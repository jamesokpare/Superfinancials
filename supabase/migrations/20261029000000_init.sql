-- Superfinancials: initial schema.
--
-- The app was written against a Firestore-style document store, so the data
-- lives in one table of JSON documents addressed by path, e.g.
--   mkt/d-2026-10-28              (public market data)
--   orgs/<uid>/members/<uid>      (organization membership)
-- Access rules mirror the original artifact's rules (see the policies below).

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user; display info other users may see.
-- Emails are deliberately NOT copied here (other users must not read them).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  avatar_url  text,
  color       text not null default '#2B5F93',
  is_admin    boolean not null default false,  -- may edit shared/admin content
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are visible to signed-in users"
  on public.profiles for select to authenticated using (true);

create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Users may not promote themselves to admin.
create or replace function public.profiles_guard_admin()
returns trigger language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and current_user = 'authenticated' then
    raise exception 'is_admin can only be changed by the service role' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard_admin before update on public.profiles
  for each row execute function public.profiles_guard_admin();

-- Create a profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  palette text[] := array['#2B5F93','#B4741A','#6A4BB8','#23807A','#C2552A','#5E7F25','#B0377A','#6B7280'];
begin
  insert into public.profiles (id, name, color)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    palette[1 + abs(hashtext(new.id::text)) % array_length(palette, 1)]
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- docs: the document store.
-- ---------------------------------------------------------------------------
create table public.docs (
  path        text primary key,
  parent      text not null,           -- collection path ("orgs/<uid>/members")
  id          text not null,           -- last path segment
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint docs_path_shape check (
    path ~ '^[A-Za-z0-9_.~:@+-]{1,200}(/[A-Za-z0-9_.~:@+-]{1,200})*$'
    and array_length(string_to_array(path, '/'), 1) % 2 = 0
  ),
  constraint docs_parent_matches check (path = parent || '/' || id)
);

create index docs_parent_idx on public.docs (parent);

create or replace function public.docs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end $$;

create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- Collections where each person writes only under their own id
-- (artifact rules "<col>/{self}" with write: interact).
create or replace function public.docs_social_root(p text)
returns boolean language sql immutable as $$
  select split_part(p, '/', 1) in ('orgs', 'outbox', 'people', 'posts', 'likes', 'dm', 'fchat');
$$;

-- Who may read a path.
--   social collections → signed-in users
--   data/users/<uid>/… → that user only
--   everything else (mkt, adm_*, energyinfra …) → anyone, including signed out
create or replace function public.docs_can_read(p text)
returns boolean language sql stable as $$
  select case
    when split_part(p, '/', 1) = 'data' then split_part(p, '/', 2) = 'users' and split_part(p, '/', 3) = auth.uid()::text
    when public.docs_social_root(p) then auth.uid() is not null
    else true
  end;
$$;

-- Who may write a path: admins anywhere; others only inside their own subtree.
create or replace function public.docs_can_write(p text)
returns boolean language sql stable as $$
  select auth.uid() is not null and (
    public.is_admin()
    or (public.docs_social_root(p) and split_part(p, '/', 2) = auth.uid()::text)
    or (split_part(p, '/', 1) = 'data' and split_part(p, '/', 2) = 'users' and split_part(p, '/', 3) = auth.uid()::text)
  );
$$;

alter table public.docs enable row level security;

create policy "docs read"   on public.docs for select using (public.docs_can_read(path));
create policy "docs insert" on public.docs for insert with check (public.docs_can_write(path));
create policy "docs update" on public.docs for update using (public.docs_can_write(path)) with check (public.docs_can_write(path));
create policy "docs delete" on public.docs for delete using (public.docs_can_write(path));

-- Deep merge for update(): nested objects merge, anything else (arrays too) replaces.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select coalesce(
    (select jsonb_object_agg(
        key,
        case
          when jsonb_typeof(a -> key) = 'object' and jsonb_typeof(b -> key) = 'object'
            then public.jsonb_deep_merge(a -> key, b -> key)
          when b ? key then b -> key
          else a -> key
        end)
     from (select jsonb_object_keys(a) as key union select jsonb_object_keys(b)) k),
    '{}'::jsonb);
$$;

-- update(): merge into an existing document; fails if it does not exist. RLS applies.
create or replace function public.docs_merge(p_path text, p_patch jsonb)
returns void language plpgsql security invoker as $$
begin
  update public.docs set data = public.jsonb_deep_merge(data, p_patch) where path = p_path;
  if not found then
    raise exception 'Document % does not exist', p_path using errcode = 'P0002';
  end if;
end $$;

-- Live updates for onSnapshot().
alter table public.docs replica identity full;
alter publication supabase_realtime add table public.docs;

-- ---------------------------------------------------------------------------
-- Storage: uploaded files (Studio). Public read; users write in their own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('assets', 'assets', true, 20971520)
on conflict (id) do nothing;

create policy "assets upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "assets delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'assets' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

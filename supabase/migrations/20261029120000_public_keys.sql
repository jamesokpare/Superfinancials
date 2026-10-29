-- End-to-end encryption: each person publishes their public key at pk/<uid>.
-- Same rule as the other social collections: signed-in users read, each
-- person writes only their own key (artifact rule "pk/{self}").
create or replace function public.docs_social_root(p text)
returns boolean language sql immutable as $$
  select split_part(p, '/', 1) in ('orgs', 'outbox', 'people', 'posts', 'likes', 'dm', 'fchat', 'pk');
$$;

-- Collections added with the November artifact update. Each person writes only under their own id; signed-in
-- users read (the artifact's rules "<col>/{self}"):
--   aiu/<uid>                      AI usage meter (tokens and requests this month), read by the organization
--   auditm/<uid>/c/<chain>         a member's sealed copy of their security-log chain head
--   auditw/<owner uid>/m/<id>      the organization owner's witness copies of members' chains
-- radig (Market Radar digests) needs no rule: like other admin content it is public to read, admin to write.
create or replace function public.docs_social_root(p text)
returns boolean language sql immutable as $$
  select split_part(p, '/', 1) in ('orgs', 'outbox', 'people', 'posts', 'likes', 'dm', 'fchat', 'pk', 'aiu', 'auditm', 'auditw');
$$;

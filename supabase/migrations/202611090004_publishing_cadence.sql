begin;
create table public.publishing_cadence (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null
);
alter table public.publishing_cadence enable row level security;
revoke all on public.publishing_cadence from public, anon, authenticated;
grant select, insert, update on public.publishing_cadence to service_role;
commit;

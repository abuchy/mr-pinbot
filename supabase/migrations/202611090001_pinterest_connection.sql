begin;

create table public.pinterest_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null default gen_random_uuid(),
  oauth_flow uuid,
  oauth_state_hash text unique,
  oauth_expires_at timestamptz,
  token_ciphertext text,
  access_expires_at timestamptz,
  refresh_locked_until timestamptz,
  reconnect_required boolean not null default false
);

alter table public.pinterest_connections enable row level security;
revoke all on public.pinterest_connections from public, anon, authenticated;
grant select, insert, update, delete on public.pinterest_connections to service_role;

commit;

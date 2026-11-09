begin;
create table public.pin_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null,
  pinterest_account text not null,
  board_id text not null check (board_id ~ '^[0-9]{1,32}$'),
  board_name text not null,
  title text not null check (char_length(title) between 1 and 100),
  description text not null check (char_length(description) <= 500),
  image_url text not null,
  destination_url text not null,
  approved_at timestamptz not null default now(),
  unique (owner_id, content_id)
);
create index pin_approvals_owner_order on public.pin_approvals(owner_id, approved_at, id);
alter table public.pin_approvals enable row level security;
revoke all on public.pin_approvals from public, anon, authenticated;
grant select, insert, delete on public.pin_approvals to service_role;
commit;

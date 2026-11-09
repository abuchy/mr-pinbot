begin;
alter table public.pin_approvals add column scheduled_at timestamptz;
grant update (scheduled_at) on public.pin_approvals to service_role;
commit;

begin;
create function public.claim_trial_pin(p_pin uuid)
returns setof public.pin_approvals
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
begin
  perform pg_advisory_xact_lock(611090005);
  select owner_id into owner from public.pin_approvals where id = p_pin;
  if owner is null or exists (
    select 1 from public.pin_approvals
    where owner_id = owner and id <> p_pin and publish_status = 'queued'
  ) then return; end if;
  return query select * from public.claim_due_pin(owner);
end;
$$;
revoke all on function public.claim_trial_pin(uuid) from public, anon, authenticated;
grant execute on function public.claim_trial_pin(uuid) to service_role;
commit;

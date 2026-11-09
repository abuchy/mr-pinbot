begin;
alter table public.pin_approvals
  add column publish_status text not null default 'queued'
    check (publish_status in ('queued', 'publishing', 'published', 'failed', 'needs_verification')),
  add column attempted_at timestamptz,
  add column published_at timestamptz,
  add column pinterest_pin_id text unique,
  add column publish_error text;

grant update (publish_status, published_at, pinterest_pin_id, publish_error)
  on public.pin_approvals to service_role;

create or replace function public.replan_pin_schedule(p_owner uuid)
returns void language plpgsql set search_path = '' as $$
declare
  settings jsonb;
  zone text;
  daily int;
  gap interval;
  starts int;
  ends int;
  spacing int;
  slack int;
  today date;
  day date;
  day_index int;
  used int;
  wall_minute int;
  wall_time timestamp;
  candidate timestamptz;
  cutoff timestamptz := statement_timestamp();
  pin_ids uuid[];
  occupied timestamptz[];
  next_pin int := 1;
begin
  select c.settings into settings from public.publishing_cadence c where c.owner_id = p_owner;
  zone := coalesce(settings->>'zone', 'America/Chicago');
  daily := coalesce((settings->>'daily')::int, 3);
  gap := make_interval(mins => coalesce((settings->>'gap')::int, 60));
  starts := extract(epoch from coalesce((settings->>'start')::time, time '09:00'))::int / 60;
  ends := extract(epoch from coalesce((settings->>'end')::time, time '21:00'))::int / 60;
  spacing := greatest(extract(epoch from gap)::int / 60, (ends - starts) / daily);
  slack := ends - starts - (daily - 1) * spacing;
  today := (cutoff at time zone zone)::date;

  update public.pin_approvals set automatic_at = null
    where owner_id = p_owner and publish_status = 'queued' and automatic_at is not null;
  select array_agg(id order by approved_at, id) filter (where scheduled_at is null and publish_status = 'queued'),
         coalesce(array_agg(coalesce(published_at, scheduled_at, automatic_at)) filter (where coalesce(published_at, scheduled_at, automatic_at) is not null), '{}'::timestamptz[])
    into pin_ids, occupied
    from public.pin_approvals where owner_id = p_owner;
  if pin_ids is null then return; end if;

  for day_index in 0..179 loop
    day := today + day_index;
    select count(*) into used from unnest(occupied) as slot
      where (slot at time zone zone)::date = day;
    if used >= daily then continue; end if;
    for wall_minute in starts + floor(slack * (0.2 + ((day - date '1970-01-01') * 37 % 61) / 100.0))::int .. ends - 1 loop
      exit when used >= daily;
      if wall_minute < starts + floor(slack * (0.2 + ((day - date '1970-01-01') * 37 % 61) / 100.0))::int + used * spacing then continue; end if;
      wall_time := day::timestamp + make_interval(mins => wall_minute);
      candidate := wall_time at time zone zone;
      if candidate <= cutoff or (candidate at time zone zone) <> wall_time then continue; end if;
      if exists (select 1 from unnest(occupied) as slot where slot > candidate - gap and slot < candidate + gap) then continue; end if;

      update public.pin_approvals set automatic_at = candidate where id = pin_ids[next_pin] and owner_id = p_owner;
      next_pin := next_pin + 1;
      if next_pin > cardinality(pin_ids) then return; end if;
      occupied := array_append(occupied, candidate);
      used := used + 1;
    end loop;
  end loop;
end;
$$;

create function public.claim_due_pin(p_owner uuid)
returns setof public.pin_approvals
language plpgsql security definer set search_path = '' as $$
declare
  settings jsonb;
  zone text;
  gap interval;
  daily int;
begin
  perform pg_advisory_xact_lock(611090005);
  update public.pin_approvals
    set publish_status = 'needs_verification', publish_error = 'The worker stopped before recording Pinterest’s response.'
    where owner_id = p_owner and publish_status = 'publishing'
      and attempted_at < now() - interval '5 minutes';

  -- A single in-flight or uncertain write blocks further sends for this owner.
  if exists (select 1 from public.pin_approvals
    where owner_id = p_owner and publish_status in ('publishing', 'needs_verification')) then return; end if;

  select c.settings into settings from public.publishing_cadence c where c.owner_id = p_owner;
  zone := coalesce(settings->>'zone', 'America/Chicago');
  daily := coalesce((settings->>'daily')::int, 3);
  gap := make_interval(mins => coalesce((settings->>'gap')::int, 60));
  if exists (select 1 from public.pin_approvals
    where owner_id = p_owner and published_at > now() - gap) then return; end if;
  if (select count(*) from public.pin_approvals where owner_id = p_owner
    and (published_at at time zone zone)::date = (now() at time zone zone)::date) >= daily then return; end if;

  -- Missed automatic slots are spread out again. Expired manual locks require review.
  update public.pin_approvals
    set publish_status = 'failed', publish_error = 'The locked publishing time was missed.'
    where owner_id = p_owner and publish_status = 'queued'
      and scheduled_at < now() - interval '10 minutes';
  if exists (select 1 from public.pin_approvals where owner_id = p_owner
      and publish_status = 'queued' and scheduled_at is null and automatic_at < now() - interval '10 minutes') then
    perform public.replan_pin_schedule(p_owner);
  end if;

  return query update public.pin_approvals as pin
    set publish_status = 'publishing', attempted_at = now()
    where pin.id = (
      select id from public.pin_approvals
      where owner_id = p_owner and publish_status = 'queued'
        and coalesce(scheduled_at, automatic_at) <= now()
      order by coalesce(scheduled_at, automatic_at), approved_at, id limit 1
    )
    returning pin.*;
end;
$$;

revoke all on function public.claim_due_pin(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_pin(uuid) to service_role;
commit;

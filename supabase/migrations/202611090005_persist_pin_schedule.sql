begin;
alter table public.pin_approvals add column automatic_at timestamptz;

create function public.replan_pin_schedule(p_owner uuid)
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
    where owner_id = p_owner and automatic_at is not null;
  select array_agg(id order by approved_at, id) filter (where scheduled_at is null),
         coalesce(array_agg(scheduled_at) filter (where scheduled_at is not null), '{}'::timestamptz[])
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

-- Serialize planning mutations before either table acquires row locks.
create function public.lock_pin_schedule()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(611090005);
  return null;
end;
$$;

create function public.refresh_pin_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.replan_pin_schedule(old.owner_id);
  else
    perform public.replan_pin_schedule(new.owner_id);
  end if;
  return null;
end;
$$;

revoke all on function public.replan_pin_schedule(uuid), public.lock_pin_schedule(), public.refresh_pin_schedule()
  from public, anon, authenticated;
create trigger lock_approval_schedule before insert or delete or update of scheduled_at on public.pin_approvals
  for each statement execute function public.lock_pin_schedule();
create trigger refresh_approval_schedule after insert or delete or update of scheduled_at on public.pin_approvals
  for each row execute function public.refresh_pin_schedule();
create trigger lock_cadence_schedule before insert or update on public.publishing_cadence
  for each statement execute function public.lock_pin_schedule();
create trigger refresh_cadence_schedule after insert or update on public.publishing_cadence
  for each row execute function public.refresh_pin_schedule();

do $$
declare owner uuid;
begin
  for owner in select distinct owner_id from public.pin_approvals loop
    perform public.replan_pin_schedule(owner);
  end loop;
end;
$$;
commit;

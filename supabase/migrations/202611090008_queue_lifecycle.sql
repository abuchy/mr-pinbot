begin;

-- Keep committed times. Allocate only jobs that have no slot or missed an automatic slot.
create or replace function public.replan_pin_schedule(p_owner uuid)
returns void language plpgsql set search_path = '' as $$
declare
  settings jsonb;
  zone text;
  daily int;
  gap interval := interval '45 minutes';
  starts int := 360;
  ends int := 1380;
  variation int := 12;
  today date;
  local_day date;
  day_index int;
  slot_index int;
  wall_minute int;
  candidate timestamptz;
  occupied timestamptz[];
  used int;
  job record;
begin
  select c.settings into settings from public.publishing_cadence c where c.owner_id = p_owner;
  zone := coalesce(settings->>'zone', 'America/Chicago');
  daily := coalesce((settings->>'daily')::int, 3);
  variation := least(variation, greatest(0, ((ends - starts) / daily - 45) / 2));
  today := (now() at time zone zone)::date;
  select coalesce(array_agg(coalesce(published_at, scheduled_at, automatic_at)), '{}')
  into occupied from public.pin_approvals where owner_id = p_owner
    and coalesce(published_at, scheduled_at, automatic_at) >= now() - interval '2 days'
    and (publish_status <> 'queued' or scheduled_at is not null or automatic_at >= now() - interval '10 minutes');

  day_index := 0;
  slot_index := 0;
  for job in select id from public.pin_approvals
    where owner_id = p_owner and publish_status = 'queued' and scheduled_at is null
      and (automatic_at is null or automatic_at < now() - interval '10 minutes')
    order by approved_at, id
  loop
    loop
      if day_index >= 180 then return; end if;
      local_day := today + day_index;
      select count(*) into used from unnest(occupied) as slot where (slot at time zone zone)::date = local_day;
      if used >= daily or slot_index >= daily then
        day_index := day_index + 1;
        slot_index := 0;
        continue;
      end if;
      -- Even bands across the day, with weekday offsets and small deterministic weekly variation.
      wall_minute := starts + ((ends - starts) * (2 * slot_index + 1)) / (2 * daily)
        + (extract(isodow from local_day)::int * 7 % 13) - 6
        + mod((local_day - date '1970-01-01') / 7 * 17 + slot_index * 11, 2 * variation + 1) - variation;
      slot_index := slot_index + 1;
      candidate := (local_day::timestamp + make_interval(mins => wall_minute)) at time zone zone;
      if candidate <= now() or exists (
        select 1 from unnest(occupied) as slot where slot > candidate - gap and slot < candidate + gap
      ) then continue; end if;
      update public.pin_approvals set automatic_at = candidate where id = job.id;
      occupied := array_append(occupied, candidate);
      exit;
    end loop;
  end loop;
end;
$$;

create or replace function public.claim_due_pin(p_owner uuid)
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
  gap := interval '45 minutes';
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

-- Serialize content edits and deletes with scheduler claims and queue mutations.
create trigger lock_content_schedule before update or delete on public.content_items
  for each statement execute function public.lock_pin_schedule();

create function public.guard_pin_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  job public.pin_approvals;
  destination text;
begin
  select * into job from public.pin_approvals where owner_id = old.owner_id and content_id = old.id;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if job.publish_status in ('publishing', 'needs_verification', 'published') then
    raise exception 'This Pin is locked by its publishing status.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    delete from public.pin_approvals where id = job.id;
    return old;
  end if;
  destination := coalesce(nullif(new.website_url, ''), new.affiliate_url);
  if char_length(btrim(new.product_name)) not between 1 and 100
     or char_length(new.product_description) > 500
     or coalesce(new.image_url, '') !~ '^https://'
     or coalesce(destination, '') !~ '^https://' then
    raise exception 'Scheduled Pins require a title, a valid image and destination, and a description of up to 500 characters.' using errcode = '23514';
  end if;
  update public.pin_approvals set title = new.product_name, description = new.product_description,
    image_url = new.image_url, destination_url = destination where id = job.id;
  return new;
end;
$$;
revoke all on function public.guard_pin_content() from public, anon, authenticated;
create trigger guard_pin_content before update or delete on public.content_items
  for each row execute function public.guard_pin_content();


grant update (title, description, image_url, destination_url, automatic_at)
  on public.pin_approvals to service_role;

create function public.schedule_library_pins(p_owner uuid, p_versions jsonb,
  p_account text, p_board text, p_board_name text)
returns integer language plpgsql set search_path = '' as $$
declare
  added uuid[];
  total int;
begin
  perform pg_advisory_xact_lock(611090005);
  with jobs as (
    insert into public.pin_approvals(owner_id, content_id, pinterest_account, board_id, board_name,
      title, description, image_url, destination_url)
    select p_owner, item.id, p_account, p_board, p_board_name, item.product_name,
      item.product_description, item.image_url, coalesce(nullif(item.website_url, ''), item.affiliate_url)
    from public.content_items item
    join jsonb_each_text(p_versions) as version on item.id = version.key::uuid
      and item.updated_at = version.value::timestamptz
    where item.owner_id = p_owner
    on conflict (owner_id, content_id) do nothing returning id
  ) select array_agg(id) into added from jobs;
  delete from public.pin_approvals where id = any(added) and automatic_at is null;
  select count(*) into total from public.pin_approvals where id = any(added);
  return total;
end;
$$;

create function public.retry_failed_library_pins(p_owner uuid, p_ids uuid[])
returns integer language plpgsql set search_path = '' as $$
declare
  total int;
begin
  perform pg_advisory_xact_lock(611090005);
  update public.pin_approvals set publish_status = 'queued', scheduled_at = null,
    automatic_at = null, publish_error = null
    where owner_id = p_owner and content_id = any(p_ids) and publish_status = 'failed'
      and exists (select 1 from public.content_items item
        where item.owner_id = p_owner and item.id = pin_approvals.content_id);
  get diagnostics total = row_count;
  return total;
end;
$$;
revoke all on function public.schedule_library_pins(uuid, jsonb, text, text, text),
  public.retry_failed_library_pins(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.schedule_library_pins(uuid, jsonb, text, text, text),
  public.retry_failed_library_pins(uuid, uuid[]) to service_role;
-- Jobs for historically deleted drafts cannot be sent. Preserve their history.
update public.pin_approvals as job set publish_status = 'failed',
  publish_error = 'The source Pin was deleted before publishing.'
  where publish_status = 'queued' and not exists (
    select 1 from public.content_items item where item.owner_id = job.owner_id and item.id = job.content_id
  );
commit;

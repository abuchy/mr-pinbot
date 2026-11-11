-- Explicit user action, serialized with scheduler claims and content edits.
create function public.claim_pin_now(p_owner uuid, p_content uuid, p_version timestamptz,
  p_account text, p_board text, p_board_name text)
returns setof public.pin_approvals
language plpgsql security definer set search_path = '' as $$
declare
  item public.content_items;
begin
  perform pg_advisory_xact_lock(611090005);
  select * into item from public.content_items
    where owner_id = p_owner and id = p_content and updated_at = p_version;
  if not found then return; end if;
  if exists (select 1 from public.pin_approvals
    where owner_id = p_owner and publish_status in ('publishing', 'needs_verification')) then return; end if;

  return query
    insert into public.pin_approvals(owner_id,content_id,pinterest_account,board_id,board_name,
      title,description,image_url,destination_url,publish_status,attempted_at,scheduled_at)
    values (p_owner,item.id,p_account,p_board,p_board_name,item.product_name,
      item.product_description,item.image_url,coalesce(nullif(item.website_url,''),item.affiliate_url),
      'publishing',now(),now())
    on conflict (owner_id,content_id) do update
      set publish_status = 'publishing', attempted_at = now(), scheduled_at = now(), publish_error = null
      where public.pin_approvals.publish_status in ('queued','failed')
        and public.pin_approvals.board_id = excluded.board_id
        and public.pin_approvals.pinterest_account = excluded.pinterest_account
    returning *;
end;
$$;
revoke all on function public.claim_pin_now(uuid,uuid,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_pin_now(uuid,uuid,timestamptz,text,text,text) to service_role;

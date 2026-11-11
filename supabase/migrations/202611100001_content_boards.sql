-- Additive. Existing Pins remain available and can have a board assigned later.
alter table public.content_items
  add column if not exists pinterest_board_id text,
  add column if not exists pinterest_board_name text;
alter table public.content_items
  add constraint content_items_board_id_format
  check (pinterest_board_id is null or pinterest_board_id ~ '^[0-9]{1,32}$');

-- The existing statement lock serializes this guard with scheduling.
create function public.guard_pin_board()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pinterest_board_id is distinct from old.pinterest_board_id
    and exists (select 1 from public.pin_approvals where owner_id = old.owner_id and content_id = old.id) then
    raise exception 'Unschedule this Pin before changing its board.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pin_board() from public, anon, authenticated;
create trigger guard_pin_board before update on public.content_items
  for each row execute function public.guard_pin_board();

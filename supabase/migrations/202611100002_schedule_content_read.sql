-- schedule_library_pins executes as service_role and reads draft content.
-- Keep client roles and row-level security unchanged.
grant select on public.content_items to service_role;

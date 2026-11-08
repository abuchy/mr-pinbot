begin;
grant delete on public.content_items to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'content_items' and policyname = 'Delete own content') then
    create policy "Delete own content" on public.content_items for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end $$;
commit;

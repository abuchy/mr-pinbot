-- Apply once in the Supabase SQL editor. Membership is provisioned by an administrator.
begin;
create table public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.workspace_members enable row level security;
revoke all on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;
create policy "Read own membership" on public.workspace_members for select to authenticated using ((select auth.uid()) = user_id);
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.workspace_members(user_id),
  source_key text not null check (source_key ~ '^shopmy:p-[1-9][0-9]*$'),
  affiliate_url text not null check (affiliate_url ~ '^https://go[.]shopmy[.]us/p-[1-9][0-9]*([?].*)?$'),
  product_name text not null default '' check (length(product_name) <= 300),
  retailer text not null default '' check (length(retailer) <= 150),
  product_url text not null default '' check (length(product_url) <= 2048 and (product_url = '' or product_url like 'https://%')),
  image_url text not null default '' check (length(image_url) <= 2048 and (image_url = '' or image_url like 'https://%')),
  image_rights_confirmed boolean not null default false,
  notes text not null default '' check (length(notes) <= 3000),
  source text not null default 'pasted_link' check (source in ('pasted_link','official_shopmy_api','authorized_browser')),
  enrichment_status text not null default 'manual_required' check (enrichment_status in ('manual_required','enriched')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key),
  check (image_url = '' or image_rights_confirmed)
);
create index content_items_owner_created on public.content_items(owner_id, created_at desc);
alter table public.content_items enable row level security;
revoke all on public.content_items from anon, authenticated;
grant select, insert, update on public.content_items to authenticated;
create policy "Read own content" on public.content_items for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Insert own content" on public.content_items for insert to authenticated with check ((select auth.uid()) = owner_id and exists (select 1 from public.workspace_members where user_id = (select auth.uid())));
create policy "Update own content" on public.content_items for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
commit;

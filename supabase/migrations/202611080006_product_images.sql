begin;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,400000,array['image/webp'])
on conflict (id) do nothing;

create table public.product_image_assets (
 owner_id uuid not null references public.workspace_members(user_id),
 hash text not null check (hash ~ '^[0-9a-f]{64}$'),
 object_path text not null unique,
 source_url text not null check (length(source_url) <= 2048),
 byte_size integer not null check (byte_size between 1 and 400000),
 primary key(owner_id,hash),
 check (object_path like owner_id::text || '/' || hash || '/%')
);
create index product_image_assets_source on public.product_image_assets(owner_id,source_url);
alter table public.product_image_assets enable row level security;
revoke all on public.product_image_assets from anon, authenticated;
grant select, insert on public.product_image_assets to authenticated;
create policy "Read own image assets" on public.product_image_assets for select to authenticated
using (owner_id = (select auth.uid()));
create policy "Reserve own image assets" on public.product_image_assets for insert to authenticated
with check (owner_id = (select auth.uid()) and exists (select 1 from public.workspace_members where user_id = (select auth.uid())));
create policy "Upload reserved product images" on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and exists (
 select 1 from public.product_image_assets where owner_id = (select auth.uid()) and object_path = name
));
alter table public.content_items add column original_image_url text not null default '';
commit;

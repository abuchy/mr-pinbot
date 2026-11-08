begin;
-- Preserve original attribution and all existing records. Website is a separate editable publishing destination.
alter table public.content_items add column if not exists website_url text check (website_url is null or (length(website_url)<=2048 and website_url like 'https://%'));
alter table public.content_items add column if not exists description_is_manual boolean not null default true;
alter table public.content_items add column if not exists description_image_url text not null default '' check (length(description_image_url)<=2048);
-- Saving a reference image is not an assertion of licensing; Pin approval remains separate.
alter table public.content_items drop constraint if exists content_items_check;
create table if not exists public.product_variant_hints (
 owner_id uuid not null references public.workspace_members(user_id),
 product_identity text not null,
 variant_id text not null,
 product_title text not null check(length(product_title)<=200),
 label text not null check(length(label)<=150),
 attributes jsonb not null default '{}',
 image_url text not null default '',
 primary key(owner_id,product_identity,variant_id)
);
alter table public.product_variant_hints enable row level security;
revoke all on public.product_variant_hints from anon,authenticated;
grant select on public.product_variant_hints to authenticated;
create policy "Read own variant corrections" on public.product_variant_hints for select to authenticated using ((select auth.uid())=owner_id);
-- User's explicit correction from this request; not claimed as independent retailer verification.
insert into public.product_variant_hints(owner_id,product_identity,variant_id,product_title,label,attributes)
select user_id,'https://klassyshop.com/products/solid-triangle-cami-tank','50517004091454','Triangle Cami Tank','Plum and White Polka Dot','{"Color":"Plum and White Polka Dot"}'::jsonb
from public.workspace_members where user_id='668eb378-210c-4ac6-a79a-ddc67dcdcd8d'
on conflict do nothing;
commit;

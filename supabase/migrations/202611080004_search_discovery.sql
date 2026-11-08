begin;
alter table public.content_items add column if not exists product_description text not null default '' check (length(product_description)<=2000);
commit;

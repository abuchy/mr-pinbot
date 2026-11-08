begin;
alter table public.content_items drop constraint content_items_enrichment_status_check;
alter table public.content_items add constraint content_items_enrichment_status_check check (enrichment_status in ('pending','partial','review_required','manual','enriched')) not valid;
alter table public.content_items add column metadata_reviewed boolean not null default false;
alter table public.content_items add column enrichment_report jsonb not null default '{"attempts":[],"checked_at":null}'::jsonb;
update public.content_items set enrichment_status = case when product_name<>'' and retailer<>'' and product_url<>'' and image_url<>'' then 'review_required' when product_name<>'' or retailer<>'' then 'partial' else 'pending' end,
 enrichment_report='{"attempts":[{"stage":"resolution","source":"authorization_registry","code":"resolution_permission_required","message":"Metadata pending: no authorized resolver is connected for this affiliate link. Your original link is preserved.","at":"migration"}],"checked_at":null}'::jsonb;
alter table public.content_items alter column enrichment_status set default 'pending';
alter table public.content_items validate constraint content_items_enrichment_status_check;
alter table public.content_items drop constraint content_items_source_key_check;
alter table public.content_items add constraint content_items_source_key_check check (source_key ~ '^shopmy:(p-[1-9][0-9]*|apx:.+)$');
alter table public.content_items drop constraint content_items_affiliate_url_check;
alter table public.content_items add constraint content_items_affiliate_url_check check (affiliate_url ~* '^https://go[.]shopmy[.]us/(p-[1-9][0-9]*/?([?#].*)?|apx/[^/?#]+[?].+)$');
-- Attribution identity must never be rewritten by enrichment or edits.
create function public.preserve_affiliate_identity() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.affiliate_url is distinct from old.affiliate_url or new.source_key is distinct from old.source_key or new.owner_id is distinct from old.owner_id then
 raise exception 'Original affiliate identity cannot be changed';
 end if;
 return new;
end; $$;
create trigger preserve_affiliate_identity before update on public.content_items for each row execute function public.preserve_affiliate_identity();
commit;

import { NextRequest } from 'next/server';
import { authenticatedDatabase, privateJson, sameOrigin } from '@/lib/api-auth';
import { enrichFromAuthorizedSources } from '@/lib/enrichment';
import { hostEnrichedImage, imageFailureCode, storeProductImage } from '@/lib/product-images';
import { describeImage } from '@/lib/description';
import { isBlockedMetadata } from '@/lib/enrichment/blocked';
import { attempt, type Fields } from '@/lib/enrichment/model';
import type { ContentItem } from '@/lib/content';

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return privateJson({ error: 'Request not allowed.' }, 403);
  try {
    const auth = await authenticatedDatabase(request);
    if (!auth) return privateJson({ error: 'Please sign in.' }, 401);
    const { id } = await params;
    const { database, user } = auth;
    const { data, error } = await database.from('content_items').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
    if (error || !data) return privateJson({ error: 'Item not found.' }, 404);
    const item: ContentItem = data;
    if (item.enrichment_report?.checked_at && Date.now() - Date.parse(item.enrichment_report.checked_at) < 65000) {
      return privateJson({ error: 'Wait a minute before retrying this Pin.' }, 429);
    }
    const claimedAt = new Date().toISOString();
    const claimedReport = { ...item.enrichment_report, checked_at: claimedAt };
    const claim = await database.from('content_items')
      .update({ updated_at: claimedAt, enrichment_report: claimedReport })
      .eq('id', id).eq('owner_id', user.id).eq('updated_at', item.updated_at).select('id').maybeSingle();
    if (claim.error || !claim.data) return privateJson({ error: 'This Pin changed. Refresh before retrying.' }, 409);

    const fields: Fields & { original_image_url?: string } = {};
    if (isBlockedMetadata(item.product_name)) fields.product_name = '';
    if (isBlockedMetadata(item.product_description)) fields.product_description = '';
    // Re-resolve drafts saved before affiliate-network destinations were decoded.
    if (item.product_url && /^https:\/\/click\.linksynergy\.com(?:\/|$)/i.test(item.product_url)) fields.product_url = '';
    const current = { ...item, ...fields };
    let notice = '';
    let report = claimedReport;
    if (!current.product_name || !current.image_url || !current.product_url || (report.variant_review && report.variant?.source !== 'user_confirmed')) {
      const result = await enrichFromAuthorizedSources(current, current, database);
      const hosted = await hostEnrichedImage(result, database, user.id);
      Object.assign(fields, result.suggestions);
      if (hosted.original_image_url) fields.original_image_url = hosted.original_image_url;
      notice = hosted.image_notice || '';
      report = {
        ...report, ...result.enrichment_report, checked_at: claimedAt,
        variant_review: result.enrichment_report.variant_review,
        fields: { ...report.fields, ...result.enrichment_report.fields },
        attempts: [...result.enrichment_report.attempts, ...(hosted.image_code ? [
          attempt('metadata', 'product_image', hosted.image_code, hosted.image_notice || 'No verified image URL was found.'),
        ] : [])],
      };
      console.info('[pinbot:enrichment]', { id, attempts: report.attempts.map(({ source, code }) => ({ source, code })) });
    }
    if (!fields.image_url && item.image_url && !item.image_url.includes('/storage/v1/object/public/product-images/')) {
      try {
        Object.assign(fields, await storeProductImage(database, user.id, item.image_url, item.product_name));
      } catch (error) {
        console.warn('[pinbot:image]', { id, code: imageFailureCode(error) });
        notice = error instanceof Error ? error.message : 'The image could not be stored.';
      }
    }
    const restricted = report.attempts?.some(entry => ['source_restricted', 'blocked_by_robots', 'blocked_metadata'].includes(entry.code));
    report.import_notice = notice || (restricted
      ? 'A source blocked access to product details. Retry or add the missing details in Edit this Pin.'
      : 'Product details are incomplete. Retry or add the missing details in Edit this Pin.');
    const merged = { ...item, ...fields };
    const uncertain = !!report.variant_review && report.variant?.source !== 'user_confirmed';
    const checkpointAt = new Date().toISOString();
    const checkpoint = await database.from('content_items').update({
      ...fields, enrichment_report: report, enrichment_status: merged.product_name || merged.image_url ? 'partial' : 'pending',
      updated_at: checkpointAt,
    }).eq('id', id).eq('owner_id', user.id).eq('updated_at', claimedAt).select('*').maybeSingle();
    if (checkpoint.error) console.warn('[pinbot:enrichment]', { id, code: 'metadata_persistence_failed', databaseCode: checkpoint.error.code });
    if (checkpoint.error || !checkpoint.data) return privateJson({ error: 'This Pin changed during import. Refresh before retrying.' }, 409);

    const descriptionFields: { product_description?: string; description_image_url?: string; description_is_manual?: boolean } = {};
    if (merged.image_url && !notice && !uncertain && !merged.product_description && !(item.metadata_reviewed && item.description_is_manual)) {
      try {
        const generated = await describeImage(merged.image_url, merged.product_name);
        Object.assign(descriptionFields, {
          product_description: generated.description, description_image_url: generated.image_url, description_is_manual: false,
        });
      } catch {
        notice = 'The description could not be generated. Retry or add one in Edit this Pin.';
      }
    } else if (fields.image_url && item.image_url && item.image_url === item.description_image_url) {
      descriptionFields.description_image_url = fields.image_url;
    }
    const complete = !!(merged.product_name && merged.image_url && (descriptionFields.product_description || merged.product_description) && !notice && !uncertain);
    const saved = await database.from('content_items').update({
      ...descriptionFields,
      enrichment_status: complete ? 'enriched' : checkpoint.data.enrichment_status,
      enrichment_report: { ...report, import_notice: complete ? '' : notice || (uncertain ? report.variant_review : report.import_notice) },
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('owner_id', user.id).eq('updated_at', checkpointAt).select('*').maybeSingle();
    if (saved.error) console.warn('[pinbot:enrichment]', { id, code: 'description_persistence_failed', databaseCode: saved.error.code });
    if (saved.error || !saved.data) return privateJson({ error: 'This Pin changed during import. Refresh before retrying.' }, 409);
    return privateJson({ item: saved.data, complete });
  } catch {
    return privateJson({ error: 'Product details could not be finished. Your link is saved and can be retried.' }, 503);
  }
}

import { attempt, complete, type Fields, type MetadataProvider, type ProductContext, type Provenance, type Report, type Resolver, type Result } from './model';
import { safePublicUrl } from '../content';
export type Pipeline = { resolvers: readonly Resolver[]; providers: readonly MetadataProvider[] };
export async function runPipeline(context: ProductContext, current: Fields, pipeline: Pipeline): Promise<Result> {
  const report: Report = {attempts:[],checked_at:new Date().toISOString(),fields:{}};
  const suggestions: Fields = {};
  let productUrl=context.product_url; let variant=context.variant;
  const accept=(fields:Fields, origin?:Provenance, perField?:Partial<Record<keyof Fields,Provenance>>) => {
    for (const key of ['product_name','product_description','retailer','product_url','image_url'] as const) {
      const value=fields[key];
      if (typeof value!=='string' || !value.trim()) continue;
      if(current[key]===value.trim()&&(perField?.[key]||origin))report.fields[key]=perField?.[key]||origin;
      if(current[key]||suggestions[key])continue;
      if(key==='image_url'&&productUrl&&new URL(productUrl).searchParams.has('variant')&&!perField?.image_url&&variant?.image_url!==value)continue;
      if ((key==='product_url'||key==='image_url') && !safePublicUrl(value)) continue;
      suggestions[key]=value.trim().slice(0,key==='product_name'?300:key==='retailer'?150:key==='product_description'?2000:2048);
      if (perField?.[key]||origin) report.fields[key]=perField?.[key]||origin;
    }
  };
  const failure=(stage:'resolution'|'metadata',source:string,error:unknown) => report.attempts.push(attempt(stage,source,error instanceof Error && error.name==='SourceError' && 'code' in error?String(error.code):'source_unavailable',error instanceof Error && error.name==='SourceError'?error.message:'The authorized source could not be reached. Your link is safe; retry later.'));
  if (!productUrl) for (const resolver of pipeline.resolvers) {
    try { const result=await resolver.resolve(context); report.attempts.push(...result.attempts); if (result.url && safePublicUrl(result.url)) {productUrl=result.url;accept({product_url:productUrl},result.provenance);break;} }
    catch(error){failure('resolution',resolver.id,error);}
  }
  // Catalog/feed providers may match an explicit licensed ID mapping even when
  // an opaque affiliate link has no resolved retailer URL.
  for (const provider of pipeline.providers) {
    if(provider.id==='tavily_search'&&complete({...current,...suggestions})&&!new URL(productUrl).searchParams.has('variant'))continue;
    try { const result=await provider.lookup({...context,product_url:productUrl,variant});report.attempts.push(...result.attempts);if(result.variant){variant=result.variant;report.variant=variant;}accept(result.fields,result.provenance,result.fieldProvenance);if(result.imageCandidates)report.image_candidates=result.imageCandidates;productUrl ||= suggestions.product_url || ''; }
    catch(error){failure('metadata',provider.id,error);}
  }
  if(productUrl&&new URL(productUrl).searchParams.has('variant')&&!variant)report.variant_review='Exact variant is not identified. Add or correct its title and image before publishing.';
  if(variant&&suggestions.product_name&&!suggestions.product_name.toLowerCase().includes(variant.label.toLowerCase()))suggestions.product_name+=` - ${variant.label}`;
  const merged={...current,...suggestions};
  if (!complete(merged) && !pipeline.providers.some(p=>p.id!=='permitted_page')) report.attempts.push(attempt('metadata','catalog_registry','provider_not_configured','No additional product-data source is configured for the missing fields.'));
  const found=!!(merged.product_name||merged.retailer||merged.image_url);
  return {enrichment_status:complete(merged)?'review_required':found?'partial':'pending',enrichment_report:report,suggestions};
}

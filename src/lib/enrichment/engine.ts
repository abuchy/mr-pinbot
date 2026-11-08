import { attempt, complete, type Fields, type MetadataProvider, type ProductContext, type Provenance, type Report, type Resolver, type Result } from './model';
import { safePublicUrl } from '../content';
export type Pipeline = { resolvers: readonly Resolver[]; providers: readonly MetadataProvider[] };
export async function runPipeline(context: ProductContext, current: Fields, pipeline: Pipeline): Promise<Result> {
  const report: Report = {attempts:[],checked_at:new Date().toISOString(),fields:{}};
  const suggestions: Fields = {};
  let productUrl=context.product_url;
  const accept=(fields:Fields, origin?:Provenance) => {
    for (const key of ['product_name','retailer','product_url','image_url'] as const) {
      const value=fields[key];
      if (typeof value!=='string' || !value.trim() || current[key] || suggestions[key]) continue;
      if ((key==='product_url'||key==='image_url') && !safePublicUrl(value)) continue;
      suggestions[key]=value.trim().slice(0,key==='product_name'?300:key==='retailer'?150:2048);
      if (origin) report.fields[key]=origin;
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
    try { const result=await provider.lookup({...context,product_url:productUrl});report.attempts.push(...result.attempts);accept(result.fields,result.provenance);productUrl ||= suggestions.product_url || ''; }
    catch(error){failure('metadata',provider.id,error);}
  }
  const merged={...current,...suggestions};
  if (!complete(merged) && !pipeline.providers.some(p=>p.id!=='permitted_page')) report.attempts.push(attempt('metadata','catalog_registry','provider_not_configured','No additional product-data source is configured for the missing fields.'));
  const found=!!(merged.product_name||merged.retailer||merged.image_url);
  return {enrichment_status:complete(merged)?'review_required':found?'partial':'pending',enrichment_report:report,suggestions};
}

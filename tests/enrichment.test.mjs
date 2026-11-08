import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractMetadata} from '../src/lib/enrichment/metadata.ts';
import {runPipeline} from '../src/lib/enrichment/engine.ts';
import {EmbeddedDestinationResolver,AuthorizedRedirectResolver,LicensedFeedProvider} from '../src/lib/enrichment/adapters.ts';
import {grantFor,publicIPv4,SourceError} from '../src/lib/enrichment/http.ts';
import {parseShopMyLink} from '../src/lib/content.ts';
const context={affiliate_url:'https://go.shopmy.us/p-101876060',source_key:'shopmy:p-101876060',product_url:''};
test('opaque ShopMy link remains pending; unconfigured resolver makes zero requests',async()=>{
 const result=await runPipeline(context,{}, {resolvers:[new EmbeddedDestinationResolver(),new AuthorizedRedirectResolver([])],providers:[]});
 assert.equal(result.enrichment_status,'pending');assert.deepEqual(result.suggestions,{});assert.ok(result.enrichment_report.attempts.some(a=>a.code==='resolution_permission_required'));
});
test('embedded destination is locally decoded and original attribution is preserved',async()=>{
 const url='https://go.shopmy.us/apx/anna?url=https%3A%2F%2Fexample.com%2Fp%3Fvariant%3Dblue&c=1';
 const link=parseShopMyLink(url);assert.equal(link.affiliate_url,url);
 const result=await new EmbeddedDestinationResolver().resolve({...link,product_url:''});assert.equal(result.url,'https://example.com/p?variant=blue');
});
test('parses JSON-LD graph and OG; does not mistake brand for retailer',()=>{
 const html='<meta property="og:site_name" content="Retail shop"><meta property="og:image" content="/image.jpg"><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Tank","brand":{"name":"Brand"}}]}</script>';
 const {fields}=extractMetadata(html,'https://example.com/product');assert.equal(fields.product_name,'Tank');assert.equal(fields.retailer,'Retail shop');assert.equal(fields.image_url,'https://example.com/image.jpg');
});
test('malformed and ambiguous JSON-LD falls back to page OG',()=>{
 const html='<meta property="og:title" content="Page title"><script type="application/ld+json">bad</script><script type="application/ld+json">[{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]</script>';
 assert.equal(extractMetadata(html,'https://example.com/p').fields.product_name,'Page title');
});
test('licensed feed exact match supplies suggestions without replacing original or manual fields',async()=>{
 const feed=new LicensedFeedProvider({id:'merchant-feed',authorizationReference:'merchant contract',expiresAt:'2099-01-01',permitsShopMyDestination:true,imagesMayBeRepublished:true,records:[{source_key:context.source_key,product_name:'Auto name',retailer:'Retailer',product_url:'https://example.com/p',image_url:'https://example.com/i.jpg'}]});
 const result=await runPipeline(context,{product_name:'My title'},{resolvers:[],providers:[feed]});assert.equal(result.suggestions.product_name,undefined);assert.equal(result.suggestions.retailer,'Retailer');assert.equal(result.enrichment_status,'review_required');assert.ok(result.enrichment_report.fields.image_url);
});
test('ambiguous feed results are not guessed; failed source does not discard link',async()=>{
 const provider={id:'test',lookup:async()=>{throw new SourceError('rate_limited','Retry later.')}};
 const result=await runPipeline(context,{}, {resolvers:[],providers:[provider]});assert.equal(result.enrichment_status,'pending');assert.equal(result.enrichment_report.attempts[0].code,'rate_limited');
});
test('permissions are origin, path, purpose and time bound; unsafe IPs are rejected',()=>{
 const grants=[{origin:'https://example.com',pathPrefix:'/products',purpose:'metadata',authorizationReference:'terms',expiresAt:'2099-01-01'}];
 assert.ok(grantFor(new URL('https://example.com/products/p'),'metadata',grants));
 assert.equal(grantFor(new URL('https://example.com/products-evil/p'),'metadata',grants),undefined);
 assert.equal(grantFor(new URL('https://example.com/products/p'),'redirect',grants),undefined);
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.1.1','198.18.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('8.8.8.8'),true);
});

import {ShopMyPublicLinkResolver} from '../src/lib/enrichment/shopmy-redirect.ts';
test('public ShopMy resolver requests only the supplied URL and decodes Location without calling the API',async()=>{
 const calls=[];
 const resolver=new ShopMyPublicLinkResolver(async(url,purpose,_grants,options)=>{calls.push([url.href,purpose,options.head]);return {status:302,location:'https://apiv3.shopmy.us/api/redirect_click?url=https%3A%2F%2Fexample.com%2Fp%3Fvariant%3Dblue%26utm_source%3DShopMy',contentType:'',body:''};});
 const result=await resolver.resolve(context);
 assert.equal(result.url,'https://example.com/p?variant=blue&utm_source=ShopMy');
 assert.deepEqual(calls,[[context.affiliate_url,'redirect',true]]);
});
test('Open Graph is preferred over conflicting JSON-LD, with JSON-LD as fallback',()=>{
 const html='<meta property="og:title" content="OG name"><meta property="og:image" content="/og.jpg"><script type="application/ld+json">{"@type":"Product","name":"JSON name","image":"/json.jpg"}</script>';
 const result=extractMetadata(html,'https://example.com/p');assert.equal(result.fields.product_name,'OG name');assert.equal(result.fields.image_url,'https://example.com/og.jpg');
});

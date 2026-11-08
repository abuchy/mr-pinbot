import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shopifyVariant} from '../src/lib/enrichment/variants.ts';
import {matchSearch} from '../src/lib/enrichment/search.ts';
import {describeImage} from '../src/lib/description.ts';
const url='https://shop.example/products/tank?variant=42&color=plum';
test('Shopify exact ID preserves selected options and image; does not use parent or first variant',()=>{
 const data={title:'Tank',featured_image:'/wrong.png',options:['Color','Size'],variants:[{id:41,title:'Red',featured_image:{src:'/red.png'}},{id:42,title:'Plum and White Polka Dot / S',option1:'Plum and White Polka Dot',option2:'S',featured_image:{src:'/plum-dot.png'}}]};
 const selected=shopifyVariant(data,url);assert.equal(selected.id,'42');assert.equal(selected.attributes.Color,'Plum and White Polka Dot');assert.equal(selected.image_url,'https://shop.example/plum-dot.png');assert.equal(shopifyVariant(data,url.replace('42','99')),undefined);
});
test('known colorway excludes plain plum and other dot colors from search image suggestions',()=>{
 const context={product_url:url,variant:{id:'42',label:'Plum and White Polka Dot',source:'user_confirmed',attributes:{}}};
 const result=matchSearch(context,{results:[{url:'https://shop.example/products/tank',title:'Triangle Cami Tank – Retailer'}],images:[{url:'https://shop.example/plain.png',title:'Triangle Cami Tank Plum / S'},{url:'https://shop.example/right.png',title:'Triangle Cami Tank Plum and White Polka Dot / XS'},{url:'https://shop.example/red.png',title:'Triangle Cami Tank Red and White Polka Dot'}]});
 assert.match(result.fields.product_name,/Plum and White Polka Dot/);assert.equal(result.fields.image_url,'https://shop.example/right.png');assert.equal(result.images.length,1);
});
test('vision integration sends image, uses no stored response, and handles missing credentials explicitly',async()=>{
 await assert.rejects(describeImage('https://shop.example/photo.png','Tank',''),/OPENAI_API_KEY/);
 const result=await describeImage('https://shop.example/photo.png','Tank','test',async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.input[0].content[1].image_url,'https://shop.example/photo.png');return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'A plum polka-dot cami with slim straps.'}]}]}));});
 assert.equal(result.description,'A plum polka-dot cami with slim straps.');
});
test('indexed variant URLs reject another ID and can identify a labeled selected variant',()=>{
 const result=matchSearch({product_url:url},{results:[{url:'https://shop.example/products/tank?variant=99',title:'Triangle Cami Tank - Red - Retailer'},{url:'https://shop.example/products/tank?variant=42',title:'Triangle Cami Tank - Plum and White Polka Dot - Retailer'}],images:[{url:'https://shop.example/plum-dot.png',title:'Triangle Cami Tank Plum and White Polka Dot'}]});
 assert.equal(result.variant.id,'42');assert.equal(result.variant.source,'search_index');assert.match(result.fields.product_name,/Plum and White Polka Dot/);assert.equal(result.fields.image_url,'https://shop.example/plum-dot.png');
});
test('a parent page indexed under another variant can anchor only an independently known colorway',()=>{
 const result=matchSearch({product_url:url,variant:{id:'42',label:'Plum and White Polka Dot',source:'user_confirmed',attributes:{}}},{results:[{url:'https://shop.example/products/tank?variant=99',title:'Triangle Cami Tank – Retailer'}],images:[{url:'https://shop.example/red.png',title:'Triangle Cami Tank Red'},{url:'https://shop.example/plum-dot.png',title:'Triangle Cami Tank Plum and White Polka Dot / S'}]});
 assert.equal(result.variant.id,'42');assert.equal(result.fields.image_url,'https://shop.example/plum-dot.png');assert.equal(result.images.length,1);
});
test('combines a colorway image from the first query with product-page evidence from the second',async()=>{
 const {TavilySearchProvider}=await import('../src/lib/enrichment/search.ts');let calls=0;
 const provider=new TavilySearchProvider('test',async()=>new Response(JSON.stringify(++calls===1?{results:[{url:'https://shop.example/products/halter',title:'Square Neck Halter – Retailer'}],images:[{url:'https://shop.example/plum-dot.png',title:'Triangle Cami Tank Plum and White Polka Dot / S'}]}:{results:[{url:'https://shop.example/products/tank?variant=99',title:'Triangle Cami Tank – Retailer'}],images:[{url:'https://shop.example/red.png',title:'Triangle Cami Tank Red'}]})));
 const result=await provider.lookup({product_url:url,variant:{id:'42',label:'Plum and White Polka Dot',source:'user_confirmed',attributes:{}}});
 assert.equal(calls,2);assert.equal(result.fields.image_url,'https://shop.example/plum-dot.png');assert.match(result.fields.product_name,/Plum and White Polka Dot/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {imageFilename,optimizeProductImage} from '../src/lib/product-images.ts';
test('WebP stays within the dimension and storage budgets without upscaling',async()=>{
 for(const width of [220,2200]){
  const png=await sharp({create:{width,height:width/2,channels:3,background:'#61203b'}}).png().toBuffer();
  const output=await optimizeProductImage(png);
  const meta=await sharp(output).metadata();
  assert.equal(meta.format,'webp');
  assert.equal(meta.width,Math.min(width,1500));
  assert.equal(meta.height,Math.min(width,1500)/2);
  assert.ok(output.length<=400000);
 }
});
test('rejects SVG and malformed inputs',async()=>{
 await assert.rejects(optimizeProductImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')));
 await assert.rejects(optimizeProductImage(Buffer.from('not an image')));
});
test('filename carries the colorway and hash',()=>assert.equal(imageFilename('Triangle Cami Tank — Plum and White Polka Dot','a81f3c123456'),'triangle-cami-tank-plum-white-polka-dot-a81f3c1234.webp'));

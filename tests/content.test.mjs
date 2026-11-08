import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShopMyLink, previewImport, validateDetails } from '../src/lib/content.ts';
test('deduplicates products across query strings, fragments and trailing slashes', () => {
  const p = previewImport('https://go.shopmy.us/p-123\nhttps://go.shopmy.us/p-123/?ref=abc#x, https://go.shopmy.us/p-456');
  assert.equal(p.links.length, 2); assert.equal(p.duplicates, 1); assert.deepEqual(p.invalid, []);
  assert.equal(p.links[0].source_key, 'shopmy:p-123');
});
test('retains affiliate query attribution on the saved link', () => {
  assert.equal(parseShopMyLink('https://go.shopmy.us/p-123?ref=abc#x').affiliate_url, 'https://go.shopmy.us/p-123?ref=abc#x');
});
test('rejects deceptive hosts, embedded credentials, executable protocols and unsupported formats', () => {
  for (const url of ['https://go.shopmy.us.evil.com/p-123','https://go.shopmy.us@evil.com/p-123','https://user@go.shopmy.us/p-123','javascript:alert(1)','http://go.shopmy.us/p-123','https://go.shopmy.us/apx/anna','https://go.shopmy.us/p-123/evil','https://go.shopmy.us:444/p-123']) assert.equal(parseShopMyLink(url), null, url);
});
test('rejects empty and oversized imports while reporting invalid entries', () => {
  assert.throws(() => previewImport(''));
  assert.throws(() => previewImport(Array(101).fill('https://go.shopmy.us/p-123').join('\n')));
  assert.equal(previewImport('bad https://go.shopmy.us/p-123').invalid.length, 1);
});
const details = { product_name:'Tank', website_url:'https://go.shopmy.us/p-123', image_url:'' };
test('stores four-field drafts without obsolete confirmation requirements', () => {
  assert.equal(validateDetails(details).product_name, 'Tank');
  assert.equal(validateDetails({...details, image_url:'https://example.com/image.jpg'}).image_url,'https://example.com/image.jpg');
  assert.throws(() => validateDetails({...details, website_url:'javascript:alert(1)'}));
  assert.throws(() => validateDetails({...details, product_name:'x'.repeat(301)}));
  assert.equal('image_rights_confirmed' in validateDetails(details),false);
});

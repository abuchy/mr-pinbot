import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processImportQueue} from '../src/lib/import-queue.ts';
import {previewImport} from '../src/lib/content.ts';

test('one link follows the same processing and completion path', async () => {
  const updates = [];
  await processImportQueue([{id:'one'}], async () => true, (...args) => updates.push(args));
  assert.deepEqual(updates, [['one','processing'],['one','completed']]);
});

test('bulk import limits concurrency and continues after partial and failed lookups', async () => {
  const parsed = previewImport('https://go.shopmy.us/p-1 https://go.shopmy.us/p-2, https://go.shopmy.us/p-1\nhttps://go.shopmy.us/p-3 https://go.shopmy.us/p-4');
  assert.equal(parsed.duplicates, 1);
  let active = 0;
  let peak = 0;
  const statuses = {};
  await processImportQueue(parsed.links.map(link => ({id:link.source_key})), async ({id}) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (id.endsWith('2')) throw new Error('Provider unavailable');
    return !id.endsWith('3');
  }, (id, status) => { statuses[id] = status; });
  assert.equal(peak, 2);
  assert.deepEqual(statuses, {'shopmy:p-1':'completed','shopmy:p-2':'attention','shopmy:p-3':'attention','shopmy:p-4':'completed'});
});

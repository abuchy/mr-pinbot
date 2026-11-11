import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/api/publishing-queue/batch/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const item = (id, board) => ({
  id, pinterest_board_id: board, updated_at: '2026-11-10T00:00:00Z',
  product_name: 'Test product', product_description: 'Product description',
  image_url: 'https://example.com/image.png', affiliate_url: 'https://go.shopmy.us/p-123',
});
const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';

async function schedule(items, options = {}) {
  const calls = [];
  const checked = [];
  const query = {
    select() { return this; }, eq() { return this; }, in: async () => ({ data: items }),
  };
  const modules = {
    '@/lib/api-auth': {
      sameOrigin: () => true,
      authenticatedDatabase: async () => ({ user: { id: 'owner' }, database: { from: () => query } }),
      privateJson: (body, status = 200) => ({ body, status }),
    },
    '@/lib/content': { safePublicUrl: value => value.startsWith('https://') },
    '@/lib/enrichment/blocked': { isBlockedMetadata: () => false },
    '@/lib/pinterest': {
      pinterestConfig: () => ({}),
      pinterestDatabase: () => ({
        rpc: async (_name, args) => {
          calls.push(args);
          return options.failAt === calls.length ? { error: true } : { data: Object.keys(args.p_versions).length };
        },
      }),
      connectionTable: () => ({
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { token_ciphertext: 'test' } }),
      }),
      refreshAccess: async () => 'test-token',
      pinterestProfile: async () => ({ username: 'test-account' }),
      pinterestBoard: async (_token, id) => {
        checked.push(id);
        if (options.blocked === id) throw new Error('Board unavailable');
        return { id, name: 'Board ' + id, privacy: 'PUBLIC' };
      },
    },
  };
  const routeModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: routeModule.exports, require: name => {
      if (!(name in modules)) throw new Error('Unexpected dependency ' + name);
      return modules[name];
    },
    process: { env: { PINTEREST_ACCESS_TIER: 'standard' } },
  });
  const result = await routeModule.exports.POST({ json: async () => ({
    action: 'schedule', ids: items.map(row => row.id), boardId: options.fallback,
  }) });
  return { result, calls, checked };
}

test('mixed-board scheduling preserves each saved board even with a supplied fallback', async () => {
  const { result, calls } = await schedule([item(first, '123'), item(second, '456')], { fallback: '999' });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(call => call.p_board), ['123', '456']);
  assert.deepEqual(Object.keys(calls[0].p_versions), [first]);
  assert.deepEqual(Object.keys(calls[1].p_versions), [second]);
});

test('legacy drafts use the selected fallback board', async () => {
  const { result, calls } = await schedule([item(first, null)], { fallback: '999' });
  assert.equal(result.status, 200);
  assert.equal(calls[0].p_board, '999');
});

test('missing or inaccessible boards prevent any scheduling', async () => {
  for (const options of [{}, { blocked: '456' }]) {
    const rows = options.blocked ? [item(first, '123'), item(second, '456')] : [item(first, null)];
    const { result, calls } = await schedule(rows, options);
    assert.ok(result.status >= 400);
    assert.equal(calls.length, 0);
  }
});

test('partial scheduling failures report the persisted count for a safe retry', async () => {
  const { result } = await schedule([item(first, '123'), item(second, '456')], { failAt: 2 });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /^1 scheduled/);
});

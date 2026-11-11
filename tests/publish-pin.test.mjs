import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/publish-pin.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class PinterestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function publish(options = {}) {
  const sent = [];
  const updates = [];
  const pin = { id: 'job', pinterest_account: 'anna', board_id: '123', title: 'Title', description: 'Description', image_url: 'https://example.com/a.png', destination_url: 'https://go.shopmy.us/p-123' };
  const query = {
    update(fields) { updates.push(fields); return this; },
    eq() { return this; }, select() { return this; },
    maybeSingle: async () => options.storageFailure ? { error: true } : { data: { id: 'job' } },
  };
  const imports = {
    'server-only': {},
    '@/lib/api-auth': { privateJson: (body, status = 200) => ({ body, status }) },
    '@/lib/pinterest': {
      PinterestError,
      pinterestProfile: async () => ({ username: options.wrongAccount ? 'other' : 'anna' }),
      pinterestBoard: async (_token, id) => ({ id, privacy: 'PUBLIC' }),
      createPinterestPin: async (_token, input, sandbox) => {
        sent.push({ input, sandbox });
        if (options.failure) throw options.failure;
        return 'pinterest-id';
      },
    },
  };
  const resultModule = { exports: {} };
  vm.runInNewContext(compiled, { exports: resultModule.exports, require: name => imports[name], Date });
  const result = await resultModule.exports.publishClaimedPin({ from: () => query }, 'owner', pin, async () => 'token', !!options.trial);
  return { result, sent, updates };
}

test('publisher preserves approved board, image and affiliate destination', async () => {
  const { result, sent, updates } = await publish();
  assert.equal(result.body.status, 'published');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.board_id, '123');
  assert.equal(sent[0].input.destination_url, 'https://go.shopmy.us/p-123');
  assert.equal(updates[0].pinterest_pin_id, 'pinterest-id');
});

test('trial publishing uses the Sandbox transport', async () => {
  const { sent } = await publish({ trial: true });
  assert.equal(sent[0].sandbox, true);
});

test('uncertain responses require verification rather than an automatic resend', async () => {
  const { result, sent } = await publish({ failure: new Error('Network timeout') });
  assert.equal(result.body.status, 'needs_verification');
  assert.equal(sent.length, 1);
});

test('explicit Pinterest rejection is recorded as failed', async () => {
  const { result } = await publish({ failure: new PinterestError('Rejected', 400) });
  assert.equal(result.body.status, 'failed');
});

test('account mismatch never sends a Pin and storage failure never reports success', async () => {
  const mismatch = await publish({ wrongAccount: true });
  assert.equal(mismatch.sent.length, 0);
  assert.equal(mismatch.result.body.status, 'failed');
  const failedSave = await publish({ storageFailure: true });
  assert.equal(failedSave.result.status, 503);
  assert.equal(failedSave.result.body.status, undefined);
});

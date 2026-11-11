import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsRange, metricValues, normalizeAnalyticsPin } from '../src/lib/pinterest-analytics.ts';

test('analytics dates cover complete UTC days across month boundaries', () => {
  assert.deepEqual(analyticsRange(7, new Date('2026-11-02T02:00:00Z')), { start: '2026-10-26', end: '2026-11-01' });
});
test('metrics preserve zero but unavailable and invalid values remain unknown', () => {
  assert.deepEqual(metricValues({ impression: 0, SAVE: 12, PIN_CLICK: -1, OUTBOUND_CLICK: '8' }),
    { IMPRESSION: 0, SAVE: 12, PIN_CLICK: null, OUTBOUND_CLICK: null });
  assert.equal(metricValues(null).IMPRESSION, null);
});
test('preexisting Pinterest Pins are normalized without a library record or creation cutoff', () => {
  const pin = normalizeAnalyticsPin({
    id: '123', title: 'Older Pin', created_at: '2020-01-01T00:00:00Z',
    media: { images: { '400x300': { url: 'https://i.pinimg.com/image.png' } } },
    pin_metrics: { '90d': { impression: 100, save: 3 }, lifetime_metrics: { impression: 500 } },
  });
  assert.equal(pin.id, '123');
  assert.equal(pin.createdAt, '2020-01-01T00:00:00Z');
  assert.equal(pin.recent.IMPRESSION, 100);
  assert.equal(pin.lifetime.IMPRESSION, 500);
  assert.equal(pin.lifetime.SAVE, null);
});
test('missing lifetime metrics never reuse a shorter-period number', () => {
  const pin = normalizeAnalyticsPin({ id: '123', pin_metrics: { '90d': { impression: 12 } } });
  assert.equal(pin.lifetime.IMPRESSION, null);
  assert.equal(pin.recent.IMPRESSION, 12);
});

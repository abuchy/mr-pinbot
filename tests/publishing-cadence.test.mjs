import test from "node:test";
import assert from "node:assert/strict";
import { defaultCadence, parseCadence, planCadence } from "../src/lib/publishing-cadence.ts";

test("cadence changes respect queue order, locked slots, daily limits and daylight saving", () => {
  const locked = "2026-03-07T18:00:00.000Z";
  const pins = [
    { id: "locked", scheduled_at: locked },
    ...["a", "b", "c"].map(id => ({ id, scheduled_at: null })),
  ];
  const now = Date.parse("2026-03-07T12:00:00Z");
  const settings = { ...defaultCadence, daily: 2, start: "09:00", end: "15:00" };
  const plan = planCadence(pins, settings, now);
  assert.deepEqual([...plan.keys()], ["a", "b", "c"]);
  assert.equal(plan.has("locked"), false);
  assert.equal(pins[0].scheduled_at, locked);
  assert.ok(Math.abs(Date.parse(plan.get("a")) - Date.parse(locked)) >= 3600000);
  assert.match(plan.get("a"), /^2026-03-07/);
  for (const id of ["b", "c"]) {
    const time = plan.get(id);
    assert.match(time, /^2026-03-08/);
    assert.ok(time >= "2026-03-08T14:00:00Z" && time < "2026-03-08T20:00:00Z");
  }
  const slower = planCadence(pins, { ...settings, daily: 1 }, now);
  assert.match(slower.get("c"), /^2026-03-10/);
  assert.equal(parseCadence({ ...settings, daily: 8 }), null);
});

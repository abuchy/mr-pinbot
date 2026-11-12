import test from "node:test";
import assert from "node:assert/strict";
import { buildThemes, clickRate, rankThemes, trendPatterns } from "../src/lib/trend-spotting.ts";

test("themes use older active Pins, allow overlap, and rank by weighted click rate", () => {
  const pins = [
    { id: "1", title: "Gold Earrings", description: "Vintage Jewelry", createdAt: "2022-01-01" },
    { id: "2", title: "Gold Earrings" },
    { id: "3", title: "Gold Earrings", description: "Vintage Jewelry" },
    { id: "4", title: "Vintage Jewelry" },
    { id: "5", title: "Vintage Jewelry" },
  ];
  const themes = buildThemes(pins, {
    "1": { impressions: 100, clicks: 10 }, "2": { impressions: 900, clicks: 0 },
    "3": { impressions: 100, clicks: 10 }, "4": { impressions: 100, clicks: 5 },
    "5": { impressions: 0, clicks: 0 },
  });
  assert.equal(themes.length, 2);
  assert.equal(rankThemes(themes, "impressions")[0].name, "Gold Earring");
  assert.equal(rankThemes(themes, "rate")[0].name, "Vintage Jewelry");
  assert.equal(rankThemes(themes, "rate")[0].rate, 25 / 300 * 100);
  assert.ok(trendPatterns(themes).length > 0);
});

test("missing counts stay unknown and zero impressions yield no click rate", () => {
  const pins = ["1", "2", "3"].map(id => ({ id, title: "Gold Earrings" }));
  const [theme] = buildThemes(pins, {
    "1": { impressions: 20, clicks: 0 }, "2": { impressions: 40, clicks: null },
    "3": { impressions: 50, clicks: 2 },
  });
  assert.equal(theme.impressions, 110);
  assert.equal(theme.clicks, null);
  assert.equal(theme.rate, null);
  assert.equal(clickRate(0, 0), null);
  assert.deepEqual(trendPatterns([theme]), []);
});

test("seasonal outfit wording maps to one specific theme without a creation-date cutoff", () => {
  const pins = [
    { id: "1", title: "Fall Outfit Ideas", createdAt: "2021-01-01" },
    { id: "2", title: "Autumn Looks" },
    { id: "3", title: "What to Wear This October" },
    { id: "4", title: "Cozy Fall Fashion" },
    { id: "5", title: "Autumn Garden Planting" },
  ];
  const metrics = Object.fromEntries(pins.map(pin => [pin.id, { impressions: 100, clicks: 2 }]));
  const theme = buildThemes(pins, metrics).find(theme => theme.name === "Fall Outfits");
  assert.deepEqual(theme.pins.map(pin => pin.id), ["1", "2", "3", "4"]);
  assert.equal(theme.clicks, 8);
});

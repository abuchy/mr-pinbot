import type { AnalyticsPin } from "./pinterest-analytics";

export type TrendMetrics = { impressions: number | null; clicks: number | null };
export type TrendMetric = "impressions" | "clicks" | "rate";
type TrendPin = AnalyticsPin & TrendMetrics;
export type Theme = TrendMetrics & { name: string; rate: number | null; pins: TrendPin[] };

const stopWords = /\b(?:a|an|and|are|as|at|be|by|for|from|has|in|is|it|of|on|or|that|the|this|to|untitled|with|you|your)\b/i;

export function clickRate(clicks: number | null, impressions: number | null) {
  return clicks == null || impressions == null || impressions <= 0 ? null : clicks / impressions * 100;
}

function phrases(text: string) {
  const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  return words.slice(1).flatMap((word, index) => {
    const previous = words[index];
    if (stopWords.test(word) || stopWords.test(previous)) return [];
    return [previous + " " + (word.length > 4 && /[^s]s$/.test(word) ? word.slice(0, -1) : word)];
  });
}

const seasonRules = [
  { name: "fall", keywords: /\b(fall|autumn|september|october|november)\b/ },
  { name: "winter", keywords: /\b(winter|december|january|february)\b/ },
  { name: "spring", keywords: /\b(spring|march|april)\b/ },
  { name: "summer", keywords: /\b(summer|june|july|august)\b/ },
];
const outfitContext = /\b(outfits?|fashion|styling|looks?|what to wear)\b/;
const specificRules = [
  { name: "capsule wardrobes", pattern: /\b(capsule wardrobes?|wardrobe capsules?)\b/ },
  { name: "wedding guest dresses", pattern: /\bwedding guests?\b.{0,35}\b(dresses?|gowns?)\b|\b(dresses?|gowns?)\b.{0,35}\bwedding guests?\b/ },
];

function pinThemes(pin: AnalyticsPin) {
  const fields = [pin.title, pin.description ?? ""].map(value =>
    value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[-–—]+/g, " "));
  const contextual = fields.flatMap(field => {
    const seasons = seasonRules.filter(rule => outfitContext.test(field) && rule.keywords.test(field));
    return [...seasons.map(rule => rule.name + " outfits"),
      ...specificRules.filter(rule => rule.pattern.test(field)).map(rule => rule.name)];
  });
  return new Set([...contextual, ...fields.flatMap(phrases)]);
}

export function trendCandidates(pins: AnalyticsPin[]) {
  const counts = new Map<string, number>();
  const byPin = pins.map(pin => ({ pin, themes: pinThemes(pin) }));
  for (const { themes } of byPin) {
    for (const theme of themes) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return byPin.filter(({ themes }) => [...themes].some(theme => (counts.get(theme) ?? 0) >= 3))
    .map(({ pin }) => pin);
}

export function buildThemes(pins: AnalyticsPin[], metrics: Record<string, TrendMetrics>) {
  const groups = new Map<string, TrendPin[]>();
  for (const pin of pins) {
    const values = metrics[pin.id];
    if (!values || !((values.impressions ?? 0) > 0 || (values.clicks ?? 0) > 0)) continue;
    for (const phrase of pinThemes(pin)) {
      const group = groups.get(phrase) ?? [];
      group.push({ ...pin, ...values });
      groups.set(phrase, group);
    }
  }
  const seen = new Set<string>();
  const themes: Theme[] = [];
  for (const [phrase, members] of groups) {
    if (members.length < 3) continue;
    const signature = members.map(pin => pin.id).join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const sum = (key: keyof TrendMetrics) => members.some(pin => pin[key] === null)
      ? null : members.reduce((total, pin) => total + (pin[key] ?? 0), 0);
    const impressions = sum("impressions");
    const clicks = sum("clicks");
    themes.push({
      name: phrase.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
      impressions, clicks, rate: clickRate(clicks, impressions), pins: members,
    });
  }
  return themes;
}

export function rankThemes(themes: Theme[], metric: TrendMetric) {
  return [...themes].sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1)
    || b.pins.length - a.pins.length || a.name.localeCompare(b.name));
}

export function trendPatterns(themes: Theme[]) {
  const comparable = themes.filter(theme => theme.rate != null && (theme.impressions ?? 0) >= 100);
  if (comparable.length < 2) return [];
  const ranked = rankThemes(comparable, "rate");
  const best = ranked[0];
  const lowest = ranked[ranked.length - 1];
  const patterns: { title: string; text: string }[] = [];
  if ((best.rate ?? 0) > 0 && (best.rate ?? 0) >= 1.5 * (lowest.rate ?? 0)) {
    patterns.push({
      title: best.name + " led on click rate",
      text: `Its ${best.pins.length} Pins recorded a ${best.rate?.toFixed(2)}% outbound click rate across ${best.impressions?.toLocaleString()} impressions, the highest among themes with at least 100 impressions.`,
    });
  }
  const leader = rankThemes(comparable, "clicks")[0];
  if (leader !== best && (leader.clicks ?? 0) > (best.clicks ?? 0)) {
    patterns.push({
      title: leader.name + " drove more clicks",
      text: `Its ${leader.pins.length} Pins earned ${leader.clicks?.toLocaleString()} outbound clicks, the most among themes with at least 100 impressions.`,
    });
  }
  return patterns;
}

export const analyticsMetrics = ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"] as const;
export type AnalyticsMetric = typeof analyticsMetrics[number];
export type MetricValues = Record<AnalyticsMetric, number | null>;
export type AnalyticsPin = {
  id: string; title: string; image: string | null; createdAt: string | null;
  recent: MetricValues; lifetime: MetricValues;
};

export function metricValues(input: unknown): MetricValues {
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(analyticsMetrics.map(key => {
    const value = values[key] ?? values[key.toLowerCase()];
    return [key, typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null];
  })) as MetricValues;
}

export function analyticsRange(days: number, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    start: new Date(today - days * 86_400_000).toISOString().slice(0, 10),
    end: new Date(today - 86_400_000).toISOString().slice(0, 10),
  };
}

export function validAnalyticsRange(start: string, end: string, now = new Date()) {
  const bounds = analyticsRange(90, now);
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return isDate(start) && isDate(end) && start >= bounds.start && end <= bounds.end && start <= end;
}

export function normalizeAnalyticsPin(input: {
  id: string; title?: string | null; created_at?: string | null;
  media?: { images?: Record<string, { url?: string }> };
  pin_metrics?: Record<string, unknown> | null;
}): AnalyticsPin {
  const images = input.media?.images;
  const image = images?.["400x300"]?.url || images?.["600x"]?.url || Object.values(images ?? {})[0]?.url;
  return {
    id: input.id, title: input.title || "Untitled Pin", createdAt: input.created_at || null,
    image: image && /^https:\/\//i.test(image) ? image : null,
    recent: metricValues(input.pin_metrics?.["90d"]),
    lifetime: metricValues(input.pin_metrics?.lifetime_metrics),
  };
}

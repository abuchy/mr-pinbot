"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { analyticsRange, type AnalyticsPin } from "@/lib/pinterest-analytics";
import { buildThemes, clickRate, rankThemes, trendCandidates, trendPatterns, type TrendMetric, type TrendMetrics } from "@/lib/trend-spotting";
import styles from "./analytics-view.module.css";

const labels = { clicks: "Outbound Clicks", rate: "Outbound Click Rate", impressions: "Impressions" };
const format = (value: number | null, rate = false) =>
  value == null ? "—" : rate ? value.toFixed(2) + "%" : value.toLocaleString();

type Report = { key: string; metrics: Record<string, TrendMetrics>; rateLimited?: boolean };
type TrendPage = Omit<Report, "key"> & { bulkUnavailable?: boolean };

export function TrendSpotting({ pins, complete, request }: {
  pins: AnalyticsPin[];
  complete: boolean;
  request: (params: URLSearchParams, signal?: AbortSignal) => Promise<TrendPage>;
}) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<TrendMetric>("clicks");
  const [all, setAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<Report>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const candidates = useMemo(() => complete ? trendCandidates(pins) : [], [complete, pins]);
  const { start, end } = analyticsRange(days);
  const key = start + ":" + end + ":" + attempt;

  useEffect(() => {
    if (!complete || !pins.length) return;
    const controller = new AbortController();
    async function load() {
      const metrics: Report["metrics"] = {};
      const ids = candidates.map(pin => pin.id).filter(id => /^\d{1,20}$/.test(id));
      let single = false;
      let offset = 0;
      let rateLimited = false;
      try {
        while (offset < ids.length) {
          const batch = ids.slice(offset, offset + (single ? 4 : 100));
          const params = new URLSearchParams({ mode: "trends", start, end, ids: batch.join(",") });
          if (single) params.set("single", "1");
          const page = await request(params, controller.signal);
          if (controller.signal.aborted) return;
          if (page.bulkUnavailable && !single) {
            single = true;
            continue;
          }
          Object.assign(metrics, page.metrics);
          if (page.rateLimited) {
            rateLimited = true;
            break;
          }
          offset += batch.length;
        }
        setReport({ key, metrics, rateLimited });
        setFailure(undefined);
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        setFailure({ key, message: error instanceof Error ? error.message : "Trend metrics are unavailable." });
      }
    }
    void load();
    return () => controller.abort();
  }, [complete, candidates, pins.length, request, start, end, key]);

  const ready = report?.key === key ? report : undefined;
  const themes = useMemo(() => ready ? buildThemes(pins, ready.metrics) : [], [pins, ready]);
  const ranked = rankThemes(themes, metric);
  const maximum = ranked[0]?.[metric] ?? 0;
  const patterns = trendPatterns(themes);
  const missing = ready ? candidates.filter(pin => {
    const values = ready.metrics[pin.id];
    return values?.impressions == null || values?.clicks == null;
  }).length : 0;

  return <section className={styles.trend} aria-labelledby="trend-title">
    <h2 id="trend-title">Trend Spotting</h2>
    <p className={styles.note}>Discover what&apos;s working across your Pins.</p>
    <div className={styles.options}>
      <label>Account Range<select value={days} onChange={event => { setDays(Number(event.target.value)); setAll(false); }}>
        {[7, 30, 90].map(value => <option key={value} value={value}>Last {value} Days</option>)}
      </select></label>
      <label>Metric<select value={metric} onChange={event => setMetric(event.target.value as TrendMetric)}>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <h3>Your Top-Performing Themes</h3>
    {!complete && <p role="status" className={styles.note}>Trend Spotting needs the full Pin list. Check the Pin list below for loading status.</p>}
    {complete && !pins.length && <p className={styles.note}>Pinterest returned no published Pins.</p>}
    {complete && !!pins.length && !ready && failure?.key !== key && <p role="status" className={styles.note}>Loading Pin performance for this range…</p>}
    {failure?.key === key && <p role="alert">{failure.message} <button className="inline-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
    {ready?.rateLimited && <p role="status" className={styles.note}>Pinterest paused requests at its rate limit. These rankings cover the Pins returned so far.</p>}
    {missing > 0 && <p className={styles.note}>Pinterest did not supply complete metrics for {missing.toLocaleString()} Pins in this range.</p>}
    {ready && !ranked.length && <p className={styles.note}>No recurring themes with recorded activity in this range.</p>}
    {ranked.slice(0, all ? undefined : 5).map(theme => <details className={styles.theme} key={key + theme.name}>
      <summary>
        <span><strong>{theme.name}</strong> · {theme.pins.length} Pins</span>
        <strong>{format(theme[metric], metric === "rate")}</strong>
        <span className={styles.themeTrack} aria-hidden="true"><span style={{ width: (maximum > 0 ? (theme[metric] ?? 0) / maximum * 100 : 0) + "%" }}/></span>
        <span className={styles.explore}>Explore Pins</span>
      </summary>
      <dl className={styles.themeStats}>
        <div><dt>Impressions</dt><dd>{format(theme.impressions)}</dd></div>
        <div><dt>Outbound clicks</dt><dd>{format(theme.clicks)}</dd></div>
        <div><dt>Outbound click rate</dt><dd>{format(theme.rate, true)}</dd></div>
      </dl>
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th scope="col">Pin</th><th scope="col">Impressions</th><th scope="col">Outbound clicks</th><th scope="col">Outbound click rate</th></tr></thead>
        <tbody>{theme.pins.map(pin => <tr key={pin.id}>
          <td><a className={styles.pin} href={`https://www.pinterest.com/pin/${pin.id}/`} target="_blank" rel="noreferrer">
            {pin.image && <Image src={pin.image} alt="" width={48} height={64} unoptimized loading="lazy"/>}{pin.title} ↗
          </a></td>
          <td>{format(pin.impressions)}</td><td>{format(pin.clicks)}</td><td>{format(clickRate(pin.clicks, pin.impressions), true)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>)}
    {ranked.length > 5 && <button className="button primary" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? "Show Top 5 Themes" : "View All Themes"}</button>}
    <h3>Patterns Worth Noticing</h3>
    {ready && (patterns.length ? <ul className={styles.trendPatterns}>
      {patterns.map(pattern => <li key={pattern.title}><span aria-hidden="true">↗</span><div><strong>{pattern.title}</strong><p>{pattern.text}</p></div></li>)}
    </ul> : <p className={styles.note}>There isn’t enough comparable performance data to highlight a pattern in this range.</p>)}
  </section>;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";
import { analyticsMetrics, type AnalyticsMetric, type AnalyticsPin, type MetricValues } from "@/lib/pinterest-analytics";
import styles from "./analytics-view.module.css";

const labels: Record<AnalyticsMetric, string> = { IMPRESSION: "Impressions", SAVE: "Saves", PIN_CLICK: "Pin clicks", OUTBOUND_CLICK: "Outbound clicks" };
const notes: Record<AnalyticsMetric, string> = { IMPRESSION: "Times your Pins were seen", SAVE: "Ideas saved for later", PIN_CLICK: "A closer look at your content", OUTBOUND_CLICK: "Visits to your destination links" };
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString();
type Summary = {
  profile: { username: string }; range: { start: string; end: string }; metrics: MetricValues;
  daily: { date: string; status: string | null; metrics: MetricValues }[]; checkedAt: string;
};

export function AnalyticsView() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [pins, setPins] = useState<AnalyticsPin[]>([]);
  const [pinsBusy, setPinsBusy] = useState(false);
  const [pinsError, setPinsError] = useState("");
  const [warning, setWarning] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"recent" | "lifetime">("recent");
  const [sort, setSort] = useState<AnalyticsMetric>("IMPRESSION");
  const [shown, setShown] = useState(50);
  const pinRun = useRef(0);
  const pinRequestActive = useRef(false);

  const request = useCallback(async (params: URLSearchParams, signal?: AbortSignal) => {
    const session = (await browserDatabase()?.auth.getSession())?.data.session;
    if (!session) throw new Error("Sign in to your Content Library in this browser to see analytics.");
    const response = await fetch("/api/analytics?" + params, {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Pinterest analytics is unavailable.");
    return result;
  }, []);

  useEffect(() => {
    const database = browserDatabase();
    if (!database) return;
    const { data } = database.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setSummaryBusy(true);
      setSummaryError("");
      setSummary(undefined);
      try {
        const result = await request(new URLSearchParams({ days: String(days) }), controller.signal);
        if (!controller.signal.aborted) setSummary(result);
      } catch (failure) {
        if (!controller.signal.aborted) setSummaryError(failure instanceof Error ? failure.message : "Could not load account analytics.");
      } finally {
        if (!controller.signal.aborted) setSummaryBusy(false);
      }
    });
    return () => controller.abort();
  }, [signedIn, days, refresh, request]);

  const loadPins = useCallback(async (start?: string) => {
    if (pinRequestActive.current) return;
    pinRequestActive.current = true;
    const run = ++pinRun.current;
    setPinsBusy(true);
    setPinsError("");
    if (!start) { setPins([]); setWarning(""); setComplete(false); setNextCursor(null); }
    let cursor = start;
    const seen = new Set<string>(start ? [start] : []);
    try {
      do {
        const params = new URLSearchParams({ mode: "pins" });
        if (cursor) params.set("bookmark", cursor);
        const result = await request(params);
        if (run !== pinRun.current) return;
        const items = result.items as AnalyticsPin[];
        setPins(previous => [...new Map([...previous, ...items].map(pin => [pin.id, pin])).values()]);
        if (result.warning) setWarning(result.warning);
        const next = result.bookmark as string | null;
        if (next && seen.has(next)) throw new Error("Pinterest repeated a page. Refresh to retry loading your Pins.");
        if (next) seen.add(next);
        cursor = next || undefined;
        setNextCursor(next || null);
      } while (cursor);
      setComplete(true);
    } catch (failure) {
      if (run === pinRun.current) {
        setNextCursor(cursor || null);
        setPinsError(failure instanceof Error ? failure.message : "Could not finish loading your Pins.");
      }
    } finally {
      if (run === pinRun.current) {
        pinRequestActive.current = false;
        setPinsBusy(false);
      }
    }
  }, [request]);

  useEffect(() => {
    if (!signedIn) return;
    void Promise.resolve().then(() => loadPins());
    return () => {
      // This numeric counter deliberately invalidates any in-flight page request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pinRun.current++;
      pinRequestActive.current = false;
    };
  }, [signedIn, refresh, loadPins]);

  if (!browserDatabase()) return <p className="import-alert">Sign-in setup is required to load Pinterest analytics.</p>;
  if (signedIn === null) return <p role="status">Checking your session…</p>;
  if (!signedIn) return <p className="import-alert"><Link className="text-link" href="/library">Sign in to your Content Library</Link> to see your Pinterest analytics.</p>;

  const filtered = pins.filter(pin => pin.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b[period][sort] ?? -1) - (a[period][sort] ?? -1));
  const daysWithData = (summary?.daily ?? [])
    .filter(day => day.status !== "PROCESSING" && day.metrics.IMPRESSION !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(1, ...daysWithData.map(day => day.metrics.IMPRESSION!));
  const startTime = Date.parse(summary?.range.start ?? "");
  const duration = Math.max(86_400_000, Date.parse(summary?.range.end ?? "") - startTime);
  const points = daysWithData.map(day => ({
    date: day.date, count: day.metrics.IMPRESSION!,
    x: 4 + 992 * (Date.parse(day.date) - startTime) / duration,
    y: 156 - 152 * day.metrics.IMPRESSION! / max,
  }));
  return <>
    <div className={styles.controls}>
      <span>{summary ? `@${summary.profile.username} · Pinterest account performance` : "Pinterest account performance"}</span>
      <div className={styles.options}>
        <label>Account range<select value={days} onChange={event => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 complete days</option><option value={30}>Last 30 complete days</option><option value={90}>Last 90 complete days</option>
        </select></label>
        <button className="button primary" disabled={summaryBusy || pinsBusy} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
      </div>
    </div>
    {summaryError && <p className="import-alert error" role="alert">{summaryError} <Link className="text-link" href="/queue">Pinterest connection</Link></p>}
    {summary && <p className={styles.note}>{summary.range.start} – {summary.range.end} · UTC · Includes activity on pre-existing Pins.</p>}
    <section className="stats-grid analytics-stats" aria-label="Account performance">
      {analyticsMetrics.map(metric => <div className="stat" key={metric}>
        <div className="stat-label">{labels[metric]}</div>
        <div className="stat-value">{summaryBusy ? "…" : number(summary?.metrics[metric])}</div>
        <p>{notes[metric]}</p>
      </div>)}
    </section>
    {summary && <section className={styles.chart}>
      <h2>Impressions over time</h2>
      {!points.length ? <p className={styles.note}>Pinterest has not supplied daily impression data for this period.</p>
        : <svg className={styles.lineChart} viewBox="0 0 1000 160" preserveAspectRatio="none" role="img"
            aria-label={`Daily impressions from ${summary.range.start} to ${summary.range.end}`}>
          <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor"
            strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
          {points.map(point => <circle key={point.date} cx={point.x} cy={point.y} r="3" fill="currentColor">
            <title>{point.date}: {number(point.count)} impressions</title>
          </circle>)}
        </svg>}
      <div className={styles.chartDates}><span>{summary.range.start}</span><span>{summary.range.end}</span></div>
    </section>}
    <section className={styles.pinSection}>
      <div className={styles.controls}>
        <div><h2>Your Pinterest Pins</h2><p className={styles.note}>{pins.length.toLocaleString()} Pins loaded{pinsBusy ? " · Loading more…" : complete ? " · All available pages loaded" : " · Loading incomplete"}</p></div>
        <div className={styles.options}>
          <label>Pin metrics<select value={period} onChange={event => { setPeriod(event.target.value as "recent" | "lifetime"); setShown(50); }}>
            <option value="recent">Last 90 days</option><option value="lifetime">Lifetime, where available</option>
          </select></label>
          <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as AnalyticsMetric); setShown(50); }}>
            {analyticsMetrics.map(metric => <option key={metric} value={metric}>{labels[metric]}</option>)}
          </select></label>
        </div>
      </div>
      <label className={styles.search}>Search Pins<input type="search" value={query} onChange={event => { setQuery(event.target.value); setShown(50); }} placeholder="Search by title"/></label>
      {warning && <p className="import-alert" role="status">{warning}</p>}
      {pinsError && <p className="import-alert error" role="alert">{pinsError} <button className="inline-button" disabled={pinsBusy} onClick={() => void loadPins(nextCursor || undefined)}>Retry loading Pins</button></p>}
      {!pins.length && !pinsBusy && complete && <p className={styles.note}>Pinterest returned no Pins for this account.</p>}
      {!!pins.length && <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th scope="col">Pin</th>{analyticsMetrics.map(metric => <th scope="col" key={metric}>{labels[metric]}</th>)}</tr></thead>
        <tbody>{filtered.slice(0, shown).map(pin => <tr key={pin.id}>
          <td><a className={styles.pin} href={`https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/`} target="_blank" rel="noreferrer">
            {pin.image && <Image src={pin.image} alt="" width={48} height={64} unoptimized/>}<span>{pin.title} ↗</span>
          </a></td>
          {analyticsMetrics.map(metric => <td key={metric}>{number(pin[period][metric])}</td>)}
        </tr>)}</tbody>
      </table></div>}
      {filtered.length > shown && <button className="button quiet" onClick={() => setShown(value => value + 50)}>Show more Pins</button>}
      {pins.length > 0 && filtered.length === 0 && <p className={styles.note}>No matching Pins.</p>}
      <p className={styles.note}>Pin metrics use the period shown above and are independent of the account date range. A dash means Pinterest did not supply that metric. Lifetime coverage varies by Pin age and format. Recent activity may still be processing.</p>
    </section>
  </>;
}

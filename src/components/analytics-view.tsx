"use client";

import Image from "next/image";
import { PinterestConnection } from "./pinterest-connection";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";
import { analyticsRange, validAnalyticsRange, analyticsMetrics, type AnalyticsMetric, type AnalyticsPin, type MetricValues } from "@/lib/pinterest-analytics";
import styles from "./analytics-view.module.css";

const initialPinCount = 10;
const labels: Record<AnalyticsMetric, string> = { IMPRESSION: "Impressions", SAVE: "Saves", PIN_CLICK: "Pin clicks", OUTBOUND_CLICK: "Outbound clicks" };
const notes: Record<AnalyticsMetric, string> = { IMPRESSION: "Times your Pins were seen", SAVE: "Ideas saved for later", PIN_CLICK: "A closer look at your content", OUTBOUND_CLICK: "Visits to your destination links" };
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString();
type Summary = {
  profile: { username: string }; range: { start: string; end: string }; metrics: MetricValues;
  daily: { date: string; status: string | null; metrics: MetricValues }[]; checkedAt: string;
};

export function AnalyticsView() {
  const [disconnected, setDisconnected] = useState(false);
  const onDisconnect = useCallback(() => setDisconnected(true), []);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [preset, setPreset] = useState("30");
  const [dates, setDates] = useState(() => analyticsRange(30));
  const bounds = analyticsRange(90);
  const rangeValid = validAnalyticsRange(dates.start, dates.end);
  function changeDate(field: "start" | "end", value: string) {
    setPreset("custom");
    setDates(previous => ({ ...previous, [field]: value }));
    setSummary(undefined);
  }
  const [summary, setSummary] = useState<Summary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [pins, setPins] = useState<AnalyticsPin[]>([]);
  const [pinsBusy, setPinsBusy] = useState(false);
  const [pinsError, setPinsError] = useState("");
  const [warning, setWarning] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"recent" | "lifetime">("recent");
  const [sort, setSort] = useState<AnalyticsMetric>("IMPRESSION");
  const [activePointKey, setActivePointKey] = useState<string | null>(null);
  const [shown, setShown] = useState(initialPinCount);
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
    if (!signedIn || disconnected || !rangeValid) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setSummaryBusy(true);
      setSummaryError("");
      setSummary(undefined);
      try {
        const result = await request(new URLSearchParams({ start: dates.start, end: dates.end }), controller.signal);
        if (!controller.signal.aborted) setSummary(result);
      } catch (failure) {
        if (!controller.signal.aborted) setSummaryError(failure instanceof Error ? failure.message : "Could not load account analytics.");
      } finally {
        if (!controller.signal.aborted) setSummaryBusy(false);
      }
    });
    return () => controller.abort();
  }, [signedIn, disconnected, dates.start, dates.end, rangeValid, request]);

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
        if (next && seen.has(next)) throw new Error("Pinterest repeated a page. Retry loading your Pins.");
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
    if (!signedIn || disconnected) return;
    void Promise.resolve().then(() => loadPins());
    return () => {
      // This numeric counter deliberately invalidates any in-flight page request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pinRun.current++;
      pinRequestActive.current = false;
    };
  }, [signedIn, disconnected, loadPins]);

  if (!browserDatabase()) return <p className="import-alert">Sign-in setup is required to load Pinterest analytics.</p>;
  if (signedIn === null) return <p role="status">Checking your session…</p>;
  if (!signedIn) return <p className="import-alert"><Link className="text-link" href="/library">Sign in to your Content Library</Link> to see your Pinterest analytics.</p>;

  const filtered = pins.filter(pin => pin.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b[period][sort] ?? -1) - (a[period][sort] ?? -1));
  const startTime = Date.parse(summary?.range.start ?? "");
  const duration = Math.max(86_400_000, Date.parse(summary?.range.end ?? "") - startTime);
  const chartSeries = (["IMPRESSION", "OUTBOUND_CLICK"] as const).map(metric => {
    const days = (summary?.daily ?? [])
      .filter(day => day.status !== "PROCESSING" && day.metrics[metric] !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const max = Math.max(1, ...days.map(day => day.metrics[metric]!));
    return {
      metric,
      color: metric === "IMPRESSION" ? "var(--burgundy)" : "var(--blue)",
      points: days.map(day => ({
        key: `${metric}-${day.date}`,
        date: day.date,
        count: day.metrics[metric]!,
        label: labels[metric].toLowerCase(),
        x: 4 + 992 * (Date.parse(day.date) - startTime) / duration,
        y: 156 - 152 * day.metrics[metric]! / max,
      })),
    };
  });
  const daySpan = summary ? (Date.parse(summary.range.end) - startTime) / 86_400_000 : 0;
  const markerCount = Math.min(5, daySpan + 1);
  const dateMarkers = summary ? Array.from({ length: markerCount }, (_, index) => {
    const dayOffset = Math.round(daySpan * index / Math.max(1, markerCount - 1));
    const date = new Date(startTime + dayOffset * 86_400_000);
    return { date: date.toISOString().slice(0, 10), position: dayOffset * 86_400_000 / duration * 100 };
  }) : [];
  const activePoint = chartSeries.flatMap(series => series.points).find(point => point.key === activePointKey);
  return <>
    <div className={styles.accountControls}>
      <PinterestConnection onDisconnect={onDisconnect}/>
      <div className={styles.options}>
        <label>Account range<select value={preset} onChange={event => {
          const value = event.target.value;
          setPreset(value);
          if (value !== "custom") setDates(analyticsRange(Number(value)));
        }}>
          <option value="7">Last 7 complete days</option><option value="30">Last 30 complete days</option><option value="90">Last 90 complete days</option>
          <option value="custom">Custom date range</option>
        </select></label>
        <label>Start date<input type="date" value={dates.start} min={bounds.start} max={bounds.end} onChange={event => changeDate("start", event.target.value)}/></label>
        <label>End date<input type="date" value={dates.end} min={bounds.start} max={bounds.end} onChange={event => changeDate("end", event.target.value)}/></label>
      </div>
    </div>
    {disconnected ? <p className={styles.note}>Connect Pinterest to view account analytics.</p> : <>
    {!rangeValid && <p className="validation-error" role="alert">Choose an ordered date range within the last 90 complete UTC days.</p>}
    {rangeValid && summaryError && <p className="import-alert error" role="alert">{summaryError} <Link className="text-link" href="/queue">Pinterest connection</Link></p>}
    <section className={`stats-grid analytics-stats ${styles.stats}`} aria-label="Account performance">
      {analyticsMetrics.map(metric => <div className="stat" key={metric}>
        <div className="stat-label">{labels[metric]}</div>
        <div className="stat-value">{summaryBusy && rangeValid ? "…" : number(summary?.metrics[metric])}</div>
        <p>{notes[metric]}</p>
      </div>)}
    </section>
    <p className={styles.note}>Includes activity on pre-existing Pins.</p>
    {summary && <section className={styles.chart}>
      <div className={styles.chartHeader}>
        <h2>Performance Over {preset === "custom" ? "Custom Date Range" : `Last ${preset} Days`}</h2>
        <ul className={styles.chartLegend} aria-label="Chart legend">
          {chartSeries.map(({ metric, color, points }) => <li key={metric}>
            <span aria-hidden="true" style={{ backgroundColor: color }}/>
            {labels[metric]}{!points.length && " (no daily data)"}
          </li>)}
        </ul>
      </div>
      {!chartSeries.some(series => series.points.length) ? <p className={styles.note}>Pinterest has not supplied daily data for this period.</p>
        : <div className={styles.chartPlot}><svg className={styles.lineChart} viewBox="0 0 1000 160" preserveAspectRatio="none" role="img"
            aria-label={`Daily impressions and outbound clicks from ${summary.range.start} to ${summary.range.end}`}>
          {chartSeries.map(({ metric, color, points }) => <g key={metric} style={{ color }}>
          <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor"
            strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
          {points.map(point => <g key={point.date}>
            <circle cx={point.x} cy={point.y} r={activePointKey === point.key ? 5 : 3} fill="currentColor"/>
            <circle cx={point.x} cy={point.y} r="10" fill="transparent" tabIndex={0}
              aria-label={`${point.date}: ${number(point.count)} ${point.label}`}
              onMouseEnter={() => setActivePointKey(point.key)} onMouseLeave={() => setActivePointKey(null)}
              onFocus={() => setActivePointKey(point.key)} onBlur={() => setActivePointKey(null)}
              onKeyDown={event => { if (event.key === "Escape") setActivePointKey(null); }}/>
          </g>)}
          </g>)}
        </svg>
        {activePoint && <div className={styles.chartTooltip} aria-hidden="true"
          style={{ left: `${activePoint.x / 10}%`, top: `${activePoint.y / 1.6}%`, transform: `translate(-${activePoint.x / 10}%, 10px)` }}>
          <span>{activePoint.date}</span>
          <strong>{number(activePoint.count)} {activePoint.label}</strong>
        </div>}
        </div>}
      <div className={styles.chartDates}>
        {dateMarkers.map(marker => <time key={marker.date} dateTime={marker.date} style={{ left: `${marker.position}%` }}>{marker.date}</time>)}
      </div>
    </section>}
    <section className={styles.pinSection}>
      <div className={styles.controls}>
        <div><h2>Your Pinterest Pins</h2><p className={styles.note}>{pins.length.toLocaleString()} Pins loaded{pinsBusy ? " · Loading more…" : complete ? " · All available pages loaded" : " · Loading incomplete"}</p></div>
        <div className={styles.options}>
          <label>Pin metrics<select value={period} onChange={event => { setPeriod(event.target.value as "recent" | "lifetime"); setShown(initialPinCount); }}>
            <option value="recent">Last 90 days</option><option value="lifetime">Lifetime, where available</option>
          </select></label>
          <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as AnalyticsMetric); setShown(initialPinCount); }}>
            {analyticsMetrics.map(metric => <option key={metric} value={metric}>{labels[metric]}</option>)}
          </select></label>
        </div>
      </div>
      <label className={styles.search}>Search Pins<input type="search" value={query} onChange={event => { setQuery(event.target.value); setShown(initialPinCount); }} placeholder="Search by title"/></label>
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
      {filtered.length > shown && <button className={`button primary ${styles.showMorePins}`} onClick={() => setShown(value => value + 50)}>Show more Pins</button>}
      {pins.length > 0 && filtered.length === 0 && <p className={styles.note}>No matching Pins.</p>}
      <p className={styles.note}>Pin metrics use the period shown above and are independent of the account date range. A dash means Pinterest did not supply that metric. Lifetime coverage varies by Pin age and format. Recent activity may still be processing.</p>
    </section>
    </>}
  </>;
}

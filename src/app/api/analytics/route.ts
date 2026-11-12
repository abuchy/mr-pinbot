import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson } from "@/lib/api-auth";
import { connectionTable, pinterestAccountAnalytics, pinterestAccountPins, pinterestConfig, PinterestError, pinterestProfile, pinterestTrendMetrics, pinterestSingleTrendMetrics, refreshAccess } from "@/lib/pinterest";
import { analyticsRange, metricValues, normalizeAnalyticsPin, validAnalyticsRange } from "@/lib/pinterest-analytics";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to see your Pinterest analytics." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ status: "setup_required", error: "Pinterest setup is incomplete." }, 503);
  const mode = request.nextUrl.searchParams.get("mode") || "summary";
  const days = Number(request.nextUrl.searchParams.get("days") || 30);
  const bookmark = request.nextUrl.searchParams.get("bookmark") || undefined;
  if (!["summary", "pins", "trends"].includes(mode) || ![7, 30, 90].includes(days) || (bookmark && bookmark.length > 2048)) {
    return privateJson({ error: "Choose a valid analytics range." }, 400);
  }
  const ids = (request.nextUrl.searchParams.get("ids") || "").split(",");
  if (mode === "trends" && (ids.length > 100 || ids.some(id => !/^\d{1,20}$/.test(id)))) {
    return privateJson({ error: "Choose up to 100 valid Pins." }, 400);
  }
  const single = request.nextUrl.searchParams.get("single") === "1";
  if (mode === "trends" && single && ids.length > 4) return privateJson({ error: "Choose up to four Pins for individual analytics." }, 400);
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");
  if ((start !== null || end !== null) && !validAnalyticsRange(start ?? "", end ?? "")) {
    return privateJson({ error: "Choose an ordered date range within the last 90 complete UTC days." }, 400);
  }
  const connection = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", auth.user.id).maybeSingle();
  if (connection.error) return privateJson({ error: "Pinterest connection storage is unavailable." }, 503);
  if (!connection.data?.token_ciphertext || connection.data.reconnect_required) {
    return privateJson({ status: "reconnect_required", error: "Connect or reconnect Pinterest on the Publishing Queue page." }, 409);
  }
  try {
    const token = await refreshAccess(config, connection.data);
    if (mode === "trends") {
      const range = start && end ? { start, end } : analyticsRange(days);
      const values = (raw: unknown) => {
        const metrics = metricValues(raw);
        return { impressions: metrics.IMPRESSION, clicks: metrics.OUTBOUND_CLICK };
      };
      if (single) {
        const entries = [];
        for (const id of new Set(ids)) {
          try {
            const result = await pinterestSingleTrendMetrics(token, id, range.start, range.end);
            entries.push([id, values(result.all?.summary_metrics)] as const);
          } catch (failure) {
            if (failure instanceof PinterestError && failure.status === 429) {
              return privateJson({ metrics: Object.fromEntries(entries), rateLimited: true });
            }
            if (!(failure instanceof PinterestError) || ![401, 403, 404].includes(failure.status)) throw failure;
            entries.push([id, values(null)] as const);
          }
        }
        return privateJson({ metrics: Object.fromEntries(entries) });
      }
      try {
        const results = await pinterestTrendMetrics(token, ids, range.start, range.end);
        return privateJson({ metrics: Object.fromEntries(ids.map(id =>
          [id, values(results[id]?.all?.summary_metrics)])) });
      } catch (failure) {
        if (failure instanceof PinterestError && [401, 403, 404].includes(failure.status)) {
          return privateJson({ metrics: {}, bulkUnavailable: true });
        }
        throw failure;
      }
    }
    if (mode === "pins") {
      let warning: string | null = null;
      let pins;
      try { pins = await pinterestAccountPins(token, bookmark); }
      catch (failure) {
        if (!(failure instanceof PinterestError) || ![400, 403].includes(failure.status)) throw failure;
        pins = await pinterestAccountPins(token, bookmark, false);
        warning = "Pinterest returned your Pins without performance metrics. Your app or account may need additional analytics access.";
      }
      return privateJson({
        items: pins.items.map(normalizeAnalyticsPin), bookmark: pins.bookmark || null, warning,
        checkedAt: new Date().toISOString(),
      });
    }
    const range = start && end ? { start, end } : analyticsRange(days);
    const [profile, report] = await Promise.all([
      pinterestProfile(token), pinterestAccountAnalytics(token, range.start, range.end),
    ]);
    const all = report.all;
    return privateJson({
      status: "connected", profile, range, metrics: metricValues(all?.summary_metrics),
      daily: (all?.daily_metrics ?? []).map(day => ({ date: day.date, status: day.data_status || null, metrics: metricValues(day.metrics) })),
      checkedAt: new Date().toISOString(),
    });
  } catch (failure) {
    if (mode === "trends" && failure instanceof PinterestError && [403, 404].includes(failure.status)) {
      return privateJson({ error: "Pinterest did not grant access to date-range Pin analytics for this request." }, 503);
    }
    const detail = failure instanceof PinterestError && failure.upstream
      ? ` (Pinterest HTTP ${failure.upstream.httpStatus}${failure.upstream.code === undefined ? "" : `, code ${failure.upstream.code}`})` : "";
    const denied = failure instanceof PinterestError && failure.status === 403;
    console.warn("[pinbot:analytics]", { mode, status: failure instanceof PinterestError ? failure.status : undefined });
    return privateJson({
      error: (denied ? "Pinterest denied access to this account's analytics. Check app analytics access and reconnect Pinterest if its permissions changed."
        : failure instanceof Error ? failure.message : "Pinterest analytics is temporarily unavailable.") + detail,
    }, failure instanceof PinterestError && failure.status === 429 ? 429 : 503);
  }
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";

type Connection = {
  status: "connected" | "disconnected" | "setup_required" | "reconnect_required";
  tier: "trial" | "standard";
  profile?: { username: string; accountType?: string };
  boards?: { id: string; name: string }[];
  bookmark?: string | null;
};

const callbackMessages: Record<string, string> = {
  connected: "Pinterest authorization completed.",
  cancelled: "Pinterest authorization was cancelled.",
  expired: "That connection request expired. Start again from this page.",
  failed: "Pinterest could not finish connecting. Check the app configuration and try again.",
};

export function PinterestConnection() {
  const [connection, setConnection] = useState<Connection>();
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [sandboxBoards, setSandboxBoards] = useState<NonNullable<Connection["boards"]>>();
  const [sandboxCursor, setSandboxCursor] = useState<string | null>(null);
  const [sandboxError, setSandboxError] = useState("");
  const [sandboxBusy, setSandboxBusy] = useState(false);

  async function loadSandboxBoards(cursor?: string, create = false) {
    setSandboxBusy(true);
    setSandboxError("");
    try {
      const session = (await browserDatabase()?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sign in to load Sandbox boards.");
      const query = new URLSearchParams({ environment: "sandbox" });
      if (cursor) query.set("bookmark", cursor);
      const response = await fetch("/api/pinterest?" + query, {
        method: create ? "POST" : "GET",
        headers: { Authorization: "Bearer " + session.access_token }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Sandbox boards.");
      if (data.profile?.username !== connection?.profile?.username) {
        throw new Error("The Sandbox token belongs to a different Pinterest account.");
      }
      setSandboxBoards(previous => [...(cursor ? previous ?? [] : []), ...data.boards]);
      setSandboxCursor(data.bookmark);
    } catch (error) {
      setSandboxError(error instanceof Error ? error.message : "Could not load Sandbox boards.");
    } finally {
      setSandboxBusy(false);
    }
  }

  const request = useCallback(async (method = "GET", bookmark?: string) => {
    const session = (await browserDatabase()?.auth.getSession())?.data.session;
    if (!session) {
      setSignedOut(true);
      setConnection(undefined);
      return;
    }
    const query = bookmark ? "?" + new URLSearchParams({ bookmark }) : "";
    const response = await fetch("/api/pinterest" + query, {
      method, headers: { Authorization: "Bearer " + session.access_token }, cache: "no-store",
    });
    if (response.status === 401) {
      setSignedOut(true);
      setConnection(undefined);
      return;
    }
    const data = await response.json() as Connection & { authorizeUrl?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "Pinterest is temporarily unavailable.");
    if (data.authorizeUrl) {
      window.location.assign(data.authorizeUrl);
      return;
    }
    if (method === "DELETE") setNotice("Pinterest disconnected from Mr. Pinbot.");
    setSignedOut(false);
    setConnection(previous => {
      if (!bookmark || !previous || data.status !== "connected") return data;
      const boards = new Map([...(previous.boards ?? []), ...(data.boards ?? [])].map(board => [board.id, board]));
      return { ...previous, boards: [...boards.values()], bookmark: data.bookmark };
    });
  }, []);

  const run = useCallback(async (method = "GET", bookmark?: string) => {
    setBusy(true);
    setError("");
    try {
      await request(method, bookmark);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Pinterest is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("pinterest");
      if (outcome) {
        setNotice(Object.hasOwn(callbackMessages, outcome) ? callbackMessages[outcome] : "");
        url.searchParams.delete("pinterest");
        window.history.replaceState(null, "", url);
      }
      void run();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [run]);

  return <section className="section-panel" aria-labelledby="pinterest-connection-title">
    <div className="section-header">
      <h2 id="pinterest-connection-title">Pinterest connection</h2>
      {connection && <span className="outline-label">{connection.tier === "trial" ? "TRIAL ACCESS" : "STANDARD ACCESS"}</span>}
    </div>
    <div className="empty-state" aria-busy={busy}>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && !connection && <p role="status">Checking connection…</p>}
      {signedOut && <p><Link className="text-link" href="/library">Sign in through Content Library to connect Pinterest →</Link></p>}
      {connection?.status === "setup_required" && <p>Pinterest setup is pending.</p>}
      {connection?.status === "connected" && <>
        <h3>@{connection.profile?.username}</h3>
        <p>{connection.profile?.accountType === "BUSINESS" ? "Pinterest Business account" : "Pinterest account"} connected.</p>
        <p>{connection.boards?.length ? "Public boards: " + connection.boards.map(board => board.name).join(" · ") : "No public boards on this page."}</p>
        <div className="form-actions" style={{ justifyContent: "center" }}>
          {connection.bookmark && <button className="button quiet" disabled={busy} onClick={() => void run("GET", connection.bookmark ?? undefined)}>Load more boards</button>}
          <button className="button quiet" disabled={busy} onClick={() => void run()}>Refresh boards</button>
          <button className="button quiet" disabled={busy} onClick={() => void run("DELETE")}>Disconnect Pinterest</button>
        </div>
        <p>You can also remove Mr. Pinbot from your connected apps in Pinterest settings.</p>
      </>}
      {(connection?.status === "disconnected" || connection?.status === "reconnect_required") && <>
        <p>{connection.status === "reconnect_required" ? "Pinterest needs you to authorize the connection again." : "Connect your Pinterest Business account to see your boards."}</p>
        <div className="form-actions" style={{ justifyContent: "center" }}>
          <button className="button primary" disabled={busy} onClick={() => void run("POST")}>
            {connection.status === "reconnect_required" ? "Reconnect Pinterest" : "Connect Pinterest"}
          </button>
        </div>
      </>}
      {connection?.tier === "trial" && connection.status !== "setup_required" && <p>Pins created through Trial access are visible only to their creator.</p>}
      {connection?.tier === "trial" && connection.status === "connected" && <div>
        <button className="button quiet" disabled={sandboxBusy} onClick={() => void loadSandboxBoards()}>Check Sandbox boards</button>
        <button className="button quiet" disabled={sandboxBusy} onClick={() => void loadSandboxBoards(undefined, true)}>Create Mr. Pinbot Trial board</button>
        {sandboxError && <p role="alert">{sandboxError}</p>}
        {sandboxBoards && <p role="status">{sandboxBoards.length
          ? "Sandbox boards: " + sandboxBoards.map(board => `${board.name} (${board.id})`).join(" · ")
          : sandboxCursor ? "No Sandbox boards on this page." : "No public Sandbox boards found."}</p>}
        {sandboxCursor && <button className="button quiet" disabled={sandboxBusy} onClick={() => void loadSandboxBoards(sandboxCursor)}>Load more Sandbox boards</button>}
      </div>}
      {error && !connection && <button className="button quiet" disabled={busy} onClick={() => void run()}>Try again</button>}
    </div>
  </section>;
}

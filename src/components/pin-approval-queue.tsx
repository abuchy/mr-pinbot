"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ContentItem } from "@/lib/content";
import { defaultCadence, planCadence, type Cadence } from "@/lib/publishing-cadence";
import { browserDatabase } from "@/lib/supabase-browser";

type Preview = { title: string; description: string; image_url: string; destination_url: string };
type Approval = Preview & { id: string; content_id: string; board_name: string; pinterest_account: string; scheduled_at: string | null };
type Board = { id: string; name: string };
type BoardPage = { profile?: { username: string }; boards?: Board[]; bookmark?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = (await browserDatabase()?.auth.getSession())?.data.session;
  if (!session) throw new Error("Sign in through Content Library to manage approvals.");
  const response = await fetch(path, {
    ...init, cache: "no-store",
    headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The approval queue is temporarily unavailable.");
  return data;
}

function PinPreview({ pin }: { pin: Preview }) {
  return <div className="pin-approval-preview">
    {/* The library already stores these product images at public URLs. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={pin.image_url} alt="" loading="lazy" width={96} height={96} referrerPolicy="no-referrer"/>
    <div>
      <h3>{pin.title}</h3>
      {pin.description && <p>{pin.description}</p>}
      <p className="pin-approval-destination">Destination: {pin.destination_url}</p>
    </div>
  </div>;
}

function ScheduleEditor({ pin, busy, onSave }: {
  pin: Approval;
  busy: boolean;
  onSave: (time: string | null) => void;
}) {
  const [time, setTime] = useState("");
  const [invalid, setInvalid] = useState(false);
  return <form onSubmit={event => {
    event.preventDefault();
    const date = new Date(time);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      setInvalid(true);
      return;
    }
    onSave(date.toISOString());
  }}>
    <label className="field-label">Lock publishing time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
      <input type="datetime-local" value={time} disabled={busy} required onChange={event => {
        setTime(event.target.value);
        setInvalid(false);
      }}/>
    </label>
    {invalid && <p role="alert">Choose a future date and time.</p>}
    <div className="form-actions">
      <button className="button quiet" disabled={busy || !time}>Save time</button>
      {pin.scheduled_at && <button type="button" className="button quiet" disabled={busy} onClick={() => onSave(null)}>Clear time</button>}
    </div>
  </form>;
}

export function PinApprovalQueue() {
  const [cadence, setCadence] = useState(defaultCadence);
  const [draft, setDraft] = useState(defaultCadence);
  const [planTime, setPlanTime] = useState(0);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [account, setAccount] = useState("");
  const [bookmark, setBookmark] = useState<string>();
  const [selection, setSelection] = useState("");
  const [boardId, setBoardId] = useState("");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const [library, queue, preference] = await Promise.all([
      request<{ items: ContentItem[] }>("/api/content"),
      request<{ items: Approval[] }>("/api/publishing-queue"),
      request<{ settings: Cadence }>("/api/publishing-queue/cadence"),
    ]);
    setItems(library.items);
    setApprovals(queue.items);
    setCadence(preference.settings);
    setDraft(preference.settings);
    setPlanTime(Date.now());
    setLoaded(true);
  }

  async function loadBoards(cursor?: string) {
    const query = cursor ? "?" + new URLSearchParams({ bookmark: cursor }) : "";
    const page = await request<BoardPage>("/api/pinterest" + query);
    if (!page.boards) {
      setAccount("");
      setBoards([]);
      setBookmark(undefined);
      throw new Error("Connect Pinterest below before choosing a board.");
    }
    if (!cursor) {
      setAccount(page.profile?.username ?? "");
      setBoardId("");
    }
    setBoards(previous => [...new Map([...(cursor ? previous : []), ...page.boards!].map(board => [board.id, board])).values()]);
    setBookmark(page.bookmark);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void run(load), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const available = items.filter(item => item.product_name.trim() && item.image_url && !approvals.some(pin => pin.content_id === item.id));
  const selected = available.find(item => item.id === selection);
  const board = boards.find(board => board.id === boardId);

  const proposed = loaded ? planCadence(approvals, cadence, planTime) : new Map<string, string>();
  const displayTime = (time: string) => new Date(time).toLocaleString(undefined, {
    timeZone: cadence.zone, dateStyle: "medium", timeStyle: "short",
  });
  const effectiveTime = (pin: Approval) => pin.scheduled_at ?? proposed.get(pin.id);

  return <section className="section-panel" aria-labelledby="approval-heading" aria-busy={busy}>
    <div className="section-header">
      <h2 id="approval-heading">Pin approval queue</h2>
      <span className="outline-label">{approvals.length} APPROVED</span>
    </div>
    <div className="pin-approval-body">
      {error && <p className="validation-error" role="alert">{error}</p>}
      {!loaded && (busy ? <p role="status">Loading approvals…</p> : <div className="form-actions">
        <Link className="text-link" href="/library">Open Content Library →</Link>
        <button className="button quiet" onClick={() => void run(load)}>Try again</button>
      </div>)}
      {loaded && <>
        <p className="muted">Cadence previews update around locked times. Automatic publishing is not active yet.</p>
        <form onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            const result = await request<{ settings: Cadence }>("/api/publishing-queue/cadence", {
              method: "PUT", body: JSON.stringify(draft),
            });
            setCadence(result.settings);
            setDraft(result.settings);
            setPlanTime(Date.now());
          });
        }}>
          <h3>Publishing cadence</h3>
          <label className="field-label">Pins per day<input type="number" min="1" max="20" required value={draft.daily || ""} onChange={e => setDraft({ ...draft, daily: Number(e.target.value) })}/></label>
          <label className="field-label">Window starts<input type="time" required value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })}/></label>
          <label className="field-label">Window ends<input type="time" required value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })}/></label>
          <label className="field-label">Time zone<input required value={draft.zone} onChange={e => setDraft({ ...draft, zone: e.target.value })}/></label>
          <label className="field-label">Minimum minutes between Pins<input type="number" min="5" max="720" required value={draft.gap || ""} onChange={e => setDraft({ ...draft, gap: Number(e.target.value) })}/></label>
          <button className="button primary" disabled={busy}>Save cadence</button>
        </form>
        <form onSubmit={event => {
          event.preventDefault();
          if (!selected || !board || !account || busy) return;
          void run(async () => {
            const { item } = await request<{ item: Approval }>("/api/publishing-queue", {
              method: "POST",
              body: JSON.stringify({ id: selected.id, version: selected.updated_at, boardId: board.id, boardName: board.name, account }),
            });
            setApprovals(previous => [...previous, item]);
            setSelection("");
            setBoardId("");
          });
        }}>
          <label className="field-label">Library Pin
            <select value={selection} disabled={busy} onChange={event => setSelection(event.target.value)}>
              <option value="">{available.length ? "Choose a Pin to review" : "No unapproved Pins with a title and image"}</option>
              {available.map(item => <option key={item.id} value={item.id}>{item.product_name}</option>)}
            </select>
          </label>
          {selected && <>
            <PinPreview pin={{
              title: selected.product_name, description: selected.product_description,
              image_url: selected.image_url, destination_url: selected.website_url || selected.affiliate_url,
            }}/>
            {account ? <label className="field-label">Pinterest board for @{account}
              <select value={boardId} disabled={busy} onChange={event => setBoardId(event.target.value)}>
                <option value="">Choose a public board</option>
                {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
              </select>
            </label> : <button type="button" className="button quiet" disabled={busy} onClick={() => void run(() => loadBoards())}>Load Pinterest boards</button>}
            <div className="form-actions">
              {bookmark && <button type="button" className="button quiet" disabled={busy} onClick={() => void run(() => loadBoards(bookmark))}>Load more boards</button>}
              <button className="button primary" disabled={busy || !board}>Approve and queue</button>
            </div>
          </>}
        </form>
        <button className="button quiet" disabled={busy} onClick={() => void run(async () => { await load(); if (account) await loadBoards(); })}>Refresh library and approvals</button>
        {[...approvals].sort((a, b) =>
          (effectiveTime(a) ?? "~").localeCompare(effectiveTime(b) ?? "~"),
        ).map(pin => <article className="pin-approval-row" key={pin.id}>
          <PinPreview pin={pin}/>
          <p className="muted">{pin.board_name} · @{pin.pinterest_account} · {effectiveTime(pin) ? displayTime(effectiveTime(pin)!) + (pin.scheduled_at ? " (locked)" : " (proposed)") : "Awaiting scheduling"}</p>
          <ScheduleEditor key={pin.scheduled_at ?? "unscheduled"} pin={pin} busy={busy} onSave={scheduledAt => void run(async () => {
            const { item } = await request<{ item: Approval }>("/api/publishing-queue", {
              method: "PATCH", body: JSON.stringify({ id: pin.id, scheduledAt }),
            });
            setApprovals(previous => previous.map(approval => approval.id === item.id ? item : approval));
          })}/>
          <button className="button quiet" disabled={busy} onClick={() => void run(async () => {
            await request("/api/publishing-queue?" + new URLSearchParams({ id: pin.id }), { method: "DELETE" });
            setApprovals(previous => previous.filter(item => item.id !== pin.id));
          })}>Remove from queue</button>
        </article>)}
      </>}
    </div>
  </section>;
}

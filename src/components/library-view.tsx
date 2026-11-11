"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { browserDatabase } from "@/lib/supabase-browser";
import { safePublicUrl, type ContentItem } from "@/lib/content";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { type ImportProgress } from "@/lib/import-queue";
import { CreatePinForm } from "./create-pin-form";
import { PinBoardSelect } from "./pin-board-select";
import { ProductFields } from "./product-fields";
import { Icon } from "./icons";
import { publishingDailyLimit, publishingZones } from "@/lib/publishing-preferences";
import { EmptyState } from "./page-parts";

function PinThumbnail({url, title}: {url: string; title: string}) {
  const [failed, setFailed] = useState(false);
  return <div className="content-thumbnail">
    {url && safePublicUrl(url) && !failed
      ? <Image fill unoptimized src={url} alt={title || "Pin image"} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <><Icon name="pin" size={29}/><span>{failed ? "Image unavailable" : "Add an image when you’re ready"}</span></>}
  </div>;
}

type Job = {
  content_id: string;
  board_name: string;
  scheduled_at: string | null;
  automatic_at: string | null;
  published_at: string | null;
  pinterest_pin_id: string | null;
  publish_status: string;
  publish_error: string | null;
  title: string;
  description: string;
  image_url: string;
  destination_url: string;
};

const syncKey = "pinbot-library-changed";

export function LibraryView({ queue = false }: { queue?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("Drafts");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<{ daily: number; zone: string }>();
  const [savedZone, setSavedZone] = useState("America/Chicago");
  const [boards, setBoards] = useState<{ id: string; name: string }[]>();
  const [boardId, setBoardId] = useState("");
  const [boardCursor, setBoardCursor] = useState<string | null>(null);
  const [trial, setTrial] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const [message, setMessage] = useState("");
  const [imageBusy,setImageBusy]=useState(false);
  const [descriptionBusy,setDescriptionBusy]=useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [editorBoard, setEditorBoard] = useState("");
  const [hasPinChanges,setHasPinChanges]=useState(false);
  const [editorError, setEditorError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const configured = !!browserDatabase();

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const database = browserDatabase();
    const { data } = await database!.auth.getSession();
    if (!data.session) throw new Error("Your session ended. Please sign in again.");
    const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Something went wrong. Please try again.");
    return result;
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [content, schedule] = await Promise.all([
        request("/api/content"), request("/api/publishing-queue"),
      ]);
      if (current === generation.current) {
        setItems(content.items);
        setJobs(schedule.items);
        setLoaded(true);
        setError("");
      }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Couldn’t load your library."); }
  }, [request]);
  useEffect(() => {
    const database = browserDatabase();
    if (!database) return;
    const { data: listener } = database.auth.onAuthStateChange((_event, next) => {
      generation.current++;
      setSession(next); setAuthReady(true);
      if (!next) { setJobs([]); setSelection([]); setPreferences(undefined); setBoards(undefined); setItems([]); setLoaded(false); setEditing(null); setMessage(""); setDeletingId(null); setProgress({}); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) void Promise.resolve().then(load); }, [session, load]);
  useEffect(() => {
    if (!session) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const sync = (event: StorageEvent) => {
      if (event.key !== syncKey) return;
      void load();
      void request("/api/publishing-queue/cadence").then(({ settings }) => setSavedZone(settings.zone)).catch(() => {});
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", sync);
    };
  }, [session, load, request]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void request("/api/publishing-queue/cadence").then(({ settings }) => {
      if (!active) return;
      setSavedZone(settings.zone);
      if (queue) setPreferences(settings);
    }).catch(e => { if (active && queue) setError(e.message); });
    return () => { active = false; };
  }, [queue, session, request]);

  useEffect(() => { if (editing && !editor.current?.open) editor.current?.showModal(); else if (!editing && editor.current?.open) editor.current.close(); }, [editing]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSent(true); setMessage("Check your email and open the one-time sign-in link in this browser.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t send your sign-in link."); }
    finally { setBusy(false); }
  }
  const describe=useCallback(async(image_url:string,title:string)=>request('/api/describe',{method:'POST',body:JSON.stringify({image_url,title})}),[request]);
  const hostImage=useCallback(async(image_url:string,title:string)=>request('/api/product-image',{method:'POST',body:JSON.stringify({image_url,title})}),[request]);
  async function deleteItem(item: ContentItem) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/api/content/${item.id}`,{method:'DELETE',body:JSON.stringify({updated_at:item.updated_at})});
      setItems(previous=>previous.filter(saved=>saved.id!==item.id));
      setDeletingId(null);
      setMessage('Library item deleted. You can import the same affiliate link again.');
      if(editing?.id===item.id) closeEditor();
      window.localStorage.setItem(syncKey, crypto.randomUUID());
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Couldn’t delete this item.');}
    finally{setBusy(false);}
  }
  function closeEditor() { editor.current?.close(); setEditing(null); setEditorError(""); }
  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || !(hasPinChanges || editorBoard !== (editing.pinterest_board_id || "")) || busy || descriptionBusy || imageBusy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setEditorError("");
    try {
      const details={original_image_url:data.get('original_image_url'),product_description:data.get('product_description'),product_name:data.get('product_name'),website_url:data.get('website_url'),image_url:data.get('image_url'),description_is_manual:data.get('description_is_manual')==='true',description_image_url:data.get('description_image_url')};
      await request(`/api/content/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ ...details, ...(editorBoard && editorBoard !== (editing.pinterest_board_id || "") ? { boardId: editorBoard } : {}), updated_at: editing.updated_at }) });
      setProgress(previous => {
        const next = { ...previous };
        delete next[editing.id];
        return next;
      });
      closeEditor(); setMessage("Product details saved.");
      window.localStorage.setItem(syncKey, crypto.randomUUID());
      await load();
    } catch (e) { setEditorError(e instanceof Error ? e.message : "Couldn’t save details."); }
    finally { setBusy(false); }
  }
  const needsDetails = (item: ContentItem) => (!item.product_name || isBlockedMetadata(item.product_name)) || !(item.website_url||item.affiliate_url) || !item.image_url || !item.product_description || isBlockedMetadata(item.product_description);
  const statuses = Object.values(progress);
  const finished = statuses.filter(status => status === 'completed').length;
  const attention = statuses.filter(status => status === 'attention').length;
  const processing = statuses.length - finished - attention;
  const byContent = new Map(jobs.map(job => [job.content_id, job]));
  const itemIds = new Set(items.map(item => item.id));
  const archived = jobs.filter(job => job.publish_status === "published" && !itemIds.has(job.content_id));
  const category = (item: ContentItem) => {
    const job = byContent.get(item.id);
    if (job?.publish_status === "published") return "Published";
    return job ? "Scheduled" : "Drafts";
  };
  const counts: Record<string, number> = {
    Drafts: items.filter(item => category(item) === "Drafts").length,
    Scheduled: items.filter(item => category(item) === "Scheduled").length,
    ...(!queue && { Published: items.filter(item => category(item) === "Published").length + archived.length }),
  };
  const matches = (...values: string[]) => values.some(value => value.toLowerCase().includes(query.toLowerCase()));
  const visible = items.filter(item => category(item) === filter && matches(item.product_name, item.retailer, item.affiliate_url));
  const visibleArchive = filter === "Published" ? archived.filter(job => matches(job.title, job.destination_url)) : [];
  const eligible = visible.filter(item => {
    const status = byContent.get(item.id)?.publish_status;
    return !status || status === "queued" || status === "failed";
  }).map(item => item.id);
  const selected = selection.filter(id => eligible.includes(id));

  const formatTime = (time: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: savedZone, year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(time));

  async function loadBoards(cursor?: string) {
    const result = await request("/api/pinterest" + (cursor ? "?bookmark=" + encodeURIComponent(cursor) : ""));
    if (result.status !== "connected") throw new Error("Connect Pinterest before scheduling Pins.");
    setTrial(result.tier !== "standard");
    setBoards(previous => [...(cursor ? previous ?? [] : []), ...(result.boards ?? [])]);
    setBoardCursor(result.bookmark ?? null);
  }

  async function changeSchedule(action: "schedule" | "unschedule" | "retry", ids: string[], destination?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request("/api/publishing-queue/batch", {
        method: "POST", body: JSON.stringify({ action, ids, boardId: destination }),
      });
      await load();
      setMessage(result.message);
      setSelection([]);
      setBoards(undefined);
      setBoardId("");
      window.localStorage.setItem(syncKey, crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { settings } = await request("/api/publishing-queue/cadence", {
        method: "PUT", body: JSON.stringify(preferences),
      });
      setPreferences(settings);
      setSavedZone(settings.zone);
      setMessage("Publishing preferences saved.");
      window.localStorage.setItem(syncKey, crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save preferences.");
    } finally {
      setBusy(false);
    }
  }

  function publicationDetails(job: Job) {
    const time = job.published_at ?? job.scheduled_at ?? job.automatic_at;
    return <>
      <p><strong>{job.publish_status === "published" ? "Published" : "Scheduled"}</strong>{time && <> · <time dateTime={time}>{formatTime(time)}</time></>}</p>
      {job.pinterest_pin_id && <a className="text-link" href={`https://www.pinterest.com/pin/${encodeURIComponent(job.pinterest_pin_id)}/`} target="_blank" rel="noreferrer">View Pin on Pinterest</a>}
      {job.publish_error && <p role="status"><strong>{job.publish_status === "needs_verification" ? "Verify on Pinterest" : "Failed"}</strong> · {job.publish_error}</p>}
      {job.publish_status === "failed" && <button className="button quiet" disabled={busy} onClick={() => void changeSchedule("retry", [job.content_id])}>Retry publishing</button>}
    </>;
  }

  return <>
    {error && <div className="import-alert error" role="alert">{error}{session && <button className="inline-button" disabled={busy} onClick={() => void load()}>Retry loading</button>}</div>}
    {message && <div className="import-alert" role="status">{message}</div>}
    {!configured ? <section className="import-panel"><p className="eyebrow">PRIVATE CLOUD LIBRARY</p><h2>Your import workspace is being connected.</h2><p>Supabase and sign-in must be configured before links can be saved. Your library will be private to your account.</p><label className="field-label">Paste ShopMy links<textarea rows={4} disabled placeholder="https://go.shopmy.us/p-…"/></label><button className="button primary" disabled>Sign-in setup required</button></section> : !authReady ? <p role="status">Checking your session…</p> : !session ? <section className="import-panel sign-in"><p className="eyebrow">JUST FOR YOU</p><h2>Your finds, in a private place.</h2><p>Sign in to save and edit your links across devices. This workspace is invite-only. <a className="text-link" href="/demo/import">Try the live import demo ↗</a></p><form onSubmit={sendCode}><label className="field-label">Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required readOnly={sent} maxLength={254}/></label><div className="form-actions"><button className="button primary" disabled={busy || sent}>{busy ? "Please wait…" : sent ? "Sign-in link sent" : "Email me a sign-in link"}</button>{sent && <button type="button" className="button quiet" disabled={busy} onClick={() => { setSent(false); setMessage(""); }}>Use another email</button>}</div></form></section> : <>
      <div className="library-account"><span>Private library · {session.user.email}</span><button className="inline-button" disabled={busy} onClick={async () => { setBusy(true); const result = await browserDatabase()!.auth.signOut(); if (result.error) setError("Couldn’t sign out. Please try again."); setBusy(false); }}>Sign out</button></div>
      {!queue && <CreatePinForm disabled={busy || !loaded} onCreated={() => {
        setFilter("Drafts");
        setQuery("");
        void load();
      }}/>}
      {statuses.length > 0 && <p className="import-alert" role="status">
        {finished + attention} of {statuses.length} processed · {finished} completed · {processing} remaining · {attention} need attention
      </p>}
      {queue && preferences && <section className="section-panel queue-preferences-panel">
        <h2>Publishing Cadence</h2>
        <form className="publishing-preferences" onSubmit={savePreferences}>
          <label className="field-label">Pins per day<input type="number" min={1} max={publishingDailyLimit} required value={Number.isNaN(preferences.daily) ? "" : preferences.daily} onChange={event => setPreferences({ ...preferences, daily: event.target.valueAsNumber })}/></label>
          <label className="field-label">Time zone<select value={preferences.zone} onChange={event => setPreferences({ ...preferences, zone: event.target.value })}>
            {!publishingZones.some(([zone]) => zone === preferences.zone) && <option value={preferences.zone} disabled>{preferences.zone}</option>}
            {publishingZones.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}
          </select></label>
          <button className="button primary" disabled={busy}>Save Preferences</button>
        </form>
      </section>}
      {queue && <h2 className="queue-heading">Ready to publish?</h2>}
      <div className="library-toolbar"><div className="filters" role="group" aria-label="Filter content">{Object.keys(counts).map(label => <button key={label} className={`filter ${filter === label ? "selected" : ""}`} aria-pressed={filter === label} onClick={() => { setFilter(label); setSelection([]); setBoards(undefined); setBoardId(""); }}>{label}<span>{counts[label]}</span></button>)}</div><label className="search-box"><Icon name="search" size={17}/><span className="sr-only">Search content</span><input type="search" placeholder="Search your library" value={query} onChange={event => { setQuery(event.target.value); setSelection([]); setBoards(undefined); }}/></label></div>
      {queue && <div className="form-actions queue-actions">
        <div className="queue-selection">
          <label><input type="checkbox" checked={eligible.length > 0 && selected.length === eligible.length}
            disabled={busy || !eligible.length} onChange={event => setSelection(event.target.checked ? eligible : [])}/> Select All</label>
          <span>({selected.length} selected)</span>
        </div>
        {filter === "Drafts" ? <button className="button primary" disabled={busy || !selected.length} onClick={async () => {
          setBusy(true);
          setError("");
          try {
            if (selected.every(id => items.find(item => item.id === id)?.pinterest_board_id)) {
              await changeSchedule("schedule", selected);
            } else {
              await loadBoards();
            }
          }
          catch (e) { setError(e instanceof Error ? e.message : "Could not load boards."); }
          finally { setBusy(false); }
        }}>Schedule Pins</button> : <button className="button primary" disabled={busy || !selected.length} onClick={() => {
          if (window.confirm(`Unschedule ${selected.length} selected Pins?`)) void changeSchedule("unschedule", selected);
        }}>Unschedule Pins</button>}
      </div>}
      {queue && boards && filter === "Drafts" && <section className="import-panel">
        {trial ? <p>Trial Pins use the Pinterest Sandbox. Publishing there requires a designated test Pin and does not create a public Pin.</p>
          : <label className="field-label">Pinterest board<select value={boardId} onChange={event => setBoardId(event.target.value)}>
            <option value="">Choose a board</option>
            {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select></label>}
        <div className="form-actions">
          {!trial && boardCursor && <button className="button quiet" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await loadBoards(boardCursor); }
            catch (e) { setError(e instanceof Error ? e.message : "Could not load boards."); }
            finally { setBusy(false); }
          }}>Load more boards</button>}
          <button className="button primary" disabled={busy || !selected.length || (!trial && !boardId)} onClick={() => void changeSchedule("schedule", selected, boardId)}>Confirm schedule</button>
          <button className="button quiet" disabled={busy} onClick={() => { setBoards(undefined); setBoardId(""); }}>Cancel</button>
        </div>
      </section>}
      {!loaded ? <p role="status">{error ? "Your library couldn’t be loaded. Retry above." : "Loading your library…"}</p> : visible.length === 0 && visibleArchive.length === 0 ? <section className="section-panel"><EmptyState icon="library" title={queue || items.length ? "No matching Pins." : "Your next find starts here."}>{queue || items.length ? "Try another filter or search." : "Paste your first ShopMy link above. No spreadsheets needed."}</EmptyState></section> : <div className="content-grid">{visible.map(item => {
        const job = byContent.get(item.id);
        const locked = job && ["published", "publishing", "needs_verification"].includes(job.publish_status);
        const findingDetails = progress[item.id] === 'queued' || progress[item.id] === 'processing';
        const showAttention = !locked && !findingDetails && needsDetails(item);
        const description = item.product_description && !isBlockedMetadata(item.product_description)
          && <p className="pin-description">{item.product_description}</p>;
        return <article className="content-card" key={item.id}>{queue && <label className="pin-selection"><input type="checkbox"
        aria-label={`Select ${item.product_name || "draft Pin"}`} disabled={busy || !!locked}
        checked={selected.includes(item.id)} onChange={event => setSelection(previous => event.target.checked
          ? [...previous, item.id] : previous.filter(id => id !== item.id))}/></label>}<PinThumbnail key={item.image_url} url={item.image_url} title={item.product_name}/><div className="content-card-body"><h3>{(!isBlockedMetadata(item.product_name) && item.product_name) || "Product details pending"}</h3><p>Board · {job?.board_name || item.pinterest_board_name || "Not selected"}</p><a className="affiliate-link" href={item.website_url||item.affiliate_url} target="_blank" rel="noreferrer">{item.website_url||item.affiliate_url} ↗</a>{!showAttention && description}{!showAttention && job && publicationDetails(job)}
        {!locked && <>
          {findingDetails && <p className="field-help">{progress[item.id] === 'queued' ? 'Queued' : 'Finding product details…'}</p>}
          {!showAttention && progress[item.id] === 'completed' && <p className="field-help">Completed</p>}
          {showAttention && <p className="field-help pin-attention"><span aria-hidden="true">⚠︎</span>{" "}Needs attention: Retry or add missing details.</p>}
          {showAttention && description}
          {showAttention && job && publicationDetails(job)}
          <div className="pin-card-actions">
          <button className="button primary" disabled={busy} onClick={() => { setHasPinChanges(false); setEditorBoard(item.pinterest_board_id || ""); setEditing({...item,image_url:item.image_url||''}); setEditorError(""); }}>Edit this Pin</button>
          {deletingId===item.id?<div className="delete-confirmation" role="group" aria-label="Confirm deletion"><p>Delete this library item and its saved details? You can re-import the same link afterward.</p><div className="form-actions"><button className="button delete-button" disabled={busy} onClick={()=>void deleteItem(item)}>{busy?'Deleting…':'Yes, delete item'}</button><button className="button quiet" disabled={busy} onClick={()=>setDeletingId(null)}>Cancel</button></div></div>:<button className="inline-button delete-link" disabled={busy} onClick={()=>setDeletingId(item.id)} aria-label={`Delete ${item.product_name||'library item'}`}>Delete item</button>}</div></>}</div></article>;
      })}{visibleArchive.map(job => <article className="content-card" key={job.content_id}>
        <PinThumbnail url={job.image_url} title={job.title}/>
        <div className="content-card-body"><h3>{job.title}</h3><p>Board · {job.board_name}</p>
          <a className="affiliate-link" href={job.destination_url} target="_blank" rel="noreferrer">{job.destination_url} ↗</a>
          {job.description && <p>{job.description}</p>}{publicationDetails(job)}
        </div>
      </article>)}</div>}
    </>}
    <dialog className="details-dialog" ref={editor} onCancel={event => { if (busy) event.preventDefault(); else closeEditor(); }} onClose={() => { setEditing(null); setEditorError(""); }} aria-labelledby="details-title">{editing && <form onSubmit={saveDetails}><div className="editor-heading"><div><h2 id="details-title">Edit this Pin</h2></div><button type="button" className="inline-button" onClick={closeEditor} disabled={busy} aria-label="Close Pin editor">Close</button></div><fieldset disabled={busy}><ProductFields key={editing.id+editing.updated_at} values={editing} onDescribe={describe} onHostImage={hostImage} onHosting={setImageBusy} onPending={setDescriptionBusy} onChanges={setHasPinChanges}/><PinBoardSelect value={editorBoard} onChange={setEditorBoard} disabled={busy || byContent.has(editing.id)} required={false}/></fieldset>{editorError && <p className="validation-error" role="alert">{editorError}</p>}<div className="form-actions"><button className="button primary" disabled={busy||descriptionBusy||imageBusy||!(hasPinChanges || editorBoard !== (editing.pinterest_board_id || ""))}>{busy ? "Saving…" : descriptionBusy?"Describing image…":"Save updates"}</button><button className="button quiet" type="button" onClick={closeEditor} disabled={busy}>Cancel</button></div></form>}</dialog>
  </>;
}

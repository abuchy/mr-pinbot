"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { browserDatabase } from "@/lib/supabase-browser";
import { previewImport, safePublicUrl, type ContentItem } from "@/lib/content";
import { processImportQueue, type ImportProgress } from "@/lib/import-queue";
import { ProductFields } from "./product-fields";
import { Icon } from "./icons";
import { EmptyState } from "./page-parts";

function PinThumbnail({url, title}: {url: string; title: string}) {
  const [failed, setFailed] = useState(false);
  return <div className="content-thumbnail">
    {url && safePublicUrl(url) && !failed
      ? <Image fill unoptimized src={url} alt={title || "Pin image"} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <><Icon name="pin" size={29}/><span>{failed ? "Image unavailable" : "Add an image when you’re ready"}</span></>}
  </div>;
}

export function LibraryView() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("All content");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const [message, setMessage] = useState("");
  const [imageBusy,setImageBusy]=useState(false);
  const [descriptionBusy,setDescriptionBusy]=useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
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
    const current = generation.current;
    try {
      const result = await request("/api/content");
      if (current === generation.current) { setItems(result.items); setLoaded(true); setError(""); }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Couldn’t load your library."); }
  }, [request]);
  useEffect(() => {
    const database = browserDatabase();
    if (!database) return;
    const { data: listener } = database.auth.onAuthStateChange((_event, next) => {
      generation.current++;
      setSession(next); setAuthReady(true);
      if (!next) { setItems([]); setLoaded(false); setText(""); setEditing(null); setMessage(""); setDeletingId(null); setProgress({}); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) void Promise.resolve().then(load); }, [session, load]);
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
  async function enrichItems(newItems: ContentItem[]) {
    setProgress(Object.fromEntries(newItems.map(item => [item.id, 'queued'])));
    await processImportQueue(newItems, async item => {
      const result = await request(`/api/content/${item.id}/enrich`, { method: 'POST' });
      setItems(previous => previous.map(saved => saved.id === item.id ? result.item : saved));
      return result.complete;
    }, (id, status) => setProgress(previous => ({ ...previous, [id]: status })));
    await load();
  }

  async function importLinks(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setProgress({});
    try {
      const result = await request("/api/content", { method: "POST", body: JSON.stringify({ text }) });
      const newItems: ContentItem[] = result.items;
      setText("");
      setMessage(`${result.added} saved · ${result.duplicates} duplicates skipped`);
      setFilter("All content");
      setQuery("");
      setItems(previous => [...newItems, ...previous.filter(item => !newItems.some(saved => saved.id === item.id))]);
      await enrichItems(newItems);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t import your links.");
    } finally {
      setBusy(false);
    }
  }

  async function retryImport(item: ContentItem) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await enrichItems([item]);
    } finally {
      setBusy(false);
    }
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
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Couldn’t delete this item.');}
    finally{setBusy(false);}
  }
  function closeEditor() { editor.current?.close(); setEditing(null); setEditorError(""); }
  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || !hasPinChanges || busy || descriptionBusy || imageBusy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setEditorError("");
    try {
      const details={original_image_url:data.get('original_image_url'),product_description:data.get('product_description'),product_name:data.get('product_name'),website_url:data.get('website_url'),image_url:data.get('image_url'),description_is_manual:data.get('description_is_manual')==='true',description_image_url:data.get('description_image_url')};
      await request(`/api/content/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ ...details, updated_at: editing.updated_at }) });
      setProgress(previous => {
        const next = { ...previous };
        delete next[editing.id];
        return next;
      });
      closeEditor(); setMessage("Product details saved."); await load();
    } catch (e) { setEditorError(e instanceof Error ? e.message : "Couldn’t save details."); }
    finally { setBusy(false); }
  }
  let preview = null, previewError = "";
  if (text.trim()) { try { preview = previewImport(text); } catch (e) { previewError = e instanceof Error ? e.message : "Check your links."; } }
  const existing = new Set(items.map(item => item.source_key));
  const alreadySaved = preview?.links.filter(link => existing.has(link.source_key)).length ?? 0;
  const needsDetails = (item: ContentItem) => !item.product_name || !(item.website_url||item.affiliate_url) || !item.image_url || !item.product_description;
  const statuses = Object.values(progress);
  const finished = statuses.filter(status => status === 'completed').length;
  const attention = statuses.filter(status => status === 'attention').length;
  const processing = statuses.length - finished - attention;
  const needsAttention = (item: ContentItem) => progress[item.id] === 'attention' || needsDetails(item) ||
    item.enrichment_status === 'pending' || item.enrichment_status === 'partial';
  const counts: Record<string, number> = { "All content": items.length, "Pending metadata": items.filter(item=>item.enrichment_status==='pending'||item.enrichment_status==='partial').length, "Drafts": items.filter(item => !needsDetails(item)).length };
  const visible = items.filter(item => (filter === "All content" || (filter === "Pending metadata" ? item.enrichment_status==='pending'||item.enrichment_status==='partial'  : !needsDetails(item))) && [item.product_name, item.retailer, item.affiliate_url].some(value => value.toLowerCase().includes(query.toLowerCase())));

  return <>
    {error && <div className="import-alert error" role="alert">{error}{session && <button className="inline-button" disabled={busy} onClick={() => void load()}>Retry loading</button>}</div>}
    {message && <div className="import-alert" role="status">{message}</div>}
    {!configured ? <section className="import-panel"><p className="eyebrow">PRIVATE CLOUD LIBRARY</p><h2>Your import workspace is being connected.</h2><p>Supabase and sign-in must be configured before links can be saved. Your library will be private to your account.</p><label className="field-label">Paste ShopMy links<textarea rows={4} disabled placeholder="https://go.shopmy.us/p-…"/></label><button className="button primary" disabled>Sign-in setup required</button></section> : !authReady ? <p role="status">Checking your session…</p> : !session ? <section className="import-panel sign-in"><p className="eyebrow">JUST FOR YOU</p><h2>Your finds, in a private place.</h2><p>Sign in to save and edit your links across devices. This workspace is invite-only. <a className="text-link" href="/demo/import">Try the live import demo ↗</a></p><form onSubmit={sendCode}><label className="field-label">Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required readOnly={sent} maxLength={254}/></label><div className="form-actions"><button className="button primary" disabled={busy || sent}>{busy ? "Please wait…" : sent ? "Sign-in link sent" : "Email me a sign-in link"}</button>{sent && <button type="button" className="button quiet" disabled={busy} onClick={() => { setSent(false); setMessage(""); }}>Use another email</button>}</div></form></section> : <>
      <div className="library-account"><span>Private library · {session.user.email}</span><button className="inline-button" disabled={busy} onClick={async () => { setBusy(true); const result = await browserDatabase()!.auth.signOut(); if (result.error) setError("Couldn’t sign out. Please try again."); setBusy(false); }}>Sign out</button></div>
      <section className="import-panel"><p className="eyebrow">FROM A LINK TO A LITTLE POSSIBILITY</p><h2>Paste your ShopMy links.</h2><p>Paste one or more links. Each Pin saves automatically as its details are found.</p><form onSubmit={importLinks}><label className="field-label" htmlFor="affiliate-links">ShopMy affiliate links<textarea id="affiliate-links" rows={4} value={text} onChange={event => setText(event.target.value)} placeholder={'https://go.shopmy.us/p-12345678\nhttps://go.shopmy.us/p-87654321'} maxLength={50000} disabled={busy || !loaded} aria-describedby="link-help"/></label><p id="link-help" className="field-help">Separate links with spaces, commas, or new lines. Up to 100 at a time. Supports ShopMy product links and published apx links with an embedded destination.</p>{previewError && <p className="validation-error" role="alert">{previewError}</p>}{preview && <div className="import-preview" aria-live="polite"><p>{preview.links.length - alreadySaved} new · {preview.duplicates + alreadySaved} duplicates · {preview.invalid.length} invalid</p>{preview.invalid.length > 0 && <><p>Remove these entries before importing:</p><ul>{preview.invalid.slice(0, 5).map((value,index) => <li key={index}>{value}</li>)}</ul>{preview.invalid.length > 5 && <p>And {preview.invalid.length - 5} more invalid entries.</p>}</>}</div>}<div className="form-actions"><button className="button primary" disabled={busy || !loaded || !preview || !!previewError || preview.invalid.length > 0 || preview.links.length === 0}>{busy ? "Finding details…" : "Find product details"}<Icon name="arrow" size={17}/></button><span className="field-help">Only configured, permitted sources are contacted.</span></div></form></section>
      {statuses.length > 0 && <p className="import-alert" role="status">
        {finished + attention} of {statuses.length} processed · {finished} completed · {processing} remaining · {attention} need attention
      </p>}
      <div className="library-toolbar"><div className="filters" role="group" aria-label="Filter content">{Object.keys(counts).map(label => <button key={label} className={`filter ${filter === label ? "selected" : ""}`} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}<span>{counts[label]}</span></button>)}</div><label className="search-box"><Icon name="search" size={17}/><span className="sr-only">Search content</span><input type="search" placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
      {!loaded ? <p role="status">{error ? "Your library couldn’t be loaded. Retry above." : "Loading your library…"}</p> : visible.length === 0 ? <section className="section-panel"><EmptyState icon="library" title={items.length ? "No matching content." : "Your next find starts here."}>{items.length ? "Try another filter or search." : "Paste your first ShopMy link above. No spreadsheets needed."}</EmptyState></section> : <div className="content-grid">{visible.map(item => <article className="content-card" key={item.id}><PinThumbnail key={item.image_url} url={item.image_url} title={item.product_name}/><div className="content-card-body"><h3>{item.product_name || "Product details pending"}</h3><a className="affiliate-link" href={item.website_url||item.affiliate_url} target="_blank" rel="noreferrer">{item.website_url||item.affiliate_url} ↗</a>{progress[item.id] === 'queued' || progress[item.id] === 'processing'
        ? <p className="field-help">{progress[item.id] === 'queued' ? 'Queued' : 'Finding product details…'}</p>
        : needsAttention(item) && <>
          <p className="field-help"><strong>Needs attention</strong> · {item.enrichment_report?.import_notice || 'Some details are missing.'}</p>
          <button className="button quiet" disabled={busy} onClick={() => void retryImport(item)}>Retry product details</button>
        </>}
        {progress[item.id] === 'completed' && <p className="field-help">Completed</p>}
        <button className="button quiet" disabled={busy} onClick={() => { setHasPinChanges(false); setEditing({...item,image_url:item.image_url||''}); setEditorError(""); }}>Edit this Pin</button>{deletingId===item.id?<div className="delete-confirmation" role="group" aria-label="Confirm deletion"><p>Delete this library item and its saved details? You can re-import the same link afterward.</p><div className="form-actions"><button className="button delete-button" disabled={busy} onClick={()=>void deleteItem(item)}>{busy?'Deleting…':'Yes, delete item'}</button><button className="button quiet" disabled={busy} onClick={()=>setDeletingId(null)}>Cancel</button></div></div>:<button className="inline-button delete-link" disabled={busy} onClick={()=>setDeletingId(item.id)} aria-label={`Delete ${item.product_name||'library item'}`}>Delete item</button>}</div></article>)}</div>}
    </>}
    <dialog className="details-dialog" ref={editor} onCancel={event => { if (busy) event.preventDefault(); else closeEditor(); }} onClose={() => { setEditing(null); setEditorError(""); }} aria-labelledby="details-title">{editing && <form onSubmit={saveDetails}><div className="editor-heading"><div><h2 id="details-title">Edit this Pin</h2></div><button type="button" className="inline-button" onClick={closeEditor} disabled={busy} aria-label="Close Pin editor">Close</button></div><fieldset disabled={busy}><ProductFields key={editing.id+editing.updated_at} values={editing} onDescribe={describe} onHostImage={hostImage} onHosting={setImageBusy} onPending={setDescriptionBusy} onChanges={setHasPinChanges}/></fieldset>{editorError && <p className="validation-error" role="alert">{editorError}</p>}<div className="form-actions"><button className="button primary" disabled={busy||descriptionBusy||imageBusy||!hasPinChanges}>{busy ? "Saving…" : descriptionBusy?"Describing image…":"Save updates"}</button><button className="button quiet" type="button" onClick={closeEditor} disabled={busy}>Cancel</button></div></form>}</dialog>
  </>;
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserDatabase } from "@/lib/supabase-browser";
import { previewImport, type ContentItem } from "@/lib/content";
import { Icon } from "./icons";
import { EmptyState } from "./page-parts";

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
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [editorError, setEditorError] = useState("");
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
      if (!next) { setItems([]); setLoaded(false); setText(""); setEditing(null); setMessage(""); }
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
  async function importLinks(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await request("/api/content", { method: "POST", body: JSON.stringify({ text }) });
      setText(""); setMessage(`${result.added} ${result.added === 1 ? "link" : "links"} saved. ${result.duplicates} duplicates skipped. ${result.message}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t import your links."); }
    finally { setBusy(false); }
  }
  function closeEditor() { editor.current?.close(); setEditing(null); setEditorError(""); }
  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setEditorError("");
    try {
      await request(`/api/content/${editing.id}`, { method: "PATCH", body: JSON.stringify({ product_name: data.get("product_name"), retailer: data.get("retailer"), product_url: data.get("product_url"), image_url: data.get("image_url"), notes: data.get("notes"), image_rights_confirmed: data.get("image_rights_confirmed") === "on", updated_at: editing.updated_at }) });
      closeEditor(); setMessage("Product details saved."); await load();
    } catch (e) { setEditorError(e instanceof Error ? e.message : "Couldn’t save details."); }
    finally { setBusy(false); }
  }
  let preview = null, previewError = "";
  if (text.trim()) { try { preview = previewImport(text); } catch (e) { previewError = e instanceof Error ? e.message : "Check your links."; } }
  const existing = new Set(items.map(item => item.source_key));
  const alreadySaved = preview?.links.filter(link => existing.has(link.source_key)).length ?? 0;
  const needsDetails = (item: ContentItem) => !item.product_name || !item.retailer || !item.product_url || !item.image_url;
  const counts: Record<string, number> = { "All content": items.length, "Needs details": items.filter(needsDetails).length, "Drafts": items.filter(item => !needsDetails(item)).length };
  const visible = items.filter(item => (filter === "All content" || (filter === "Needs details" ? needsDetails(item) : !needsDetails(item))) && [item.product_name, item.retailer, item.affiliate_url].some(value => value.toLowerCase().includes(query.toLowerCase())));

  return <>
    {error && <div className="import-alert error" role="alert">{error}{session && <button className="inline-button" disabled={busy} onClick={() => void load()}>Retry loading</button>}</div>}
    {message && <div className="import-alert" role="status">{message}</div>}
    {!configured ? <section className="import-panel"><p className="eyebrow">PRIVATE CLOUD LIBRARY</p><h2>Your import workspace is being connected.</h2><p>Supabase and sign-in must be configured before links can be saved. Your library will be private to your account.</p><label className="field-label">Paste ShopMy links<textarea rows={4} disabled placeholder="https://go.shopmy.us/p-…"/></label><button className="button primary" disabled>Sign-in setup required</button></section> : !authReady ? <p role="status">Checking your session…</p> : !session ? <section className="import-panel sign-in"><p className="eyebrow">JUST FOR YOU</p><h2>Your finds, in a private place.</h2><p>Sign in to save and edit your links across devices. This workspace is invite-only.</p><form onSubmit={sendCode}><label className="field-label">Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required readOnly={sent} maxLength={254}/></label><div className="form-actions"><button className="button primary" disabled={busy || sent}>{busy ? "Please wait…" : sent ? "Sign-in link sent" : "Email me a sign-in link"}</button>{sent && <button type="button" className="button quiet" disabled={busy} onClick={() => { setSent(false); setMessage(""); }}>Use another email</button>}</div></form></section> : <>
      <div className="library-account"><span>Private library · {session.user.email}</span><button className="inline-button" disabled={busy} onClick={async () => { setBusy(true); const result = await browserDatabase()!.auth.signOut(); if (result.error) setError("Couldn’t sign out. Please try again."); setBusy(false); }}>Sign out</button></div>
      <section className="import-panel"><p className="eyebrow">FROM A LINK TO A LITTLE POSSIBILITY</p><h2>Paste your ShopMy links.</h2><p>One link or a handful. We’ll save each product once, and you can fill in the details when you’re ready.</p><form onSubmit={importLinks}><label className="field-label" htmlFor="affiliate-links">ShopMy affiliate links<textarea id="affiliate-links" rows={4} value={text} onChange={event => setText(event.target.value)} placeholder={'https://go.shopmy.us/p-12345678\nhttps://go.shopmy.us/p-87654321'} maxLength={50000} disabled={busy || !loaded} aria-describedby="link-help"/></label><p id="link-help" className="field-help">Separate links with spaces, commas, or new lines. Up to 100 at a time. Use the go.shopmy.us/p-… link from ShopMy’s Copy button.</p>{previewError && <p className="validation-error" role="alert">{previewError}</p>}{preview && <div className="import-preview" aria-live="polite"><p>{preview.links.length - alreadySaved} new · {preview.duplicates + alreadySaved} duplicates · {preview.invalid.length} invalid</p>{preview.invalid.length > 0 && <><p>Remove these entries before importing:</p><ul>{preview.invalid.slice(0, 5).map((value,index) => <li key={index}>{value}</li>)}</ul>{preview.invalid.length > 5 && <p>And {preview.invalid.length - 5} more invalid entries.</p>}</>}</div>}<div className="form-actions"><button className="button primary" disabled={busy || !loaded || !preview || !!previewError || preview.invalid.length > 0 || preview.links.length === 0}>{busy ? "Saving…" : "Save links to library"}<Icon name="arrow" size={17}/></button><span className="field-help">No ShopMy login or automatic retrieval.</span></div></form></section>
      <p className="source-notice"><Icon name="pin" size={17}/>No approved product-information source is connected yet. Your links save as drafts; add details below. Images are optional until you prepare a Pin.</p>
      <div className="library-toolbar"><div className="filters" role="group" aria-label="Filter content">{Object.keys(counts).map(label => <button key={label} className={`filter ${filter === label ? "selected" : ""}`} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}<span>{counts[label]}</span></button>)}</div><label className="search-box"><Icon name="search" size={17}/><span className="sr-only">Search content</span><input type="search" placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
      {!loaded ? <p role="status">{error ? "Your library couldn’t be loaded. Retry above." : "Loading your library…"}</p> : visible.length === 0 ? <section className="section-panel"><EmptyState icon="library" title={items.length ? "No matching content." : "Your next find starts here."}>{items.length ? "Try another filter or search." : "Paste your first ShopMy link above. No spreadsheets needed."}</EmptyState></section> : <div className="content-grid">{visible.map(item => <article className="content-card" key={item.id}><div className="content-thumbnail"><Icon name="pin" size={29}/><span>{item.image_url ? "Image address saved" : "Add an image when you’re ready"}</span></div><div className="content-card-body"><span className="outline-label">{needsDetails(item) ? "NEEDS DETAILS" : "DRAFT"}</span><h3>{item.product_name || "Untitled product"}</h3><p>{item.retailer || "Retailer not added"}</p><a className="affiliate-link" href={item.affiliate_url} target="_blank" rel="noreferrer">{item.affiliate_url} ↗</a><button className="button quiet" onClick={() => { setEditing(item); setEditorError(""); }}>{needsDetails(item) ? "Add details" : "Edit details"}</button></div></article>)}</div>}
    </>}
    <dialog className="details-dialog" ref={editor} onCancel={event => { if (busy) event.preventDefault(); else closeEditor(); }} onClose={() => { setEditing(null); setEditorError(""); }} aria-labelledby="details-title">{editing && <form onSubmit={saveDetails}><div className="editor-heading"><div><p className="eyebrow">MAKE IT YOUR OWN</p><h2 id="details-title">Product details</h2></div><button type="button" className="inline-button" onClick={closeEditor} disabled={busy} aria-label="Close product details">Close</button></div><p className="field-help">Add what you know now. You can finish the rest later.</p><p className="saved-affiliate">Affiliate link: <a href={editing.affiliate_url} target="_blank" rel="noreferrer">{editing.affiliate_url}</a></p><fieldset disabled={busy}><label className="field-label">Product name<input name="product_name" defaultValue={editing.product_name} maxLength={300} autoFocus/></label><label className="field-label">Retailer<input name="retailer" defaultValue={editing.retailer} maxLength={150}/></label><label className="field-label">Product URL <span>(optional)</span><input name="product_url" type="url" placeholder="https://…" defaultValue={editing.product_url} maxLength={2048}/></label><label className="field-label">Image URL <span>(optional)</span><input name="image_url" type="url" placeholder="https://…" defaultValue={editing.image_url} maxLength={2048}/></label><p className="field-help">Use your own image or an image you have permission to republish. External images aren’t loaded automatically.</p><label className="checkbox-label"><input name="image_rights_confirmed" type="checkbox" defaultChecked={editing.image_rights_confirmed}/>I have permission to use this image.</label><label className="field-label">Notes <span>(optional)</span><textarea name="notes" rows={3} maxLength={3000} defaultValue={editing.notes}/></label></fieldset>{editorError && <p className="validation-error" role="alert">{editorError}</p>}<div className="form-actions"><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save details"}</button><button className="button quiet" type="button" onClick={closeEditor} disabled={busy}>Cancel</button></div></form>}</dialog>
  </>;
}

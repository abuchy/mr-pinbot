"use client";

import { PinBoardSelect } from "@/components/pin-board-select";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { parseShopMyLink, safePublicUrl } from "@/lib/content";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { browserDatabase } from "@/lib/supabase-browser";
import styles from "./capture.module.css";

type Capture = { title: string; source: string; data: string };
const maxBytes = 4_000_000;

export function CaptureForm() {
  const [boardId, setBoardId] = useState("");
  const [capture, setCapture] = useState<Capture>();
  const [title, setTitle] = useState("");
  const [affiliate, setAffiliate] = useState("");
  const [copiedImage, setCopiedImage] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nonce = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === window && event.data?.type === "pinbot:clipboard") {
        const value = typeof event.data.value === "string" ? event.data.value.trim() : "";
        if (!value) return;
        if (value.length <= 2048 && parseShopMyLink(value)) setAffiliate(value);
        else if (value.length <= 2048 && safePublicUrl(value)) {
          setCopiedImage(value);
          setPreviewFailed(false);
        } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !isBlockedMetadata(value)) {
          setTitle(value.replace(/\s+/g, " ").slice(0, 100));
        }
        return;
      }
      if (event.origin !== location.origin || event.source !== window ||
          event.data?.type !== "pinbot:capture" || event.data.nonce !== nonce) return;
      const result = event.data.capture as Capture | null;
      if (!result) return;
      setCapture(result);
      const suggested = result.title.split(/\s+[|–—]\s+/)[0].trim();
      if (!isBlockedMetadata(suggested)) setTitle(previous => previous || suggested.slice(0, 100));
    };
    window.addEventListener("message", receive);
    window.postMessage({ type: "pinbot:request-capture", nonce }, location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const db = browserDatabase();
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => data.subscription.unsubscribe();
  }, []);

  function clear() {
    setBoardId("");
    setTitle("");
    setAffiliate("");
    setCopiedImage("");
    setCapture(undefined);
    setPreviewFailed(false);
    setError("");
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const session = (await browserDatabase()?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sign in to Mr. Pinbot before saving.");
      if (!parseShopMyLink(affiliate)) throw new Error("Enter a valid ShopMy affiliate link.");
      let image: File | undefined;
      if (!copiedImage && capture?.data.startsWith("data:image/")) {
        const blob = await (await fetch(capture.data)).blob();
        image = new File([blob], "selected-image", { type: blob.type });
      }
      if (!image && !copiedImage && !capture?.source) throw new Error("Copy an image address to continue.");
      if (image && image.size > maxBytes) throw new Error("Choose an image under 4 MB.");
      const form = new FormData();
      form.set("boardId", boardId);
      form.set("title", title);
      form.set("affiliate", affiliate);
      if (image) form.set("image", image);
      form.set("source", copiedImage || capture?.source || "");
      const response = await fetch("/api/content/capture", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: form,
      });
      const result = await response.json().catch(() => null);
      if (response.status !== 201 || !result?.id) throw new Error(result?.error || "The Draft could not be saved. Try again.");
      clear();
      setSaved(true);
      try { localStorage.setItem("pinbot-library-changed", crypto.randomUUID()); } catch { /* optional refresh signal */ }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const imageUrl = copiedImage || capture?.data || capture?.source;

  return <main className={styles.capture}>
    <div className={styles.brand}><Image src="/pinbot.png" width={25} height={40} alt=""/> Mr. Pinbot</div>
    <h1>Let&apos;s Pin it.</h1>
    <form onSubmit={save}>
      {imageUrl && !previewFailed && <div className={styles.preview}>
        <Image src={imageUrl} alt="Selected product image" fill unoptimized referrerPolicy="no-referrer"
          onError={() => setPreviewFailed(true)}/>
      </div>}
      {!imageUrl && <p className="field-help">
        Copy your ShopMy link, image URL, and product title while this panel is open.
      </p>}
      <label className="field-label">Image URL
        <input type="text" readOnly value={copiedImage || capture?.source || ""}/>
      </label>
      <label className="field-label">Pin Title
        <input required maxLength={100} value={title} disabled={busy} onChange={event => setTitle(event.target.value)}/>
      </label>
      <label className="field-label">ShopMy Affiliate Link
        <input type="url" required maxLength={2048} value={affiliate} disabled={busy}
          onChange={event => setAffiliate(event.target.value)}/>
      </label>
      <PinBoardSelect value={boardId} onChange={setBoardId} disabled={busy} enabled={signedIn}/>
      {error && <p className="validation-error" role="alert">{error}</p>}
      {!signedIn && <p className="field-help"><a style={{ font: "inherit", color: "inherit" }} href="/library" target="_blank" rel="noreferrer">Sign in to Mr. Pinbot to save.</a></p>}
      {saved && <p className="import-alert" role="status">Pin added to your library!</p>}
      <div className="form-actions"><button className="button primary" disabled={busy || !signedIn || !imageUrl || !boardId}>
        {busy ? "Creating pin..." : "Create Pin"}
      </button>
      <button type="button" className="button primary" disabled={busy || !(title || affiliate || imageUrl || boardId)} onClick={clear}>Clear</button></div>
    </form>
  </main>;
}

"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseShopMyLink, safePublicUrl } from "@/lib/content";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { browserDatabase } from "@/lib/supabase-browser";
import styles from "./create-pin-form.module.css";

export function CreatePinForm({ disabled, onCreated }: { disabled: boolean; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [affiliate, setAffiliate] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [localPreview, setLocalPreview] = useState("");
  const [previewState, setPreviewState] = useState({ url: "", valid: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const preview = file ? localPreview : imageUrl.trim();
  const validImage = !!preview && previewState.url === preview && previewState.valid;
  const valid = !!title.trim() && title.trim().length <= 100 && !isBlockedMetadata(title)
    && !!parseShopMyLink(affiliate.trim()) && validImage
    && (file ? file.size > 0 && file.size <= 4_000_000 : !!safePublicUrl(imageUrl.trim()) && imageUrl.trim().length <= 2048);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  function removeImage() {
    setFile(undefined);
    setLocalPreview("");
    setImageUrl("");
    setPreviewState({ url: "", valid: false });
    if (upload.current) upload.current.value = "";
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!valid || disabled || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const session = (await browserDatabase()?.auth.getSession())?.data.session;
      if (!session) throw new Error("Your session ended. Please sign in again.");
      const data = new FormData();
      data.set("title", title.trim());
      data.set("affiliate", affiliate.trim());
      if (file) data.set("image", file);
      else data.set("source", imageUrl.trim());
      const response = await fetch("/api/content/capture", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: data,
      });
      const result = await response.json().catch(() => null);
      if (response.status !== 201 || !result?.id) throw new Error(result?.error || "Could not confirm the save. Check your library before trying again.");
      setTitle("");
      setAffiliate("");
      removeImage();
      setMessage("Pin added to your library!");
      try { localStorage.setItem("pinbot-library-changed", crypto.randomUUID()); } catch { /* Refresh still runs below. */ }
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save. Check your connection and your library before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="import-panel">
    <h2>Generate a Pin</h2>
    <form onSubmit={create} className={styles.form}>
      <fieldset disabled={disabled || busy} className={styles.fields}>
        <label className="field-label">Pin Title
          <input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)}/>
        </label>
        <label className="field-label">ShopMy Affiliate Link
          <input type="url" required maxLength={2048} value={affiliate} onChange={event => setAffiliate(event.target.value)}/>
        </label>
        <div className={styles.images}>
          <label className="field-label">Product Image
            <input ref={upload} className={styles.upload} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const selected = event.target.files?.[0];
              if (!selected) return;
              if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || !selected.size || selected.size > 4_000_000) {
                setError("Choose a JPEG, PNG, or WebP image under 4 MB.");
                event.target.value = "";
                return;
              }
              setError("");
              setImageUrl("");
              setFile(selected);
              setLocalPreview(URL.createObjectURL(selected));
            }}/>
          </label>
          <label className="field-label">Or paste an image URL
            <input type="url" maxLength={2048} value={imageUrl} onChange={event => {
              setImageUrl(event.target.value);
              setFile(undefined);
              setLocalPreview("");
              if (upload.current) upload.current.value = "";
            }}/>
          </label>
          {preview && <div>
            {(file || safePublicUrl(preview)) && <div className={styles.preview}>
              <Image key={preview} src={preview} alt="Selected product image" fill unoptimized referrerPolicy="no-referrer"
                onLoad={() => setPreviewState({ url: preview, valid: true })}
                onError={() => setPreviewState({ url: preview, valid: false })}/>
            </div>}
            {!validImage && <p className="field-help" role="status">Waiting for a valid image preview. Check the image address if it does not load.</p>}
            <button type="button" className="inline-button" onClick={removeImage}>Remove image</button>
          </div>}
        </div>
      </fieldset>
      {error && <p className="validation-error" role="alert">{error}</p>}
      {message && <p className="import-alert" role="status">{message}</p>}
      <div className="form-actions"><button className="button primary" disabled={disabled || busy || !valid}>{busy ? "Creating Pin…" : "Create Pin"}</button></div>
    </form>
  </section>;
}

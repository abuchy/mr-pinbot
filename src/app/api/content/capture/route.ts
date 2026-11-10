import { after, type NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { parseShopMyLink, safePublicUrl } from "@/lib/content";
import { describeImage } from "@/lib/description";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { imageFailureCode, saveProductImageBytes, storeProductImage } from "@/lib/product-images";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to Mr. Pinbot before saving." }, 401);

  const length = Number(request.headers.get("content-length"));
  if (!Number.isInteger(length) || length < 1 || length > 4_200_000) {
    return privateJson({ error: "Choose an image under 4 MB." }, 413);
  }
  const form = await request.formData().catch(() => null);
  const title = String(form?.get("title") ?? "").trim();
  const affiliate = String(form?.get("affiliate") ?? "");
  const link = affiliate.length <= 2048 ? parseShopMyLink(affiliate) : null;
  const file = form?.get("image");
  const source = String(form?.get("source") ?? "");
  if (!title || title.length > 100 || isBlockedMetadata(title)) {
    return privateJson({ error: "Enter a product title up to 100 characters." }, 400);
  }
  if (!link) return privateJson({ error: "Enter a valid ShopMy affiliate link." }, 400);
  const publicSource = source.length <= 2048 && safePublicUrl(source) ? source : "";
  if (file instanceof File ? !file.size || file.size > 4_000_000 : !publicSource) {
    return privateJson({ error: "Choose a JPEG, PNG, or WebP image under 4 MB." }, 400);
  }

  const { database, user } = auth;
  const items = database.from("content_items");
  const existing = await items.select("id").eq("owner_id", user.id).eq("source_key", link.source_key).maybeSingle();
  if (existing.error) return privateJson({ error: "Could not check your library. Try again." }, 503);
  if (existing.data) return privateJson({ error: "This link is already saved. Open the library to edit the existing Pin." }, 409);

  let image;
  try {
    image = file instanceof File
      ? await saveProductImageBytes(database, user.id, Buffer.from(await file.arrayBuffer()), title, publicSource)
      : await storeProductImage(database, user.id, publicSource, title);
  } catch (error) {
    const code = imageFailureCode(error);
    console.warn("[pinbot:capture]", { code });
    if (code === "image_download_failed") return privateJson({ error: "The image could not be downloaded. Choose a local copy and try again." }, 422);
    return code === "image_decode_failed"
      ? privateJson({ error: "Choose a supported static JPEG, PNG, or WebP image." }, 400)
      : privateJson({ error: "The image could not be stored. Try saving again." }, 503);
  }

  const { data: draft, error } = await items.insert({
    ...link, ...image, owner_id: user.id, website_url: link.affiliate_url,
    product_name: title, source: "authorized_browser", enrichment_status: "partial",
  }).select("id,updated_at").single();
  if (error?.code === "23505") return privateJson({ error: "This link is already saved. Open the library to view the Pin." }, 409);
  if (error || !draft) return privateJson({ error: "The Draft could not be saved. Try again." }, 503);

  after(async () => {
    try {
      const generated = await describeImage(image.image_url, title);
      if (isBlockedMetadata(generated.description)) return;
      const result = await items.update({
        product_description: generated.description, description_image_url: image.image_url, description_is_manual: false,
        enrichment_status: "enriched", updated_at: new Date().toISOString(),
      }).eq("id", draft.id).eq("owner_id", user.id).eq("updated_at", draft.updated_at);
      if (result.error) throw result.error;
    } catch {
      console.warn("[pinbot:capture] Description generation or save failed", { id: draft.id });
    }
  });

  return privateJson({ id: draft.id }, 201);
}

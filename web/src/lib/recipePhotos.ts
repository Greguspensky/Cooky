import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "recipe-photos";
const SIGNED_URL_TTL_SECONDS = 3600;
const CACHE_TTL_MS = 55 * 60 * 1000; // refresh before the signed URL actually expires

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Signed URL for one photo, cached until shortly before it expires. */
export async function getSignedPhotoUrl(db: SupabaseClient, path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.signedUrl;
}

/** Signed URLs for several photos in one request (e.g. a page of recipe cards). */
export async function getSignedPhotoUrls(
  db: SupabaseClient,
  paths: string[],
): Promise<Record<string, string>> {
  const now = Date.now();
  const stale = paths.filter((p) => {
    const cached = cache.get(p);
    return !cached || cached.expiresAt <= now;
  });

  if (stale.length > 0) {
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(stale, SIGNED_URL_TTL_SECONDS);
    if (!error && data) {
      for (const item of data) {
        if (item.signedUrl && item.path) {
          cache.set(item.path, { url: item.signedUrl, expiresAt: now + CACHE_TTL_MS });
        }
      }
    }
  }

  const result: Record<string, string> = {};
  for (const path of paths) {
    const cached = cache.get(path);
    if (cached) result[path] = cached.url;
  }
  return result;
}

/** Downscales and compresses a photo client-side before upload, so a phone photo isn't sent at full size. */
export async function prepareImageForUpload(
  file: File,
  maxDimension = 1600,
  quality = 0.85,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
        "image/jpeg",
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Uploads a dish photo for a recipe and returns the storage path to save on the recipe. */
export async function uploadRecipePhoto(
  db: SupabaseClient,
  householdId: string,
  recipeId: string,
  file: File,
): Promise<string> {
  const blob = await prepareImageForUpload(file);
  const path = `${householdId}/${recipeId}/${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteRecipePhoto(db: SupabaseClient, path: string): Promise<void> {
  cache.delete(path);
  await db.storage.from(BUCKET).remove([path]);
}

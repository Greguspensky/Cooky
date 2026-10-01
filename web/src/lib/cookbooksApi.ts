import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedRecipe } from "../../../lib/cookbook";
import { getAccessToken } from "../api";

export type CookbookStatus = "uploaded" | "processing" | "ready" | "failed";

export interface Cookbook {
  id: string;
  household_id: string;
  title: string;
  storage_path: string;
  page_count: number | null;
  uploaded_by: string | null;
  status: CookbookStatus;
  created_at: string;
}

export interface ImportCandidate {
  id: string;
  cookbook_id: string;
  recipe: ExtractedRecipe;
  page: number | null;
  status: "pending" | "accepted" | "rejected";
  duplicate_of: string | null;
  duplicate_recipe: { title: string } | null;
}

export async function listCookbooks(db: SupabaseClient): Promise<Cookbook[]> {
  const { data, error } = await db.from("cookbooks").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Cookbook[];
}

export async function fetchCookbook(db: SupabaseClient, id: string): Promise<Cookbook> {
  const { data, error } = await db.from("cookbooks").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Cookbook;
}

export async function listPendingCandidates(db: SupabaseClient, cookbookId: string): Promise<ImportCandidate[]> {
  const { data, error } = await db
    .from("import_candidates")
    .select("*, duplicate_recipe:recipes!duplicate_of(title)")
    .eq("cookbook_id", cookbookId)
    .eq("status", "pending")
    .order("page", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data as unknown as ImportCandidate[];
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request to ${path} failed (${response.status}).`);
  return response.json();
}

/** Uploads a PDF straight to Supabase Storage via a signed URL, then kicks off chunking. Actual
 * extraction happens job-by-job via runNextImportJob, driven by the review screen. */
export async function uploadCookbook(db: SupabaseClient, file: File, title: string): Promise<{ cookbookId: string }> {
  const { cookbookId, path, token } = await apiPost<{ cookbookId: string; path: string; token: string }>(
    "/api/cookbooks/upload-url",
    { title },
  );

  const uploaded = await db.storage.from("cookbooks").uploadToSignedUrl(path, token, file);
  if (uploaded.error) throw uploaded.error;

  await apiPost("/api/cookbooks/start", { cookbookId });
  return { cookbookId };
}

export async function runNextImportJob(cookbookId: string): Promise<{ done: boolean; remaining: number; found: number }> {
  return apiPost("/api/cookbooks/run-job", { cookbookId });
}

export async function acceptCandidate(candidateId: string): Promise<{ recipeId: string }> {
  return apiPost("/api/cookbooks/candidates", { candidateId, action: "accept" });
}

export async function rejectCandidate(candidateId: string): Promise<void> {
  await apiPost("/api/cookbooks/candidates", { candidateId, action: "reject" });
}

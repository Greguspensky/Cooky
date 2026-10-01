import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMainButton } from "../../hooks/useTelegramButtons";
import { listCookbooks, uploadCookbook, type Cookbook } from "../../lib/cookbooksApi";

const STATUS_LABEL: Record<Cookbook["status"], string> = {
  uploaded: "Starting…",
  processing: "Extracting recipes…",
  ready: "Ready to review",
  failed: "Couldn't read this PDF",
};

export function CookbooksListScreen({
  db,
  onOpenCookbook,
}: {
  db: SupabaseClient;
  onOpenCookbook: (id: string) => void;
}) {
  const [cookbooks, setCookbooks] = useState<Cookbook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reload() {
    listCookbooks(db)
      .then(setCookbooks)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your cookbooks."));
  }

  useEffect(reload, [db]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const title = file.name.replace(/\.pdf$/i, "").trim() || "Untitled cookbook";
      const { cookbookId } = await uploadCookbook(db, file, title);
      onOpenCookbook(cookbookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that PDF.");
    } finally {
      setUploading(false);
    }
  }

  useMainButton(uploading ? "Uploading…" : "+ Upload PDF", () => fileInput.current?.click(), !uploading);

  return (
    <div className="screen">
      <h1>Import</h1>
      {error && <p className="error">{error}</p>}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        onChange={handleFile}
        style={{ display: "none" }}
      />

      {cookbooks === null && !error && <p className="muted">Loading…</p>}

      {cookbooks !== null && cookbooks.length === 0 && (
        <div className="center">
          <div className="emoji">📥</div>
          <h2>No cookbooks yet</h2>
          <p className="muted">
            Tap “+ Upload PDF” below to import recipes from a cookbook, or send one as a document to
            the bot.
          </p>
        </div>
      )}

      {cookbooks && cookbooks.length > 0 && (
        <ul className="list-of-lists">
          {cookbooks.map((c) => (
            <li key={c.id}>
              <button className="list-card" onClick={() => onOpenCookbook(c.id)}>
                <strong>{c.title}</strong>
                <span className="muted"> — {STATUS_LABEL[c.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

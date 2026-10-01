// Server-only cookbook-import logic: PDF splitting and Claude extraction. Never import this
// from /web.

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { buildChunkRanges, parseExtractedRecipes, type ExtractedRecipe, type PageRange } from "./cookbook.js";

export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

/** Extracts a `[range.pageStart, range.pageEnd]` (1-indexed, inclusive) page range into its own
 * standalone PDF, for sending to Claude as one chunk. */
export async function sliceChunkPdf(pdfBytes: Uint8Array, range: PageRange): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdfBytes);
  const out = await PDFDocument.create();
  const indices = [];
  for (let p = range.pageStart; p <= range.pageEnd; p++) indices.push(p - 1);
  const pages = await out.copyPages(source, indices);
  for (const page of pages) out.addPage(page);
  return out.save();
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_recipes",
  description: "Report every distinct recipe found in this cookbook excerpt.",
  input_schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            servings: { type: "number" },
            prep_minutes: { type: "number" },
            cook_minutes: { type: "number" },
            cuisine: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  qty: { type: "number" },
                  unit: { type: "string" },
                  item: { type: "string" },
                  note: { type: "string" },
                },
                required: ["item"],
              },
            },
            steps: { type: "array", items: { type: "string" } },
            page: { type: "number", description: "Page number within this excerpt (1 = its first page)." },
          },
          required: ["title", "ingredients", "steps"],
        },
      },
    },
    required: ["recipes"],
  },
};

const EXTRACT_PROMPT =
  "This PDF excerpt is a few pages from a cookbook. Find every distinct recipe on these pages " +
  "(ignore introductions, tips, and indexes) and call extract_recipes with all of them. Keep each " +
  "recipe in its original language. Only include a step's timer by writing the duration in its " +
  "text, exactly as the book phrases it — do not invent one.";

/** Sends one PDF chunk to Claude and returns the recipes it finds, already validated. */
export async function extractRecipesFromChunk(pdfBytes: Uint8Array): Promise<ExtractedRecipe[]> {
  const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: env.claudeModelMain,
    max_tokens: 4096,
    tool_choice: { type: "tool", name: "extract_recipes" },
    tools: [EXTRACT_TOOL],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdfBytes).toString("base64") },
          },
          { type: "text", text: EXTRACT_PROMPT },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return [];
  return parseExtractedRecipes(toolUse.input);
}

/**
 * Downloads an uploaded cookbook PDF, splits it into import_jobs, and marks it "processing".
 * Shared by the Mini App's upload flow and the bot's PDF handler. Each job is later processed
 * one at a time by /api/cookbooks/run-job, driven by the Mini App while the review screen is
 * open — simpler than self-chaining serverless invocations, at the cost of needing the app open
 * to make progress.
 */
export async function startCookbookImport(db: SupabaseClient, cookbookId: string): Promise<{ jobCount: number }> {
  const cookbook = await db.from("cookbooks").select("storage_path").eq("id", cookbookId).single();
  if (cookbook.error) throw cookbook.error;

  const download = await db.storage.from("cookbooks").download(cookbook.data.storage_path);
  if (download.error) throw download.error;
  const pdfBytes = new Uint8Array(await download.data.arrayBuffer());

  const pageCount = await getPdfPageCount(pdfBytes);
  const ranges = buildChunkRanges(pageCount);

  if (ranges.length > 0) {
    const jobs = await db
      .from("import_jobs")
      .insert(ranges.map((r) => ({ cookbook_id: cookbookId, page_start: r.pageStart, page_end: r.pageEnd })));
    if (jobs.error) throw jobs.error;
  }

  const update = await db
    .from("cookbooks")
    .update({ page_count: pageCount, status: ranges.length > 0 ? "processing" : "failed" })
    .eq("id", cookbookId);
  if (update.error) throw update.error;

  return { jobCount: ranges.length };
}

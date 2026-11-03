/**
 * POST /api/extract: document extraction only (server-side).
 *
 * Body, either:
 *   Content-Type: text/plain        -> one document named "document.txt"
 *   Content-Type: application/json  -> { "documents": [{ "name": "sales.txt", "text": "..." }, ...] }
 *
 * Returns: a validated OrderAssessment (200), or { error, details } on failure.
 * The result is an unverified AI draft: send it to /api/verify next.
 * Token usage is reported in x-riskit-* headers. Identical input within this
 * server process is served from memory with no second Claude call.
 */
import { createHash, randomUUID } from "node:crypto";
import { parseDocuments, type InputDocument } from "../../../lib/documents";
import { ExtractionError, EXTRACT_MODEL, extractOrderAssessment } from "../../../lib/extraction.server";
import type { OrderAssessment } from "../../../lib/types";

export const runtime = "nodejs";

const CACHE_MAX = 50;
const cache = new Map<string, OrderAssessment>();

function fail(status: number, error: string, details: string[] = []) {
  return Response.json({ error, details }, { status });
}

async function readDocuments(req: Request): Promise<{ docs: InputDocument[] } | Response> {
  const type = req.headers.get("content-type") ?? "";
  let raw: unknown;
  if (type.startsWith("text/plain")) {
    raw = [{ name: "document.txt", text: await req.text() }];
  } else if (type.startsWith("application/json")) {
    try {
      raw = ((await req.json()) as { documents?: unknown })?.documents;
    } catch {
      return fail(400, "Request body is not valid JSON");
    }
  } else {
    return fail(400, "Use Content-Type text/plain or application/json");
  }
  const p = parseDocuments(raw);
  return p.ok ? { docs: p.docs } : fail(p.status, p.error);
}

export async function POST(req: Request) {
  const read = await readDocuments(req);
  if (read instanceof Response) return read;
  const { docs } = read;

  const key = createHash("sha256").update(EXTRACT_MODEL).update(JSON.stringify(docs)).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    return Response.json({ ...structuredClone(cached), id: randomUUID() }, {
      headers: { "x-riskit-cache": "hit", "x-riskit-model": EXTRACT_MODEL, "x-riskit-input-tokens": "0", "x-riskit-output-tokens": "0" },
    });
  }

  try {
    const { assessment, usage } = await extractOrderAssessment(docs, randomUUID());
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, assessment);
    return Response.json(assessment, {
      headers: {
        "x-riskit-cache": "miss",
        "x-riskit-model": EXTRACT_MODEL,
        "x-riskit-input-tokens": String(usage.input_tokens),
        "x-riskit-output-tokens": String(usage.output_tokens),
      },
    });
  } catch (err) {
    if (err instanceof ExtractionError) return fail(err.status, err.message, err.details);
    return fail(500, "Unexpected server error");
  }
}

/**
 * POST /api/verify: the second, independent Claude call. Checks an extraction draft
 * against the source documents.
 *
 * Body (JSON): { "documents": [{ "name", "text" }], "assessment": OrderAssessment (status "pending") }
 * Returns: VerificationResult. Any finding (AI or deterministic) means verdict FAIL and
 * blocked: true. If the verifier cannot run, this returns an error: a draft is never
 * passed without verification.
 */
import { createHash } from "node:crypto";
import { parseDocuments } from "../../../lib/documents";
import type { VerificationResult } from "../../../lib/types";
import { validateOrderAssessment } from "../../../lib/validate";
import { VERIFY_MODEL, VerificationError, verifyDraft } from "../../../lib/verification.server";

export const runtime = "nodejs";

const CACHE_MAX = 50;
const cache = new Map<string, VerificationResult>();

function fail(status: number, error: string, details: string[] = []) {
  return Response.json({ error, details }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Request body is not valid JSON");
  }
  const p = parseDocuments(body.documents);
  if (!p.ok) return fail(p.status, p.error);
  const v = validateOrderAssessment(body.assessment);
  if (!v.ok) return fail(400, "Invalid assessment", v.errors);
  if (v.value.human_review_status !== "pending") {
    return fail(409, "Only an unreviewed AI draft (status pending) can be verified");
  }

  const key = createHash("sha256").update(VERIFY_MODEL).update(String(body.language ?? "en")).update(JSON.stringify([p.docs, v.value])).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    return Response.json(cached, { headers: { "x-riskit-cache": "hit", "x-riskit-model": VERIFY_MODEL, "x-riskit-input-tokens": "0", "x-riskit-output-tokens": "0" } });
  }

  try {
    const language = typeof body.language === "string" ? body.language : "en";
    const { result, usage } = await verifyDraft(p.docs, v.value, language);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return Response.json(result, {
      headers: {
        "x-riskit-cache": "miss",
        "x-riskit-model": VERIFY_MODEL,
        "x-riskit-input-tokens": String(usage.input_tokens),
        "x-riskit-output-tokens": String(usage.output_tokens),
      },
    });
  } catch (err) {
    if (err instanceof VerificationError) return fail(err.status, err.message, err.details);
    return fail(500, "Unexpected server error");
  }
}

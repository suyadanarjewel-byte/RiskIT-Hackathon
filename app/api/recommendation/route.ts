/**
 * POST /api/recommendation: one Claude call that drafts a risk recommendation.
 *
 * Body (JSON):
 *   assessment          OrderAssessment, human-approved (human_review_status "approved")
 *   verification        VerificationResult for this assessment
 *   verifier_decisions  HumanReviewDecision[] (needed if the verifier failed)
 *   manual_fx_rate?     user-provided fallback rate, used only if the lookup has none
 *   language?           output language for the draft text (en, zh-CN, id, vi, ko)
 *
 * The server re-checks eligibility and recomputes all numbers itself; it never
 * trusts calculation results sent by the client. Returns a RecommendationDraft
 * (human_review_required: true) that must go through the Human Review Gate.
 *
 * Prototype limitation: without server-side storage, approval and verifier decisions
 * are taken from the request. A production version must load them from a trusted store.
 */
import { createHash } from "node:crypto";
import { checkRecommendationEligibility } from "../../../lib/recommendation";
import { getExchangeRate } from "../../../lib/fx.server";
import { prepareRecommendationInput } from "../../../lib/recommendationInput";
import { RECOMMEND_MODEL, RecommendationError, draftRecommendation } from "../../../lib/recommendation.server";
import type { HumanReviewDecision, RecommendationDraft, VerificationResult } from "../../../lib/types";
import { validateOrderAssessment } from "../../../lib/validate";

export const runtime = "nodejs";

const cache = new Map<string, RecommendationDraft>();
const CACHE_MAX = 50;

function fail(status: number, error: string, details: string[] = []) {
  return Response.json({ error, details }, { status });
}

function isVerification(v: unknown): v is VerificationResult {
  const o = v as VerificationResult | null;
  return !!o && typeof o.assessment_id === "string" && (o.verdict === "PASS" || o.verdict === "FAIL") && Array.isArray(o.issues);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Request body is not valid JSON");
  }

  const v = validateOrderAssessment(body.assessment);
  if (!v.ok) return fail(400, "Invalid assessment", v.errors);
  const assessment = v.value;
  if (!isVerification(body.verification)) return fail(400, "Invalid or missing verification result");
  const verification = body.verification;
  const decisions = Array.isArray(body.verifier_decisions) ? (body.verifier_decisions as HumanReviewDecision[]) : [];

  const elig = checkRecommendationEligibility(assessment, verification, decisions);
  if (!elig.ok) return fail(409, "Recommendation not allowed yet: the assessment must pass the Human Review Gate first", elig.reasons);

  // Deterministic inputs, recomputed on the server.
  const manual = typeof body.manual_fx_rate === "number" && body.manual_fx_rate > 0 ? body.manual_fx_rate : null;
  const language = typeof body.language === "string" ? body.language : "en";
  const from = assessment.sales_currency.value;
  const to = assessment.reporting_currency.value;
  // Same server-side retrieval and cache as /api/fx, so the draft uses the rate the user saw.
  const fx = from && to ? (await getExchangeRate(from, to, manual)).result : null;
  const input = prepareRecommendationInput(assessment, verification, decisions, fx);

  const key = createHash("sha256").update(RECOMMEND_MODEL).update(language).update(JSON.stringify(input.payload)).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    return Response.json(cached, { headers: { "x-riskit-cache": "hit", "x-riskit-model": RECOMMEND_MODEL, "x-riskit-input-tokens": "0", "x-riskit-output-tokens": "0" } });
  }

  try {
    const { draft, usage } = await draftRecommendation(input, language);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, draft);
    return Response.json(draft, {
      headers: {
        "x-riskit-cache": "miss",
        "x-riskit-model": RECOMMEND_MODEL,
        "x-riskit-input-tokens": String(usage.input_tokens),
        "x-riskit-output-tokens": String(usage.output_tokens),
      },
    });
  } catch (err) {
    if (err instanceof RecommendationError) return fail(err.status, err.message, err.details);
    return fail(500, "Unexpected server error");
  }
}

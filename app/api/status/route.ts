/**
 * GET /api/status: whether live Claude calls are configured. Never returns the key.
 */
import { EXTRACT_MODEL } from "../../../lib/extraction.server";
import { RECOMMEND_MODEL } from "../../../lib/recommendation.server";
import { VERIFY_MODEL } from "../../../lib/verification.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const live = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  return Response.json({
    live_ai: live,
    models: { extract: EXTRACT_MODEL, verify: VERIFY_MODEL, recommend: RECOMMEND_MODEL },
    setup: live ? null : "Set ANTHROPIC_API_KEY in .env.local in the project folder, then restart the server.",
  });
}

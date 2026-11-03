/**
 * GET /api/fx?from=USD&to=SGD[&manual=1.28]
 * Server-side exchange-rate retrieval (lib/fx.server.ts). Never invents a rate:
 * returns live (indicative), cached (with timestamp), user-provided (manual) or unavailable.
 */
import { getExchangeRate } from "../../../lib/fx.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE = /^[A-Za-z]{3}$/;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "";
  const to = u.searchParams.get("to") ?? "";
  if (!CODE.test(from) || !CODE.test(to)) {
    return Response.json({ error: "Use ?from=XXX&to=YYY with 3-letter currency codes" }, { status: 400 });
  }
  const m = u.searchParams.get("manual");
  const manual = m === null ? null : Number(m);
  if (m !== null && !(Number.isFinite(manual) && (manual as number) > 0)) {
    return Response.json({ error: "Manual rate must be a positive number" }, { status: 400 });
  }
  const r = await getExchangeRate(from, to, manual);
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/transcribe  { "image": "<base64>", "media_type": "image/png" }
 * Returns { text } for the user to check before analysis. One Claude call per image.
 */
import { IMAGE_TYPES, MAX_IMAGE_BYTES, TranscribeError, transcribeImage, type ImageType } from "../../../lib/transcribe.server";

export const runtime = "nodejs";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  let body: { image?: unknown; media_type?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Request body is not valid JSON");
  }
  if (typeof body.image !== "string" || !body.image) return fail(400, "Missing image data");
  if (!IMAGE_TYPES.includes(body.media_type as ImageType)) return fail(415, "Use a PNG, JPEG, WebP or GIF image");
  if (Math.floor((body.image.length * 3) / 4) > MAX_IMAGE_BYTES) return fail(413, "Image is larger than 5 MB");
  try {
    const { text, usage } = await transcribeImage(body.image, body.media_type as ImageType);
    if (!text) return fail(422, "No readable text was found in the image");
    return Response.json({ text }, { headers: { "x-riskit-input-tokens": String(usage.input_tokens), "x-riskit-output-tokens": String(usage.output_tokens) } });
  } catch (err) {
    if (err instanceof TranscribeError) return fail(err.status, err.message);
    return fail(500, "Unexpected server error");
  }
}

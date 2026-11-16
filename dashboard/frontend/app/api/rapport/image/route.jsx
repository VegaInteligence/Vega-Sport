import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadReport } from "../../../../src/server/report-data.js";
import { card, cardImages, HEIGHT, WIDTH } from "../../../../src/server/report-cards.jsx";

export const dynamic = "force-dynamic";

const FONTS = [
  ["inter-latin-400-normal", 400], ["inter-latin-700-normal", 700], ["inter-latin-ext-400-normal", 400], ["inter-latin-ext-700-normal", 700],
];
let fonts;
async function loadFonts() {
  // As the next/og guide does in the Node.js runtime (next.config traces the files).
  // The server runs from the site's folder (Vercel) or from dashboard/ (next dev frontend).
  const read = async (file) => {
    for (const folder of ["src/server/fonts", "frontend/src/server/fonts"]) {
      try {
        return await readFile(join(process.cwd(), folder, `${file}.woff`));
      } catch {}
    }
    throw new Error(`font ${file} not found`);
  };
  fonts ??= Promise.all(FONTS.map(async ([file, weight]) => ({ name: "Inter", weight, style: "normal", data: await read(file) })));
  return fonts;
}

const IMAGE_TYPES = /^image\/(?:png|jpeg|webp|gif|svg\+xml)$/;
/** An image as a data URL, or nothing: a card never fails for a portrait or a crest. */
async function dataUrl(url) {
  if (!url || !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!response.ok || !IMAGE_TYPES.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    // The renderer reads a WebP's size but does not draw it: every image becomes a PNG of
    // 480 px at most (sharp, an optional dependency of next), else the initials are drawn.
    const sharp = (await import("sharp")).default;
    const png = await sharp(bytes).resize(480, 480, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/** GET /api/rapport/image?id=…&n=1…6[&season=…]: one image of a report, 1080 × 1350 PNG. */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const n = Number(params.get("n"));
  if (!Number.isInteger(n) || n < 1 || n > 6) return new Response("Image invalide.", { status: 400 });
  try {
    const report = await loadReport(params.get("id"), { season: params.get("season") });
    if (!report) return new Response("Rapport indisponible.", { status: 404 });
    const urls = [...new Set(cardImages(report, n).filter(Boolean))];
    const [loaded, fontData] = await Promise.all([Promise.all(urls.map(dataUrl)), loadFonts()]);
    const images = Object.fromEntries(urls.map((url, i) => [url, loaded[i]]).filter(([, data]) => data));
    return new ImageResponse(card(report, n, images), {
      width: WIDTH, height: HEIGHT, fonts: fontData,
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("report image failed", params.get("id"), n, error?.message);
    return new Response("Image momentanément indisponible.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

import { ImageResponse } from "next/og";
import { BRAND_IVORY, BRAND_NIGHT, MARK } from "../../../src/brand-mark.js";

// The app icons (apple-touch-icon, site.webmanifest): the mark « V* » on its tile, in the
// logo's two colours (docs/brand/README.md).
const SIZES = [180, 192, 512];
// The share picture is a file; this address stays for the pages that still name it.
const SHARE = "/branding/vega/share-1200x630.jpg";

export function GET(request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  // A path, not an address: the visitor's own origin stays, whatever host the server sees.
  if (params.get("kind") !== "icon")
    return new Response(null, { status: 308, headers: { Location: SHARE } });
  const n = Number(params.get("size"));
  const side = SIZES.includes(n) ? n : 512;
  const light = params.get("theme") === "light";
  const tile = light ? BRAND_IVORY : BRAND_NIGHT;
  const ink = light ? BRAND_NIGHT : BRAND_IVORY;
  // The mark takes 64 % of the tile's width: a platform that rounds the tile or cuts it
  // into a circle leaves it whole.
  const width = Math.round(side * 0.64);
  const height = Math.round((width * MARK.height) / MARK.width);
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        background: tile,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${MARK.width} ${MARK.height}`}
      >
        <path d={MARK.letter} fill={ink} />
        <path d={MARK.sign} fill={ink} />
      </svg>
    </div>,
    { width: side, height: side },
  );
}

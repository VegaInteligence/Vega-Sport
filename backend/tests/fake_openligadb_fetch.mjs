// Supply a frozen provider response to the real Node bridge and fail on any stray URL.
import { readFileSync } from "node:fs";

globalThis.fetch = async (url) => {
  if (String(url) !== process.env.VEGA_TEST_OPENLIGA_URL) throw new Error(`Unexpected OpenLigaDB URL: ${url}`);
  return new Response(readFileSync(process.env.VEGA_TEST_OPENLIGA), { headers: { "Content-Type": "application/json" } });
};

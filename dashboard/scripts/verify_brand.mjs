/** HTTP E2E branding contract against a built Next/Bun website. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.ORION_VERIFY_URL || "http://127.0.0.1:3000";
const report = {
  setup:
    "Running Next/Bun application, bundled Vega Intelligence assets and actual canonical data. No provider credentials needed.",
  command: `cd dashboard && ORION_VERIFY_URL=${base} node scripts/verify_brand.mjs`,
  expected:
    "New brand in document metadata and share cards; supplied logo/favicon/OG assets available byte-for-byte; neutral theme and compact data manifest remain reachable.",
  status: "failed",
  checks: [],
};
try {
  assert.equal(
    (await fetch(base + "/reglages")).status,
    404,
    "Removed settings route",
  );
  const html = await (await fetch(base)).text();
  assert.match(html, /<title>[^<]*Vega Intelligence/);
  assert.doesNotMatch(html, /<title>[^<]*Orion/);
  assert.match(html, /og:image/);
  assert.match(html, /site.webmanifest/);
  for (const file of [
    "favicon.svg",
    "branding/vega/favicon.svg",
    "branding/vega/icon-dark.svg",
    "branding/vega/banner-dark.svg",
    "branding/vega/logo-dark.svg",
    "branding/vega/symbol-dark.svg",
  ]) {
    const response = await fetch(base + "/" + file);
    assert.equal(response.status, 200, file);
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = await fs.readFile("frontend/public/" + file);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(expected).digest("hex"),
    );
    report.checks.push(file);
  }
  const manifest = await (await fetch(base + "/site.webmanifest")).json();
  assert.equal(manifest.name, "Vega Intelligence");
  assert.equal(manifest.theme_color, "#000000");
  const data = await (
    await fetch(base + "/data/dashboard-manifest.json")
  ).json();
  assert.equal(data.storage, "json-packed");
  assert.equal(data.seasons.length, 3);
  report.status = "passed";
  report.actual = {
    brand: manifest.name,
    theme: manifest.theme_color,
    dataSeasons: data.seasons.map((x) => x.id),
  };
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    "outputs/statarena-brand/http-evidence.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report, null, 2));

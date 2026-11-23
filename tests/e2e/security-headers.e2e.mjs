// E2E — the site's security headers and its report-only content security policy, in a real
// browser. Written with the headers (tests/security-headers.test.mjs documents the policy).
//
// Failure modes and expected outcomes:
//  S1 (every route) The page, a static chunk, a public file, an app/api route and the 404
//     carry Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy,
//     X-Frame-Options, Permissions-Policy, Content-Security-Policy-Report-Only and
//     Reporting-Endpoints.
//  S2 (observe only) No response carries a blocking Content-Security-Policy.
//  S3 (nothing forgotten) Normal use — home, competition, club, player, match, and a search
//     typed in the header — raises no violation of the policy, on a desktop (1365×900) and
//     an iPhone 16 (393×852): the page's securitypolicyviolation events and the browser's
//     « [Report Only] » console lines are both collected.
//  S4 (reports land) The report endpoint takes a report (204) and refuses an oversized one
//     (413).
//  X1 No page error.
//
// Run against a local front (dashboard: bun run build && bun run start) or a deployment:
//   node tests/e2e/security-headers.e2e.mjs <base url> <evidence dir>
// It writes evidence.json (setup, inputs, expected, actual, violations, console) and a
// screenshot per page and viewport; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "security-headers-e2e")] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });

function playwright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {}
  const roots = [
    process.env.PLAYWRIGHT_CORE,
    ...(() => {
      const npx = path.join(os.homedir(), ".npm/_npx");
      return existsSync(npx)
        ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules/playwright-core"))
        : [];
    })(),
  ].filter((p) => p && existsSync(path.join(p, "package.json")));
  if (!roots.length) throw new Error("playwright not found: set PLAYWRIGHT_CORE");
  return require(roots[0]);
}

const HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "permissions-policy",
  "content-security-policy-report-only",
  "reporting-endpoints",
];
const results = [],
  consoleLog = [],
  violations = {};
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", typeof actual === "string" ? actual : JSON.stringify(actual));
};
const { chromium } = playwright();
const browser = await chromium.launch();
const desktop = { width: 1365, height: 900 },
  phone = { width: 393, height: 852 };

async function open(viewport) {
  const context = await browser.newContext({
    locale: "fr-FR",
    viewport,
    ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  // Every violation the page sees, from the first script on.
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        source: e.sourceFile,
        line: e.lineNumber,
        sample: e.sample,
        disposition: e.disposition,
      }),
    );
  });
  const page = await context.newPage();
  const errors = [],
    reportOnly = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|\[Report Only\]/i.test(text)) reportOnly.push(text);
    if (m.type() === "error") consoleLog.push({ url: page.url(), text });
  });
  return { context, page, errors, reportOnly };
}
const settle = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  // Reach the lazy parts of the page, then come back.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
};

try {
  // Pages: the home, and the first club, competition and match it links to; a player from them.
  const { context: c0, page: p0 } = await open(desktop);
  const first = await p0.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await settle(p0);
  const hrefs = async (page) =>
    page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const links = await hrefs(p0);
  const find = (list, re) => list.find((h) => re.test(h || ""));
  const club = find(links, /^\/clubs\/?\?.*\bid=t_/),
    match = find(links, /^\/matchs\/?\?.*\bid=m_/);
  const league = match && new URLSearchParams(match.split("?")[1]).get("competition");
  const competition =
    find(links, /^\/competitions\/?\?.*\bid=l_/) || (league && `/competitions?id=${league}`);
  let player = find(links, /^\/joueurs\/?\?.*\bid=p_/);
  for (const url of [match, club].filter(Boolean)) {
    if (player) break;
    await p0.goto(base + url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await settle(p0);
    player = find(await hrefs(p0), /^\/joueurs\/?\?.*\bid=p_/);
  }
  const pages = [
    ["home", "/"],
    ["competition", competition],
    ["club", club],
    ["player", player],
    ["match", match],
    ["search", "/"],
  ].filter(([, url]) => url);
  check("P0", "home links to a competition, a club, a player and a match", pages.map(([n, u]) => `${n} ${u}`).join(" | "), pages.length === 6);

  // S1/S2 on each kind of route.
  await p0.goto(base + "/", { waitUntil: "domcontentloaded" });
  const chunk = await p0.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("/_next/static/")));
  await c0.close();
  const routes = [
    ["page", "/"],
    ["static chunk", chunk && new URL(chunk).pathname],
    ["public file", "/branding/vega/favicon.svg"],
    ["app/api route", "/api/vega-image?kind=og"],
    ["not found", "/page-qui-n-existe-pas"],
  ].filter(([, url]) => url);
  const headerSets = {};
  for (const [name, url] of routes) {
    const response = await fetch(base + url, { redirect: "manual" });
    await response.arrayBuffer();
    const missing = HEADERS.filter((key) => !response.headers.get(key));
    headerSets[name] = Object.fromEntries(HEADERS.map((key) => [key, response.headers.get(key)]));
    check(`S1 ${name}`, "all seven headers", missing.length ? `missing: ${missing.join(", ")} (${response.status})` : `all present (${response.status})`, !missing.length);
    check(`S2 ${name}`, "no blocking Content-Security-Policy", String(response.headers.get("content-security-policy")), !response.headers.get("content-security-policy"));
  }
  check("S1 page document", "status 200", String(first?.status()), first?.status() === 200);

  // S3: normal use, desktop and phone.
  for (const viewport of [desktop, phone]) {
    const tag = viewport.width < 600 ? "phone" : "desktop";
    for (const [name, url] of pages) {
      const { context, page, errors, reportOnly } = await open(viewport);
      await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await settle(page);
      if (name === "search") {
        let box = page.getByRole("combobox", { name: /Rechercher/ });
        if (!(await box.isVisible().catch(() => false))) {
          await page.getByRole("button", { name: /Rechercher/ }).first().click().catch(() => {});
          box = page.getByRole("combobox", { name: /Rechercher/ });
        }
        await box.fill("a", { timeout: 10000 }).catch((e) => errors.push("search: " + e.message));
        await page.waitForTimeout(1500);
        await settle(page);
      }
      await page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
      const seen = await page.evaluate(() => window.__csp);
      violations[`${name} ${tag}`] = { events: seen, console: reportOnly };
      check(`S3 ${name} ${tag}`, "0 violations", `${seen.length} violation(s)${seen.length ? ": " + [...new Set(seen.map((v) => `${v.directive} ${v.blocked}`))].join(" | ") : ""}`, seen.length === 0 && reportOnly.length === 0);
      check(`X1 ${name} ${tag}`, "no page error", errors.join(" | ") || "none", !errors.length);
      await context.close();
    }
  }

  // S4: the report endpoint.
  const report = JSON.stringify({ "csp-report": { "document-uri": base + "/", "effective-directive": "img-src", "blocked-uri": "https://e2e.invalid/x.png", disposition: "report" } });
  const accepted = await fetch(base + "/api/csp-report", { method: "POST", headers: { "Content-Type": "application/csp-report" }, body: report });
  check("S4 report", "204", String(accepted.status), accepted.status === 204);
  const oversized = await fetch(base + "/api/csp-report", { method: "POST", headers: { "Content-Type": "application/csp-report" }, body: "x".repeat(70000) });
  check("S4 oversized", "413", String(oversized.status), oversized.status === 413);

  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        setup: { base, browser: browser.version(), viewports: { desktop, phone } },
        rerun: `node tests/e2e/security-headers.e2e.mjs ${base} ${out}`,
        pages,
        headers: headerSets,
        results,
        violations,
        console: consoleLog,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; evidence in ${out}`);
process.exit(failed.length ? 1 : 0);

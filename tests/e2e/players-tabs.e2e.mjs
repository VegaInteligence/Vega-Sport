// E2E — /joueurs: Explorer and Indices replaced by « Remplaçant » and « En forme » (VI-39).
// Written before the implementation, from the mock-up validated on 20 Nov 2026
// (https://claude.ai/artifact/9QLiW66xkhhxN5FxLyCtLG, « Remplaçant + En forme »).
//
// Failure modes and expected outcomes:
//  T1 Tabs: Performances · Remplaçant · En forme · Mes listes (or Mes listes first when the
//     visitor has saved players, as today). No « Explorer », no « Indices ».
//  T2 Old links: ?playersView=explore and ?playersView=indices open Performances, never a blank
//     panel or an error.
//  R1 Remplaçant opens in a working state: a reference player is set (the URL's `replace` id, else
//     the directory's first player) and its closest players are listed, each with a resemblance
//     in %, never NaN, never above 100.
//  R2 Age filter « ≤ 25 ans »: every candidate shown has an age ≤ 25 (no candidate without an age).
//  R3 Value filter « ≤ 50 M€ »: every candidate shown has a value ≤ 50 M€ (no candidate without a
//     value); « Toutes » brings the others back.
//  R4 Sort « Note »: the candidates' notes are in descending order.
//  R5 Selecting a candidate fills the comparison: « <ref> → <candidate> », age / value / note
//     deltas, and « Voir la fiche » links to /joueurs?id=<candidate id>.
//  R6 Changing the reference (search a name, pick it) updates the URL's `replace` and the list.
//  F1 En forme « En hausse »: rows sorted by gap, every gap > 0, each with a 10-match curve.
//  F2 « En baisse »: every gap < 0, steepest first.
//  F3 « Temps de jeu en hausse »: gaps in minutes > 0.
//  F4 The list follows the page's competitions: the request carries the page's leagues.
//  P1 Phone (iPhone 16, 393×852): the filter chips of both tabs stay on one scrolling row
//     (same top for every chip), nothing makes the page scroll sideways.
//  P2 Phone: tapping a candidate opens the comparison right under him (not after the 40 rows).
//  X1 No provider name in the visible text of either tab.
//  X2 No page error in the console during the whole run.
//
// Run (local front against the API named by NEXT_PUBLIC_API_ORIGIN, or the public site):
//   node tests/e2e/players-tabs.e2e.mjs <base url> <evidence dir>
// e.g. node tests/e2e/players-tabs.e2e.mjs http://127.0.0.1:3000 /tmp/vi-39-e2e
// It writes evidence.json (setup, inputs, expected, actual, console), and one screenshot per
// step, desktop and phone, into the evidence dir; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "vi-39-e2e")] = process.argv.slice(2);
await mkdir(out, { recursive: true });

function playwright() {
  const roots = [process.env.PLAYWRIGHT_CORE, ...(() => {
    const npx = path.join(os.homedir(), ".npm/_npx");
    return existsSync(npx) ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules/playwright-core")) : [];
  })()].filter((p) => p && existsSync(path.join(p, "package.json")));
  if (!roots.length) throw new Error("playwright-core not found: set PLAYWRIGHT_CORE");
  return createRequire(import.meta.url)(roots[0]);
}
function shell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dir = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().at(-1) : null;
  if (!dir) return undefined;
  const sub = readdirSync(path.join(cache, dir)).find((d) => d.startsWith("chrome-"));
  return path.join(cache, dir, sub, "chrome-headless-shell");
}

const PROVIDERS = /pitchapi|transfermarkt|sofascore|openligadb|openfootball|sportscore|wikidata|fotmob|opta/i;
const results = [], consoleLog = [];
const check = (id, expected, actual, ok) => { results.push({ id, expected, actual, ok: Boolean(ok) }); console.log(ok ? "PASS" : "FAIL", id, "—", actual); };
const num = (text) => Number(String(text).replace(/\s| /g, "").replace("−", "-").replace(",", ".").match(/-?\d+(\.\d+)?/)?.[0]);

const { chromium } = playwright();
const browser = await chromium.launch({ executablePath: shell() });

async function open(viewport, query) {
  const page = await browser.newPage({ locale: "fr-FR", viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  page.on("console", (m) => m.type() === "error" && consoleLog.push(`[${viewport.width}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${viewport.width}] pageerror ${e.message}`));
  await page.goto(`${base}/joueurs?${new URLSearchParams(query)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("tablist", { name: "Vues des joueurs" }).waitFor({ timeout: 60000 });
  return page;
}
const tabs = (page) => page.getByRole("tablist", { name: "Vues des joueurs" }).getByRole("tab").allInnerTexts();
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const candidates = (page) => page.locator("[data-replacement-candidate]");
async function readCandidates(page) {
  await candidates(page).first().waitFor({ timeout: 60000 });
  return candidates(page).evaluateAll((rows) => rows.map((r) => ({
    id: r.dataset.replacementCandidate, name: r.dataset.name,
    age: r.dataset.age === "" ? null : Number(r.dataset.age),
    value: r.dataset.value === "" ? null : Number(r.dataset.value),
    note: r.dataset.note === "" ? null : Number(r.dataset.note),
    similarity: Number(r.dataset.similarity), text: r.innerText,
  })));
}
async function chip(page, group, label) {
  await page.getByRole("group", { name: group }).getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(300);
  await page.waitForLoadState("networkidle").catch(() => {});
}

const desktop = { width: 1365, height: 900 }, phone = { width: 393, height: 852 };
try {
  // T1, T2
  let page = await open(desktop, {});
  const names = await tabs(page);
  check("T1", "Performances, Remplaçant, En forme, Mes listes; no Explorer/Indices", names.join(" · "),
    ["Performances", "Remplaçant", "En forme", "Mes listes"].every((t) => names.includes(t)) && !names.some((t) => /Explorer|Indices/.test(t)));
  await page.close();
  for (const legacy of ["explore", "indices"]) {
    page = await open(desktop, { playersView: legacy });
    const selected = await page.getByRole("tab", { selected: true }).innerText();
    check(`T2-${legacy}`, "Performances selected", selected, selected.trim() === "Performances");
    await page.close();
  }

  // R1–R6
  page = await open(desktop, { playersView: "replace" });
  let rows = await readCandidates(page);
  await shot(page, "replace-desktop");
  check("R1", "≥ 1 candidate, resemblance 0–100", `${rows.length} candidates, ${rows.map((r) => r.similarity).join("/")}`,
    rows.length > 0 && rows.every((r) => Number.isFinite(r.similarity) && r.similarity >= 0 && r.similarity <= 100));
  await chip(page, "Âge", "≤ 25 ans");
  rows = await readCandidates(page).catch(() => []);
  check("R2", "every age ≤ 25", rows.map((r) => r.age).join(","), rows.every((r) => r.age != null && r.age <= 25));
  await chip(page, "Âge", "Tous");
  await chip(page, "Valeur", "≤ 50 M€");
  rows = await readCandidates(page).catch(() => []);
  check("R3", "every value ≤ 50 M€", rows.map((r) => r.value).join(","), rows.every((r) => r.value != null && r.value <= 50e6));
  await chip(page, "Valeur", "Toutes");
  await chip(page, "Trier", "Note");
  rows = await readCandidates(page);
  const notes = rows.map((r) => r.note).filter((n) => n != null);
  check("R4", "notes descending", notes.join(","), notes.every((n, i) => !i || notes[i - 1] >= n));
  await candidates(page).nth(Math.min(1, rows.length - 1)).click();
  const picked = rows[Math.min(1, rows.length - 1)];
  const panel = page.locator("[data-replacement-comparison]");
  const panelText = await panel.innerText();
  const href = await panel.getByRole("link", { name: "Voir la fiche" }).getAttribute("href");
  check("R5", `comparison names ${picked.name}, link to its page`, `${panelText.split("\n")[0]} · ${href}`,
    panelText.includes(picked.name) && href?.includes(`id=${picked.id}`));
  await shot(page, "replace-selected-desktop");
  const before = new URL(page.url()).searchParams.get("replace");
  await page.getByRole("combobox", { name: "Joueur à remplacer" }).fill(picked.name.split(" ").at(-1));
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.waitForTimeout(500);
  rows = await readCandidates(page);
  const after = new URL(page.url()).searchParams.get("replace");
  check("R6", "URL reference changes and list reloads", `${before} → ${after}, ${rows.length} rows`, after && after !== before && rows.length > 0);
  const replaceText = await page.locator("#player-workspace-panel").innerText();
  check("X1-replace", "no provider name", PROVIDERS.exec(replaceText)?.[0] || "none", !PROVIDERS.test(replaceText));
  await page.close();

  // F1–F4
  page = await open(desktop, { playersView: "form" });
  const formRequests = [];
  page.on("request", (r) => r.url().includes("/api/player-form") && formRequests.push(r.url()));
  const formRows = page.locator("[data-form-row]");
  const readForm = async () => {
    await formRows.first().waitFor({ timeout: 60000 });
    return formRows.evaluateAll((rows) => rows.map((r) => ({ gap: Number(r.dataset.gap), curve: r.querySelectorAll("svg path, svg polyline").length > 0 })));
  };
  let form = await readForm();
  await shot(page, "form-up-desktop");
  check("F1", "gaps > 0, descending, each with a curve", form.map((r) => r.gap).join(","),
    form.length > 0 && form.every((r, i) => r.gap > 0 && r.curve && (!i || form[i - 1].gap >= r.gap)));
  await chip(page, "Tendance", "En baisse");
  form = await readForm();
  check("F2", "gaps < 0, steepest first", form.map((r) => r.gap).join(","),
    form.length > 0 && form.every((r, i) => r.gap < 0 && (!i || form[i - 1].gap <= r.gap)));
  await chip(page, "Tendance", "Temps de jeu en hausse");
  form = await readForm();
  check("F3", "minute gaps > 0", form.map((r) => r.gap).join(","), form.length > 0 && form.every((r) => r.gap > 0));
  await shot(page, "form-minutes-desktop");
  await page.reload({ waitUntil: "domcontentloaded" });
  await formRows.first().waitFor({ timeout: 60000 });
  const pageLeagues = new URL(page.url()).searchParams.get("leagues");
  check("F4", "request carries the page's competitions", formRequests.at(-1) || "no request",
    formRequests.length > 0 && (!pageLeagues || new URL(formRequests.at(-1)).searchParams.get("leagues") === pageLeagues));
  const formText = await page.locator("#player-workspace-panel").innerText();
  check("X1-form", "no provider name", PROVIDERS.exec(formText)?.[0] || "none", !PROVIDERS.test(formText));
  await page.close();

  // P1
  for (const [view, group] of [["replace", "Âge"], ["form", "Tendance"]]) {
    page = await open(phone, { playersView: view });
    await page.getByRole("group", { name: group }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const layout = await page.evaluate(() => {
      const tops = [...document.querySelectorAll("[data-chip-row] button")].map((b) => Math.round(b.getBoundingClientRect().top));
      return { tops: [...new Set(tops)], pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    await shot(page, `${view}-phone`);
    check(`P1-${view}`, "one row of chips, no sideways page scroll", JSON.stringify(layout), layout.tops.length === 1 && layout.pageOverflow <= 0);
    if (view === "replace") {
      const row = candidates(page).nth(5);
      await row.click();
      const inline = page.locator("[data-replacement-comparison-inline]");
      await inline.waitFor({ timeout: 10000 });
      const [rowBox, panelBox] = [await row.boundingBox(), await inline.boundingBox()];
      await shot(page, "replace-selected-phone");
      const gap = Math.round(panelBox.y - (rowBox.y + rowBox.height));
      check("P2", "comparison within 20 px under the tapped player", `gap ${gap} px, ${await inline.getAttribute("data-replacement-comparison-inline")}`,
        gap >= 0 && gap <= 20 && (await inline.getAttribute("data-replacement-comparison-inline")) === (await row.getAttribute("data-replacement-candidate")));
    }
    await page.close();
  }
} catch (error) {
  check("RUN", "run completes", String(error?.stack || error).slice(0, 500), false);
} finally {
  await browser.close();
  check("X2", "no page error in the console", consoleLog.length ? consoleLog.slice(0, 5).join(" | ") : "none", !consoleLog.length);
  const failed = results.filter((r) => !r.ok);
  await writeFile(path.join(out, "evidence.json"), JSON.stringify({
    issue: "VI-39", observed: new Date().toISOString(), base,
    rerun: `node tests/e2e/players-tabs.e2e.mjs ${base} ${out}`,
    setup: "Chromium headless shell, fr-FR; desktop 1365×900, phone 393×852 (touch). Default page filters unless stated.",
    results, console: consoleLog, passed: results.length - failed.length, failed: failed.length,
  }, null, 2));
  console.log(`${results.length - failed.length}/${results.length} passed · evidence in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

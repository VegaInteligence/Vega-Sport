// E2E — the competitions chosen on the home follow the person (FAILURE_MODES § 78, hugo 26 Nov 2026): on /competitions,
// and across a sign-out and a sign-in, on the same browser and on another.
//
//  F1  Signed in, three competitions chosen in the home's bar (Championship, Premier League, Saudi Pro League):
//      the segment says « 3 compétitions ».
//  F2  The account's document holds those three (`leagues`).
//  F3  /competitions: the bar's panel opens on « Mes compétitions » with exactly those three (§ 82), and the page opens on one of them.
//  F4  « Se déconnecter »: this browser is back to nothing chosen (home « Top 7 Europe + UEFA », /competitions
//      « Compétitions à la une » with its ten).
//  F5  Signed in again on the same browser: the three are back, on the home and on /competitions.
//  F6  Signed in on another browser: the same three on the home.
//  F7  Four more sign-ins and sign-outs on that browser: each sign-out leaves nothing chosen (the sync attached again
//      during « Se déconnecter » wrote the account back into the emptied stores about one time in three).
//  X1  No page error.
//
//   node tests/e2e/accounts/competitions-follow.e2e.mjs <evidence dir>
// Against the build of accounts.e2e.mjs's « on » phase on 127.0.0.1:3100 (NEON_AUTH_BASE_URL=http://127.0.0.1:4100/
// neondb/auth, NEON_AUTH_COOKIE_SECRET=<32+>, ACCOUNT_API_ORIGIN=http://127.0.0.1:4200, NEXT_PUBLIC_API_ORIGIN=
// http://127.0.0.1:8765), the replay on :8765 and the local PostgreSQL 16; this script starts the two stand-ins.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startAuthStandIn } from "./auth-stand-in.mjs";
import { startAccountApiStandIn } from "./account-api-stand-in.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const [OUT = "/tmp/competitions-follow-e2e"] = process.argv.slice(2);
const SITE = process.env.SITE || "http://127.0.0.1:3100";
const PASSWORD = "motdepasse-e2e-1";
const EMAIL = `follow-${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}@example.test`;
const CHOSEN = [
  ["Championship", "Angleterre"],
  ["Premier League", "Angleterre"],
  ["Saudi Pro League", "Arabie saoudite"],
];
mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${JSON.stringify(expected)} — ${JSON.stringify(actual)}`);
};
const until = async (fn, { timeout = 20000, every = 250 } = {}) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return last;
};

const browser = await chromium.launch();
async function device(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR", colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`.slice(0, 300)));
  return { context, page };
}
const open = (page, url) => page.goto(`${SITE}${url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
const shot = (page, file) => page.screenshot({ path: path.join(OUT, file) });
const segment = (page) => page.locator('.home-settings-segment[data-key="competitions"]');
const homeLabel = async (page) => ((await segment(page).textContent({ timeout: 30000 })) || "").trim();
const storedLeagues = (page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("orion.preferences.v1") || "{}").favoriteLeagueIds || [];
    } catch {
      return null;
    }
  });
async function signIn(page, { create = false } = {}) {
  await open(page, "/connexion?next=%2F");
  await page.getByRole("button", { name: create ? "Créer un compte" : "Se connecter", exact: true }).first().waitFor({ timeout: 30000 });
  if (create) await page.locator(".signin-switch button", { hasText: "Créer un compte" }).click();
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator(".account-submit").click();
  await until(async () => new URL(page.url()).pathname === "/", { timeout: 30000 });
  await until(async () => (await page.locator(".account-entry").first().getAttribute("aria-label")) !== "Se connecter", { timeout: 30000 });
}
async function competitionsRow(page) {
  // § 82: the row is the bar's panel, its first list « Mes compétitions » (or « À la une »); the page opens on one.
  await open(page, "/competitions");
  await page.locator(".edition-bar .settings-picker").nth(1).locator("button").waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator(".edition-bar .settings-picker").nth(1).locator("button").click();
  await page.locator('dialog[data-pane="competitions"] .home-settings-tile').first().waitFor({ timeout: 10000 });
  const row = await page.evaluate(() => ({
    title: document.querySelector('dialog[data-pane="competitions"] .home-settings-presets button')?.textContent.trim() || "",
    names: [...document.querySelectorAll('dialog[data-pane="competitions"] .home-settings-tile strong')].map((n) => n.textContent.trim()),
    opened: document.querySelector(".edition-head--page h1.edition-name")?.textContent.trim() || null,
  }));
  await page.keyboard.press("Escape");
  return row;
}
const sameNames = (row) =>
  row.names.length === CHOSEN.length && CHOSEN.every(([name]) => row.names.includes(name)) && CHOSEN.some(([name]) => name === row.opened);

let auth = null, api = null, failure = null;
try {
  auth = await startAuthStandIn({ port: 4100, siteOrigin: SITE });
  api = await startAccountApiStandIn({ port: 4200, authUrl: "https://auth.stand-in.test/neondb/auth", jwksUrl: auth.jwksUrl, deleteUser: (id) => auth.deleteUser(id) });
  const A = await device("A");

  // F1: signed in, three competitions chosen in the home's bar.
  await signIn(A.page, { create: true });
  await segment(A.page).click();
  await A.page.locator(".home-settings-presets button", { hasText: "Toutes" }).click();
  for (const [name, country] of CHOSEN)
    await A.page.locator(".home-settings-tile").filter({ has: A.page.locator("strong", { hasText: new RegExp(`^${name}$`) }) }).filter({ hasText: country }).first().click();
  await shot(A.page, "f1-chosen.png");
  await A.page.locator(".home-settings-action.is-filled").click();
  const label = await until(async () => ((await homeLabel(A.page)) === "3 compétitions" ? "3 compétitions" : null), { timeout: 10000 });
  const ids = (await storedLeagues(A.page)) || [];
  check("F1 three competitions chosen on the home", "3 compétitions", { label: label || (await homeLabel(A.page)), ids }, label && ids.length === 3);

  // F2: the account's document.
  const accountId = (await auth.pool.query('SELECT id FROM "user" WHERE email = $1', [EMAIL])).rows[0]?.id;
  const held = await until(async () => {
    const doc = await api.document(accountId);
    const leagues = doc?.document?.leagues || [];
    return leagues.length === 3 && ids.every((id) => leagues.includes(id)) ? leagues : null;
  });
  check("F2 the account holds them", [...ids].sort(), held ? [...held].sort() : (await api.document(accountId))?.document?.leagues, Boolean(held));

  // F3: /competitions follows.
  const row = await competitionsRow(A.page);
  await shot(A.page, "f3-competitions.png");
  check("F3 /competitions: « Mes compétitions », those three, opened on one of them", { title: "Mes compétitions", names: CHOSEN.map(([n]) => n) }, row,
    row.title === "Mes compétitions" && sameNames(row));

  // F4: sign-out.
  await open(A.page, "/compte");
  await A.page.locator('.account-syncblock[data-state="synced"]').waitFor({ state: "attached", timeout: 30000 });
  await A.page.getByRole("button", { name: "Se déconnecter" }).click();
  await until(async () => new URL(A.page.url()).pathname === "/", { timeout: 30000 });
  await until(async () => (await A.page.locator(".account-entry").first().getAttribute("aria-label")) === "Se connecter", { timeout: 30000 });
  const outLabel = await homeLabel(A.page);
  const outIds = await storedLeagues(A.page);
  const outRow = await competitionsRow(A.page);
  check("F4 signed out: nothing chosen on this browser", { label: "Top 7 Europe + UEFA", ids: [], row: 10, title: "Compétitions à la une" }, { outLabel, outIds, outRow },
    outLabel === "Top 7 Europe + UEFA" && Array.isArray(outIds) && outIds.length === 0 && outRow.names.length === 10 && outRow.title === "À la une");

  // F5: signed in again, same browser.
  await signIn(A.page);
  const backLabel = await until(async () => ((await homeLabel(A.page)) === "3 compétitions" ? "3 compétitions" : null), { timeout: 20000 });
  await shot(A.page, "f5-home-back.png");
  const backRow = await competitionsRow(A.page);
  await shot(A.page, "f5-competitions-back.png");
  check("F5 signed in again: the three are back on the home and on /competitions", { label: "3 compétitions", names: CHOSEN.map(([n]) => n) },
    { label: backLabel || (await homeLabel(A.page)), backRow }, backLabel && backRow.title === "Mes compétitions" && sameNames(backRow));

  // F6: another browser.
  const B = await device("B");
  await signIn(B.page);
  const otherLabel = await until(async () => ((await homeLabel(B.page)) === "3 compétitions" ? "3 compétitions" : null), { timeout: 20000 });
  check("F6 another browser: the same three", "3 compétitions", otherLabel || (await homeLabel(B.page)), Boolean(otherLabel));

  // F7: sign-out after sign-out, the stores stay empty.
  const rounds = [];
  for (let round = 0; round < 4; round += 1) {
    await open(B.page, "/compte");
    await B.page.locator('.account-syncblock[data-state="synced"]').waitFor({ state: "attached", timeout: 30000 });
    await B.page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => (await B.page.locator(".account-entry").first().getAttribute("aria-label")) === "Se connecter", { timeout: 30000 });
    await B.page.waitForTimeout(1500);
    rounds.push((await storedLeagues(B.page))?.length ?? null);
    if (round < 3) await signIn(B.page);
  }
  check("F7 four sign-outs, each leaves nothing chosen", [0, 0, 0, 0], rounds, rounds.every((n) => n === 0));
} catch (error) {
  failure = String(error?.stack || error);
  console.log(`FAILED ${failure.split("\n")[0]}`);
}
check("X1 no page error", [], errors, errors.length === 0);
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify({ site: SITE, results, errors, failure, result: failure ? "failed" : `${results.length - failed.length}/${results.length}` }, null, 2));
console.log(failure ? "FAILED" : `${results.length - failed.length}/${results.length} ok`);
await browser.close();
await api?.close().catch(() => {});
await auth?.close().catch(() => {});
process.exit(failure || failed.length ? 1 : 0);

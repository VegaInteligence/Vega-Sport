// E2E — accounts on the site (VI-38): sign-up, sign-out, sign-in, the preferences sync across two devices, the 409
// merge, sign-out's reset, export, deletion, the sync states, and the switch. Failure modes: docs/COMPTES_SITE.md.
//
// Run by tests/e2e/accounts/run.sh, which builds and starts the site once per phase:
//   on      Neon (the stand-in) and the account API set: everything below
//   nosync  Neon set, ACCOUNT_API_ORIGIN absent: sign-in works, « Synchronisation : Indisponible », nothing reset
//   off     nothing set: today's site (no entry, /connexion and /compte are 404, /api/auth and /api/account 404,
//           no request to them)
//   node tests/e2e/accounts/accounts.e2e.mjs <evidence dir> <on|nosync|off> [captures dir]
//
// What stands in for what (said in the evidence): Neon Auth is a real Better Auth server on 127.0.0.1:4100
// (auth-stand-in.mjs); the account API is the real front and store on the local PostgreSQL (account-api-stand-in.mjs);
// the football data are recorded production answers replayed on 127.0.0.1:8765. Google is not configured there.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startAuthStandIn } from "./auth-stand-in.mjs";
import { startAccountApiStandIn } from "./account-api-stand-in.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const [OUT, PHASE = "on", CAPTURES = ""] = process.argv.slice(2);
if (!OUT || !["on", "nosync", "off"].includes(PHASE)) {
  console.error("usage: accounts.e2e.mjs <evidence dir> <on|nosync|off> [captures dir]");
  process.exit(2);
}
const SITE = process.env.SITE || "http://127.0.0.1:3100";
const DATA = process.env.VEGA_API || "http://127.0.0.1:8765";
const IMAGES = "https://dngp6kh9jx2bl.cloudfront.net";
// Lower case: Better Auth stores addresses in lower case.
const RUN = new Date().toISOString().replace(/[:.]/g, "-").toLowerCase();
const DIR = path.join(OUT, PHASE);
mkdirSync(DIR, { recursive: true });
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

const CLUB_A = "t_1iaglr"; // AFC Bournemouth in the recorded data
const CLUB_B = "t_41iFW3";
const NATION = "t_2ysHaw";
const PASSWORD = "motdepasse-e2e-1";
// The captures' favourites: clubs and players of the recorded data, with their images.
// Readable addresses for the captures (the stand-in's base is new at every run).
const CAPTURE_OWNERS = {
  "bureau-sombre": "lea.martin@example.test",
  "bureau-clair": "marc.dubois@example.test",
  "telephone-sombre": "ines.roux@example.test",
  "telephone-clair": "tom.girard@example.test",
};
const CAPTURE_SEED = JSON.parse(readFileSync(new URL("capture-seed.json", import.meta.url), "utf8"));
const steps = [];
const consoleErrors = [];
const sameOriginCalls = [];
let failure = null;

function record(id, name, expected, actual, ok) {
  steps.push({ id, name, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "ok " : "NOT OK"} ${id} ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}
const until = async (fn, { timeout = 15000, every = 200 } = {}) => {
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
async function device(name, { phone = false, theme = "dark", scale = 1 } = {}) {
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } }),
    deviceScaleFactor: scale,
    locale: "fr-FR",
    acceptDownloads: true,
  });
  await context.addInitScript((value) => {
    try {
      if (!localStorage.getItem("statarena.theme")) localStorage.setItem("statarena.theme", value);
    } catch {}
  }, theme);
  // Images are addressed on the public API's origin: served from the replay.
  await context.route(`${IMAGES}/**`, async (route) => {
    try {
      const answer = await fetch(route.request().url().replace(IMAGES, DATA));
      await route.fulfill({ status: answer.status, headers: Object.fromEntries(answer.headers), body: Buffer.from(await answer.arrayBuffer()) });
    } catch {
      await route.abort();
    }
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === SITE && /^\/api\/(auth|account)(\/|$)/.test(url.pathname))
      sameOriginCalls.push({ device: name, method: request.method(), path: url.pathname });
  });
  context.on("page", watch(name));
  const page = await context.newPage();
  watch(name)(page);
  return { context, page, name };
}
const watched = new WeakSet();
const watch = (name) => (page) => {
  if (watched.has(page)) return;
  watched.add(page);
  page.on("pageerror", (error) => consoleErrors.push({ device: name, error: `pageerror ${error.message}`.slice(0, 300) }));
  page.on("console", (message) => {
    const text = message.text();
    // The replay lacks some reads, and Vercel's scripts do not exist locally: their failed loads are not errors here.
    if (message.type() === "error" && !/Failed to load resource|_vercel\/|MIME type/.test(text)) consoleErrors.push({ device: name, error: text.slice(0, 300) });
  });
};

const open = async (page, url) => {
  await page.goto(`${SITE}${url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
};
const entry = (page) => page.locator(".account-entry");
const entryLabel = async (page) => until(async () => (await entry(page).first().getAttribute("aria-label")) || null);
const listIds = (page) =>
  page.evaluate(() => {
    try {
      const data = JSON.parse(localStorage.getItem("statarena.research.v1") || "null");
      return (data?.lists || []).flatMap((list) => list.entries.map((e) => e.id)).sort();
    } catch {
      return null;
    }
  });
const storedTheme = (page) => page.evaluate(() => localStorage.getItem("statarena.theme"));
const markerOf = (page) => page.evaluate(() => localStorage.getItem("vega.account.merged.v1"));
const bookmark = (page, saved) => page.locator(`button[aria-pressed="${saved}"][aria-label^="${saved ? "Retirer" : "Enregistrer"} "]`).first();
async function toggleBookmark(page, url, wanted) {
  await open(page, url);
  const button = bookmark(page, !wanted);
  await button.waitFor({ timeout: 30000 });
  const label = await button.getAttribute("aria-label");
  await button.click();
  await bookmark(page, wanted).waitFor({ timeout: 10000 });
  return label;
}
async function signInForm(page, email, { create = false, password = PASSWORD, next = "" } = {}) {
  await open(page, `/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByRole("button", { name: create ? "Créer un compte" : "Se connecter", exact: true }).first().waitFor({ timeout: 30000 });
  if (create) await page.locator(".signin-switch button", { hasText: "Créer un compte" }).click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator(".account-submit").click();
}
const shot = async (page, file) => {
  await page.screenshot({ path: path.join(DIR, file) });
  return file;
};
async function capture(page, file) {
  if (!CAPTURES) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, file) });
}

let auth = null, api = null;
const evidence = { phase: PHASE };
try {
  if (PHASE !== "off") {
    auth = await startAuthStandIn({ port: 4100, siteOrigin: SITE });
    if (PHASE === "on")
      api = await startAccountApiStandIn({ port: 4200, authUrl: "https://auth.stand-in.test/neondb/auth", jwksUrl: auth.jwksUrl, deleteUser: (id) => auth.deleteUser(id) });
  }
  const userId = async (email) => (await auth.pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id ?? null;
  const doc = async (id) => (api ? api.document(id) : null);
  // The base only holds v1 documents (CHECK document @> '{"v": 1}'); a document of a later version, as a newer site
  // would write once that check moves, is simulated by lifting the check on this dedicated local base.
  const storeOtherVersion = async (id) => {
    await api.db.query("ALTER TABLE account.preferences DROP CONSTRAINT IF EXISTS preferences_document_check");
    await api.db.query("UPDATE account.preferences SET document = $2::jsonb WHERE account_id = $1", [id, JSON.stringify({ v: 2, lists: [] })]);
  };
  const docClubs = async (id) => {
    const held = await doc(id);
    return held ? held.document.lists.flatMap((l) => l.entries.map((e) => e.id)).sort() : null;
  };

  if (PHASE === "off") {
    const a = await device("off");
    await open(a.page, `/clubs?id=${CLUB_A}`);
    await a.page.locator(".topbar").waitFor({ timeout: 60000 });
    await a.page.waitForTimeout(4000);
    const entries = await entry(a.page).count();
    record("W1a", "no account entry in the header", 0, entries, entries === 0);
    await shot(a.page, "off-header.png");
    await capture(a.page, "interrupteur-coupe-en-tete-bureau-sombre.png");
    for (const url of ["/connexion", "/compte", "/connexion?next=/clubs"]) {
      const response = await a.page.goto(`${SITE}${url}`, { waitUntil: "domcontentloaded" });
      const text = await a.page.locator("h1").first().textContent({ timeout: 30000 }).catch(() => "");
      record("W1b", `${url} is the 404 page`, [404, "Page introuvable"], [response.status(), text], response.status() === 404 && /introuvable/.test(text));
    }
    for (const [method, url] of [["GET", "/api/auth/get-session"], ["POST", "/api/auth/sign-in/email"], ["POST", "/api/account/session"], ["GET", "/api/account/preferences"], ["DELETE", "/api/account"]]) {
      const answer = await fetch(`${SITE}${url}`, { method, headers: { origin: SITE, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      record("W1c", `${method} ${url} answers 404`, 404, answer.status, answer.status === 404);
    }
    sameOriginCalls.length = 0;
    await open(a.page, "/");
    await a.page.waitForTimeout(5000);
    await open(a.page, `/clubs?id=${CLUB_A}`);
    await a.page.waitForTimeout(5000);
    record("W1d", "no request to /api/auth or /api/account while browsing", [], sameOriginCalls, sameOriginCalls.length === 0);
    // The rest of the site still reads its data through the catch-all.
    const status = await fetch(`${SITE}/api/status`).then((r) => r.status).catch(() => 0);
    record("W1e", "the catch-all /api/[...path] still answers (proxied to the data API)", "not 404 from the account routes", status, status !== 0);
  }

  if (PHASE === "nosync") {
    const email = "lea.martin@example.test";
    const a = await device("A");
    await toggleBookmark(a.page, `/clubs?id=${CLUB_A}`, true);
    await signInForm(a.page, email, { create: true, next: "/compte" });
    await until(async () => a.page.url().includes("/compte"), { timeout: 30000 });
    const sync = await a.page.locator(".account-syncblock").textContent({ timeout: 30000 });
    record("W2a", "signed in, /compte says Indisponible", "Indisponible", sync, /Indisponible/.test(sync));
    record("W2b", "no export or deletion without the account API", 0, await a.page.locator(".account-data").count(), (await a.page.locator(".account-data").count()) === 0);
    await shot(a.page, "nosync-compte.png");
    if (CAPTURES)
      for (const [phone, theme, suffix] of [[false, "dark", "bureau-sombre"], [false, "light", "bureau-clair"], [true, "dark", "telephone-sombre"]]) {
        const c = await device(`capture-${suffix}`, { phone, theme, scale: 2 });
        await signInForm(c.page, email, { next: "/compte" });
        await c.page.locator(".account-syncblock").waitFor({ timeout: 30000 });
        await capture(c.page, `compte-synchro-indisponible-${suffix}.png`);
        await c.context.close();
      }
    const accountCalls = sameOriginCalls.filter((c) => c.path.startsWith("/api/account"));
    record("W2c", "no request to /api/account", [], accountCalls, accountCalls.length === 0);
    await a.page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => new URL(a.page.url()).pathname === "/", { timeout: 30000 });
    const kept = await listIds(a.page);
    record("W2d", "sign-out without sync keeps the browser's favourites", [CLUB_A], kept, kept?.includes(CLUB_A));
  }

  if (PHASE === "on") {
    const email = `e2e-${RUN}@example.test`;
    const A = await device("A");
    const B = await device("B");

    // W6: a visitor who never signed in on this browser asks /api/auth nothing, and still gets « Se connecter ».
    const visitor = await device("visitor");
    await open(visitor.page, "/");
    await visitor.page.waitForTimeout(3000);
    await open(visitor.page, `/clubs?id=${CLUB_A}`);
    await visitor.page.locator('.account-entry[aria-label="Se connecter"]').waitFor({ timeout: 30000 });
    await visitor.page.waitForTimeout(3000);
    const asked = sameOriginCalls.filter((call) => call.device === "visitor");
    record("W6", "accounts on, never signed in: no request to /api/auth or /api/account while browsing", [], asked, asked.length === 0);
    await visitor.context.close();

    // O6: the slot keeps its size while the session is read.
    const slow = await device("slow");
    // With the hint (W6), as a browser that signed in before: the session is asked for, slowly here.
    await slow.context.addInitScript(() => {
      try {
        localStorage.setItem("vega.account.hint.v1", "1");
      } catch {}
    });
    await slow.context.route(`${SITE}/api/auth/**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.continue();
    });
    await open(slow.page, `/clubs?id=${CLUB_A}`);
    const box = (selector) => slow.page.evaluate((s) => {
      const element = document.querySelector(s);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }, selector);
    const pending = await until(() => box(".account-entry-pending"), { timeout: 30000, every: 100 });
    await slow.page.locator('.account-entry[aria-label="Se connecter"]').waitFor({ timeout: 30000 });
    const resolved = await box(".account-entry");
    record("O6", "the header entry has the same box before and after the session arrives", pending, resolved, pending && resolved && ["x", "y", "width", "height"].every((k) => Math.abs(pending[k] - resolved[k]) < 0.5));
    await slow.context.close();

    // Signed out, a favourite added before signing in.
    const labelA = await toggleBookmark(A.page, `/clubs?id=${CLUB_A}`, true);
    record("S1", "signed out: the header says « Se connecter »", "Se connecter", await entryLabel(A.page), (await entryLabel(A.page)) === "Se connecter");
    record("S2", `a favourite added before signing in (${labelA})`, [CLUB_A], await listIds(A.page), (await listIds(A.page))?.includes(CLUB_A));
    await shot(A.page, "01-signed-out-favourite.png");

    // Sign-up from the header, back to the page.
    const entryWidth = (await A.page.locator(".account-entry").boundingBox())?.width;
    await A.page.locator(".account-entry").click();
    await until(async () => new URL(A.page.url()).pathname === "/connexion");
    const nextParam = new URL(A.page.url()).searchParams.get("next");
    record("O4", "the header link carries the page as ?next=", `/clubs?id=${CLUB_A}…`, nextParam, nextParam?.startsWith(`/clubs?id=${CLUB_A}`));
    // The screen of its own (docs/COMPTES_SITE.md, section 7).
    const outWidth = entryWidth;
    const links = await A.page.evaluate(() => ({
      wordmark: document.querySelector(".signin-wordmark")?.getAttribute("href"),
      close: document.querySelector(".signin-close")?.getAttribute("href"),
      header: document.querySelectorAll(".topbar").length,
      art: document.querySelector(".signin-brand .account-art")?.getAttribute("aria-hidden"),
      images: [...document.querySelectorAll(".account-art image, .account-art img")].length,
    }));
    record("S9", "no site header; the wordmark goes home and « Fermer » back to ?next=", { wordmark: "/", close: nextParam, header: 0 }, links, links.wordmark === "/" && links.close === nextParam && links.header === 0);
    record("S8", "the drawing is inline and hidden from screen readers", { art: "true", images: 0 }, { art: links.art, images: links.images }, links.art === "true" && links.images === 0);
    await A.page.locator('input[name="email"]').fill(email);
    await A.page.locator('input[name="password"]').fill("brouillon");
    await A.page.locator(".signin-eye").click();
    const eye = await A.page.evaluate(() => ({ type: document.querySelector('input[name="password"]').type, value: document.querySelector('input[name="password"]').value, pressed: document.querySelector(".signin-eye").getAttribute("aria-pressed") }));
    record("S7", "the eye shows the password without changing it", { type: "text", value: "brouillon", pressed: "true" }, eye, eye.type === "text" && eye.value === "brouillon" && eye.pressed === "true");
    await A.page.locator(".signin-switch button", { hasText: "Créer un compte" }).click();
    const switched = await A.page.evaluate(() => ({
      title: document.querySelector(".signin-title").textContent,
      email: document.querySelector('input[name="email"]').value,
      password: document.querySelector('input[name="password"]').value,
      type: document.querySelector('input[name="password"]').type,
      autocomplete: document.querySelector('input[name="password"]').autocomplete,
    }));
    record("S6", "changing to « Créer un compte » keeps the address and clears the password", { title: "Créer un compte", email, password: "", type: "password", autocomplete: "new-password" }, switched, switched.title === "Créer un compte" && switched.email === email && switched.password === "" && switched.type === "password" && switched.autocomplete === "new-password");
    await A.page.locator('input[name="password"]').fill(PASSWORD);
    await shot(A.page, "02-sign-up-form.png");
    await A.page.locator(".account-submit").click();
    await until(async () => new URL(A.page.url()).pathname === "/clubs", { timeout: 30000 });
    record("S3", "sign-up brings the person back, signed in", "Mon compte", await entryLabel(A.page), (await until(async () => (await entryLabel(A.page)) === "Mon compte")) === true);
    const inWidth = (await A.page.locator(".account-entry").boundingBox())?.width;
    record("S10", "the header entry is 124 px wide signed out and signed in", [124, 124], [outWidth, inWidth], outWidth === 124 && inWidth === 124);
    const id = await userId(email);
    const afterSignUp = await until(async () => {
      const clubs = await docClubs(id);
      return clubs?.includes(CLUB_A) ? clubs : null;
    });
    record("A1", "the favourite added before sign-up is in the account", [CLUB_A], afterSignUp, afterSignUp?.includes(CLUB_A));

    await open(A.page, "/compte");
    const facts = await A.page.locator(".account-hero").textContent({ timeout: 30000 });
    const synced = await until(async () => /À jour/.test(await A.page.locator(".account-syncblock").textContent()));
    const kept = await until(async () => {
      const text = await A.page.locator(".account").textContent();
      return /Clubs\s*1/.test(text) && (await A.page.locator(`.account-favourites a[href*="${CLUB_A}"]`).count()) === 1 ? text : null;
    });
    record("S5", "/compte: the address, « Gratuit », « À jour », the club kept as a favourite", [email, "Gratuit", "À jour", "Clubs 1"], facts, facts.includes(email) && facts.includes("Gratuit") && synced && Boolean(kept));
    await shot(A.page, "03-compte-a-jour.png");

    // Sign-out: last save, stores emptied, marker removed.
    await A.page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => new URL(A.page.url()).pathname === "/", { timeout: 30000 });
    const afterOut = await listIds(A.page);
    record("O3", "after sign-out the browser holds no favourite of the account", [], afterOut, Array.isArray(afterOut) && !afterOut.includes(CLUB_A));
    record("O1", "after sign-out the merge marker of that account is gone", null, await markerOf(A.page), !(await markerOf(A.page))?.includes(id));
    record("O3b", "the account still holds its favourite", [CLUB_A], await docClubs(id), (await docClubs(id))?.includes(CLUB_A));
    record("S6", "the header says « Se connecter » again", "Se connecter", await entryLabel(A.page), (await until(async () => (await entryLabel(A.page)) === "Se connecter")) === true);

    // A wrong password, then the right one: the favourite comes back from the account.
    await signInForm(A.page, email, { password: "mauvais-mot-de-passe", next: "/compte" });
    const wrong = await A.page.locator(".signin-error").textContent({ timeout: 30000 });
    record("O5", "a wrong password reads in plain French", "Adresse ou mot de passe incorrect.", wrong, wrong === "Adresse ou mot de passe incorrect.");
    await shot(A.page, "04-wrong-password.png");
    await A.page.locator('input[name="password"]').fill(PASSWORD);
    await A.page.locator(".account-submit").click();
    await until(async () => new URL(A.page.url()).pathname === "/compte", { timeout: 30000 });
    const back = await until(async () => {
      const ids = await listIds(A.page);
      return ids?.includes(CLUB_A) ? ids : null;
    });
    record("S8", "signing in again brings the account's favourite back", [CLUB_A], back, back?.includes(CLUB_A));

    // Device B: its own favourite before signing in, merged at its first sign-in.
    const labelB = await toggleBookmark(B.page, `/clubs?id=${CLUB_B}`, true);
    await signInForm(B.page, email, { next: `/clubs?id=${CLUB_B}` });
    const merged = await until(async () => {
      const ids = await listIds(B.page);
      return ids?.includes(CLUB_A) && ids.includes(CLUB_B) ? ids : null;
    }, { timeout: 30000 });
    record("A2", `device B's first sign-in merges (${labelB}) with the account's`, [CLUB_A, CLUB_B], merged, Boolean(merged));
    const inAccount = await until(async () => {
      const clubs = await docClubs(id);
      return clubs?.includes(CLUB_B) ? clubs : null;
    });
    record("A2b", "the account holds both", [CLUB_A, CLUB_B], inAccount, Boolean(inAccount));
    await open(A.page, "/compte");
    const onA = await until(async () => {
      const ids = await listIds(A.page);
      return ids?.includes(CLUB_B) ? ids : null;
    }, { timeout: 30000 });
    record("S9", "B's change appears on device A (reload)", [CLUB_A, CLUB_B], onA, Boolean(onA));

    // Concurrent edits (409): both loaded at one revision; A removes a club, then B adds a nation.
    await open(A.page, `/clubs?id=${CLUB_A}`);
    await open(B.page, `/nations?id=${NATION}`);
    await A.page.waitForTimeout(3000);
    const base = (await doc(id)).revision;
    const removeButton = bookmark(A.page, true);
    await removeButton.waitFor({ timeout: 30000 });
    await removeButton.click();
    await until(async () => (await doc(id)).revision > base, { timeout: 15000 });
    const addNation = bookmark(B.page, false);
    await addNation.waitFor({ timeout: 30000 });
    const nationLabel = await addNation.getAttribute("aria-label");
    const logStart = api.log.length;
    await addNation.click();
    const final = await until(async () => {
      const clubs = await docClubs(id);
      return clubs?.includes(NATION) ? clubs : null;
    }, { timeout: 20000 });
    const conflicts = api.log.slice(logStart).map((line) => JSON.parse(line)).filter((line) => line.status === 409);
    record("A6", "B's save met a 409 (the account changed under it)", ">= 1", conflicts.length, conflicts.length >= 1);
    record("A6b", `both edits survive: ${CLUB_A} removed on A, ${nationLabel} added on B`, [CLUB_B, NATION], final, final && !final.includes(CLUB_A) && final.includes(CLUB_B) && final.includes(NATION));
    const onB = await until(async () => {
      const ids = await listIds(B.page);
      return ids && !ids.includes(CLUB_A) && ids.includes(NATION) ? ids : null;
    });
    record("A6c", "B's stores hold the merged contract", [CLUB_B, NATION], onB, Boolean(onB));
    await open(A.page, "/compte");
    const onA2 = await until(async () => {
      const ids = await listIds(A.page);
      return ids && !ids.includes(CLUB_A) && ids.includes(NATION) ? ids : null;
    }, { timeout: 30000 });
    record("A6d", "A reloaded holds the merged contract", [CLUB_B, NATION], onA2, Boolean(onA2));

    // Sync states on /compte.
    const state = async (page) => (await page.locator(".account-syncblock").textContent({ timeout: 30000 })).trim();
    await until(async () => /À jour/.test(await state(A.page)));
    api.control.delay = 6000;
    await open(A.page, "/compte");
    const during = await until(async () => /En cours/.test(await state(A.page)) && (await state(A.page)));
    record("A10a", "« En cours » while the account answers", "En cours", during, /En cours/.test(during || ""));
    await shot(A.page, "05-compte-en-cours.png");
    api.control.delay = 0;
    api.control.down = true;
    await open(A.page, "/compte");
    const failing = await until(async () => /En échec/.test(await state(A.page)) && (await state(A.page)), { timeout: 20000 });
    record("A10b", "« En échec » when the account API is down", "En échec…", failing, /En échec/.test(failing || ""));
    await shot(A.page, "06-compte-en-echec.png");

    // O2: the last save fails at sign-out: told, cancel keeps the session.
    await A.page.locator(".theme-toggle").click();
    await A.page.getByRole("button", { name: "Se déconnecter" }).click();
    const unsaved = await A.page.locator(".account-unsaved").textContent({ timeout: 20000 }).catch(() => "");
    record("O2", "a failed last save is told before signing out", "Vos derniers changements…", unsaved, /n’ont pas pu être enregistrés/.test(unsaved));
    await shot(A.page, "07-sign-out-unsaved.png");
    await A.page.getByRole("button", { name: "Annuler" }).click();
    record("O2b", "« Annuler » keeps the person signed in", "Mon compte", await entryLabel(A.page), (await entryLabel(A.page)) === "Mon compte");
    api.control.down = false;
    await A.page.locator(".theme-toggle").click(); // back to the theme of the run

    // A5: the account holds a contract of another version: stopped, never overwritten.
    const held = await doc(id);
    await storeOtherVersion(id);
    await open(A.page, "/compte");
    const stopped = await until(async () => /Arrêtée/.test(await state(A.page)) && (await state(A.page)), { timeout: 20000 });
    record("A5", "an other-version contract stops the sync, with the reason", "Arrêtée Version de préférences non reconnue : 2.", stopped, /Arrêtée/.test(stopped || "") && /Version de préférences non reconnue : 2/.test(stopped || ""));
    await shot(A.page, "08-compte-arretee.png");
    await A.page.locator(".theme-toggle").click();
    await A.page.waitForTimeout(2500);
    const untouched = (await doc(id)).document;
    record("A5b", "the other-version contract is not overwritten after a change", { v: 2, lists: [] }, untouched, JSON.stringify(untouched) === JSON.stringify({ v: 2, lists: [] }));
    await A.page.locator(".theme-toggle").click();
    await api.db.query("UPDATE account.preferences SET document = $2::jsonb WHERE account_id = $1", [id, JSON.stringify(held.document)]);
    await open(A.page, "/compte");
    await until(async () => /À jour/.test(await state(A.page)));

    // Export.
    const [download] = await Promise.all([A.page.waitForEvent("download", { timeout: 20000 }), A.page.getByRole("button", { name: "Exporter mes données" }).click()]);
    const file = path.join(DIR, "export.json");
    await download.saveAs(file);
    const exported = JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
    record("O8a", "« Exporter mes données » downloads the export", ["vega-account-export.json", "vega-account-export", NATION], [download.suggestedFilename(), exported.format], download.suggestedFilename() === "vega-account-export.json" && exported.format === "vega-account-export" && JSON.stringify(exported.preferences?.contract).includes(NATION));

    // Deletion: 503 without Neon's key, then done.
    await A.page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await A.page.locator('input[name="confirm"]').fill("SUPPRIMER");
    await A.page.getByRole("button", { name: "Supprimer définitivement" }).click();
    const refused = await A.page.locator(".account-data .account-error").textContent({ timeout: 20000 });
    record("O8b", "deletion before Neon's key: told in plain words, nothing erased", "pas encore possible", refused, /pas encore possible/.test(refused) && (await api.rows()).accounts > 0);
    await shot(A.page, "09-delete-unavailable.png");
    api.control.deletion = true;
    await A.page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await until(async () => new URL(A.page.url()).pathname === "/", { timeout: 30000 });
    const rows = await api.rows();
    const left = await listIds(A.page);
    record("O8c", "deletion done: signed out, stores emptied, no row left but the erasure", { accounts: 0, preferences: 0, erasures: 1 }, { rows, left, user: await userId(email) }, rows.accounts === 0 && rows.preferences === 0 && rows.erasures === 1 && !left?.includes(CLUB_B) && (await userId(email)) === null);
    await signInForm(A.page, email, {});
    const gone = await A.page.locator(".signin-error").textContent({ timeout: 30000 });
    record("O8d", "the deleted account cannot sign in", "Adresse ou mot de passe incorrect.", gone, gone === "Adresse ou mot de passe incorrect.");

    // Google: not configured on the stand-in: the error path in plain words.
    await open(A.page, "/connexion");
    await A.page.locator(".signin-google").click();
    const google = await A.page.locator(".signin-error").textContent({ timeout: 20000 });
    record("O7", "« Continuer avec Google » fails in plain words when Google is not set up", "…Google…", google, /Google|indisponible|injoignable/.test(google));

    // O9: no address, token or account id in a URL the browser asked for.
    const leaked = sameOriginCalls.filter((c) => c.path.includes("@") || c.path.includes(id));
    record("O9", "no address or account id in a same-origin URL", [], leaked, leaked.length === 0);
    evidence.accountLog = api.log;
    evidence.authRequests = auth.requests;

    // Captures for the owner (deviceScaleFactor 2): the header, /connexion, /compte.
    if (CAPTURES) {
      for (const [phone, theme, suffix] of [[false, "dark", "bureau-sombre"], [false, "light", "bureau-clair"], [true, "dark", "telephone-sombre"], [true, "light", "telephone-clair"]]) {
        // One account per capture device: the account carries the theme, so a shared one would paint every
        // capture in the theme of the first device.
        const owner = CAPTURE_OWNERS[suffix];
        const c = await device(`capture-${suffix}`, { phone, theme, scale: 2 });
        await open(c.page, `/clubs?id=${CLUB_A}`);
        await c.page.locator('.account-entry[aria-label="Se connecter"]').waitFor({ timeout: 60000 });
        await c.page.waitForTimeout(2500);
        await capture(c.page, `en-tete-deconnecte-${suffix}.png`);
        await open(c.page, "/connexion");
        await c.page.locator(".signin-form").waitFor({ timeout: 30000 });
        await capture(c.page, `connexion-se-connecter-${suffix}.png`);
        await c.page.locator(".signin-switch button", { hasText: "Créer un compte" }).click();
        await c.page.locator('input[name="email"]').fill("lea.martin@example.test");
        await capture(c.page, `connexion-creer-un-compte-${suffix}.png`);
        await c.page.locator(".signin-switch button", { hasText: "Se connecter" }).click();
        await c.page.locator('input[name="email"]').fill("lea.martin@example.test");
        await c.page.locator('input[name="password"]').fill("mauvais-mot-de-passe");
        await c.page.locator(".account-submit").click();
        await c.page.locator(".signin-error").waitFor({ timeout: 20000 });
        await capture(c.page, `connexion-erreur-${suffix}.png`);
        // A new account without a favourite, then the owner's: favourites chosen before the sign-up (capture-seed.json)
        // are merged into the account at the first sign-in.
        if (suffix === "bureau-sombre") {
          await signInForm(c.page, "sacha.petit@example.test", { create: true, next: "/compte" });
          await until(async () => /À jour/.test(await state(c.page)), { timeout: 30000 });
          await capture(c.page, `compte-sans-favori-${suffix}.png`);
          await c.page.getByRole("button", { name: "Se déconnecter" }).click();
          await until(async () => new URL(c.page.url()).pathname === "/", { timeout: 30000 });
        }
        await c.page.evaluate((seed) => {
          for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, JSON.stringify(value));
        }, CAPTURE_SEED);
        await signInForm(c.page, owner, { create: true, next: `/clubs?id=${CLUB_A}` });
        await until(async () => (await entryLabel(c.page)) === "Mon compte", { timeout: 30000 });
        await c.page.waitForTimeout(2500);
        await capture(c.page, `en-tete-connecte-${suffix}.png`);
        await open(c.page, "/compte");
        await until(async () => /À jour/.test(await state(c.page)), { timeout: 30000 });
        await capture(c.page, `compte-synchro-a-jour-${suffix}.png`);
        {
          api.control.delay = 8000;
          await open(c.page, "/compte");
          await until(async () => /En cours/.test(await state(c.page)), { timeout: 20000 });
          await capture(c.page, `compte-synchro-en-cours-${suffix}.png`);
          api.control.delay = 0;
          api.control.down = true;
          await open(c.page, "/compte");
          await until(async () => /En échec/.test(await state(c.page)), { timeout: 20000 });
          await capture(c.page, `compte-synchro-en-echec-${suffix}.png`);
          api.control.down = false;
          const ownerId = await userId(owner);
          const kept = await doc(ownerId);
          await storeOtherVersion(ownerId);
          await open(c.page, "/compte");
          await until(async () => /Arrêtée/.test(await state(c.page)), { timeout: 20000 });
          await capture(c.page, `compte-synchro-arretee-${suffix}.png`);
          await api.db.query("UPDATE account.preferences SET document = $2::jsonb WHERE account_id = $1", [ownerId, JSON.stringify(kept.document)]);
          await c.page.getByRole("button", { name: "Supprimer mon compte" }).click();
          await c.page.locator('input[name="confirm"]').fill("SUPPRIMER");
          api.control.deletion = false;
          await c.page.getByRole("button", { name: "Supprimer définitivement" }).click();
          await c.page.locator(".account-data .account-error").waitFor({ timeout: 20000 });
          await capture(c.page, `compte-suppression-indisponible-${suffix}.png`);
        }
        await c.context.close();
      }
    }
  }
} catch (error) {
  failure = error?.stack || String(error);
  console.error(failure);
} finally {
  const failed = steps.filter((s) => !s.ok);
  writeFileSync(
    path.join(DIR, "evidence.json"),
    JSON.stringify(
      {
        subject: "VI-38: accounts on the site (sign-in, account page, preferences sync, switch)",
        phase: PHASE,
        observed: new Date().toISOString(),
        rerun: "VEGA_FX=<folder holding the replay's server.mjs> tests/e2e/accounts/run.sh <evidence dir> [captures dir]",
        setup: {
          site: SITE,
          build: {
            on: "NEON_AUTH_BASE_URL=http://127.0.0.1:4100/neondb/auth NEON_AUTH_COOKIE_SECRET=<32+> ACCOUNT_API_ORIGIN=http://127.0.0.1:4200 NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8765",
            nosync: "the same without ACCOUNT_API_ORIGIN",
            off: "NEXT_PUBLIC_API_ORIGIN only",
          }[PHASE],
          neonAuth: PHASE === "off" ? "not set" : "stand-in: a real Better Auth 1.7.27 server with the JWT plugin (EdDSA), cookies named __Secure-neon-auth.*, on 127.0.0.1:4100/neondb/auth, base vega_site_auth_e2e (local PostgreSQL 16); JWT iss/aud set to https://auth.stand-in.test for the account front's verifier",
          accountApi: PHASE === "on" ? "the real front and store of backend/account on base vega_site_account_e2e (local PostgreSQL 16), role vega_account; Neon's deletion is the stand-in's, enabled only for step O8c" : "not set",
          data: `${DATA}: recorded production answers (23 Nov 2026) replayed; images routed there from ${IMAGES}`,
          browser: "Playwright Chromium, 1440x900 desktop (devices A, B), 390x844 phone for captures",
        },
        expected: "every step ok",
        steps,
        consoleErrors,
        sameOriginCalls: sameOriginCalls.slice(0, 400),
        ...evidence,
        result: failure ? `failed: ${failure.split("\n")[0]}` : failed.length ? `${failed.length} of ${steps.length} steps failed` : `${steps.length}/${steps.length} steps as expected`,
      },
      null,
      2,
    ),
  );
  console.log(failure ? "FAILED" : `${steps.length - failed.length}/${steps.length} steps ok`);
  await browser.close();
  await api?.close().catch(() => {});
  await auth?.close().catch(() => {});
  process.exit(failure || failed.length ? 1 : 0);
}

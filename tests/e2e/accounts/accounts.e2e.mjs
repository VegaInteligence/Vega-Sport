// E2E — accounts on the site (VI-38): sign-up, sign-out, sign-in, the preferences sync across two devices, the 409
// merge, sign-out's reset, export, deletion, the sync states, the switch, the account page and the header menu. Failure modes: docs/COMPTES_SITE.md.
//
// Run by tests/e2e/accounts/run.sh, which builds and starts the site once per phase:
//   on      Neon (the stand-in) and the account API set: everything below
//   nosync  Neon set, ACCOUNT_API_ORIGIN absent: sign-in works, « Synchronisation : Indisponible », nothing reset
//   off     nothing set: today's site (no entry, /connexion and /compte are 404, /api/auth and /api/account 404,
//           no request to them)
//   verify  the build of « on », the stand-in requiring a confirmed address: the e-mail codes (section 8, R1 to R13)
//   node tests/e2e/accounts/accounts.e2e.mjs <evidence dir> <on|nosync|off|verify> [captures dir]
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
if (!OUT || !["on", "nosync", "off", "verify"].includes(PHASE)) {
  console.error("usage: accounts.e2e.mjs <evidence dir> <on|nosync|off|verify> [captures dir]");
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
// /compte says the sync's state only when it does not work; its block always carries the state (data-state). The
// state's former words lead, so the checks below read as before: « À jour », « En cours », « En échec », « Arrêtée »,
// « Indisponible », then the words on the page (the reason of a stop).
const SYNC_WORDS = { synced: "À jour", idle: "En cours", syncing: "En cours", failed: "En échec", stopped: "Arrêtée", unavailable: "Indisponible" };
const syncState = async (page) => {
  const block = page.locator(".account-syncblock");
  await block.waitFor({ state: "attached", timeout: 30000 });
  return `${SYNC_WORDS[await block.getAttribute("data-state")] ?? ""} ${(await block.textContent()) ?? ""}`.trim();
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
    auth = await startAuthStandIn({ port: 4100, siteOrigin: SITE, requireVerification: PHASE === "verify" });
    if (PHASE === "on" || PHASE === "verify")
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
    const sync = await syncState(a.page);
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
    const synced = await until(async () => /À jour/.test(await syncState(A.page)));
    const kept = await until(async () => {
      const text = await A.page.locator(".account").textContent();
      return (await A.page.locator(".account-favourites a").count()) === 1 && (await A.page.locator(`.account-favourites a[href*="${CLUB_A}"]`).count()) === 1 ? text : null;
    });
    record("S5", "/compte: the address, « Gratuit », « À jour », the club kept as a favourite", [email, "Gratuit", "À jour", "one favourite: the club"], facts, facts.includes(email) && facts.includes("Gratuit") && synced && Boolean(kept));
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
    const state = syncState;
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

    // Section 9, the return from Google. G1: the request carries an absolute error return with the same next.
    {
      const next = `/clubs?id=${CLUB_A}`;
      await open(A.page, `/connexion?next=${encodeURIComponent(next)}`);
      await A.page.locator(".signin-google").waitFor({ timeout: 30000 });
      const asked = A.page.waitForRequest((request) => request.url().endsWith("/api/auth/sign-in/social"), { timeout: 20000 });
      await A.page.locator(".signin-google").click();
      const body = (await asked).postDataJSON();
      const wanted = { callbackURL: `${SITE}${next}`, errorCallbackURL: `${SITE}/connexion?next=${encodeURIComponent(next)}` };
      const got = { callbackURL: body?.callbackURL, errorCallbackURL: body?.errorCallbackURL };
      record("G1", "Google's sign-in carries the page and an error return on /connexion with the same next", wanted, got, got.callbackURL === wanted.callbackURL && got.errorCallbackURL === wanted.errorCallbackURL);
    }
    // G2 to G4: Neon sends the person back to /connexion?error=<code>.
    const errorReturn = async (page, code) => {
      await open(page, `/connexion?next=%2Fclubs&error=${encodeURIComponent(code)}&error_description=State+not+found`);
      const text = await page.locator(".signin-error").textContent({ timeout: 30000 });
      const marked = await page.locator('.signin-form input[aria-invalid="true"]').count();
      const search = await until(async () => {
        // The site adds its own `season` to the address: only next and the error's absence are read.
        const query = new URL(page.url()).searchParams;
        return query.has("error") || query.has("error_description") ? null : query.get("next");
      }, { timeout: 10000 });
      return { text, search, marked };
    };
    {
      const linked = await errorReturn(A.page, "account_not_linked");
      record("G2a", "account_not_linked: sign in with the password and confirm the address first", { text: "…mot de passe…confirm…", search: "/clubs" }, linked, /mot de passe/.test(linked.text) && /confirm/.test(linked.text) && linked.search === "/clubs");
      record("G2d", "the fields are not marked as wrong by a Google return", 0, linked.marked, linked.marked === 0);
      await shot(A.page, "10-google-account-not-linked.png");
      const denied = await errorReturn(A.page, "access_denied");
      record("G2b", "access_denied: the Google step was cancelled or refused", "…Google…annulée…", denied.text, /Google/.test(denied.text) && /annulée|refusée/.test(denied.text));
      const other = await errorReturn(A.page, "state_mismatch");
      record("G2c", "any other code: the generic sentence, the code in parentheses", "…(state_mismatch)", other.text, /Google/.test(other.text) && /\(state_mismatch\)$/.test(other.text) && !/State not found/.test(other.text));
      const dirty = await errorReturn(A.page, "<b>lea@example.test</b>");
      record("G3", "a code that is not clean is never shown", "the generic sentence alone", dirty.text, !/[<@(]|example/.test(dirty.text) && /Google/.test(dirty.text));
      record("G4", "the error leaves the address, next stays", "/clubs", other.search, other.search === "/clubs");
    }
    // G5 / G6: a return with a verifier the session cannot be opened with, in a browser without the hint.
    {
      const fresh = await device("google-return");
      const page = `/clubs?id=${CLUB_A}`;
      await open(fresh.page, `${page}&neon_auth_session_verifier=e2e-unknown-verifier`);
      const landed = await until(async () => (new URL(fresh.page.url()).pathname === "/connexion" ? fresh.page.url() : null), { timeout: 60000 });
      const text = await fresh.page.locator(".signin-error").textContent({ timeout: 30000 }).catch(() => "");
      // The sentence shows before the router has removed `error` from the address: wait for the cleaned address.
      await until(async () => !new URL(fresh.page.url()).searchParams.has("error"), { timeout: 10000 });
      const after = landed ? new URL(fresh.page.url()) : null;
      const actual = { landed: Boolean(landed), next: after?.searchParams.get("next"), error: after?.searchParams.get("error") ?? null, verifier: fresh.page.url().includes("verifier"), text };
      record("G5", "a verifier return without a session goes to /connexion, the code said, the page kept as next", { landed: true, next: page, error: null, verifier: false, text: "…(VERIFICATION_NOT_FOUND)" }, actual, actual.landed && actual.next === page && actual.error === null && !actual.verifier && /\(VERIFICATION_NOT_FOUND\)$/.test(text));
      const read = sameOriginCalls.some((c) => c.device === "google-return" && c.path === "/api/auth/get-session");
      record("G6", "the verifier is read without the hint", true, read, read);
      await shot(fresh.page, "11-google-return-without-session.png");
      await fresh.context.close();
    }

    // Section 10: the account page « Lettre » and the header menu (C1 to C7; C8 is O8 above).
    {
      const owner = `e2e-lettre-${RUN}@example.test`;
      const L = await device("lettre");
      const seed = JSON.parse(JSON.stringify(CAPTURE_SEED));
      // Seven clubs: one more than a kind shows before « Afficher l’autre ».
      seed["statarena.research.v1"].lists[0].entries.push(
        { id: "t_e2eClub6", kind: "clubs", name: "Club six", season: "", imageUrl: "" },
        { id: "t_e2eClub7", kind: "clubs", name: "Club sept", season: "", imageUrl: "" },
      );
      await open(L.page, "/");
      await L.page.evaluate((value) => {
        for (const [key, v] of Object.entries(value)) localStorage.setItem(key, JSON.stringify(v));
      }, seed);
      await signInForm(L.page, owner, { create: true, next: `/clubs?id=${CLUB_A}` });
      await until(async () => (await entryLabel(L.page)) === "Mon compte", { timeout: 30000 });
      const button = L.page.locator("button.account-entry-in");
      const expanded = () => button.getAttribute("aria-expanded");

      // C6: the menu with a mouse, then the keyboard.
      await button.hover();
      await L.page.locator(".account-menu").waitFor({ timeout: 10000 });
      const menu = await L.page.evaluate(() => {
        const m = document.querySelector(".account-menu");
        return {
          text: m.querySelector(".account-menu-who").textContent,
          links: [...m.querySelectorAll(".account-menu-links a")].map((a) => [a.textContent.trim(), a.getAttribute("href")]),
          out: m.querySelector(".account-menu-out")?.textContent.trim(),
          controls: document.querySelector("button.account-entry-in").getAttribute("aria-controls") === m.id,
        };
      });
      const menuOk = (await expanded()) === "true" && menu.text.includes(owner) && menu.text.includes("Gratuit") && JSON.stringify(menu.links) === JSON.stringify([["Mon compte", "/compte"], ["Paramètres", "/compte#parametres"]]) && menu.out === "Se déconnecter" && menu.controls;
      record("C6a", "hover opens the menu: who, « Mon compte », « Paramètres », « Se déconnecter », aria-expanded and aria-controls", { expanded: "true", links: [["Mon compte", "/compte"], ["Paramètres", "/compte#parametres"]], out: "Se déconnecter" }, menu, menuOk);
      await shot(L.page, "12-menu-hover.png");
      await L.page.mouse.move(700, 700);
      const left = await until(async () => (await expanded()) === "false", { timeout: 3000 });
      record("C6b", "leaving with the mouse closes it", "false", await expanded(), Boolean(left));
      await L.page.locator(".theme-toggle").focus();
      await L.page.keyboard.press("Tab");
      const byKeyboard = await until(async () => (await expanded()) === "true", { timeout: 3000 });
      await L.page.keyboard.press("Tab");
      const inside = await L.page.evaluate(() => document.activeElement?.closest(".account-menu") ? document.activeElement.textContent.trim() : null);
      record("C6c", "keyboard focus opens it and Tab goes into its links", { expanded: "true", focus: "Mon compte" }, { expanded: Boolean(byKeyboard), focus: inside }, byKeyboard && inside === "Mon compte");
      await L.page.keyboard.press("Escape");
      await L.page.waitForTimeout(400);
      const escaped = { expanded: await expanded(), focus: await L.page.evaluate(() => document.activeElement?.matches("button.account-entry-in")) };
      record("C6d", "Escape closes it and gives the focus back to the button, without opening it again", { expanded: "false", focus: true }, escaped, escaped.expanded === "false" && escaped.focus === true);

      // C1: « Paramètres » from another page lands on the settings, and the anchor survives the season sync.
      await button.hover();
      await L.page.locator(".account-menu a", { hasText: "Paramètres" }).click();
      await until(async () => new URL(L.page.url()).pathname === "/compte", { timeout: 30000 });
      await L.page.locator("#parametres").waitFor({ timeout: 30000 });
      await L.page.waitForTimeout(3000);
      const landing = await L.page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById("parametres").getBoundingClientRect().top), header: Math.round(document.querySelector(".topbar").getBoundingClientRect().bottom) }));
      record("C1a", "« Paramètres » lands on the settings, under the header, #parametres kept", { hash: "#parametres", top: "header … header + 80" }, landing, landing.hash === "#parametres" && landing.top >= landing.header && landing.top <= landing.header + 80);
      await shot(L.page, "13-parametres.png");
      await L.page.mouse.move(700, 700);
      await button.hover();
      await L.page.locator(".account-menu a", { hasText: "Mon compte" }).click();
      const top = await until(async () => (await L.page.evaluate(() => window.scrollY)) === 0, { timeout: 5000 });
      record("C1b", "« Mon compte » from /compte goes back to the top", 0, await L.page.evaluate(() => window.scrollY), Boolean(top));
      await open(L.page, "/compte#securite");
      await L.page.locator("#securite").waitFor({ timeout: 30000 });
      await L.page.waitForTimeout(3000);
      const direct = await L.page.evaluate(() => ({ hash: location.hash, search: location.search, top: Math.round(document.getElementById("securite").getBoundingClientRect().top) }));
      record("C1c", "/compte#securite opened directly keeps its hash and lands on the section", { hash: "#securite", top: "56 … 136" }, direct, direct.hash === "#securite" && direct.top >= 56 && direct.top <= 136);

      // C2: the password row only for a credential account.
      await open(L.page, "/compte");
      await L.page.locator(".account").waitFor({ timeout: 30000 });
      const shown = await until(async () => (await L.page.getByRole("button", { name: "Changer le mot de passe" }).count()) === 1, { timeout: 15000 });
      record("C2a", "an account with a password is offered « Changer le mot de passe »", 1, await L.page.getByRole("button", { name: "Changer le mot de passe" }).count(), Boolean(shown));
      await L.page.route("**/api/auth/list-accounts**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"down"}' }));
      await open(L.page, "/compte");
      await L.page.locator(".account").waitFor({ timeout: 30000 });
      await L.page.waitForTimeout(4000);
      const hidden = await L.page.getByRole("button", { name: "Changer le mot de passe" }).count();
      record("C2b", "list-accounts failing: no password row", 0, hidden, hidden === 0);
      await L.page.unroute("**/api/auth/list-accounts**");

      // C3: nothing said while the sync works.
      await open(L.page, "/compte");
      await until(async () => /À jour/.test(await syncState(L.page)), { timeout: 30000 });
      const quiet = { state: await L.page.locator(".account-syncblock").getAttribute("data-state"), notes: await L.page.locator(".account-sync-note").count() };
      record("C3", "a working sync says nothing", { state: "synced", notes: 0 }, quiet, quiet.state === "synced" && quiet.notes === 0);

      // C4: six clubs, then « Afficher l’autre ».
      const clubs = L.page.locator(".account-favourites").first();
      const before = await clubs.locator("a").count();
      const more = L.page.getByRole("button", { name: "Afficher l’autre" });
      const hasMore = await more.count();
      if (hasMore) await more.click();
      const after = await until(async () => ((await clubs.locator("a").count()) === 7 ? 7 : null), { timeout: 5000 });
      record("C4", "seven clubs: six shown, « Afficher l’autre » shows the seventh", { before: 6, more: 1, after: 7 }, { before, more: hasMore, after: await clubs.locator("a").count() }, before === 6 && hasMore === 1 && after === 7);
      await shot(L.page, "14-compte-lettre.png");

      // C7: « Se déconnecter » from the menu, the last-save rule kept: signed out, the stores emptied.
      await L.page.mouse.move(700, 700);
      await button.hover();
      await L.page.locator(".account-menu-out").click();
      const gone = await until(async () => (await entryLabel(L.page)) === "Se connecter" && new URL(L.page.url()).pathname === "/", { timeout: 30000 });
      const emptied = await listIds(L.page);
      record("C7", "« Se déconnecter » in the menu signs out from /compte to /, the stores emptied", { entry: "Se connecter", path: "/", favourites: [] }, { entry: await entryLabel(L.page), path: new URL(L.page.url()).pathname, favourites: emptied }, Boolean(gone) && Array.isArray(emptied) && !emptied.includes("t_e2eClub7"));
      // C6f: signed out, the entry is the link « Se connecter », without a menu.
      const outEntry = await L.page.evaluate(() => {
        const e = document.querySelector(".account-entry");
        return { tag: e?.tagName, expanded: e?.getAttribute("aria-expanded") ?? null };
      });
      record("C6f", "signed out: a link « Se connecter », no aria-expanded", { tag: "A", expanded: null }, outEntry, outEntry.tag === "A" && outEntry.expanded === null);
      await L.context.close();

      // C5 and C6e: a phone, a new account without favourites; the menu by touch.
      const P = await device("lettre-phone", { phone: true });
      await signInForm(P.page, `e2e-vide-${RUN}@example.test`, { create: true, next: "/compte" });
      await until(async () => new URL(P.page.url()).pathname === "/compte", { timeout: 30000 });
      await P.page.locator(".account").waitFor({ timeout: 30000 });
      await P.page.waitForTimeout(1500);
      const empty = await P.page.evaluate(() => {
        const p = document.querySelector(".lettre-empty");
        const next = p?.nextElementSibling;
        const gap = p && next ? Math.round(next.getBoundingClientRect().top - p.getBoundingClientRect().bottom) : null;
        return { text: (p?.textContent || "").replace(/\s+/g, " ").trim(), links: [...(p?.querySelectorAll("a") || [])].map((a) => new URL(a.href).pathname.replace(/\/$/, "")), lists: document.querySelectorAll(".account-favourites").length, gap };
      });
      record("C5", "no favourite: « Aucun favori. » and the ways to add one, the competitions a group's distance below", { text: "Aucun favori. …", links: ["/clubs", "/joueurs", "/nations"], lists: 0, gap: "≥ 40" }, empty, empty.text.startsWith("Aucun favori.") && JSON.stringify(empty.links) === JSON.stringify(["/clubs", "/joueurs", "/nations"]) && empty.lists === 0 && empty.gap >= 40);
      await shot(P.page, "15-compte-sans-favori-telephone.png");
      const tapButton = P.page.locator("button.account-entry-in");
      await tapButton.tap();
      const tapOpen = await until(async () => (await tapButton.getAttribute("aria-expanded")) === "true", { timeout: 3000 });
      await tapButton.tap();
      const tapClosed = await until(async () => (await tapButton.getAttribute("aria-expanded")) === "false", { timeout: 3000 });
      await tapButton.tap();
      await until(async () => (await tapButton.getAttribute("aria-expanded")) === "true", { timeout: 3000 });
      // Elsewhere: the page's left gutter under the open menu (on a phone the menu covers the title).
      const menuBox = await P.page.locator(".account-menu").boundingBox();
      await P.page.touchscreen.tap(6, Math.round(menuBox.y + menuBox.height + 24));
      const outside = await until(async () => (await tapButton.getAttribute("aria-expanded")) === "false", { timeout: 3000 });
      record("C6e", "a tap opens and closes the menu; a tap elsewhere closes it", { open: true, closed: true, outside: true }, { open: Boolean(tapOpen), closed: Boolean(tapClosed), outside: Boolean(outside) }, tapOpen && tapClosed && outside);
      await P.context.close();
    }

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
        // Section 9: the returns from Google that Neon refused.
        for (const [code, name] of [["account_not_linked", "compte-non-confirme"], ["access_denied", "annule"], ["VERIFICATION_NOT_FOUND", "echec"]]) {
          await open(c.page, `/connexion?error=${code}`);
          await c.page.locator(".signin-error").waitFor({ timeout: 30000 });
          await capture(c.page, `connexion-retour-google-${name}-${suffix}.png`);
        }
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

  if (PHASE === "verify") {
    const email = `e2e-${RUN}@example.test`;
    const NEW_PASSWORD = "nouveau-motdepasse-2";
    const V = await device("V");
    const page = V.page;
    const title = () => page.locator(".signin-title").textContent();
    const titled = (text) => until(async () => ((await title()) || "").trim() === text, { timeout: 30000 });
    const view = () =>
      page.evaluate(() => ({
        title: document.querySelector(".signin-title")?.textContent.trim(),
        address: document.querySelector(".signin-address")?.textContent.trim() ?? null,
        error: document.querySelector(".signin-error")?.textContent.trim() ?? null,
        note: document.querySelector('.signin-note[role="status"]')?.textContent.trim() ?? null,
        code: document.querySelector('input[name="code"]')?.value ?? null,
        email: document.querySelector('input[name="email"]')?.value ?? null,
        password: document.querySelector('input[name="password"]')?.value ?? null,
        focus: document.activeElement?.getAttribute("name") ?? null,
        google: document.querySelectorAll(".signin-google").length,
        headings: document.querySelectorAll("h1").length,
      }));
    const calls = (suffix) => sameOriginCalls.filter((call) => call.path === `/api/auth/${suffix}`).length;
    const signedIn = async () => (await page.evaluate(() => fetch("/api/auth/get-session", { headers: { "X-Force-Fetch": "1" } }).then((r) => r.json()).catch(() => null)))?.user?.email ?? null;
    const lastCode = (address, type) => auth.codes(address, type).at(-1);
    const wrongCode = (right) => (right === "000000" ? "111111" : "000000");

    // R1: a sign-up answer without a session opens « Confirmer l'adresse ».
    await signInForm(page, email, { create: true, next: "/compte" });
    record("R1a", "sign-up with verification required opens « Confirmer l'adresse »", true, await titled("Confirmer l’adresse"), (await titled("Confirmer l’adresse")) === true);
    const first = await view();
    record("R1b", "the step shows the address, the code field has the focus, no Google button, one h1", { address: email, focus: "code", google: 0, headings: 1 }, first, first.address === email && first.focus === "code" && first.google === 0 && first.headings === 1);
    record("R1c", "the address is not in the URL", false, page.url().includes("example.test"), !page.url().includes("example.test") && !decodeURIComponent(page.url()).includes("@"));
    record("R1d", "one code was sent at sign-up; nobody is signed in", { codes: 1, session: null }, { codes: auth.codes(email, "email-verification").length, session: await signedIn() }, auth.codes(email, "email-verification").length === 1 && (await signedIn()) === null);
    const field = page.locator('input[name="code"]');
    const attributes = await field.evaluate((input) => ({ inputMode: input.inputMode, autocomplete: input.autocomplete, maxLength: input.maxLength }));
    record("R3a", "the code field is numeric and announced as a one-time code", { inputMode: "numeric", autocomplete: "one-time-code" }, attributes, attributes.inputMode === "numeric" && attributes.autocomplete === "one-time-code");
    await shot(page, "v01-confirmer.png");

    // R3: an incomplete code sends nothing.
    await field.fill("12 34");
    const before = calls("email-otp/verify-email");
    await page.locator(".account-submit").click();
    await page.waitForTimeout(800);
    const partial = await view();
    record("R3b", "four digits: cleaned in the field, nothing sent, the focus stays in the field", { code: "1234", sent: 0, focus: "code" }, { code: partial.code, sent: calls("email-otp/verify-email") - before, focus: partial.focus }, partial.code === "1234" && calls("email-otp/verify-email") === before && partial.focus === "code");

    // R4: a wrong code.
    await field.fill(wrongCode(lastCode(email, "email-verification")));
    await page.locator(".account-submit").click();
    await page.locator(".signin-error").waitFor({ timeout: 30000 });
    const refused = await view();
    record("R4a", "a wrong code: « Code incorrect. », the field emptied and focused, the address kept", { error: "Code incorrect.", code: "", focus: "code", address: email }, refused, refused.error === "Code incorrect." && refused.code === "" && refused.focus === "code" && refused.address === email);
    await shot(page, "v02-code-incorrect.png");

    // R5: another code, then the wait.
    const resend = page.locator(".signin-resend");
    await resend.click();
    await until(() => auth.codes(email, "email-verification").length === 2);
    await page.locator('.signin-note[role="status"]').waitFor({ timeout: 10000 });
    const waiting = await resend.evaluate((button) => ({ disabled: button.disabled, text: button.textContent.trim() }));
    record("R5", "« Renvoyer le code » sends a second code, says so, then waits", { codes: 2, disabled: true }, { codes: auth.codes(email, "email-verification").length, ...waiting, note: (await view()).note }, auth.codes(email, "email-verification").length === 2 && waiting.disabled === true && /\d/.test(waiting.text));

    // R3 + R1: the code pasted with text around it signs the person in and brings them back.
    const code = lastCode(email, "email-verification");
    await field.fill(`Votre code : ${code.slice(0, 3)}-${code.slice(3)}.`);
    const pasted = (await view()).code;
    await page.locator(".account-submit").click();
    await until(async () => new URL(page.url()).pathname === "/compte", { timeout: 30000 });
    const hero = await page.locator(".account-hero").textContent({ timeout: 30000 });
    record("R3c", "a pasted code keeps its six digits and confirms the address: signed in, back to ?next=", { pasted: code, path: "/compte" }, { pasted, path: new URL(page.url()).pathname, address: hero.includes(email) }, pasted === code && hero.includes(email));
    const verified = (await auth.pool.query('SELECT "emailVerified" AS v FROM "user" WHERE email = $1', [email])).rows[0]?.v;
    record("R1e", "the address is confirmed at the auth server", true, verified, verified === true);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => new URL(page.url()).pathname === "/", { timeout: 30000 });

    // R2 + R6 + R11: an account left unconfirmed, then a sign-in.
    const late = `e2e-late-${RUN}@example.test`;
    await signInForm(page, late, { create: true, next: "/compte" });
    await titled("Confirmer l’adresse");
    await page.locator(".signin-back").click();
    await titled("Connexion");
    const backView = await view();
    record("R11a", "« Retour » gives « Connexion », the address kept, the password cleared, Google back", { title: "Connexion", email: late, password: "", google: 1 }, backView, backView.email === late && backView.password === "" && backView.google === 1);
    const sentBefore = auth.codes(late, "email-verification").length;
    // R6: the confirmation's own session is withheld (as with Neon's auto sign-in off): the cookies are dropped.
    await V.context.route(`${SITE}/api/auth/email-otp/verify-email`, async (route) => {
      const answer = await route.fetch();
      // route.fetch() keeps the answer's cookies in the context's jar: emptied (nobody is signed in at this point).
      await V.context.clearCookies();
      const headers = Object.fromEntries(Object.entries(answer.headers()).filter(([name]) => name.toLowerCase() !== "set-cookie"));
      const body = await answer.json().catch(() => null);
      await route.fulfill({ status: answer.status(), headers, body: JSON.stringify(body && typeof body === "object" ? { ...body, token: null } : body) });
    });
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator(".account-submit").click();
    await titled("Confirmer l’adresse");
    await until(() => auth.codes(late, "email-verification").length > sentBefore);
    await page.waitForTimeout(1000);
    const asked = auth.codes(late, "email-verification").length - sentBefore;
    record("R2", "sign-in with an unconfirmed address opens the step and asks for exactly one code", { title: "Confirmer l’adresse", codes: 1 }, { title: (await view()).title, codes: asked }, asked === 1);
    const signIns = calls("sign-in/email");
    await page.locator('input[name="code"]').fill(lastCode(late, "email-verification"));
    await page.locator(".account-submit").click();
    await until(async () => new URL(page.url()).pathname === "/compte", { timeout: 30000 });
    record("R6", "no session from the confirmation: the site signs in with the password it held", { path: "/compte", signIns: 1 }, { path: new URL(page.url()).pathname, signIns: calls("sign-in/email") - signIns, session: await signedIn() }, new URL(page.url()).pathname === "/compte" && calls("sign-in/email") - signIns === 1 && (await signedIn()) === late);
    await V.context.unroute(`${SITE}/api/auth/email-otp/verify-email`);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => new URL(page.url()).pathname === "/", { timeout: 30000 });

    // R7 + R12 + R13: « Mot de passe oublié ? ».
    await open(page, "/connexion?next=/compte");
    await titled("Connexion");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("brouillon");
    await page.locator(".signin-forgot").click();
    await titled("Mot de passe oublié");
    const forgot = await view();
    record("R13a", "« Mot de passe oublié »: its own title, the address kept, no password field, no Google button", { title: "Mot de passe oublié", email, password: null, google: 0 }, forgot, forgot.email === email && forgot.password === null && forgot.google === 0);
    await shot(page, "v03-oubli.png");
    await page.locator('input[name="email"]').fill("");
    const requests = () => calls("email-otp/request-password-reset") + calls("forget-password/email-otp");
    const none = requests();
    await page.locator(".account-submit").click();
    await page.waitForTimeout(800);
    record("R7a", "an empty address sends nothing and keeps the focus", { sent: 0, focus: "email" }, { sent: requests() - none, focus: (await view()).focus }, requests() === none && (await view()).focus === "email");
    const stranger = `inconnu-${RUN}@example.test`;
    await page.locator('input[name="email"]').fill(stranger);
    await page.locator(".account-submit").click();
    await titled("Nouveau mot de passe");
    const unknown = await view();
    await page.waitForTimeout(500);
    record("R7b", "an address without an account gets the same step, no error, and no e-mail", { title: "Nouveau mot de passe", error: null, mails: 0 }, { title: unknown.title, error: unknown.error, mails: auth.codes(stranger).length }, unknown.error === null && auth.codes(stranger).length === 0);
    await page.reload({ waitUntil: "domcontentloaded" });
    record("R12a", "reloading a step shows « Connexion »", true, await titled("Connexion"), (await titled("Connexion")) === true);
    await open(page, "/connexion?mode=oubli&next=/compte");
    record("R12b", "?mode=oubli opens « Mot de passe oublié »", true, await titled("Mot de passe oublié"), (await titled("Mot de passe oublié")) === true);

    // R9 + R10: the reset.
    await page.locator('input[name="email"]').fill(email);
    await page.locator(".account-submit").click();
    await titled("Nouveau mot de passe");
    await until(() => auth.codes(email, "forget-password").length === 1);
    const reset = await view();
    record("R9a", "« Nouveau mot de passe »: the address, the code field focused, the password as new-password", { address: email, focus: "code", autocomplete: "new-password" }, { ...reset, autocomplete: await page.locator('input[name="password"]').getAttribute("autocomplete") }, reset.address === email && reset.focus === "code" && (await page.locator('input[name="password"]').getAttribute("autocomplete")) === "new-password");
    await shot(page, "v04-nouveau-mot-de-passe.png");
    const resetCode = lastCode(email, "forget-password");
    await page.locator('input[name="code"]').fill(resetCode);
    await page.locator('input[name="password"]').fill("court");
    await page.locator(".account-submit").click();
    await page.locator(".signin-error").waitFor({ timeout: 30000 });
    const short = await view();
    record("R9b", "a short password: told in plain words, the step and the code kept", { title: "Nouveau mot de passe", error: "8 caractères", code: resetCode }, short, short.title === "Nouveau mot de passe" && /8 caractères/.test(short.error) && short.code === resetCode);
    await page.locator('input[name="code"]').fill(wrongCode(resetCode));
    await page.locator('input[name="password"]').fill(NEW_PASSWORD);
    await page.locator(".account-submit").click();
    await until(async () => (await view()).error === "Code incorrect.", { timeout: 30000 });
    const badCode = await view();
    record("R9c", "a wrong code: « Code incorrect. », the code emptied, the new password kept", { error: "Code incorrect.", code: "", password: NEW_PASSWORD }, badCode, badCode.error === "Code incorrect." && badCode.code === "" && badCode.password === NEW_PASSWORD);
    await page.locator('input[name="code"]').fill(resetCode);
    await page.locator(".account-submit").click();
    await until(async () => new URL(page.url()).pathname === "/compte", { timeout: 30000 });
    record("R10", "the reset signs in with the new password and brings the person back", { path: "/compte", session: email }, { path: new URL(page.url()).pathname, session: await signedIn() }, new URL(page.url()).pathname === "/compte" && (await signedIn()) === email);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await until(async () => new URL(page.url()).pathname === "/", { timeout: 30000 });
    await signInForm(page, email, { password: PASSWORD, next: "/compte" });
    const old = await page.locator(".signin-error").textContent({ timeout: 30000 });
    record("R10b", "the old password no longer opens the account", "Adresse ou mot de passe incorrect.", old, old === "Adresse ou mot de passe incorrect.");
    await page.locator('input[name="password"]').fill(NEW_PASSWORD);
    await page.locator(".account-submit").click();
    await until(async () => new URL(page.url()).pathname === "/compte", { timeout: 30000 });
    record("R10c", "the new password does", "/compte", new URL(page.url()).pathname, new URL(page.url()).pathname === "/compte");
    const leaked = [...consoleErrors.map((e) => e.error), ...sameOriginCalls.map((c) => c.path)].filter((text) => /example\.test|\b\d{6}\b/.test(text));
    record("O9", "no address and no code in a URL of the site or in the console", [], leaked, leaked.length === 0);
    await V.context.close();

    if (CAPTURES)
      for (const [phone, theme, suffix] of [[false, "dark", "bureau-sombre"], [false, "light", "bureau-clair"], [true, "dark", "telephone-sombre"], [true, "light", "telephone-clair"]]) {
        const c = await device(`capture-${suffix}`, { phone, theme, scale: 2 });
        const owner = CAPTURE_OWNERS[suffix];
        await open(c.page, "/connexion");
        await c.page.locator(".signin-forgot").waitFor({ timeout: 30000 });
        await c.page.locator('input[name="email"]').fill(owner);
        await capture(c.page, `connexion-avec-oubli-${suffix}.png`);
        await signInForm(c.page, owner, { create: true });
        await c.page.locator('input[name="code"]').waitFor({ timeout: 30000 });
        await capture(c.page, `confirmer-adresse-${suffix}.png`);
        const sent = auth.codes(owner, "email-verification").at(-1);
        await c.page.locator('input[name="code"]').fill(sent.slice(0, 4));
        await capture(c.page, `confirmer-adresse-saisie-${suffix}.png`);
        await c.page.locator('input[name="code"]').fill(sent === "000000" ? "111111" : "000000");
        await c.page.locator(".account-submit").click();
        await c.page.locator(".signin-error").waitFor({ timeout: 30000 });
        await capture(c.page, `confirmer-adresse-code-incorrect-${suffix}.png`);
        await c.page.locator(".signin-resend").click();
        await c.page.locator('.signin-note[role="status"]').waitFor({ timeout: 10000 });
        await capture(c.page, `confirmer-adresse-renvoye-${suffix}.png`);
        await c.page.locator(".signin-back").click();
        await c.page.locator(".signin-forgot").click();
        await c.page.locator(".signin-title", { hasText: "Mot de passe oublié" }).waitFor({ timeout: 10000 });
        await capture(c.page, `mot-de-passe-oublie-${suffix}.png`);
        await c.page.locator(".account-submit").click();
        await c.page.locator(".signin-title", { hasText: "Nouveau mot de passe" }).waitFor({ timeout: 30000 });
        await capture(c.page, `nouveau-mot-de-passe-${suffix}.png`);
        await c.page.locator('input[name="code"]').fill("482913");
        await c.page.locator('input[name="password"]').fill("un-nouveau-secret");
        await capture(c.page, `nouveau-mot-de-passe-rempli-${suffix}.png`);
        await c.context.close();
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
            verify: "the build of « on »",
          }[PHASE],
          neonAuth: PHASE === "off" ? "not set" : "stand-in: a real Better Auth 1.7.27 server with the JWT plugin (EdDSA), cookies named __Secure-neon-auth.*, on 127.0.0.1:4100/neondb/auth, base vega_site_auth_e2e (local PostgreSQL 16); JWT iss/aud set to https://auth.stand-in.test for the account front's verifier; the Email OTP plugin (six digits, 15 minutes, 3 attempts), its e-mails kept in an outbox the run reads" + (PHASE === "verify" ? "; a confirmed address required, a code sent at sign-up, a session opened by the confirmation" : "; no confirmation required"),
          accountApi: PHASE === "on" || PHASE === "verify" ? "the real front and store of backend/account on base vega_site_account_e2e (local PostgreSQL 16), role vega_account; Neon's deletion is the stand-in's, enabled only for step O8c" : "not set",
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

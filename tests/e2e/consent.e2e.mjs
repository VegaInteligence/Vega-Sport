// E2E — the consent banner for visitors in Europe (hugo, 24 Nov 2026: « ajoute aussi les bannières de cookies quand le
// user est en Europe »). Written before the implementation, run red against main first.
//
// What the site keeps in the browser and what it sends elsewhere (checked in the code, see WORKLOG.md): the theme,
// preferences, favourites, the visit's memory, the home cookie `vega.home.v1` and the session cookies of Neon Auth are
// asked for by the visitor and never wait for a consent. Two tools measure the site for its owner: Vercel Web
// Analytics (`<Analytics />`) and Vercel Speed Insights (`<SpeedInsights />`). There is no advertising.
//
// Failure modes and expected outcomes:
//  E1 Europe (x-vercel-ip-continent EU), no stored choice: the banner (a region named « Mesure d’audience », the
//     sentence, « Accepter », « Refuser », the link « Confidentialité » to /confidentialite/, which next/link renders without its final slash) shows on /, /clubs/ and
//     /connexion (the run's server has accounts on), and NO request goes to a measurement script or endpoint
//     (va.vercel-scripts.com in development, /_vercel/insights/ and /_vercel/speed-insights/ in production).
//  E2 « Accepter »: the banner goes, the measurement scripts are requested, localStorage `vega.consent.v1` holds
//     { measurement: true, at: <ISO date> }; after a reload no banner and the scripts load again.
//  E3 « Refuser »: the banner goes, no measurement request, `vega.consent.v1` holds { measurement: false, at };
//     after a reload no banner and still no measurement request.
//  E4 Outside Europe (continent NA, country US): no banner, the measurement loads as before.
//  E5 Unknown location (no geolocation header: local, another host): the banner shows, nothing measured.
//  E6 An EU outermost region (country RE, continent AF): the banner shows.
//  E7 A stored choice older than six months (an acceptance of 200 days ago): the banner shows again, nothing measured.
//  E8 Reopening (window event `vega:consent-open`, what the footer's « Cookies » button sends): after a refusal the
//     banner shows again, « Refuser » marked as the current choice (aria-pressed true, « Accepter » false); choosing
//     « Accepter » then loads the measurement without a reload.
//  E9 Refusing after accepting, in the same page: the measurement components leave at once; no measurement request
//     after the next load.
//  E10 Both buttons have the same box (width and height within 1 px) and the same look (background, colour, border,
//     font size and weight): refusing is as easy as accepting.
//  E11 The server's HTML of /, /clubs/ and /connexion (requested with the Europe headers) contains neither the banner
//     nor its buttons: cached pages are the same for everyone.
//  E12 /api/consent-region answers only {"consent":"required"} or {"consent":"none"}, with Cache-Control private,
//     no-store, for EU, NA, RE/AF and no header.
//  E13 Phone 390 × 844: the banner is open, nothing scrolls sideways, the banner sits above the tab bar (no overlap),
//     both buttons are at least 44 px high and side by side.
//  E14 /connexion on a phone (390 × 844): the sign-in form's primary action is clear of the banner at first view,
//     without scrolling.
//  E15 Keyboard: Tab from the top of the page reaches « Accepter » and « Refuser »; the focused button shows a visible
//     outline; Escape closes the banner without storing anything, and it returns on the next page.
//  E16 localStorage throwing: the banner shows, nothing is measured, no page error.
//  E17 The region is announced once (one polite live region holding the banner), and the banner appears without moving
//     the page (the main heading's position is unchanged after it shows).
//  X1 No page error during the run.
//
// Run against a local site (dev or production build) whose API reads go to the replay of recorded production reads:
//   node tests/e2e/consent.e2e.mjs <base url> <evidence dir> [replay origin]
// The replay serves the public image copies too (https://dngp6kh9jx2bl.cloudfront.net/** is routed to it). The site's
// server needs NEON_AUTH_BASE_URL=http://127.0.0.1:4199/neondb/auth and a NEON_AUTH_COOKIE_SECRET of 32 characters or
// more for /connexion to exist (nothing listens there: the page only renders). It writes evidence.json (setup, rerun
// command, expected, actual, requests, console) and screenshots into the evidence dir; exit code 1 when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3100", out = path.join(os.tmpdir(), "consent-e2e"), replay = "http://127.0.0.1:8865"] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");

const KEY = "vega.consent.v1";
const EU = { "x-vercel-ip-continent": "EU", "x-vercel-ip-country": "FR" };
const NA = { "x-vercel-ip-continent": "NA", "x-vercel-ip-country": "US" };
const RE = { "x-vercel-ip-continent": "AF", "x-vercel-ip-country": "RE" };
const MEASURE = /va\.vercel-scripts\.com|\/_vercel\/(insights|speed-insights)\//;
const DAY = 86400000;

const results = [], consoleLog = [], requestLog = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(typeof actual === "string" ? actual : JSON.stringify(actual ?? null)).slice(0, 400));
};
const notRun = (id, why) => {
  results.push({ id, ok: null, notRun: why });
  console.log("NOT RUN", id, "—", why);
};

const browser = await chromium.launch();
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

/** A browser with the given geolocation headers on the site's own requests, and the measurement requests counted. */
async function open({ geo = null, viewport = desktop, stored, init, label }) {
  const context = await browser.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport,
    ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  if (stored !== undefined)
    await context.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem("consent-e2e-seeded")) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem("consent-e2e-seeded", "1");
      }
    }, [KEY, stored]);
  if (init) await context.addInitScript(init);
  if (geo)
    await context.route(`${base}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), ...geo } }),
    );
  await context.route("https://dngp6kh9jx2bl.cloudfront.net/**", (route) => {
    const u = new URL(route.request().url());
    return context.request.get(replay + u.pathname + u.search).then(
      async (r) => route.fulfill({ status: r.status(), contentType: r.headers()["content-type"], body: await r.body() }),
      () => route.abort(),
    );
  });
  // The measurement scripts cannot be reached from a local run: answered empty, still counted.
  await context.route("https://va.vercel-scripts.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  const measured = [];
  context.on("request", (request) => {
    if (MEASURE.test(request.url())) {
      measured.push(request.url());
      requestLog.push({ label, url: request.url() });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleLog.push(`${label}: pageerror ${String(error).slice(0, 300)}`));
  return { context, page, measured };
}
const banner = (page) => page.getByRole("region", { name: "Mesure d’audience" });
const goto = async (page, route) => {
  await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
};
const visible = (page) => banner(page).isVisible().catch(() => false);
const stored = (page) => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return "unreadable"; } }, KEY);
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});

try {
  // E12 — the answer of /api/consent-region.
  {
    const cases = [["EU", EU, "required"], ["NA", NA, "none"], ["RE/AF", RE, "required"], ["none", {}, "required"]];
    const seen = [];
    let ok = true;
    for (const [name, headers, expected] of cases) {
      const response = await fetch(`${base}/api/consent-region`, { headers });
      const body = await response.text();
      const cache = response.headers.get("cache-control") || "";
      seen.push({ name, status: response.status, body, cache });
      ok &&= response.status === 200 && body === JSON.stringify({ consent: expected }) && /private/.test(cache) && /no-store/.test(cache);
    }
    check("E12", "only {consent}, private, no-store", seen, ok);
  }

  // E11 — the server's HTML never holds the banner.
  {
    const seen = [];
    for (const route of ["/", "/clubs/", "/connexion"]) {
      const response = await fetch(base + route, { headers: EU });
      const html = await response.text();
      seen.push({ route, status: response.status, banner: /Mesure d’audience|Mesure d&#x27;audience|consent-title|>Accepter<|>Refuser</.test(html) });
    }
    check("E11", "no banner markup in the server's HTML", seen, seen.every((s) => s.status === 200 && !s.banner));
  }

  // E1 — Europe, no choice: banner on three pages, nothing measured.
  {
    const { context, page, measured } = await open({ geo: EU, label: "E1" });
    const pages = [];
    for (const route of ["/", "/clubs/", "/connexion"]) {
      await goto(page, route);
      const region = banner(page);
      const shown = await visible(page);
      const link = shown ? await region.getByRole("link", { name: "Confidentialité" }).getAttribute("href").catch(() => null) : null;
      const buttons = shown ? await region.getByRole("button").allInnerTexts() : [];
      pages.push({ route, shown, link, buttons });
      await shot(page, `E1${route.replace(/\W/g, "-")}`);
    }
    check(
      "E1",
      "banner with « Accepter », « Refuser » and /confidentialite/ on /, /clubs/, /connexion; no measurement request",
      { pages, measured },
      pages.every((p) => p.shown && /^\/confidentialite\/?$/.test(p.link || "") && p.buttons.join("|") === "Accepter|Refuser") && measured.length === 0,
    );

    // E17 — one polite live region, the page does not move.
    const live = await page.evaluate(() => {
      const regions = [...document.querySelectorAll("[aria-live]")].filter((n) => n.querySelector("#consent-title"));
      return regions.map((n) => n.getAttribute("aria-live"));
    });
    check("E17a", "the banner sits in one polite live region", live, live.length === 1 && live[0] === "polite");
    await context.close();
  }
  {
    // E17b — the main heading does not move when the banner appears: the position with the banner held back
    // (the region answer delayed) against the position once it shows.
    const { context, page } = await open({ geo: EU, label: "E17" });
    let release;
    const held = new Promise((r) => (release = r));
    await context.route(`${base}/api/consent-region`, async (route) => {
      await held;
      route.continue({ headers: { ...route.request().headers(), ...EU } });
    });
    await page.goto(base + "/clubs/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const before = await page.evaluate(() => document.querySelector("h1")?.getBoundingClientRect().top ?? null);
    const scrollBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    release();
    await banner(page).waitFor({ timeout: 10000 }).catch(() => {});
    const after = await page.evaluate(() => document.querySelector("h1")?.getBoundingClientRect().top ?? null);
    check("E17b", "the page does not move when the banner appears", { before, after, scrollBefore }, before !== null && before === after && (await visible(page)));
    await context.close();
  }

  // E2 — accept.
  {
    const { context, page, measured } = await open({ geo: EU, label: "E2" });
    await goto(page, "/");
    const beforeClick = measured.length;
    await banner(page).getByRole("button", { name: "Accepter" }).click().catch(() => {});
    await page.waitForTimeout(1500);
    const gone = !(await visible(page));
    const afterClick = measured.length;
    const value = await stored(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const goneAfterReload = !(await visible(page));
    check(
      "E2",
      "banner gone, scripts requested, { measurement: true, at } stored, still gone after a reload and measured again",
      { beforeClick, afterClick, value, goneAfterReload, total: measured.length },
      beforeClick === 0 && gone && afterClick > 0 && value?.measurement === true && !Number.isNaN(Date.parse(value?.at)) &&
        goneAfterReload && measured.length > afterClick,
    );
    await context.close();
  }

  // E3 — refuse.
  {
    const { context, page, measured } = await open({ geo: EU, label: "E3" });
    await goto(page, "/");
    await banner(page).getByRole("button", { name: "Refuser" }).click().catch(() => {});
    await page.waitForTimeout(1000);
    const gone = !(await visible(page));
    const value = await stored(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const goneAfterReload = !(await visible(page));
    await goto(page, "/clubs/");
    check(
      "E3",
      "banner gone, nothing measured, { measurement: false, at } stored, still gone after a reload",
      { gone, value, goneAfterReload, measured },
      gone && value?.measurement === false && !Number.isNaN(Date.parse(value?.at)) && goneAfterReload && !(await visible(page)) && measured.length === 0,
    );
    await context.close();
  }

  // E4 — outside Europe.
  {
    const { context, page, measured } = await open({ geo: NA, label: "E4" });
    await goto(page, "/");
    check("E4", "no banner, measurement loads", { shown: await visible(page), measured }, !(await visible(page)) && measured.length > 0);
    await context.close();
  }

  // E5 — unknown location.
  {
    const { context, page, measured } = await open({ geo: null, label: "E5" });
    await goto(page, "/clubs/");
    const shown = await visible(page);
    check("E5", "banner, nothing measured", { shown, measured }, shown && measured.length === 0);
    await context.close();
  }

  // E6 — an outermost region.
  {
    const { context, page, measured } = await open({ geo: RE, label: "E6" });
    await goto(page, "/clubs/");
    const shown = await visible(page);
    check("E6", "banner for La Réunion (continent AF)", { shown, measured }, shown && measured.length === 0);
    await context.close();
  }

  // E7 — an expired choice.
  {
    const old = { measurement: true, at: new Date(Date.now() - 200 * DAY).toISOString() };
    const { context, page, measured } = await open({ geo: EU, stored: old, label: "E7" });
    await goto(page, "/clubs/");
    const shown = await visible(page);
    check("E7", "an acceptance of 200 days ago: banner again, nothing measured", { shown, measured }, shown && measured.length === 0);
    await context.close();
  }

  // E8 — reopening after a refusal, then accepting without a reload.
  {
    const refused = { measurement: false, at: new Date(Date.now() - 3 * DAY).toISOString() };
    const { context, page, measured } = await open({ geo: EU, stored: refused, label: "E8" });
    await goto(page, "/clubs/");
    const hiddenFirst = !(await visible(page));
    await page.evaluate(() => window.dispatchEvent(new Event("vega:consent-open")));
    await page.waitForTimeout(500);
    const shown = await visible(page);
    const pressed = shown
      ? {
          accept: await banner(page).getByRole("button", { name: "Accepter" }).getAttribute("aria-pressed"),
          refuse: await banner(page).getByRole("button", { name: "Refuser" }).getAttribute("aria-pressed"),
        }
      : null;
    await shot(page, "E8-reopened");
    if (shown) await banner(page).getByRole("button", { name: "Accepter" }).click();
    await page.waitForTimeout(1500);
    check(
      "E8",
      "reopened with « Refuser » marked; « Accepter » then measures without a reload",
      { hiddenFirst, shown, pressed, measured, value: await stored(page) },
      hiddenFirst && shown && pressed?.refuse === "true" && pressed?.accept === "false" && measured.length > 0 && (await stored(page))?.measurement === true,
    );
    await context.close();
  }

  // E9 — refusing after accepting.
  {
    const accepted = { measurement: true, at: new Date(Date.now() - 3 * DAY).toISOString() };
    const { context, page, measured } = await open({ geo: EU, stored: accepted, label: "E9" });
    await goto(page, "/clubs/");
    const loaded = measured.length;
    await page.evaluate(() => window.dispatchEvent(new Event("vega:consent-open")));
    await page.waitForTimeout(400);
    await banner(page).getByRole("button", { name: "Refuser" }).click().catch(() => {});
    await page.waitForTimeout(800);
    const value = await stored(page);
    const atRefusal = measured.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    check(
      "E9",
      "measured before; after « Refuser » and a reload, no new measurement request",
      { loaded, atRefusal, after: measured.length, value },
      loaded > 0 && value?.measurement === false && measured.length === atRefusal,
    );
    await context.close();
  }

  // E10 — equal weight; E15 — keyboard and Escape.
  {
    const { context, page } = await open({ geo: EU, label: "E10" });
    await goto(page, "/clubs/");
    const look = await page.evaluate(() => {
      const region = document.getElementById("consent-title")?.closest("section");
      if (!region) return null;
      return [...region.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect(), s = getComputedStyle(b);
        return { text: b.textContent.trim(), w: r.width, h: r.height, bg: s.backgroundColor, color: s.color, border: s.border, size: s.fontSize, weight: s.fontWeight };
      });
    });
    const [a, r] = look || [];
    check(
      "E10",
      "« Accepter » and « Refuser »: same box and same look",
      look,
      a && r && Math.abs(a.w - r.w) <= 1 && Math.abs(a.h - r.h) <= 1 && a.bg === r.bg && a.color === r.color && a.border === r.border && a.size === r.size && a.weight === r.weight,
    );
    await shot(page, "E10-desktop");

    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.locator("body").focus().catch(() => {});
    const reached = new Set();
    let outline = null;
    for (let i = 0; i < 40 && reached.size < 2; i += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        const inBanner = el?.closest?.("section")?.querySelector("#consent-title");
        if (!inBanner || el.tagName !== "BUTTON") return null;
        const s = getComputedStyle(el);
        return { text: el.textContent.trim(), outline: `${s.outlineStyle} ${s.outlineWidth}` };
      });
      if (focused) {
        reached.add(focused.text);
        outline ??= focused.outline;
      }
    }
    await shot(page, "E15-focus");
    check("E15a", "Tab reaches « Accepter » and « Refuser », the focus is visible", { reached: [...reached], outline }, reached.has("Accepter") && reached.has("Refuser") && outline && !/^none/.test(outline) && !/ 0px$/.test(outline));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = !(await visible(page));
    const value = await stored(page);
    await goto(page, "/competitions/");
    check("E15b", "Escape closes without storing; the banner returns on the next page", { closed, value, nextPage: await visible(page) }, closed && value === null && (await visible(page)));
    await context.close();
  }

  // E13 — phone.
  for (const theme of ["dark", "light"]) {
    const { context, page } = await open({
      geo: EU,
      viewport: phone,
      label: `E13-${theme}`,
      init: theme === "light" ? () => localStorage.setItem("statarena.theme", "light") : undefined,
    });
    await goto(page, "/");
    const layout = await page.evaluate(() => {
      const region = document.getElementById("consent-title")?.closest("section");
      const bar = document.querySelector(".tabbar");
      const box = (n) => (n ? n.getBoundingClientRect().toJSON() : null);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
        banner: box(region),
        tabbar: box(bar),
        buttons: region ? [...region.querySelectorAll("button")].map((b) => box(b)) : [],
      };
    });
    const [b1, b2] = layout.buttons;
    check(
      `E13-${theme}`,
      "390 px: no sideways scroll, banner above the tab bar, buttons side by side, 44 px high or more",
      layout,
      layout.banner && layout.scrollWidth <= layout.width && layout.tabbar && layout.banner.bottom <= layout.tabbar.top + 0.5 &&
        b1 && b2 && Math.abs(b1.top - b2.top) < 1 && b1.height >= 44 && b2.height >= 44 && layout.banner.left >= 0 && layout.banner.right <= layout.width,
    );
    await shot(page, `E13-phone-${theme}`);
    await context.close();
  }

  // E14 — /connexion on a phone.
  {
    const { context, page } = await open({ geo: EU, viewport: phone, label: "E14" });
    await goto(page, "/connexion");
    const submit = page.locator(".signin-submit").first();
    if (!(await submit.count())) notRun("E14", "/connexion shows no sign-in form here (accounts off?)");
    else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const boxes = await page.evaluate(() => {
        const s = document.querySelector(".signin-submit")?.getBoundingClientRect();
        const b = document.getElementById("consent-title")?.closest("section")?.getBoundingClientRect();
        return { submit: s?.toJSON(), banner: b?.toJSON(), height: window.innerHeight };
      });
      const clear = boxes.submit && boxes.banner && boxes.submit.bottom <= boxes.banner.top;
      await shot(page, "E14-connexion-phone");
      check("E14", "the sign-in button is clear of the banner at first view", boxes, clear);
    }
    await context.close();
  }

  // E16 — no storage.
  {
    const { context, page, measured } = await open({
      geo: EU,
      label: "E16",
      init: () => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
      },
    });
    const errors = consoleLog.length;
    await goto(page, "/clubs/");
    const shown = await visible(page);
    if (shown) await banner(page).getByRole("button", { name: "Refuser" }).click().catch(() => {});
    await page.waitForTimeout(500);
    check("E16", "localStorage refused: banner shows, nothing measured, no page error", { shown, measured, errors: consoleLog.slice(errors) }, shown && measured.length === 0 && consoleLog.length === errors);
    await context.close();
  }

  check("X1", "no page error", consoleLog.length ? consoleLog.slice(0, 5) : "none", consoleLog.length === 0);
} catch (error) {
  check("RUN", "the run completes", `error: ${error.message.split("\n")[0]}`, false);
} finally {
  await browser.close();
  const failed = results.filter((r) => r.ok === false).length;
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        subject: "Consent banner for visitors in Europe: the Vercel measurement waits for « Accepter »",
        observed: new Date().toISOString(),
        base,
        rerun: `node tests/e2e/consent.e2e.mjs ${base} ${out} ${replay}`,
        setup:
          "Chromium headless, fr-FR, Europe/Paris; desktop 1440×900, phone 390×844 (touch, ×2). The geolocation headers " +
          "(x-vercel-ip-continent, x-vercel-ip-country) are added to the site's own requests by the browser context, as " +
          "Vercel adds them. https://va.vercel-scripts.com/** answered empty (counted); the image copies routed to the replay. " +
          "Site server: NEXT_PUBLIC_API_ORIGIN=<replay>, NEON_AUTH_BASE_URL=http://127.0.0.1:4199/neondb/auth, " +
          "NEON_AUTH_COOKIE_SECRET of 32+ characters (for /connexion).",
        inputs: { key: KEY, measurement: String(MEASURE), EU, NA, RE },
        results,
        measurementRequests: requestLog,
        console: consoleLog,
        passed: results.filter((r) => r.ok === true).length,
        failed,
        notRun: results.filter((r) => r.ok === null).length,
      },
      null,
      2,
    ),
  );
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed, ${failed} failed — ${out}`);
  process.exitCode = failed ? 1 : 0;
}

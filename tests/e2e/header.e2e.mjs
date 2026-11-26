// E2E — the site header between the phone layout (640 px) and 1200 px: the menus keep their
// room and the search takes what is left (GitHub issue 109; mock-up validated by the owner on
// 24 Nov 2026). Before: with the account button in the header, the last menus ran under the
// search field (1 at 1024 px, 2 at 768 px, 3 at 700 px).
// Written before the implementation, against the real home page.
//
// Failure modes and expected outcomes:
//  H1 (every width) At each width from 641 to 1200 px (27 of them, both sides of every
//     breakpoint): the header is 56 px tall; the five menus are shown whole, each one answers
//     a pointer at its left edge, its middle and its right edge (nothing lies over it); the
//     last menu ends at least 12 px before the search; the header's parts and the actions
//     neither overlap nor leave the window; the page does not scroll sideways.
//  H2 (icon from 920 px) Since the bar's piste B (§ 76, 26 Nov 2026) the search is its icon at
//     every width from 641 px, 920 px and wider included (it was a field of 200 px at least
//     there before). From 1024 px the account button shows its label, under it the icon alone.
//  H3 (icon) From 641 px the search is its icon: a 34 px round, no field text, no
//     shortcut hint, still named « Rechercher un joueur, un club ou une compétition ».
//     a. A click opens the field beside the menus: at least 220 px wide, focused, inside
//        the window, right of the logo; the menus stay, opaque, 8 px left of it at least (they
//        slide left or show their symbols, § 76.1); the theme and the account still answer a
//        pointer. Typed text gives the results panel, inside the window.
//     b. The clear button empties the field and leaves it open and focused.
//     c. Escape closes the results first (the field stays), then the field: the icon again,
//        the menus back, the text gone.
//     d. A click elsewhere closes it; the typed text is kept for the next opening and the
//        closed search shows the icon alone (no clear button over it).
//     e. « / » opens it from the keyboard.
//     f. Tab leaves it for the theme button and it closes.
//  H4 (first menu) From 641 to 760 px the first menu reads « Accueil », from 761 px « Vue
//     d’ensemble »; it has that one name for a screen reader, leads to the path « / » (the
//     link keeps the page's season and scope in its query) and is the current page on the
//     home page.
//  H5 (touch) On a touch screen (768, 641 and 1024 px wide): the logo, the search, the theme
//     and the account each answer a finger on 44 × 44 px around their middle (the four corners
//     of that square and its middle reach the control), their look unchanged (34 px icons, the
//     logo's link 40 px); every menu is at least 44 px wide and answers a finger 21 px above
//     and below its middle (its pill is drawn 34 px tall, § 76); a tap 4 px outside the search
//     icon's 34 px round opens the search. Focused, the field is still drawn 34 px tall: 3 px above and 3 px below it the
//     screen shows the header's own background.
//  H6 (menus) At 700 and 768 px a menu opens under its button when the mouse comes over it
//     (as before), inside the window, and its first entry answers a pointer; on a touch
//     screen 768 px wide a tap on the menu opens it the same way.
//  H7 (ends) At 640 px the phone layout is untouched: no menus and no search in the header,
//     the tab bar shown. At 1365 px the search is its icon and the five menus are whole, in
//     the bar's middle (§ 76).
//  X1 No page error and no console error on the home page.
//
// The account button must be in the header (as in production): a local server shows it only
// with NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET set. Run against a local front
// (NEXT_PUBLIC_API_ORIGIN and ORION_API_ORIGIN = the public API) or the public site:
//   PLAYWRIGHT_CORE=<playwright-core> node tests/e2e/header.e2e.mjs <base url> <evidence dir>
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots; exit code 1
// when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "header-e2e")] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });

function playwright() {
  const roots = [
    process.env.PLAYWRIGHT_CORE,
    ...(() => {
      const npx = path.join(os.homedir(), ".npm/_npx");
      return existsSync(npx)
        ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules/playwright-core"))
        : [];
    })(),
  ].filter((p) => p && existsSync(path.join(p, "package.json")));
  if (!roots.length) throw new Error("playwright-core not found: set PLAYWRIGHT_CORE");
  return createRequire(import.meta.url)(roots[0]);
}

const WIDTHS = [641, 660, 667, 680, 700, 720, 744, 760, 761, 768, 800, 820, 860, 900, 919, 920, 960, 1000, 1023, 1024, 1031, 1080, 1119, 1120, 1180, 1181, 1200];
const MENUS = ["Compétitions", "Équipes", "Joueurs", "Calendrier"];
const SEARCH_NAME = "Rechercher un joueur, un club ou une compétition";
const QUERY = "mbappe";
const results = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "ok  " : "FAIL"} ${id} — ${expected} — ${typeof actual === "string" ? actual : JSON.stringify(actual)}`);
};

/** The header as a pointer finds it at the current width. */
const header = (page) =>
  page.evaluate(() => {
    const top = document.querySelector(".topbar");
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const round = (v) => Math.round(v * 10) / 10;
    const shown = (e) => Boolean(e) && box(e).width > 0 && getComputedStyle(e).visibility !== "hidden";
    const reaches = (e, x, y) => {
      const at = document.elementFromPoint(x, y);
      return Boolean(at && (at === e || e.contains(at)));
    };
    const nav = top.querySelector(".main-nav");
    const menus = shown(nav) ? [...nav.querySelectorAll(":scope > a, :scope > .nav-menu > button")].filter(shown) : [];
    const field = top.querySelector(".global-search-field");
    const input = top.querySelector(".global-search input");
    const actions = top.querySelector(".topbar-actions");
    const parts = [...top.children].filter(shown).map(box);
    const inActions = [...actions.children].filter(shown).map((c) => (c.classList.contains("global-search") ? box(field) : box(c)));
    const overlap = (list) => {
      let worst = -Infinity;
      for (let i = 1; i < list.length; i++) worst = Math.max(worst, list[i - 1].right - list[i].left);
      return round(worst);
    };
    const account = top.querySelector(".account-entry");
    const label = account?.querySelector(".account-entry-label");
    const hint = top.querySelector(".global-search-hint");
    const clear = top.querySelector(".global-search-clear");
    return {
      height: round(box(top).height),
      menus: menus.map((m) => {
        const b = box(m), y = (b.top + b.bottom) / 2;
        return { text: m.innerText.trim(), width: round(b.width), height: round(b.height), finger: [y - 21, y + 21].every((yy) => reaches(m, (b.left + b.right) / 2, yy)), reached: [b.left + 2, (b.left + b.right) / 2, b.right - 2].every((x) => reaches(m, x, y)) };
      }),
      menusOpacity: shown(nav) ? Number(getComputedStyle(nav).opacity) : null,
      room: menus.length && shown(field) ? round(box(field).left - box(menus.at(-1)).right) : null,
      search: shown(field)
        ? { left: round(box(field).left), right: round(box(field).right), top: round(box(field).top), bottom: round(box(field).bottom), width: round(box(field).width), height: round(box(field).height), text: Number(getComputedStyle(input).opacity) > 0.5, name: input.getAttribute("aria-label"), hint: shown(hint), clear: shown(clear), focused: document.activeElement === input, value: input.value }
        : null,
      account: account ? { width: round(box(account).width), label: Boolean(label && box(label).width > 20) } : null,
      themeReached: (() => { const t = top.querySelector(".theme-toggle"), b = box(t); return reaches(t, (b.left + b.right) / 2, (b.top + b.bottom) / 2); })(),
      accountReached: account ? (() => { const b = box(account); return reaches(account, (b.left + b.right) / 2, (b.top + b.bottom) / 2); })() : null,
      brandRight: round(box(top.querySelector(".brand")).right),
      partsOverlap: overlap(parts),
      actionsOverlap: inActions.length > 1 ? overlap(inActions) : 0,
      right: round(Math.max(...parts.map((b) => b.right), ...inActions.map((b) => b.right))),
      window: innerWidth,
      sideways: document.documentElement.scrollWidth - innerWidth,
      active: document.activeElement?.className || document.activeElement?.tagName,
    };
  });

/** Whether the four corners and the middle of a 44 px square around a control reach it. */
const tapArea = (page, selector) =>
  page.evaluate((selector) => {
    const e = document.querySelector(selector);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const reaches = (x, y) => {
      const at = document.elementFromPoint(x, y);
      return Boolean(at && (at === e || e.contains(at)));
    };
    const points = [[0, 0], [-21, -21], [21, -21], [-21, 21], [21, 21]];
    return { look: [Math.round(r.width), Math.round(r.height)], reached: points.filter(([dx, dy]) => reaches(cx + dx, cy + dy)).length, of: points.length, middle: [Math.round(cx), Math.round(cy)] };
  }, selector);

/** The colours the screen shows at some points of the page (CSS pixels). */
const colours = async (page, points) => {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([shot, points]) => {
    const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
    const picture = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = picture.width; canvas.height = picture.height;
    const g = canvas.getContext("2d");
    g.drawImage(picture, 0, 0);
    const scale = picture.width / innerWidth;
    return points.map(([x, y]) => [...g.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data].slice(0, 3).join(","));
  }, [shot, points]);
};
/** Around a focused field: the header's background, above the field, inside it, below it. */
const aroundField = async (page, field) => {
  const x = (field.left + field.right) / 2;
  const [ground, above, inside, below] = await colours(page, [[6, 6], [x, field.top - 3], [x, (field.top + field.bottom) / 2 + 9], [x, field.bottom + 3]]);
  return { ground, above, inside, below, drawnAsBefore: above === ground && below === ground && inside !== ground };
};

/** The open menu's panel: where it is, its entries, whether the first one answers a pointer. */
const menuPanel = (page) =>
  page.evaluate(() => {
    // One panel for every menu since § 76, drawn while open.
    const p = document.querySelector(".topbar .nav-panel.is-open");
    if (!p) return null;
    const r = p.getBoundingClientRect(), first = p.querySelector(".nav-menu-item"), f = first.getBoundingClientRect();
    const at = document.elementFromPoint((f.left + f.right) / 2, (f.top + f.bottom) / 2);
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), entries: p.querySelectorAll(".nav-menu-item").length, firstReached: Boolean(at && (at === first || first.contains(at))) };
  });
const menuOpen = (menu, width) => menu && menu.left >= 0 && menu.right <= width && menu.top >= 55 && menu.entries >= 2 && menu.firstReached;

const { chromium } = playwright();
const browser = await chromium.launch();
const consoleLog = [];
const open = async (options, name) => {
  const context = await browser.newContext({ locale: "fr-FR", ...options });
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleLog.push(`${name} pageerror ${e.message.split("\n")[0]}`));
  page.on("console", (m) => { if (m.type() === "error") consoleLog.push(`${name} console ${m.text().slice(0, 200)}`); });
  // A development server's own connection never goes quiet: wait for the header's parts instead.
  await page.goto(base + "/", { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0));
  // The account button takes its final state once the session is read.
  await page.waitForSelector(".topbar .account-entry-out, .topbar .account-entry-in", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
};
const resize = async (page, width, height = 900) => {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
};
// « Elsewhere » is the page's left gutter (3, 420): no link there.
const closed = (h) => h.search && Math.abs(h.search.width - 34) <= 1 && Math.abs(h.search.height - 34) <= 1 && !h.search.text;
const opened = (h) => h.search && h.search.width >= 220 && h.search.text && h.search.focused;

try {
  const page = await open({ viewport: { width: 1365, height: 900 } }, "desktop");
  const accountButton = await page.evaluate(() => Boolean(document.querySelector(".topbar .account-entry")));
  check("H0", "the account button is in the header (the setup this test needs)", { accountButton }, accountButton);

  // ---- H1, H2, H3 (closed), H4: every width
  const sweep = [];
  for (const width of WIDTHS) {
    await resize(page, width);
    sweep.push({ width, ...(await header(page)) });
    await page.locator(".topbar").screenshot({ path: path.join(out, `header-${width}.png`) });
  }
  const brief = (h) => ({ width: h.width, height: h.height, menus: h.menus.map((m) => m.text).join(" · "), covered: h.menus.filter((m) => !m.reached).map((m) => m.text), room: h.room, partsOverlap: h.partsOverlap, actionsOverlap: h.actionsOverlap, right: h.right, sideways: h.sideways });
  const whole = (h) =>
    h.height === 56 && h.menus.length === 5 && h.menus.every((m) => m.reached) && h.menus.slice(1).every((m, i) => m.text === MENUS[i]) &&
    h.room >= 12 && h.partsOverlap <= 0 && h.actionsOverlap <= 0 && h.right <= h.window && h.sideways <= 0;
  const brokenAt = sweep.filter((h) => !whole(h));
  check("H1", `at each of ${WIDTHS.length} widths from 641 to 1200 px: header 56 px, five whole menus that answer a pointer, 12 px at least before the search, nothing overlapping or leaving the window`,
    brokenAt.length ? { failing: brokenAt.map(brief) } : { widths: WIDTHS.length, leastRoom: Math.min(...sweep.map((h) => h.room)), at: sweep.reduce((a, b) => (b.room < a.room ? b : a)).width },
    brokenAt.length === 0);

  const fields = sweep.filter((h) => h.width >= 920);
  check("H2a", "from 920 px too the search is its icon (piste B, § 76)",
    fields.map((h) => `${h.width}: ${h.search?.width}`).join(", "),
    fields.every(closed));
  check("H2b", "the account button shows its label from 1024 px, the icon alone under it",
    sweep.map((h) => `${h.width}: ${h.account?.label ? "label" : "icon"} ${h.account?.width}`).join(", "),
    sweep.every((h) => h.account && h.account.label === (h.width >= 1024) && (h.width >= 1024 ? h.account.width > 100 : Math.abs(h.account.width - 34) <= 1)));

  const icons = sweep;
  check("H3", `from 641 px the search is its icon: a 34 px square, no field text, no shortcut hint, named « ${SEARCH_NAME} »`,
    icons.map((h) => `${h.width}: ${h.search?.width}×${h.search?.height}${h.search?.text ? " text" : ""}${h.search?.hint ? " hint" : ""}`).join(", "),
    icons.every((h) => closed(h) && !h.search.hint && h.search.name === SEARCH_NAME));

  const firstNames = sweep.map((h) => [h.width, h.menus[0]?.text]);
  check("H4a", "the first menu reads « Accueil » from 641 to 760 px and « Vue d’ensemble » from 761 px",
    firstNames.map(([w, t]) => `${w}: ${t}`).join(", "),
    firstNames.every(([w, t]) => t === (w <= 760 ? "Accueil" : "Vue d’ensemble")));
  const named = [];
  for (const [width, name, other] of [[700, "Accueil", "Vue d’ensemble"], [768, "Vue d’ensemble", "Accueil"]]) {
    await resize(page, width);
    const nav = page.locator(".topbar .main-nav");
    const link = nav.getByRole("link", { name, exact: true });
    const found = await link.count();
    named.push({ width, name, found, other: await nav.getByRole("link", { name: other }).count(), path: found ? new URL(await link.first().getAttribute("href"), base).pathname : null, current: found ? await link.first().getAttribute("aria-current") : null });
  }
  check("H4b", "for a screen reader the first menu has the one name it shows, leads to « / » and is the current page", named,
    named.every((n) => n.found === 1 && n.other === 0 && n.path === "/" && n.current === "page"));

  // ---- H3a–f: the search opened from its icon
  for (const width of [641, 768, 919]) {
    await resize(page, width);
    const input = page.locator(".topbar .global-search input");
    await input.click();
    await page.waitForTimeout(450);
    const empty = await header(page);
    await page.locator(".topbar").screenshot({ path: path.join(out, `search-open-${width}.png`) });
    await page.keyboard.type(QUERY, { delay: 25 });
    await page.waitForSelector(".topbar .global-search-panel", { timeout: 15000 }).catch(() => {});
    await page.waitForSelector(".topbar .global-search-option", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    const panel = await page.evaluate(() => {
      const p = document.querySelector(".topbar .global-search-panel");
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), options: p.querySelectorAll(".global-search-option").length };
    });
    const typed = await header(page);
    await page.screenshot({ path: path.join(out, `search-results-${width}.png`), clip: { x: 0, y: 0, width, height: 420 } });
    check(`H3a-${width}`, `${width} px: a click opens the field beside the menus (220 px at least, focused, inside the window, right of the logo), the menus stay, 8 px left of it, the theme and the account answer; « ${QUERY} » gives the results panel inside the window`,
      { field: empty.search, brandRight: empty.brandRight, menusOpacity: empty.menusOpacity, room: empty.room, menus: empty.menus.length, theme: empty.themeReached, account: empty.accountReached, actionsOverlap: empty.actionsOverlap, sideways: typed.sideways, panel },
      opened(empty) && empty.search.left >= empty.brandRight && empty.search.right <= empty.window && empty.menusOpacity === 1 && empty.menus.length === 5 && empty.room >= 8 && empty.themeReached && empty.accountReached && empty.actionsOverlap <= 0 && empty.height === 56 &&
        typed.sideways <= 0 && panel && panel.left >= 0 && panel.right <= width && panel.top >= 34);

    // b. the clear button
    await page.locator(".topbar .global-search-clear").click();
    await page.waitForTimeout(200);
    const cleared = await header(page);
    check(`H3b-${width}`, `${width} px: the clear button empties the field and leaves it open and focused`, cleared.search, opened(cleared) && cleared.search.value === "");

    // c. Escape, twice
    await page.keyboard.type(QUERY, { delay: 25 });
    await page.waitForSelector(".topbar .global-search-panel", { timeout: 15000 }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const once = { ...(await header(page)), panel: await page.locator(".topbar .global-search-panel").count() };
    await page.keyboard.press("Escape");
    // The field and the menus move for 0.28 s (§ 76.1).
    await page.waitForTimeout(450);
    const twice = await header(page);
    check(`H3c-${width}`, `${width} px: Escape closes the results and keeps the field; Escape again closes the field: the icon, the menus back, the text gone`,
      { once: { panel: once.panel, field: once.search }, twice: { field: twice.search, menusOpacity: twice.menusOpacity, menus: twice.menus.length } },
      once.panel === 0 && opened(once) && closed(twice) && !twice.search.focused && twice.search.value === "" && twice.menusOpacity === 1 && twice.menus.length === 5 && twice.menus.every((m) => m.reached));

    // d. a click elsewhere
    await input.click();
    await page.keyboard.type("abc", { delay: 25 });
    await page.mouse.click(3, 420);
    await page.waitForTimeout(450);
    const away = await header(page);
    await input.click();
    await page.waitForTimeout(450);
    const again = await header(page);
    check(`H3d-${width}`, `${width} px: a click elsewhere closes it (the icon alone, no clear button, the menus back); the text is kept for the next opening`,
      { away: { field: away.search, menusOpacity: away.menusOpacity }, again: again.search },
      closed(away) && !away.search.clear && away.menusOpacity === 1 && away.menus.every((m) => m.reached) && opened(again) && again.search.value === "abc");
    await page.locator(".topbar .global-search-clear").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // e. « / »
    await page.mouse.click(3, 420);
    await page.keyboard.press("/");
    await page.waitForTimeout(250);
    const slash = await header(page);
    check(`H3e-${width}`, `${width} px: « / » opens the search`, slash.search, opened(slash) && slash.search.value === "");

    // f. Tab leaves it
    await page.keyboard.press("Tab");
    await page.waitForTimeout(450);
    const tabbed = await header(page);
    check(`H3f-${width}`, `${width} px: Tab leaves the search for the theme button and the search closes`,
      { active: tabbed.active, field: tabbed.search, menusOpacity: tabbed.menusOpacity },
      /theme-toggle/.test(String(tabbed.active)) && closed(tabbed) && tabbed.menusOpacity === 1);
    await page.mouse.click(3, 420);
  }

  // ---- H6: a menu still opens
  for (const width of [700, 768]) {
    await resize(page, width);
    // A mouse opens a menu by coming over it. A menu that cannot be reached is a failed
    // check, not a stopped run.
    await page.mouse.move(3, 420);
    await page.locator(".topbar .main-nav .nav-menu > button", { hasText: "Joueurs" }).hover({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const menu = await menuPanel(page);
    await page.screenshot({ path: path.join(out, `menu-${width}.png`), clip: { x: 0, y: 0, width, height: 260 } });
    check(`H6-${width}`, `${width} px: « Joueurs » opens under its button when the mouse comes over it, inside the window, its first entry answers a pointer`, menu, menuOpen(menu, width));
    await page.mouse.move(3, 420);
    await page.waitForTimeout(300);
  }

  // ---- H7: the two ends
  await resize(page, 640);
  const phone = await page.evaluate(() => {
    const shown = (s) => { const e = document.querySelector(s); return Boolean(e && e.getBoundingClientRect().width > 0); };
    return { menus: shown(".topbar .main-nav"), search: shown(".topbar .global-search"), tabbar: shown(".tabbar"), sideways: document.documentElement.scrollWidth - innerWidth };
  });
  check("H7a", "640 px: the phone layout, no menus and no search in the header, the tab bar shown", phone, !phone.menus && !phone.search && phone.tabbar && phone.sideways <= 0);
  await resize(page, 1365);
  const wide = await header(page);
  check("H7b", "1365 px: the search is its icon, the five menus whole before it", { field: wide.search?.width, room: wide.room, first: wide.menus[0]?.text },
    closed(wide) && wide.room >= 12 && wide.menus.length === 5 && wide.menus[0].text === "Vue d’ensemble");
  await page.context().close();

  // ---- H5: touch
  for (const width of [768, 641, 1024]) {
    const touch = await open({ viewport: { width, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, `touch-${width}`);
    await touch.waitForTimeout(300);
    const coarse = await touch.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const areas = {};
    for (const [name, selector] of [["logo", ".topbar .brand"], ["search", ".topbar .global-search input"], ["theme", ".topbar .theme-toggle"], ["account", ".topbar .account-entry"]])
      areas[name] = await tapArea(touch, selector);
    const h = await header(touch);
    await touch.locator(".topbar").screenshot({ path: path.join(out, `touch-${width}.png`) });
    const iconMode = true; // the search is its icon at every width since § 76
    const looks = areas.logo && areas.theme && areas.account && areas.logo.look.join() === "40,40" && areas.theme.look.join() === "34,34" && (width >= 1024 ? areas.account.look[1] === 34 : areas.account.look.join() === "34,34") && (iconMode ? closed(h) : h.search.height === 34);
    check(`H5a-${width}`, `touch, ${width} px: the logo, the search, the theme and the account answer on 44 × 44 px around their middle; their look is unchanged; every menu is 44 px wide at least and answers a finger 21 px above and below its middle`,
      { coarse, areas, searchLook: h.search && [h.search.width, h.search.height], menus: h.menus.map((m) => `${m.text} ${m.width}×${m.height}`) },
      coarse && Object.values(areas).every((a) => a && a.reached === a.of) && looks && h.menus.length === 5 && h.menus.every((m) => m.width >= 44 && m.finger) && whole({ ...h, width }));
    if (iconMode) {
      // A finger 4 px outside the icon's square, inside its 44 px.
      const [cx, cy] = areas.search.middle;
      await touch.touchscreen.tap(cx - 21, cy + 21);
      await touch.waitForTimeout(300);
      const tapped = await header(touch);
      await touch.locator(".topbar").screenshot({ path: path.join(out, `touch-open-${width}.png`) });
      const drawn = await aroundField(touch, tapped.search);
      check(`H5b-${width}`, `touch, ${width} px: a tap 4 px outside the icon's square opens the search; the field is drawn 34 px tall, the header's background above and below it`, { field: tapped.search, drawn },
        opened(tapped) && tapped.search.right <= tapped.window && tapped.search.height === 34 && drawn.drawnAsBefore);
    } else {
      // A finger on the field, 4 px above its 34 px, inside its 44 px.
      const [cx, cy] = areas.search.middle;
      await touch.touchscreen.tap(cx, cy - 21);
      await touch.waitForTimeout(300);
      const tapped = await header(touch);
      await touch.locator(".topbar").screenshot({ path: path.join(out, `touch-open-${width}.png`) });
      const drawn = await aroundField(touch, tapped.search);
      check(`H5b-${width}`, `touch, ${width} px: a tap 4 px above the field focuses it; the field is drawn 34 px tall, the header's background above and below it`, { field: tapped.search, drawn },
        tapped.search.focused && tapped.search.height === 34 && drawn.drawnAsBefore);
    }
    if (width === 768) {
      // H6 on touch: a tap elsewhere closes the search, a tap on a menu opens it.
      await touch.touchscreen.tap(3, 420);
      await touch.waitForTimeout(250);
      await touch.locator(".topbar .main-nav .nav-menu > button", { hasText: "Équipes" }).tap({ timeout: 5000 }).catch(() => {});
      await touch.waitForTimeout(300);
      const menu = await menuPanel(touch);
      await touch.screenshot({ path: path.join(out, "touch-menu-768.png"), clip: { x: 0, y: 0, width, height: 260 } });
      check("H6-touch-768", "touch, 768 px: a tap on « Équipes » opens its menu, inside the window, its first entry answers", menu, menuOpen(menu, width));
    }
    await touch.context().close();
  }

  check("X1", "no page error and no console error", consoleLog.length ? consoleLog.slice(0, 5).join(" | ") : "none", consoleLog.length === 0);
} catch (error) {
  // A step that stops the run is a failure, never a shorter list of passes.
  check("RUN", "the run completes", `error: ${error.message.split("\n")[0]}`, false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        subject: "Header between 641 and 1200 px: the menus keep their room, the search takes what is left (a field down to 920 px, its icon under it)",
        observed: new Date().toISOString(),
        base,
        rerun: `PLAYWRIGHT_CORE=<playwright-core> node tests/e2e/header.e2e.mjs ${base} ${out}`,
        setup: "Chromium headless, fr-FR, dark theme, the home page; a mouse at the widths listed in inputs.widths (height 900), then a touch screen (×2) 768, 641 and 1024 px wide. The header must carry the account button as in production: a local server needs NEON_AUTH_BASE_URL=http://127.0.0.1:9 with any NEON_AUTH_COOKIE_SECRET of 32 characters, and ORION_API_ORIGIN and NEXT_PUBLIC_API_ORIGIN set to the public API (the search results come from it).",
        inputs: { page: "/", widths: WIDTHS, opened: [641, 768, 919], touch: [768, 641, 1024], query: QUERY },
        results,
        console: consoleLog,
        passed: results.length - failed,
        failed,
      },
      null,
      2,
    ),
  );
  console.log(`${results.length - failed}/${results.length} passed — ${out}`);
  process.exitCode = failed ? 1 : 0;
}

// E2E — crests and portraits (Media) follow the avatar rules compared with Geist on 20 Nov 2026.
// Written before the implementation, against the real pages (home, club, club « Style de jeu »,
// player, competition, match), on a desktop (1365×900) and an iPhone 16 (393×852).
//
// Failure modes and expected outcomes:
//  M1 (loading ≠ missing) Image responses held: every Media still loading shows no letters
//     (neutral shell). Today the initials show while the image loads, then the photo replaces them.
//  M2 (initials) Image responses refused: every Media ends on its fallback, whose text is one or
//     two upper-case letters or digits, or nothing (neutral). Never « — », « ? » or punctuation.
//  M3 (scale) Real images: every visible Media is square and its side is one of the scale's sizes
//     (dashboard/frontend/AGENTS.md, « Sizes »). Today about 27 different sides.
//  M4 (one component) Each club mark of « Style de jeu » is a Media (lazy, queued, decoded before
//     it shows), not the second image component the club pages had.
//  M5 (accessible name) A crest shown without its name beside it (the « Style de jeu » marks)
//     carries the club's name for screen readers: role="img" and aria-label = the club's name.
//  M6 (group) The home's podium stack is one AvatarGroup: three slots, each overlapping the
//     previous one by the same amount, hidden from screen readers because the names follow in text.
//  X1 No page error and no console error with real images.
//  X2 Phone: nothing makes the page scroll sideways.
//
// Run against a local front (NEXT_PUBLIC_API_ORIGIN = the public API) or the public site:
//   node tests/e2e/media.e2e.mjs <base url> <evidence dir>
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots per page,
// desktop and phone; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "media-e2e")] =
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
function shell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dir = existsSync(cache)
    ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().at(-1)
    : null;
  if (!dir) return undefined;
  const sub = readdirSync(path.join(cache, dir)).find((d) => d.startsWith("chrome-"));
  return path.join(cache, dir, sub, "chrome-headless-shell");
}

// The scale written in dashboard/frontend/AGENTS.md (checked against the code by
// tests/media-initials.test.mjs).
const SCALE = [16, 20, 24, 28, 32, 40, 48, 64, 96];
const results = [],
  consoleLog = [],
  reloads = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", typeof actual === "string" ? actual : JSON.stringify(actual));
};
const { chromium } = playwright();
const browser = await chromium.launch({ executablePath: shell() });
const desktop = { width: 1365, height: 900 },
  phone = { width: 393, height: 852 };

async function open(viewport, url, images = "real") {
  const context = await browser.newContext({
    locale: "fr-FR",
    viewport,
    ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  if (images !== "real")
    await context.route("**/*", (route) => {
      if (route.request().resourceType() !== "image") return route.continue();
      if (images === "refuse") return route.abort("failed");
      // "hold": never answered while the page is open.
    });
  const page = await context.newPage();
  if (images === "real") {
    page.on("console", (m) => m.type() === "error" && consoleLog.push(`[${viewport.width}] ${url} ${m.text()}`));
    page.on("pageerror", (e) => consoleLog.push(`[${viewport.width}] ${url} pageerror ${e.message}`));
  }
  // Every page under test shows crests or portraits: wait for the first one, and reload once
  // when the page came without its data (the public API can answer late); the reload is logged.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) reloads.push(`${viewport.width} ${images} ${url}`);
    await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page
      .locator('main[data-page-ready="true"], main[data-server-home]')
      .first()
      .waitFor({ timeout: 90000 });
    const shown = await page
      .locator("[data-page-media]")
      .first()
      .waitFor({ state: "attached", timeout: 20000 })
      .then(() => true, () => false);
    if (shown) break;
  }
  await page.waitForTimeout(images === "real" ? 2500 : 4000);
  return { page, close: () => context.close() };
}
const mediaStates = (page) =>
  page.locator("[data-page-media]").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect(),
        fallback = n.querySelector(".image-fallback");
      return {
        state: n.dataset.mediaState,
        text: fallback ? fallback.textContent.trim() : null,
        w: Math.round(r.width * 2) / 2,
        h: Math.round(r.height * 2) / 2,
        visible: r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden",
        where: (n.closest("[class]")?.parentElement?.className || "").toString().slice(0, 60),
        cls: n.className.toString().slice(0, 60),
      };
    }),
  );

try {
  // Pages: the home, and the first club, player, competition and match it links to.
  const hrefs = async (url) => {
    const { page, close } = await open(desktop, url);
    const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    await close();
    return links;
  };
  const links = await hrefs("/");
  const first = (list, re) => list.find((h) => re.test(h));
  const club = first(links, /^\/clubs\/?\?.*\bid=t_/),
    match = first(links, /^\/matchs\/?\?.*\bid=m_/);
  const league = match && new URLSearchParams(match.split("?")[1]).get("competition");
  const competition =
    first(links, /^\/competitions\/?\?.*\bid=l_/) || (league && `/competitions?id=${league}`);
  // The home links no player while the podium is hidden: a match's line-ups do.
  const playerLink = /^\/joueurs\/?\?.*\bid=p_/;
  let player = first(links, playerLink);
  for (const url of [match, club].filter(Boolean)) {
    if (player) break;
    player = first(await hrefs(url), playerLink);
  }
  const pages = [
    ["home", "/"],
    ["club", club],
    ["club-style", club && `${club}${club.includes("?") ? "&" : "?"}clubView=style`],
    ["player", player],
    ["competition", competition],
    ["match", match],
  ].filter(([, url]) => url);
  check("P0", "home links to a club, a player, a competition and a match", pages.map(([n, u]) => `${n} ${u}`).join(" | "), pages.length === 6);

  for (const viewport of [desktop, phone]) {
    const tag = viewport.width < 600 ? "phone" : "desktop";
    for (const [name, url] of pages) {
      // M1: held images.
      try {
        const { page, close } = await open(viewport, url, "hold");
        const all = await mediaStates(page);
        const loading = all.filter((m) => m.state === "loading");
        const lettered = loading.filter((m) => m.text);
        check(`M1-${tag}-${name}`, "Media loading: no letters", `${loading.length} loading, ${lettered.length} with letters${lettered[0] ? ` (e.g. « ${lettered[0].text} »)` : ""}`, loading.length > 0 && lettered.length === 0);
        await close();
      } catch (error) {
        check(`M1-${tag}-${name}`, "the step runs", `error: ${error.message.split("\n")[0]}`, false);
      }
      // M2: refused images.
      try {
        const { page, close } = await open(viewport, url, "refuse");
        await page.waitForTimeout(2000);
        const all = (await mediaStates(page)).filter((m) => m.text !== null);
        const bad = all.filter((m) => !/^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{0,2}$/u.test(m.text));
        check(`M2-${tag}-${name}`, "fallback text: 0–2 upper-case letters or digits", `${all.length} fallbacks, ${bad.length} bad${bad.length ? ": " + [...new Set(bad.map((m) => m.text))].slice(0, 8).join(", ") : ""}`, all.length > 0 && bad.length === 0);
        if (tag === "desktop" && name === "competition") await page.screenshot({ path: path.join(out, `${tag}-${name}-fallback.png`) });
        await close();
      } catch (error) {
        check(`M2-${tag}-${name}`, "the step runs", `error: ${error.message.split("\n")[0]}`, false);
      }
      // M3, M4, M5, M6, X1, X2: real images.
      try {
        const { page, close } = await open(viewport, url, "real");
        const visible = (await mediaStates(page)).filter((m) => m.visible);
        const off = visible.filter((m) => !SCALE.includes(m.w) || Math.abs(m.w - m.h) > 0.5);
        const sides = [...new Set(visible.map((m) => m.w))].sort((a, b) => a - b);
        check(`M3-${tag}-${name}`, `every visible Media square, side in ${SCALE.join("/")}`, `${visible.length} visible, sides ${sides.join("/")}; ${off.length} off${off[0] ? ` (e.g. ${off[0].w}×${off[0].h} ${off[0].cls})` : ""}`, visible.length > 0 && off.length === 0);
        if (name === "club-style") {
          const marks = await page.locator("[data-club]").evaluateAll((nodes) =>
            nodes.map((n) => ({
              title: n.getAttribute("title") || "",
              media: Boolean(n.querySelector("[data-page-media]")),
              role: n.querySelector('[role="img"]')?.getAttribute("aria-label") || "",
            })),
          );
          const named = marks.filter((m) => m.title.includes(" : "));
          check(`M4-${tag}`, "each « Style de jeu » mark is a Media", `${named.length} marks, ${named.filter((m) => m.media).length} Media`, named.length > 0 && named.every((m) => m.media));
          check(`M5-${tag}`, "each mark: role=img, aria-label = club name", `${named.filter((m) => m.role && m.title.startsWith(m.role + " : ")).length}/${named.length} named${named[0] ? ` (e.g. « ${named[0].role} » for « ${named[0].title} »)` : ""}`, named.length > 0 && named.every((m) => m.role && m.title.startsWith(m.role + " : ")));
        }
        if (name === "home") {
          const group = await page.locator("[data-avatar-group]").first().evaluate((g) => {
            const slots = [...g.children].map((c) => c.getBoundingClientRect());
            const steps = slots.slice(1).map((r, i) => Math.round((slots[i].right - r.left) * 2) / 2);
            return { slots: slots.length, steps, hidden: g.getAttribute("aria-hidden"), text: g.parentElement.textContent.replace(/\s+/g, " ").trim().slice(0, 80) };
          }).catch(() => null);
          check(`M6-${tag}`, "home podium = one AvatarGroup: 3 slots, equal overlap, aria-hidden, names in text", group || "no [data-avatar-group]", group && group.slots === 3 && group.steps.length === 2 && group.steps[0] > 0 && group.steps[0] === group.steps[1] && group.hidden === "true" && /En tête du classement|Podium à révéler/.test(group.text));
        }
        if (tag === "phone") {
          const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          check(`X2-${name}`, "no sideways scroll", `${wide}px wider than the screen`, wide <= 0);
        }
        await page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
        await close();
      } catch (error) {
        check(`M3-${tag}-${name}`, "the step runs", `error: ${error.message.split("\n")[0]}`, false);
      }
    }
  }
  check("X1", "no page or console error with real images", consoleLog.length ? consoleLog.slice(0, 5).join(" | ") : "none", consoleLog.length === 0);
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
        subject: "Media: avatar rules (loading, initials, scale, one component, accessible name, group)",
        observed: new Date().toISOString(),
        base,
        rerun: `node tests/e2e/media.e2e.mjs ${base} ${out}`,
        setup: "Chromium headless shell, fr-FR; desktop 1365×900, phone 393×852 (touch, ×3). Images: held (M1), refused (M2), real (M3–M6, X1, X2).",
        scale: SCALE,
        results,
        console: consoleLog,
        reloads,
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

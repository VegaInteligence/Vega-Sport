// E2E — the club and nation pages, FAILURE_MODES § 86: piste B of the mock-up
// https://claude.ai/artifact/FV91Edw3nwSudoP9sTx5yS (hugo, 27 Nov 2026, 20 h 50 « on va partir sur la B aucun doute »), with
// « Favoris » for « Enregistrer » and the club's tabs centred. Written before the code, against Paris Saint-Germain and
// France.
//
// Failure modes and expected outcomes (dark theme, 1440 × 900 unless said):
//  H1  /clubs/?id=t_41iFW3: no identity column (no « Identité du club » aside); a head across the page
//      (`header.team-hero`) with the crest, the h1 « Paris Saint-Germain » and a line naming the league; its corners 22 px.
//  H2  At the head's right one track 40 px tall (±1) holding the season (« 2026/2027 ») and « Comparer à »; beside it
//      « Favoris » (32 px, round) and « Rapport », a link to /rapport/?id=t_41iFW3.
//  H3  Six figures in the head, in this order: the league (« Ligue 1 »), « Indice Vega », « Bilan », « Buts », « xPts »,
//      « Forme »; one row (same top ±2); the rank reads « 1er », « 2e »…; the form holds round marks (999 px).
//  H4  The tabs: a 999 px track centred on the page (its left and right gaps equal ±2), « Vue d’ensemble » filled (ivory).
//  H5  « Comparer à » is in the bar on the four referential tabs, gone on « Matchs et tendances »; its panel offers
//      « Europe · niveau comparable », « Europe · tous les clubs » and the league; choosing the league writes « Ligue 1 »
//      in the profile's reference line (« Centiles face aux 18 clubs du référentiel (Ligue 1) »).
//  H6  « Favoris »: a click turns it to « Dans vos favoris » (aria-pressed true); the head does not change height.
//  H7  The overview's last row: « Le club en bref » and « Compétitions et rang européen », the same height (±2), side by
//      side; the competitions (with « Ligue 1 ») in the second, the squad's « Âge pondéré » in the first.
//  H8  The overview's cards: 22 px corners, no border.
//  H9  No link or button ending in « → » in the page (a chart's axis keeps its arrow).
//  H10 Phone (390 × 844): no sideways scroll; the head's bar spans the head (±2) and cuts no word; the figures in two
//      columns; the tabs' track scrolls inside itself.
//  N1  /nations/?id=t_2ysHaw: the same head (h1 « France », a flag), six figures (« Classement Vega », « Elo Vega »,
//      « Bilan », « Buts », « Forme », then the last tournament); the overview no longer opens on the strip of key
//      figures (no « Rang Vega » cell); no identity column.
//  N2  The nation's tabs centred in their track; « Favoris » in the head.
//  S1  While the club is read the skeleton draws the head (`.team-hero-skeleton`), not a column.
//  X1  No page error.
//
//   node tests/e2e/team-pages.e2e.mjs <base url> <evidence dir> [replay origin]
// Against `next dev` or `next build` + `next start` of the site reading the public API, or a recorded replay of it
// (NEXT_PUBLIC_API_ORIGIN; with a replay origin, the requests the app sends to the API's own origin are answered by it).
// Writes evidence.json and screenshots; exit code 1 when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/team-pages-e2e", replay] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const CLUB = "t_41iFW3", NATION = "t_2ysHaw";

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const IVORY = "rgb(244, 241, 234)";
const near = (a, b, d = 2) => a != null && b != null && Math.abs(a - b) <= d;
const round = (v) => v === "999px" || parseFloat(v) >= 100;

const browser = await chromium.launch();
async function open(path, options = {}, before) {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-27T12:00:00Z" }));
    } catch {}
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  if (replay)
    await page.route("https://dngp6kh9jx2bl.cloudfront.net/**", async (route) => {
      const url = route.request().url().replace("https://dngp6kh9jx2bl.cloudfront.net", replay);
      try {
        const response = await fetch(url);
        await route.fulfill({
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" },
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch {
        await route.abort();
      }
    });
  if (before) await before(page);
  await page.goto(base + path, { waitUntil: "load", timeout: 120000 });
  return { context, page };
}
async function run(name, part) {
  try {
    await part();
  } catch (error) {
    check(`${name} stopped`, "the part runs to its end", String(error.message).split("\n")[0], false);
  }
}
const hideConsent = (page) => page.evaluate(() => document.querySelectorAll(".consent-live, .consent").forEach((n) => n.remove()));

/** The head, its bar, its figures and the tabs' track, as the page shows them. */
const readHead = (page) =>
  page.evaluate(() => {
    const box = (n) => (n ? n.getBoundingClientRect() : null);
    const hero = document.querySelector("header.team-hero");
    const bar = hero?.querySelector(".team-hero-bar");
    const figs = hero ? [...hero.querySelectorAll(".team-fig")] : [];
    const track = document.querySelector(".team-page [role='tablist']");
    const main = document.querySelector("#main .workspace") || document.querySelector(".workspace");
    const t = box(track), m = box(hero);
    const selected = track?.querySelector("[aria-selected='true']");
    const fav = [...(hero?.querySelectorAll("button") || [])].find((b) => /Favoris|Dans vos favoris/.test(b.textContent));
    const report = [...(hero?.querySelectorAll("a") || [])].find((a) => /Rapport/.test(a.textContent));
    return {
      column: Boolean(document.querySelector("aside[aria-label='Identité du club'], aside[aria-label='Identité de la sélection']")),
      hero: Boolean(hero),
      heroRadius: hero && getComputedStyle(hero).borderTopLeftRadius,
      heroHeight: m && Math.round(m.height),
      h1: hero?.querySelector("h1")?.textContent.trim(),
      crest: Boolean(hero?.querySelector(".team-hero-mark img, .team-hero-mark .crest, .team-hero-mark svg, .team-hero-mark span")),
      sub: hero?.querySelector(".team-hero-sub")?.textContent.replace(/\s+/g, " ").trim(),
      barHeight: bar && Math.round(box(bar.querySelector(".home-settings") || bar).height),
      segments: bar ? [...bar.querySelectorAll(".home-settings-segment")].map((n) => n.textContent.trim()) : [],
      fav: fav && { text: fav.textContent.trim(), pressed: fav.getAttribute("aria-pressed"), h: Math.round(box(fav).height), radius: getComputedStyle(fav).borderTopLeftRadius },
      report: report?.getAttribute("href"),
      figs: figs.map((n) => ({ label: n.querySelector("dt")?.textContent.trim(), value: n.querySelector("dd")?.textContent.trim(), top: Math.round(box(n).top), left: Math.round(box(n).left) })),
      formRound: hero ? [...hero.querySelectorAll(".team-fig [data-result], .team-fig b[data-r]")].map((n) => getComputedStyle(n).borderTopLeftRadius) : [],
      track: t && { left: Math.round(t.left - (box(track.parentElement)?.left ?? 0)), right: Math.round((box(track.parentElement)?.right ?? 0) - t.right), radius: getComputedStyle(track).borderTopLeftRadius, scroll: track.scrollWidth > track.clientWidth + 1 },
      selected: selected && { text: selected.textContent.trim(), bg: getComputedStyle(selected).backgroundColor },
      main: Boolean(main),
    };
  });

// ------------------------------------------------------------------ the club, computer
await run("club", async () => {
  const { context, page } = await open(`/clubs/?id=${CLUB}`);
  await page.locator(".team-page [role='tablist']").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await hideConsent(page);
  const head = await readHead(page);
  check("H1 head", "no column; head with crest, h1 PSG, the league named; 22 px", head,
    !head.column && head.hero && head.h1 === "Paris Saint-Germain" && head.crest && /Ligue 1/.test(head.sub || "") && head.heroRadius === "22px");
  check("H2 bar", "40 px track: season · Comparer à; Favoris 32 px round; Rapport → /rapport/?id=", head,
    near(head.barHeight, 40, 1) && head.segments.length === 2 && /^\d{4}\/\d{4}$/.test(head.segments[0]) && head.fav?.text === "Favoris" &&
      near(head.fav.h, 32, 1) && round(head.fav.radius) && /^\/rapport\/?\?/.test(head.report || "") && new URLSearchParams((head.report || "").split("?")[1]).get("id") === CLUB);
  const labels = head.figs.map((f) => f.label);
  check("H3 figures", "Ligue 1 · Indice Vega · Bilan · Buts · xPts · Forme, one row, a rank, round form marks", { labels, figs: head.figs, form: head.formRound },
    labels.join("|") === "Ligue 1|Indice Vega|Bilan|Buts|xPts|Forme" && head.figs.every((f) => near(f.top, head.figs[0].top)) &&
      /^\d+(er|e)$/.test(head.figs[0].value || "") && head.formRound.length >= 3 && head.formRound.every(round));
  check("H4 tabs", "a 999 px track, centred (±2), Vue d’ensemble ivory", { track: head.track, selected: head.selected },
    round(head.track?.radius) && near(head.track?.left, head.track?.right) && head.selected?.text === "Vue d’ensemble" && head.selected?.bg === IVORY);
  await page.screenshot({ path: join(out, "club-ordinateur.png") });

  // H5: the referential, on its tabs only.
  const compare = page.locator("header.team-hero .home-settings-segment").nth(1);
  await compare.click();
  await page.waitForTimeout(400);
  const pane = await page.evaluate(() => [...document.querySelectorAll("dialog[open] .home-settings-presets button")].map((b) => b.textContent.trim()));
  await page.screenshot({ path: join(out, "club-comparer.png") });
  await page.locator("dialog[open] .home-settings-presets button", { hasText: /^Ligue 1$/ }).click();
  await page.waitForTimeout(1500);
  const reference = await page.evaluate(() => [...document.querySelectorAll("#club-profile-panel p")].map((p) => p.textContent).find((t) => /référentiel/.test(t)) || "");
  await page.getByRole("tab", { name: "Matchs et tendances" }).click();
  await page.waitForTimeout(800);
  const onMatches = await page.evaluate(() => [...document.querySelectorAll("header.team-hero .home-settings-segment")].map((n) => n.textContent.trim()));
  await page.getByRole("tab", { name: "Vue d’ensemble" }).click();
  await page.waitForTimeout(800);
  check("H5 Comparer à", "three choices, the league writes Ligue 1 in the reference; no segment on Matchs et tendances", { pane, reference, onMatches },
    pane.join("|") === "Europe · niveau comparable|Europe · tous les clubs|Ligue 1" && /\(Ligue 1\)/.test(reference) && onMatches.length === 1);

  // H6: Favoris.
  const before = (await readHead(page)).heroHeight;
  await page.locator("header.team-hero button", { hasText: "Favoris" }).click();
  await page.waitForTimeout(500);
  const after = await readHead(page);
  check("H6 Favoris", "Dans vos favoris, pressed, the head's height kept", { fav: after.fav, before, after: after.heroHeight },
    after.fav?.text === "Dans vos favoris" && after.fav?.pressed === "true" && near(before, after.heroHeight, 1));

  // H7–H9: the overview's cards.
  // « Le club en bref » and the ranking are read once their place nears the screen.
  await page.locator(".club-overview-info").scrollIntoViewIfNeeded();
  await page.locator(".club-overview-info .club-ranking").waitFor({ timeout: 30000 });
  await page.locator(".club-overview-info .club-ranking").scrollIntoViewIfNeeded();
  await page.waitForTimeout(3000);
  const cards = await page.evaluate(() => {
    const info = document.querySelector(".club-overview-info");
    const facts = info?.querySelector(".club-facts-card"), ranking = info?.querySelector(".club-ranking");
    const r = (n) => n?.getBoundingClientRect();
    const panel = document.querySelector("#club-profile-panel");
    // A row's grid is transparent: its cards are its children.
    const clear = (n) => /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(n).backgroundColor) && getComputedStyle(n).borderTopWidth === "0px";
    const shapes = [...panel.querySelectorAll(":scope > div > *")].flatMap((n) => (clear(n) ? [...n.children] : [n])).filter((n) => n.offsetHeight > 60).map((n) => ({
      radius: getComputedStyle(n).borderTopLeftRadius, border: getComputedStyle(n).borderTopWidth,
    }));
    return {
      facts: facts && { top: Math.round(r(facts).top), h: Math.round(r(facts).height), text: facts.textContent },
      ranking: ranking && { top: Math.round(r(ranking).top), h: Math.round(r(ranking).height), title: ranking.querySelector("h2, h3, .card-title")?.textContent.trim(), ligue: /Ligue 1/.test(ranking.textContent) },
      shapes,
      arrows: [...document.querySelectorAll("#main a, #main button")].filter((n) => /→/.test(n.textContent)).length,
    };
  });
  check("H7 last row", "Le club en bref and Compétitions et rang européen side by side, same height, competitions and ages inside", { facts: cards.facts && { ...cards.facts, text: undefined, age: /Âge pondéré/.test(cards.facts.text) }, ranking: cards.ranking },
    cards.facts && cards.ranking && near(cards.facts.top, cards.ranking.top) && near(cards.facts.h, cards.ranking.h) &&
      cards.ranking.title === "Compétitions et rang européen" && cards.ranking.ligue && /Âge pondéré/.test(cards.facts.text));
  check("H8 cards", "22 px corners, no border", cards.shapes, cards.shapes.length > 3 && cards.shapes.every((s) => s.radius === "22px" && s.border === "0px"));
  check("H9 arrows", "no link or button with « → »", cards.arrows, cards.arrows === 0);
  await page.screenshot({ path: join(out, "club-ordinateur-bas.png"), fullPage: true });
  await context.close();
});

// ------------------------------------------------------------------ the club, phone
await run("club phone", async () => {
  const { context, page } = await open(`/clubs/?id=${CLUB}`, { ...devices["iPhone 13"], colorScheme: "dark" });
  await page.locator(".team-page [role='tablist']").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await hideConsent(page);
  const phone = await page.evaluate(() => {
    const hero = document.querySelector("header.team-hero"), bar = hero?.querySelector(".team-hero-bar .home-settings");
    const h = hero?.getBoundingClientRect(), b = bar?.getBoundingClientRect();
    const cut = bar ? [...bar.querySelectorAll(".home-settings-segment span")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent) : ["no bar"];
    const figs = hero ? [...hero.querySelectorAll(".team-fig dt")].map((n) => Math.round(n.getBoundingClientRect().left)) : [];
    const track = document.querySelector(".team-page [role='tablist']");
    return {
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      head: h && Math.round(h.width), bar: b && Math.round(b.width), cut,
      columns: new Set(figs).size,
      trackScrolls: track ? track.scrollWidth > track.clientWidth + 1 : null,
    };
  });
  await page.screenshot({ path: join(out, "club-telephone.png") });
  check("H10 phone", "no sideways scroll, the bar spans the head, no word cut, figures in two columns, tabs scroll inside", phone,
    !phone.sideways && phone.bar >= phone.head - 34 && phone.cut.length === 0 && phone.columns === 2 && phone.trackScrolls === true);
  await context.close();
});

// ------------------------------------------------------------------ the nation
await run("nation", async () => {
  const { context, page } = await open(`/nations/?id=${NATION}`);
  await page.locator(".team-page [role='tablist']").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2000);
  await hideConsent(page);
  const head = await readHead(page);
  const kpis = await page.evaluate(() => [...document.querySelectorAll("#nation-panel span, #nation-panel dt")].some((n) => n.textContent.trim() === "Rang Vega"));
  const labels = head.figs.map((f) => f.label);
  check("N1 head", "h1 France, flag, six figures, no strip, no column", { head: { h1: head.h1, crest: head.crest, column: head.column }, labels, kpis },
    !head.column && head.h1 === "France" && head.crest && labels.length === 6 &&
      labels.slice(0, 5).join("|") === "Classement Vega|Elo Vega|Bilan|Buts|Forme" && !kpis);
  check("N2 tabs and Favoris", "centred track, Favoris in the head", { track: head.track, fav: head.fav },
    round(head.track?.radius) && near(head.track?.left, head.track?.right) && head.fav?.text === "Favoris");
  await page.screenshot({ path: join(out, "nation-ordinateur.png") });
  await context.close();
  const phone = await open(`/nations/?id=${NATION}`, { ...devices["iPhone 13"], colorScheme: "light" });
  await phone.page.locator(".team-page [role='tablist']").first().waitFor({ timeout: 90000 });
  await phone.page.waitForTimeout(1500);
  await hideConsent(phone.page);
  await phone.page.screenshot({ path: join(out, "nation-telephone-clair.png") });
  await phone.context.close();
});

// ------------------------------------------------------------------ the skeleton
await run("skeleton", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { context, page } = await open(`/clubs/?id=${CLUB}`, {}, async (p) => {
    await p.route(/\/api\/(read\/club|teams\/)/, async (route) => {
      await held;
      await route.fallback();
    });
  });
  await page.locator(".team-hero-skeleton").first().waitFor({ timeout: 30000 }).catch(() => {});
  const shape = await page.evaluate(() => ({
    hero: Boolean(document.querySelector(".team-hero-skeleton")),
    rail: Boolean(document.querySelector(".club-skeleton-rail, aside[aria-label='Identité du club']")),
  }));
  await page.screenshot({ path: join(out, "club-squelette.png") });
  release();
  check("S1 skeleton", "the head's shape, no column", shape, shape.hero && !shape.rail);
  await context.close();
});

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  join(out, "evidence.json"),
  JSON.stringify({ base, replay: replay || null, rerun: `node tests/e2e/team-pages.e2e.mjs ${base} ${out}${replay ? " " + replay : ""}`, at: new Date().toISOString(), results }, null, 2),
);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// E2E — the two public legal pages Google asks for before it publishes the OAuth app « Vega Sport »:
// /confidentialite (« Confidentialité ») and /conditions-utilisation (« Conditions d'utilisation »),
// both linked from the site footer. Written before the pages, run red against main first.
//
// Failure modes and expected outcomes:
//  L1 (address) Each page answers 200 at its bare address (the one pasted at Google) without a redirect;
//     the address with a trailing slash redirects (308) to the bare one, which answers 200. The
//     site's convention: no `trailingSlash` in next.config.mjs, so /clubs/ → /clubs.
//  L2 (static) The server's HTML already carries the page: its h1 and its section titles are in the
//     first response, not drawn later by the browser (Google's reviewers and crawlers read it as is),
//     and nothing in it waits for the football API.
//  L3 (title) Exactly one h1, whose text is the page title; <title> is « <titre> — Vega Intelligence »;
//     a meta description; the canonical link is https://vegasport.vercel.app/<page> (bare form).
//  L4 (indexable) No `noindex` in a robots meta tag or in an X-Robots-Tag header.
//  L5 (footer) On /, /clubs and both legal pages, the footer holds « Confidentialité » → /confidentialite
//     and « Conditions d'utilisation » → /conditions-utilisation, plain: no query, where the other links
//     of the football pages carry the season and focus (a legal page has one address);
//     `aria-current="page"` is on the current page's link only.
//  L6 (sibling) Each legal page links to the other one outside the footer.
//  L7 (contents) A `nav[aria-label="Sommaire"]` lists the sections (12 for the privacy page, 12 for the
//     terms); every one of its links is a `#id` that names a section heading of the page, in order.
//  L8 (anchor) Following a Sommaire link on a desktop leaves the section's heading fully visible
//     under the sticky header (scroll-margin-top), not hidden behind it.
//  L9 (accounts off) With the account features off (the default local state: no NEON_AUTH_*), /connexion
//     is the 404 page and the legal pages still render in full. When the server under test has
//     accounts on, the check is recorded as not run, never as passed.
//  L10 (phone) At 390 px, neither page scrolls sideways; a table scrolls inside its own box at most
//     (a drawing clipped by its box, as the banner's, is inside it).
//  L11 (placeholders) Every value the owner has not supplied yet shows as a field marked
//     `[data-legal-field]`, reading « [À compléter : … »], visible (a box, a dashed underline or a
//     tinted background); while one is shown, the line « Version provisoire : les champs entre
//     crochets restent à compléter. » ([data-legal-provisional]) is under the banner.
//  L12 (en bref) The privacy page shows 4 « En bref » tiles, the terms 3, each with its label and
//     sentence, each a link to the section it sums up (named by its title).
//  L13 (references) Every « section N » written in the text is a link to the section that really has
//     the number N on the page — a section added or moved later must not leave a reference pointing
//     to the wrong place.
//  L14 (fields) The pages use exactly four owner fields: publisherName, publisherAddress, contactEmail,
//     applicableLaw. No « [À compléter » text stands outside a field element, and a punctuation mark
//     right after a field stays on the field's line (never alone at the start of a line).
//  L15 (final text) None of phase 1's sample strings is left (« Exemple à confirmer », « Cette section
//     décrira », …); the owner's note « Champs à compléter » is not on the page.
//  L16 (typography) In the text: typographic apostrophes only (no '), and no ordinary breaking space
//     before « : ; ! ? » or inside « … » (a no-break space instead).
//  L17 (cookies anchor) The privacy page's section « Cookies et stockage du navigateur » has the id
//     `cookies`: the cookie banner's link points to /confidentialite#cookies.
//  L18 (phone anchor) On a 390 px phone, opening the Sommaire and following its first link shows the
//     first field of that section between the sticky bars at the top and the tab bar at the bottom.
//  L19 (captions) Each table of the pages is introduced by its section's heading: its caption stays in the
//     table's accessible name but is hidden visually (a box of 1 px or less), desktop and phone, so the page
//     never shows « Cookies et stockage du navigateur » twice in a row.
//  L20 (consent text) The privacy page says what the consent banner does (src/services/consent.js,
//     components/Consent.jsx): it also shows when the location is unknown; without a choice nothing is
//     measured and it returns on the next page; the choice is kept six months in this browser under
//     vega.consent.v1 and is not linked to the account; after a refusal nothing more is sent, from the
//     current page on; outside Europe the measurement works unless it was refused in this browser.
//  L5 also: the footer's « Informations » column ends with the button « Cookies » (the consent banner's
//     reopening control), after the two links.
//  The consent banner itself is tested by tests/e2e/consent.e2e.mjs: here every browser starts with a stored
//  refusal (vega.consent.v1) so the banner never covers what these checks look at.
//  X1 No page error and no console error on the legal pages, apart from network failures of third
//     party scripts a local server cannot reach, and Vercel's analytics scripts (/_vercel/), which
//     `next start` does not serve (recorded in the evidence, not judged).
//
// Run against a local front or the public site:
//   node tests/e2e/legal-pages.e2e.mjs <base url> <evidence dir>
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots; exit code 1
// when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "legal-pages-e2e")] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");

const SITE = "https://vegasport.vercel.app";
const PAGES = [
  {
    path: "/confidentialite", title: "Confidentialité", sections: 12, sibling: "/conditions-utilisation", refs: 5,
    facts: [
      ["Sans compte", "Vos choix restent dans votre navigateur.", "Sans compte : ce que le site traite"],
      ["Avec un compte", "E-mail et mot de passe chez Neon Auth, préférences et listes chez AWS.", "Avec un compte : ce qui s’ajoute"],
      ["Connexion Google", "Vos données Google servent uniquement à créer votre compte et à vous connecter.", "Connexion avec Google"],
      ["Suppression", "Depuis « Mon compte », avec effet immédiat.", "Supprimer votre compte"],
    ],
  },
  {
    path: "/conditions-utilisation", title: "Conditions d’utilisation", sections: 12, sibling: "/confidentialite", refs: 0,
    facts: [
      ["Gratuit", "Tout le site est gratuit, avec ou sans compte.", "Offres payantes"],
      ["Informations", "Notes, probabilités et prévisions sont données à titre d’information, sans garantie.", "Données, notes et prévisions"],
      ["Compte", "Facultatif, supprimable à tout moment depuis « Mon compte ».", "Le compte"],
    ],
  },
];
const FIELDS = ["applicableLaw", "contactEmail", "publisherAddress", "publisherName"];
const SAMPLES = ["Exemple à confirmer", "Cette section décrira", "Cette section indiquera", "Cette section précisera", "Cette section listera", "Champs à compléter"];
// Compare text whatever the kind of space (ordinary, no-break, narrow no-break).
const flat = (text) => text.replace(/[\u00a0\u202f\s]+/g, " ").trim();
const usedFields = new Set();
// The footer's labels; the apostrophe of the site is the typographic one (« Vue d’ensemble »).
const FOOTER = [
  ["Confidentialité", "/confidentialite/"],
  ["Conditions d’utilisation", "/conditions-utilisation/"],
];
const PROVISIONAL = "Version provisoire : les champs entre crochets restent à compléter.";
const results = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: ok === null ? null : Boolean(ok) });
  const mark = ok === null ? "skip" : ok ? "ok  " : "FAIL";
  console.log(`${mark} ${id} — ${expected} — ${typeof actual === "string" ? actual : JSON.stringify(actual)}`);
};
const consoleLog = [], network = [];
const bare = (value) => value.replace(/\/$/, "");

const browser = await chromium.launch();
async function open(viewport, label) {
  const phone = viewport.width < 600;
  const context = await browser.newContext({
    viewport, deviceScaleFactor: phone ? 3 : 1, locale: "fr-FR", timezoneId: "Europe/Paris",
    isMobile: phone, hasTouch: phone,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: new Date().toISOString() }));
    } catch {}
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleLog.push(`${label} pageerror: ${String(e).slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // A resource a local server cannot reach or does not serve (the API's images, Vercel's analytics
    // scripts under /_vercel/, which only Vercel serves): recorded, not judged.
    if (/^Failed to load resource/.test(text) || /\/_vercel\//.test(text)) network.push(`${label}: ${text.slice(0, 200)}`);
    else consoleLog.push(`${label} console: ${text.slice(0, 300)}`);
  });
  return page;
}

try {
  // ---- L1, L2, L4 (headers): raw HTTP, no browser
  for (const p of PAGES) {
    const direct = await fetch(base + p.path, { redirect: "manual" });
    const html = direct.status === 200 ? await direct.text() : "";
    check(`L1 ${p.path}`, "the bare address answers 200 without a redirect", direct.status, direct.status === 200);
    const slash = await fetch(base + p.path + "/", { redirect: "manual" });
    const target = slash.headers.get("location") || "";
    const followed = target ? await fetch(new URL(target, base), { redirect: "manual" }) : null;
    check(`L1 ${p.path}/`, "the trailing-slash address redirects to the bare one, which answers 200",
      { status: slash.status, location: target, then: followed?.status ?? null },
      [301, 308].includes(slash.status) && bare(new URL(target, base).pathname) === p.path && followed?.status === 200);
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const h1Text = h1 ? h1[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
    const h2Count = (html.match(/<h2[^>]*data-legal-section/g) || []).length;
    check(`L2 ${p.path}`, `the server's HTML carries the h1 « ${p.title} » and the ${p.sections} section titles`,
      { h1: h1Text, sections: h2Count, loadingShell: html.includes("Chargement…") },
      h1Text === p.title && h2Count === p.sections);
    const robotsHeader = direct.headers.get("x-robots-tag") || "";
    check(`L4 ${p.path} header`, "no X-Robots-Tag noindex", robotsHeader || "none", !/noindex/i.test(robotsHeader));
  }

  // ---- L3, L4, L5, L6, L7, L8, L9, L11 on a desktop
  const desk = await open({ width: 1440, height: 1000 }, "desktop");
  // L9 first: are the account features off on this server?
  await desk.goto(base + "/connexion", { waitUntil: "networkidle", timeout: 120000 });
  const accountsOff = await desk.evaluate(() => /Page introuvable/.test(document.body.innerText));
  for (const p of PAGES) {
    await desk.goto(base + p.path, { waitUntil: "networkidle", timeout: 120000 });
    await desk.waitForTimeout(500);
    const facts = await desk.evaluate(() => {
      const h1s = [...document.querySelectorAll("h1")].map((h) => h.textContent.replace(/\s+/g, " ").trim());
      const robots = [...document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')].map((m) => m.content);
      const toc = document.querySelector('nav[aria-label="Sommaire"]');
      const links = toc ? [...toc.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      const sections = [...document.querySelectorAll("main [data-legal-section]")].map((h) => h.id);
      const resolved = links.map((href) => {
        const target = href?.startsWith("#") ? document.getElementById(decodeURIComponent(href.slice(1))) : null;
        return Boolean(target && target.matches("[data-legal-section]"));
      });
      const outsideFooter = [...document.querySelectorAll("a[href]")].filter((a) => !a.closest(".site-footer"));
      return {
        h1s,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || "",
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
        robots,
        links,
        sections,
        resolved,
        siblingLinks: outsideFooter.map((a) => a.getAttribute("href")),
      };
    });
    check(`L3 ${p.path} h1`, `exactly one h1, « ${p.title} »`, facts.h1s, facts.h1s.length === 1 && facts.h1s[0] === p.title);
    check(`L3 ${p.path} head`, `<title> « ${p.title} — Vega Intelligence », a description, canonical ${SITE}${p.path}`,
      { title: facts.title, description: facts.description.slice(0, 80), canonical: facts.canonical },
      facts.title === `${p.title} — Vega Intelligence` && facts.description.length > 20 && facts.canonical === SITE + p.path);
    check(`L4 ${p.path} meta`, "no robots meta with noindex", facts.robots.length ? facts.robots : "none", !facts.robots.some((r) => /noindex/i.test(r)));
    check(`L6 ${p.path}`, `links to ${p.sibling} outside the footer`, facts.siblingLinks.filter((h) => bare(h || "") === p.sibling),
      facts.siblingLinks.some((h) => bare(h || "") === p.sibling));
    check(`L7 ${p.path}`, `a Sommaire of ${p.sections} links, each naming a section heading, in the page's order`,
      { links: facts.links.length, sections: facts.sections.length, unresolved: facts.links.filter((_, i) => !facts.resolved[i]) },
      facts.links.length === p.sections && facts.sections.length === p.sections && facts.resolved.every(Boolean) &&
        facts.links.every((href, i) => href === `#${facts.sections[i]}`));
    // L8: the tenth link, then the heading's place under the sticky header.
    let anchor = { missing: true };
    if (facts.links.length >= 10) {
      await desk.locator('nav[aria-label="Sommaire"] a').nth(9).click();
      await desk.waitForTimeout(900);
      anchor = await desk.evaluate((id) => {
        const heading = document.getElementById(id).getBoundingClientRect();
        const header = document.querySelector(".topbar")?.getBoundingClientRect();
        return { headingTop: Math.round(heading.top), headerBottom: Math.round(header?.bottom ?? 0), hash: location.hash };
      }, facts.sections[9]);
    }
    check(`L8 ${p.path}`, "after a Sommaire link, the heading sits below the sticky header", anchor,
      !anchor.missing && anchor.headingTop >= anchor.headerBottom && anchor.headingTop < 400);
    // L11: placeholders and the provisional line.
    const fields = await desk.evaluate(() => {
      const list = [...document.querySelectorAll("main [data-legal-field]")].map((el) => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        return {
          text: el.textContent.replace(/\s+/g, " ").trim(),
          shown: box.width > 0 && box.height > 0 && style.visibility !== "hidden",
          marked: /dashed|dotted/.test(style.borderBottomStyle) || /dashed|dotted/.test(style.textDecorationStyle) || style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== bodyBg,
        };
      });
      const note = document.querySelector("[data-legal-provisional]");
      return { list, note: note ? { text: note.textContent.replace(/\s+/g, " ").trim(), shown: note.getBoundingClientRect().height > 0 } : null };
    });
    check(`L11 ${p.path} fields`, "at least one field « [À compléter : … »] marked and visible",
      fields.list.slice(0, 4), fields.list.length > 0 && fields.list.every((f) => /^\[À compléter : .+\]$/.test(f.text) && f.shown && f.marked));
    check(`L11 ${p.path} note`, `the line « ${PROVISIONAL} » is shown`, fields.note, fields.note?.shown && fields.note.text === PROVISIONAL);
    // L12 – L17: the text itself.
    const text = await desk.evaluate(() => {
      const main = document.querySelector("main");
      const number_ = (heading) => heading?.querySelector(".legal-num")?.textContent.trim() || null;
      const title = (heading) => heading?.querySelector(".legal-heading")?.textContent.replace(/\s+/g, " ").trim() || null;
      const facts = [...main.querySelectorAll(".legal-facts li a")].map((a) => {
        const target = document.getElementById(decodeURIComponent((a.getAttribute("href") || "").slice(1)));
        return {
          label: a.querySelector(".legal-fact-label")?.textContent || "",
          value: a.querySelector(".legal-fact-value")?.textContent || "",
          section: target?.matches("[data-legal-section]") ? title(target) : null,
        };
      });
      // Every « section N » of the prose, and where its link (if any) leads.
      const refs = [];
      const walker = document.createTreeWalker(main.querySelector(".legal-text") || main, NodeFilter.SHOW_TEXT);
      const loose = [];
      const breaking = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest("h2, .legal-num")) continue;
        const value = node.nodeValue;
        if (value.includes("[À compléter") && !node.parentElement.closest("[data-legal-field]")) loose.push(value.slice(0, 80));
        if (/'/.test(value)) breaking.push(`apostrophe: ${value.slice(0, 60)}`);
        for (const m of value.matchAll(/ [:;!?»]|« /g)) breaking.push(`space « ${m[0]} »: ${value.slice(Math.max(0, m.index - 30), m.index + 10)}`);
      }
      // « section N » is counted per block (a paragraph, an item, a cell): React may split « section » and its
      // number into two text nodes, so text nodes alone would miss them.
      for (const block of (main.querySelector(".legal-text") || main).querySelectorAll("p, li, td, th")) {
        if (block.querySelector("p, li, td, th")) continue;
        const written = [...block.textContent.matchAll(/sections?[\s\u00a0\u202f]+(\d+)/g)].map((m) => m[1]);
        const links = [...block.querySelectorAll("a[href^='#']")].filter((a) => /^sections?[\s\u00a0\u202f]+\d+$/.test(a.textContent.trim()));
        written.forEach((number, i) => {
          const link = links[i];
          const target = link ? document.getElementById(decodeURIComponent(link.getAttribute("href").slice(1))) : null;
          refs.push({
            written: number,
            linkText: link ? link.textContent.replace(/\D+/g, "") : null,
            linkedTo: target?.matches("[data-legal-section]") ? number_(target) : null,
          });
        });
      }
      // A punctuation mark just after a field: on the field's last line.
      const detached = [];
      for (const field of main.querySelectorAll("[data-legal-field]")) {
        const next = field.nextSibling;
        if (!next || next.nodeType !== 3 || !/^[.,;:]/.test(next.nodeValue)) continue;
        const range = document.createRange();
        range.setStart(next, 0);
        range.setEnd(next, 1);
        const mark = range.getBoundingClientRect(), rects = field.getClientRects(), last = rects[rects.length - 1];
        if (Math.abs(mark.top + mark.height / 2 - (last.top + last.height / 2)) > last.height / 2) detached.push(`${field.dataset.legalField} ${next.nodeValue[0]}`);
      }
      const cookies = document.getElementById("cookies");
      return {
        facts,
        refs,
        loose,
        breaking: breaking.slice(0, 8),
        detached,
        fields: [...new Set([...main.querySelectorAll("[data-legal-field]")].map((f) => f.dataset.legalField))],
        body: main.innerText,
        cookies: cookies?.matches("[data-legal-section]") ? title(cookies) : null,
      };
    });
    const wanted = p.facts.map(([label, value, section]) => ({ label, value, section }));
    check(`L12 ${p.path}`, `${p.facts.length} « En bref » tiles, each leading to its section`, text.facts.map((f) => ({ ...f, label: flat(f.label), value: flat(f.value) })),
      text.facts.length === wanted.length && wanted.every((w, i) => flat(text.facts[i].label) === w.label && flat(text.facts[i].value) === w.value && flat(text.facts[i].section || "") === w.section));
    check(`L13 ${p.path}`, `every « section N » links to the section numbered N (at least ${p.refs})`, { refs: text.refs.length, wrong: text.refs.filter((r) => r.written !== r.linkedTo || r.linkText !== r.written) },
      text.refs.length >= p.refs && text.refs.every((r) => r.written === r.linkedTo && r.linkText === r.written));
    text.fields.forEach((name) => usedFields.add(name));
    check(`L14 ${p.path}`, "fields are owner fields only, no loose « [À compléter », punctuation stays with its field",
      { fields: text.fields, loose: text.loose, detached: text.detached },
      text.fields.length > 0 && text.fields.every((f) => FIELDS.includes(f)) && text.loose.length === 0 && text.detached.length === 0);
    const left = SAMPLES.filter((sample) => text.body.includes(sample));
    check(`L15 ${p.path}`, "no phase 1 sample text, no owner's note", left.length ? left : "none", left.length === 0);
    check(`L16 ${p.path}`, "typographic apostrophes, no-break spaces before : ; ! ? and inside « »", text.breaking.length ? text.breaking : "none", text.breaking.length === 0);
    if (p.path === "/confidentialite")
      check("L17", "#cookies is the section « Cookies et stockage du navigateur »", text.cookies, flat(text.cookies || "") === "Cookies et stockage du navigateur");
    await desk.evaluate(() => window.scrollTo(0, 0));
    await desk.screenshot({ path: path.join(out, `${p.path.slice(1)}-desktop.png`) });
    check(`L9 ${p.path}`, "accounts off (/connexion is the 404 page) and the page renders in full",
      accountsOff ? { accountsOff, h1: facts.h1s[0] || null } : "accounts are on on this server: not run",
      accountsOff ? facts.h1s[0] === p.title && facts.sections.length === p.sections : null);
  }

  check("L14 both", "the two pages together use exactly the four owner fields", [...usedFields].sort(), [...usedFields].sort().join() === FIELDS.join());

  // ---- L19 (desktop) and L20: the tables' captions, the consent text
  {
    await desk.goto(base + "/confidentialite", { waitUntil: "networkidle", timeout: 120000 });
    const captions = await desk.evaluate(() => [...document.querySelectorAll("main table")].map((table) => {
      const caption = table.querySelector("caption");
      const box = caption?.getBoundingClientRect();
      return { caption: caption?.textContent.trim() || null, w: box ? Math.round(box.width) : null, h: box ? Math.round(box.height) : null };
    }));
    const named = [];
    for (const c of captions) named.push(c.caption ? await desk.getByRole("table", { name: c.caption }).count() : 0);
    check("L19 desktop", "3 tables on the privacy page; each caption names its table and is hidden visually (≤ 1 px)", { captions, named },
      captions.length === 3 && captions.every((c, i) => c.caption && c.w <= 1 && c.h <= 1 && named[i] === 1));
    const terms = await fetch(base + "/conditions-utilisation").then((r) => r.text());
    check("L19 terms", "the terms page has no table (nothing to hide)", (terms.match(/<table/g) || []).length, !/<table/.test(terms));
    const text = await desk.evaluate(() => ({
      cookies: document.getElementById("cookies")?.closest("section")?.innerText || "",
      without: document.getElementById("sans-compte")?.closest("section")?.innerText || "",
    }));
    const plain = (t) => flat(t).replace(/’/g, "'");
    const cookies = plain(text.cookies), without = plain(text.without);
    const wanted = [
      [cookies, "Si vous êtes en Europe, ou si votre position est inconnue"],
      [cookies, "Sans choix de votre part, rien n'est mesuré et le bandeau revient à la page suivante"],
      [cookies, "gardé six mois dans ce navigateur (clé vega.consent.v1)"],
      [cookies, "il n'est pas lié à votre compte"],
      [cookies, "après un refus, plus rien n'est envoyé, dès la page en cours"],
      [cookies, "sauf si vous l'avez refusée dans ce navigateur"],
      [without, "En Europe, ou si votre position est inconnue, ces deux outils ne sont chargés qu'après votre accord"],
    ];
    const missing = wanted.filter(([where, phrase]) => !where.includes(phrase)).map(([, phrase]) => phrase);
    check("L20", "the privacy page describes the consent banner as the code does", missing.length ? { missing } : "all present", missing.length === 0);
  }

  // ---- L5: the footer on four pages
  for (const route of ["/", "/clubs", ...PAGES.map((p) => p.path)]) {
    await desk.goto(base + route, { waitUntil: "networkidle", timeout: 120000 });
    await desk.locator(".site-footer").first().waitFor({ timeout: 60000 }).catch(() => {});
    const links = await desk.evaluate((labels) => labels.map(([label]) => {
      const a = [...document.querySelectorAll(".site-footer a")].find((link) => link.textContent.trim() === label);
      return a ? { label, href: a.getAttribute("href"), current: a.getAttribute("aria-current") } : { label, missing: true };
    }), FOOTER);
    const column = await desk.evaluate(() =>
      [...document.querySelectorAll('.site-footer nav[aria-label="Informations"] li')].map((li) => {
        const control = li.querySelector("a, button");
        return control ? `${control.tagName.toLowerCase()}:${control.textContent.trim()}` : "empty";
      }),
    );
    const ok = links.every((l, i) => !l.missing && bare(l.href) === bare(FOOTER[i][1]) &&
      (bare(FOOTER[i][1]) === route ? l.current === "page" : l.current === null)) &&
      column.join("|") === "a:Confidentialité|a:Conditions d’utilisation|button:Cookies";
    check(`L5 ${route}`, "the footer links both pages, aria-current on the current one only, then the button « Cookies »", { links, column }, ok);
  }
  await desk.locator(".site-footer").scrollIntoViewIfNeeded().catch(() => {});
  await desk.locator(".site-footer").screenshot({ path: path.join(out, "footer-desktop.png") }).catch(() => {});
  await desk.context().close();

  // ---- L10: the phone
  const phone = await open({ width: 390, height: 844 }, "phone");
  for (const p of PAGES) {
    await phone.goto(base + p.path, { waitUntil: "networkidle", timeout: 120000 });
    await phone.waitForTimeout(500);
    const sideways = await phone.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      wide: [...document.querySelectorAll("main *")].filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.right <= window.innerWidth + 1) return false;
        // Inside a box that scrolls on its own: allowed.
        for (let up = el.parentElement; up; up = up.parentElement) {
          const s = getComputedStyle(up);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && up.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        }
        return true;
      }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") || ""}`),
    }));
    check(`L10 ${p.path}`, "390 px: no sideways scroll, nothing wider than the screen outside its own scroll box", sideways,
      sideways.overflow <= 0 && sideways.wide.length === 0);
    await phone.screenshot({ path: path.join(out, `${p.path.slice(1)}-phone.png`) });
    if (p.path === "/confidentialite") {
      const captions = await phone.evaluate(() => [...document.querySelectorAll("main table caption")].map((c) => {
        const box = c.getBoundingClientRect();
        return { caption: c.textContent.trim(), w: Math.round(box.width), h: Math.round(box.height) };
      }));
      check("L19 phone", "390 px: the 3 captions hidden visually", captions, captions.length === 3 && captions.every((c) => c.w <= 1 && c.h <= 1));
    }
    // L18: the Sommaire's first link, then the first field of that section between the bars.
    let reached = { missing: true };
    const toggle = phone.locator(".legal-toc-toggle");
    if (await toggle.count()) {
      await toggle.click();
      await phone.locator('nav[aria-label="Sommaire"] a').first().click();
      await phone.waitForTimeout(900);
      reached = await phone.evaluate(() => {
        const field = document.querySelector("main [data-legal-field]");
        if (!field) return { field: null };
        const box = field.getBoundingClientRect();
        const toc = document.querySelector(".legal-toc")?.getBoundingClientRect();
        const bar = document.querySelector(".tabbar")?.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom), tocBottom: Math.round(toc?.bottom ?? 0), tabbarTop: Math.round(bar?.top ?? innerHeight) };
      });
    }
    check(`L18 ${p.path}`, "phone: after the Sommaire's first link, the section's first field is fully visible between the bars", reached,
      !reached.missing && reached.top >= reached.tocBottom && reached.bottom <= reached.tabbarTop);
  }
  await phone.context().close();

  check("X1", "no page error and no console error on the pages visited", consoleLog.length ? consoleLog.slice(0, 5).join(" | ") : "none", consoleLog.length === 0);
} catch (error) {
  // A step that stops the run is a failure, never a shorter list of passes.
  check("RUN", "the run completes", `error: ${error.message.split("\n")[0]}`, false);
} finally {
  await browser.close();
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        subject: "Legal pages: /confidentialite and /conditions-utilisation, public, static, indexable, linked from the footer",
        observed: new Date().toISOString(),
        base,
        rerun: `node tests/e2e/legal-pages.e2e.mjs ${base} ${out}`,
        setup: "Chromium headless, fr-FR; desktop 1440×1000, phone 390×844 (touch, ×3); raw fetch for statuses, redirects and the server's HTML. Local server: from dashboard/, NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8765 node node_modules/next/dist/bin/next dev frontend --hostname 127.0.0.1 --port 3000, without any NEON_AUTH_* variable (accounts off), the API replay on 8765 for the header and the other pages.",
        inputs: { pages: PAGES, footer: FOOTER, provisional: PROVISIONAL, site: SITE },
        results,
        console: consoleLog,
        networkFailures: network,
        passed: results.filter((r) => r.ok === true).length,
        failed,
        skipped,
      },
      null,
      2,
    ),
  );
  console.log(`${results.filter((r) => r.ok === true).length}/${results.length} passed, ${failed} failed, ${skipped} not run — ${out}`);
  process.exitCode = failed ? 1 : 0;
}

// On the real home page, Safari used the SVG's 285 px intrinsic width to size
// the logo link, leaving the visible mark small and pushing the menus away.
// At every tested width and in both themes, the mark must be 25 × 28 px
// in a centered 40 px desktop / 44 px phone link at the header's left gutter.
// On desktop, all five menus must fit between the brand and search.
// On phones, the top actions must fit and the five bottom tabs must stay inside
// their bar, with search centered. The menu and mobile search must still open.
//
// PLAYWRIGHT_CORE=<path> node tests/e2e/header-logo.e2e.mjs <base URL> <evidence dir>
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [base, out] = process.argv.slice(2);
if (!base || !out || !process.env.PLAYWRIGHT_CORE) {
  throw new Error("Set PLAYWRIGHT_CORE and pass the base URL and evidence directory.");
}
const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const pageUrl = new URL("/?season=2026%2F2027", base).href;
const widths = {
  desktop: [641, 760, 761, 919, 920, 1023, 1024, 1180, 1181, 1440, 1747],
  mobile: [320, 390, 440, 640],
};
const themes = ["dark", "light"];
const results = [];
const diagnostics = [];
const browserVersions = {};
await mkdir(out, { recursive: true });

function check(engine, mode, expected, actual, ok) {
  results.push({ engine, mode, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "ok" : "FAIL"} ${engine} ${mode}: ${expected}`);
}

function geometry() {
  const top = document.querySelector(".topbar");
  const nav = top.querySelector(".main-nav");
  const tabs = document.querySelector(".tabbar");
  const box = (element) => {
    const { left, right, width, height } = element.getBoundingClientRect();
    return { left, right, width, height, center: (left + right) / 2 };
  };
  return {
    width: innerWidth,
    theme: document.documentElement.dataset.theme,
    top: box(top),
    gutter: parseFloat(getComputedStyle(top).paddingLeft),
    gap: parseFloat(getComputedStyle(top).columnGap),
    brand: box(top.querySelector(".brand")),
    mark: box(top.querySelector(".brand-mark")),
    nav: box(nav),
    menus: [...nav.querySelectorAll(":scope > a, :scope > .nav-menu > button")].map(box),
    search: box(top.querySelector(".global-search")),
    actions: [...top.querySelector(".topbar-actions").children].map(box).filter((item) => item.width > 0),
    tabbar: box(tabs),
    tabs: [...tabs.children].map(box),
    tabSearch: box(tabs.querySelector(".tabbar-search")),
  };
}

const near = (a, b) => Math.abs(a - b) <= 0.5;
const inside = (item, container) => item.left >= container.left - 0.5 && item.right <= container.right + 0.5;
const ordered = (items, container) =>
  items.every((item, index) => inside(item, container) && (index === 0 || item.left >= items[index - 1].right - 0.5));

async function checkMode(browser, engine, mode) {
  const mobile = mode === "mobile";
  const height = mobile ? 844 : 900;
  // Firefox supports a touch viewport but not Playwright's isMobile option.
  const context = await browser.newContext({
    viewport: { width: widths[mode][0], height },
    locale: "fr-FR",
    deviceScaleFactor: mobile ? 2 : 1,
    hasTouch: mobile,
    ...(engine !== "firefox" ? { isMobile: mobile } : {}),
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => diagnostics.push({ engine, mode, message: error.message }));
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    for (const theme of themes) {
      const themeButton = page.locator(".topbar .theme-toggle");
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await themeButton.click();
        await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
      }
      await page.evaluate(async (theme) => {
        await document.fonts.ready;
        await document.querySelector(`.topbar .brand-mark .logo-${theme}`).decode();
      }, theme);
      for (const width of widths[mode]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction((expected) => innerWidth === expected, width, { timeout: 3000 });
        const g = await page.evaluate(geometry);
        const expectedLink = mobile ? 44 : 40;
        const logoFits =
          near(g.brand.left, g.top.left + g.gutter) && near(g.brand.width, expectedLink) &&
          near(g.brand.height, expectedLink) && g.mark.width === 25 && g.mark.height === 28 &&
          near(g.mark.center, g.brand.center);
        const layoutFits = mobile
          ? g.nav.width === 0 && g.search.width === 0 && g.actions.length === 3 &&
            g.tabs.length === 5 && g.tabbar.width > 0 && ordered(g.tabs, g.tabbar) &&
            inside(g.tabbar, g.top) && near(g.tabSearch.center, g.tabbar.center)
          : g.tabbar.width === 0 && g.menus.length === 5 && g.menus.every((menu) => menu.width > 0) &&
            near(g.nav.left - g.brand.right, g.gap) && g.nav.right <= g.search.left - 11.5 &&
            ordered(g.menus, g.nav);
        check(engine, mode, `${width} px ${theme}: ${expectedLink} px logo link and aligned navigation`,
          g, g.theme === theme && logoFits && layoutFits && ordered([g.brand, ...g.actions], g.top));
        if (theme === "dark" && width === (mobile ? 390 : 1747)) {
          await page.locator(".topbar").screenshot({ path: path.join(out, `${engine}-${mode}-header.png`) });
          if (mobile) {
            await page.locator(".tabbar").screenshot({ path: path.join(out, `${engine}-mobile-tabs.png`) });
          }
        }
      }
    }
    if (mobile) {
      await page.setViewportSize({ width: 390, height });
      await page.locator(".tabbar-search").tap();
      await page.getByRole("dialog", { name: "Recherche" }).waitFor();
      check(engine, mode, "the bottom search button opens the search dialog", "dialog visible", true);
    } else {
      const menu = page.locator(".main-nav").getByRole("button", { name: "Joueurs" });
      await menu.press("Enter");
      await page.locator(".nav-menu-panel").waitFor();
      check(engine, mode, "Joueurs opens from the keyboard", await menu.getAttribute("aria-expanded"),
        (await menu.getAttribute("aria-expanded")) === "true");
    }
  } finally {
    await context.close();
  }
}

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await playwright[engine].launch();
    browserVersions[engine] = browser.version();
    for (const mode of Object.keys(widths)) {
      try {
        await checkMode(browser, engine, mode);
      } catch (error) {
        check(engine, mode, "the browser run completes", error.message, false);
      }
    }
  } catch (error) {
    check(engine, "launch", "the browser starts", error.message, false);
  } finally {
    await browser?.close();
  }
}

const failed = results.filter((result) => !result.ok).length;
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  pageUrl, widths, themes, browserVersions, passed: results.length - failed, failed,
  rerun: `PLAYWRIGHT_CORE=${JSON.stringify(process.env.PLAYWRIGHT_CORE)} node tests/e2e/header-logo.e2e.mjs ${JSON.stringify(base)} ${JSON.stringify(out)}`,
  results, diagnostics,
}, null, 2));
console.log(`${results.length - failed}/${results.length} passed — ${out}`);
process.exitCode = failed ? 1 : 0;

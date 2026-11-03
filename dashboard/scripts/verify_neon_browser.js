async (page) => {
  const base = new URL(page.url()).origin;
  const report = {
    setup:
      "Local Next with real read-only Neon, homepage commit 00be3aa integrated. Desktop and mobile navigation; inspect network for direct provider or GitHub data calls.",
    command:
      "playwright-cli run-code --filename dashboard/scripts/verify_neon_browser.js",
    expected:
      "Every page loads real content; zero direct Pitch or GitHub data calls; no page exceptions; mobile has no horizontal overflow.",
    pages: [],
    requests: [],
    errors: [],
  };
  page.on("request", (r) => {
    const url = r.url();
    if (/pitchapi\.dev|raw\.githubusercontent\.com/.test(new URL(url).hostname))
      report.requests.push(url);
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  for (const route of [
    "/",
    "/matchs",
    "/joueurs",
    "/clubs",
    "/competitions",
    "/calendrier",
    "/archives",
    "/classement-joueurs",
    "/methode",
  ]) {
    const start = Date.now();
    await page.goto(base + route);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForFunction(
      () =>
        !/Chargement des données|Chargement…/.test(
          document.querySelector("main")?.innerText || "",
        ),
    );
    report.pages.push({
      route,
      title: await page.title(),
      heading: await page.getByRole("heading", { level: 1 }).allTextContents(),
      ms: Date.now() - start,
      text: (await page.locator("main").innerText()).slice(0, 240),
    });
  }
  await page.goto(base + "/");
  await page
    .getByRole("navigation", { name: "Résultats de la semaine" })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/neon-home-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/neon-home-mobile.png",
    fullPage: true,
  });
  report.mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  report.status =
    report.requests.length === 0 &&
    report.errors.length === 0 &&
    !report.mobileOverflow
      ? "passed"
      : "failed";
  return report;
};

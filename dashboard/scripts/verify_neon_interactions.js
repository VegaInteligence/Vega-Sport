async (page) => {
  const base = new URL(page.url()).origin;
  const report = {
    setup:
      "Real Neon production data, saved match state confined to the browser profile.",
    command:
      "playwright-cli run-code --filename dashboard/scripts/verify_neon_interactions.js",
    expected:
      "Match tabs render, save state persists across reload and is restored, player and club profiles load, both themes work, no provider requests or server errors.",
    checks: [],
    errors: [],
    providerRequests: [],
    serverErrors: [],
  };
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (
      /pitchapi\.dev|raw\.githubusercontent\.com/.test(
        new URL(r.url()).hostname,
      )
    )
      report.providerRequests.push(r.url());
  });
  page.on("response", (r) => {
    if (r.status() >= 500)
      report.serverErrors.push({ url: r.url(), status: r.status() });
  });
  await page.goto(
    base +
      "/matchs?season=2026%2F2027&tab=results&id=m_1cQmo2&competition=l_4WFCIZ&sourceSeason=2026%2F2027",
  );
  await page
    .getByRole("heading", { name: "Liverpool — Arsenal", exact: true })
    .waitFor();
  for (const name of [
    "Statistiques",
    "Tirs & xG",
    "Compositions",
    "Joueurs",
    "Classement",
    "Données complètes",
    "Avant-match",
    "Vue d’ensemble",
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.getByRole("tabpanel", { name, exact: true }).waitFor();
    report.checks.push({
      matchTab: name,
      content: (
        await page.getByRole("tabpanel", { name, exact: true }).innerText()
      ).slice(0, 180),
    });
  }
  const save = page.getByRole("button", {
    name: /Liverpool.*Arsenal.*sélection/,
  });
  const before = await save.getAttribute("aria-pressed");
  await save.click();
  await page.reload();
  await page
    .getByRole("heading", { name: "Liverpool — Arsenal", exact: true })
    .waitFor();
  const after = await save.getAttribute("aria-pressed");
  if (before === after) throw new Error("Saved match did not persist");
  await save.click();
  report.checks.push({ savedMatch: { before, after, restored: true } });
  await page
    .getByRole("button", { name: "Activer le thème clair", exact: true })
    .click();
  if ((await page.locator("html").getAttribute("data-theme")) !== "light")
    throw new Error("Theme did not change");
  await page.screenshot({
    path: "output/playwright/neon-match-light-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Activer le thème sombre", exact: true })
    .click();
  await page.goto(base + "/joueurs?id=p_01fuwy&season=2026%2F2027");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForFunction(
    () => !/Chargement/.test(document.querySelector("main")?.innerText || ""),
  );
  report.checks.push({
    playerProfile: (await page.locator("main").innerText()).slice(0, 280),
  });
  await page.goto(base + "/clubs?id=t_0BrMnM&season=2026%2F2027");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForFunction(
    () =>
      !/Chargement des données/.test(
        document.querySelector("main")?.innerText || "",
      ),
  );
  report.checks.push({
    clubProfile: (await page.locator("main").innerText()).slice(0, 280),
  });
  report.status =
    report.errors.length === 0 &&
    report.providerRequests.length === 0 &&
    report.serverErrors.length === 0
      ? "passed"
      : "failed";
  return report;
};

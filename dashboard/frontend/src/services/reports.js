/**
 * A report of a player, a club or a match (/rapport/?id=…), shared by the page and the
 * server's images (src/server/report-cards.jsx): the six titles, an image's address, the
 * file names and the text of the thread on X.
 */
export const REPORT_TITLES = {
  player: ["Le joueur", "La saison en chiffres", "Profil par phase de jeu", "Match par match", "Valeur marchande", "Ses meilleurs matchs"],
  club: ["Le club", "La forme", "xG pour et contre", "Les meilleurs joueurs", "La fin de saison", "À venir"],
  match: ["Le match", "Les statistiques", "Probabilité de victoire", "Les meilleures notes", "Avant le match", "Le joueur du match"],
};

/** The projection card's line: how many season ends were simulated (the number the projection gives, none when it gives none). */
export const outlookNote = (outlook) =>
  `${outlook.replays ? `${Number(outlook.replays).toLocaleString("fr-FR")} fins` : "Fins"} de saison simulées après ${outlook.played} journées`;

export function reportImageUrl(id, n, season) {
  return `/api/rapport/image?${new URLSearchParams({ id, n: String(n), ...(season ? { season } : {}) })}`;
}

export function reportSlug(report) {
  const name = (report?.title || "rapport").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `vega-${name || "rapport"}`;
}

const fr = (value, digits = 0) => (value == null ? "—" : Number(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }));

/** The text that goes with the six images: a few facts, then the site's address. */
export function reportThread(report) {
  if (!report) return "";
  let text = "";
  if (report.kind === "player") {
    const p = report.player, s = report.seasonStats, power = report.power;
    text = `${p.name}${p.team ? ` (${p.team.name})` : ""} en six images. `
      + (power?.score != null ? `Score Vega ${fr(power.score)}/100, ${power.rank}e du classement. ` : "")
      + `${fr(s.totals.goals)} but${s.totals.goals > 1 ? "s" : ""} et ${fr(s.totals.assists)} passe${s.totals.assists > 1 ? "s" : ""} décisive${s.totals.assists > 1 ? "s" : ""} en ${s.matches} matchs cette saison.`;
  } else if (report.kind === "club") {
    const r = report.record, power = report.power, o = report.outlook;
    text = `${report.club.name} en six images. `
      + (power?.score != null ? `Score Vega ${fr(power.score)}/100, ${power.rank}e du Power Ranking. ` : "")
      + `${r.wins} victoires, ${r.draws} nuls, ${r.losses} défaites cette saison.`
      + (o ? ` ${fr(o.title)} % de chances de titre selon nos simulations.` : "");
  } else {
    const m = report.match, best = report.playerOfMatch;
    text = `${m.home.name} ${m.home.score ?? ""}–${m.away.score ?? ""} ${m.away.name} en six images.`
      + (report.xg ? ` xG ${fr(report.xg.home, 2)}–${fr(report.xg.away, 2)}.` : "")
      + (best ? ` Joueur du match : ${best.name}, ${fr(best.grade)}/100.` : "");
  }
  return `${text}\nvegasport.vercel.app`;
}

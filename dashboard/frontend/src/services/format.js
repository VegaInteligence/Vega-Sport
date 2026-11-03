export {
  formatNumber as number,
  isNumber,
  normalizeText,
  seasonLabel,
} from "../model.js";
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Paris",
});
export const date = (value) =>
  value && !Number.isNaN(Date.parse(value))
    ? dateFormatter.format(
        new Date(value.includes("T") ? value : `${value}T12:00:00Z`),
      )
    : "—";
export function safeImageUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      (u.hostname === "cdn.pitchapi.dev" ||
        (u.hostname === "upload.wikimedia.org" &&
          /^\/wikipedia\/commons\//.test(u.pathname)) ||
        (u.hostname === "img.thesports.com" &&
          /^\/football\/(?:team|competition)\/[a-z0-9]+\.(?:png|webp|jpe?g)$/i.test(
            u.pathname,
          ))) &&
      !u.username &&
      !u.password
      ? `/api/assets?url=${encodeURIComponent(u.href)}`
      : "";
  } catch {
    return "";
  }
}
export const title = (value) =>
  String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export function rawPlayerMetrics(row) {
  const result = new Map();
  for (const group of row?.stats || [])
    for (const [label, item] of Object.entries(group.stats || {})) {
      const key = item.key || label;
      if (!result.has(key)) result.set(key, { key, label, ...item.stat });
    }
  return result;
}
export const MATCH_SECTIONS = [
  ["lineups", "Compositions"],
  ["stats", "Statistiques équipes"],
  ["players", "Statistiques joueurs"],
  ["shots", "Tirs & xG"],
  ["events", "Événements"],
  ["momentum", "Momentum"],
  ["players/halves", "Par mi-temps"],
  ["advanced", "Analyse avancée"],
  ["advanced/players", "Joueurs · avancé"],
  ["advanced/network", "Réseaux de passes"],
  ["heatmaps", "Cartes d’activité"],
  ["h2h", "Confrontations"],
  ["match", "Fiche du match"],
];
export const endpointKeys = {
  match: "match",
  shots: "shots",
  momentum: "momentum",
  events: "events",
  players: "players",
  "players/halves": "player_halves",
  lineups: "lineups",
  h2h: "h2h",
  stats: "stats",
  advanced: "advanced_teams",
  "advanced/players": "advanced_players",
  "advanced/network": "pass_networks",
  heatmaps: "heatmaps",
};
export function normalizeArchive(record) {
  if (!record?.endpoints) return record;
  const value = {};
  for (const [name, key] of Object.entries(endpointKeys)) {
    const entry = record.endpoints[key];
    if (entry?.status === 200) value[name] = { data: entry.data };
  }
  return value;
}

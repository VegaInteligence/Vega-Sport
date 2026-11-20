import { acceptedImageSource } from "./image-source.js";
import { apiUrl } from "../data-url.js";
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
  return acceptedImageSource(value)
    ? apiUrl(`/api/assets?url=${encodeURIComponent(new URL(value).href)}`)
    : "";
}
/** The sides a crest or portrait may take, in px (dashboard/frontend/AGENTS.md, « Images »). */
export const MEDIA_SIZES = Object.freeze([16, 20, 24, 28, 32, 40, 48, 64, 96]);
const SURNAME_PARTICLES = new Set(
  "da das de del della der di do dos du la le mac st ten ter van von".split(
    " ",
  ),
);
const capital = (letter) => [...letter.toLocaleUpperCase("fr")][0];
/**
 * One or two capitals for an image that is missing: the first letter or digit of the first
 * and last words (« Olympique de Marseille » → OM, « 1. FC Köln » → 1K). For a person, a
 * capitalised particle before the surname counts (« Kevin De Bruyne » → KD, « Virgil van
 * Dijk » → VD). "" when the name has no letter or digit: Media shows its neutral shell.
 */
export function mediaInitials(name, { person = false } = {}) {
  if (typeof name !== "string") return "";
  const words = name
    .split(/\s+/)
    .map((word) => ({ word, letter: word.match(/[\p{L}\p{N}]/u)?.[0] }))
    .filter((part) => part.letter);
  if (!words.length) return "";
  let last = words.length > 1 ? words.at(-1) : null;
  const particle = words.at(-2);
  if (
    person &&
    words.length > 2 &&
    SURNAME_PARTICLES.has(particle.word.toLowerCase()) &&
    /^\p{Lu}/u.test(particle.word)
  )
    last = particle;
  return capital(words[0].letter) + (last ? capital(last.letter) : "");
}
export function mediaImageSource(
  url,
  fallbackUrl,
  primaryFailed = false,
  fallbackFailed = false,
) {
  const primary = safeImageUrl(url),
    fallback = safeImageUrl(fallbackUrl);
  if (primary && !primaryFailed) return primary;
  if (fallback && fallback !== primary && !fallbackFailed) return fallback;
  return "";
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

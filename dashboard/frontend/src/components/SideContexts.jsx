"use client";
/* B (VI-41): each page's « Contexte » panel. One rule: a fact shows once.
 * The page's own side column (a club's identity, a league's level and
 * matches) moves into the sidebar on wide screens; the panel adds only what
 * the page does not show. The reads below are the page's own cached ones. */
import React, { useMemo } from "react";
import { useEuropePool } from "../services/club-scout.js";
import { useMatchForecast, projectionRows } from "../services/forecasts.js";
import { matchForecast } from "../services/cup-matches.js";
import { useLeagueLevels, leagueStrength } from "../services/league-levels.js";
import { SEASON_METRICS } from "../services/season-player.js";
import useMatchSection from "../hooks/useMatchSection.js";
import SideContext, { Block, Figure, Meter, Odds, Row, Timeline } from "./SideContext.jsx";

const number = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : null;
const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);

/* ---------- Club: the identity column, and the club's Elo ---------- */
export function ClubSide({ dossier, rail }) {
  const pool = useEuropePool(true).value;
  const elo = Number(pool?.levels?.get(dossier.id));
  const rank = useMemo(() => {
    if (!Number.isFinite(elo) || !pool?.levels) return null;
    const values = [...pool.levels.values()].map(Number).filter(Number.isFinite);
    return { rank: values.filter((value) => value > elo).length + 1, of: values.length };
  }, [elo, pool]);
  return (
    <SideContext summary={{ label: dossier.name, value: Number.isFinite(elo) ? `Elo ${number(elo)}` : null }}>
      {rail}
      {Number.isFinite(elo) && (
        <Block title="Elo" sub="tous les clubs classés">
          <Figure
            value={number(elo)}
            caption={rank && <>{ordinal(rank.rank)} sur {number(rank.of)}</>}
          />
        </Block>
      )}
    </SideContext>
  );
}

/* ---------- Competition: the column beside the table, and the projection ---------- */
export function CompetitionSide({ competition, season, projection, view, highlights }) {
  const levels = useLeagueLevels();
  const strength = levels ? leagueStrength(levels, competition.id) : null;
  const rows = projection ? projectionRows(projection) : [];
  const played = rows.length ? rows.reduce((sum, row) => sum + (row.played || 0), 0) / 2 : null;
  const total = rows.length > 1 ? rows.length * (rows.length - 1) : null;
  const title = [...rows].sort((a, b) => (b.title || 0) - (a.title || 0)).filter((row) => row.title > 0).slice(0, 3);
  const down = [...rows].sort((a, b) => (b.bottomThree || 0) - (a.bottomThree || 0)).filter((row) => row.bottomThree > 0).slice(0, 3);
  // The projection tab shows the whole projection: its summary would say it twice.
  const showProjection = view !== "projection" && projection?.format !== "knockout" && (title.length || down.length);
  return (
    <SideContext
      summary={{
        label: competition.name,
        value: strength?.score != null ? `Niveau ${number(Math.round(strength.score))}` : season,
      }}
    >
      {highlights}
      {showProjection ? (
        <Block title="Projection" sub="fin de saison">
          <Row label="Matchs joués" value={played != null ? number(played) : null} unit={total ? `/ ${number(total)}` : null} />
          {title.length > 0 && <h4 className="sx-sub">Titre</h4>}
          {title.map((row) => <Meter key={row.id} label={row.name} share={row.title} />)}
          {down.length > 0 && <h4 className="sx-sub">Relégation</h4>}
          {down.map((row) => <Meter key={row.id} label={row.name} share={row.bottomThree} />)}
        </Block>
      ) : null}
    </SideContext>
  );
}

/* ---------- Match: what the page leaves out (the events; the forecast of a match to come) ---------- */
const EVENT = {
  goal: "But",
  yellowcard: "Carton jaune",
  secondyellow: "2e jaune",
  redcard: "Carton rouge",
  substitution: "Changement",
};
export function MatchSide({ match, view, upcoming }) {
  const events = useMatchSection(match, "events")?.data?.events;
  // A match to come: its forecast lives in the « Avant-match » tab, not on the overview.
  const forecast = matchForecast(useMatchForecast(match.id, upcoming)?.forecast);
  const side = (teamId) => (teamId === match.home?.id ? match.home?.name : teamId === match.away?.id ? match.away?.name : "");
  const items = (events || [])
    .filter((event) => EVENT[event.event_type])
    .map((event, index) => ({
      key: `${event.minute}-${index}`,
      state: "done",
      label: `${EVENT[event.event_type]}${event.is_own_goal ? " c.s.c." : ""} · ${event.event_type === "substitution" ? `${event.sub_in_player?.name || ""} ↔ ${event.player?.name || ""}` : event.player?.name || side(event.team_id)}`,
      time: `${event.minute}'${event.minute_added ? `+${event.minute_added}` : ""}`,
    }));
  const score = [match.home?.score, match.away?.score];
  const scored = score.every((value) => value != null && value !== "");
  return (
    <SideContext summary={{ label: `${match.home?.name} – ${match.away?.name}`, value: scored ? score.join("–") : null }}>
      {forecast && view !== "context" && (
        <Block title="Pronostic" sub="avant le match">
          <Odds {...forecast} labels={[match.home?.name, match.away?.name]} />
        </Block>
      )}
      {items.length > 0 && (
        <Block title="Événements" sub="chronologie">
          <Timeline items={items} />
        </Block>
      )}
    </SideContext>
  );
}

/* ---------- A player of a list: the figures the table's columns leave out ---------- */
const HIDDEN = new Set(["matches", "minutes", "score", "grade"]);
export function PlayerSide({ row, shown = [] }) {
  if (!row) return null;
  const inTable = new Set(shown);
  const figures = Object.entries(SEASON_METRICS)
    .filter(([key]) => !inTable.has(key) && !HIDDEN.has(key) && Number.isFinite(row[key]))
    .slice(0, 14);
  if (!figures.length) return null;
  return (
    <SideContext summary={{ label: row.name, value: null }}>
      <Block title={row.name} sub="hors colonnes du tableau">
        {figures.map(([key, metric]) => (
          <Row
            key={key}
            label={metric.label}
            value={number(metric.ratio ? row[key] * (row[key] <= 1 ? 100 : 1) : row[key], metric.ratio ? 0 : metric.decimals ?? 2)}
            unit={metric.unit}
          />
        ))}
      </Block>
    </SideContext>
  );
}

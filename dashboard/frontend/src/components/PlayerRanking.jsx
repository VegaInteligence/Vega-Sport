"use client";
/* Player side of the comparison: the club-level filter of the position
 * cohort and the full ranking behind one indicator. */
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { seasonMetric } from "../services/season-player.js";
import { SCOUT_METRICS } from "../services/scouting.js";
import { percentile } from "../services/player-profile.js";
import { number } from "../services/format.js";
import { RankingDialog } from "./RankingDialog.jsx";
import s from "./PlayerRanking.module.css";

/**
 * Level switch above the analysis. `peers` is levelPeerClubs()'s result,
 * null when the club is outside the European pool.
 */
export function PlayerLevelBar({ level, onLevel, state, peers, team }) {
  const outside = level && state.status === "ready" && !peers;
  return (
    <section className={s.bar} aria-label="Joueurs comparés">
      <span className={s.label}>Comparer à</span>
      <div
        className="segmented-control"
        role="group"
        aria-label="Niveau des clubs des joueurs comparés"
      >
        <button aria-pressed={level} onClick={() => onLevel(true)}>
          Clubs de niveau comparable
        </button>
        <button aria-pressed={!level} onClick={() => onLevel(false)}>
          Tous les clubs
        </button>
      </div>
      {level && (state.status !== "ready" || outside) && (
        <p className={s.summary} role="status">
          {state.status === "loading"
            ? "Lecture des niveaux des clubs du Top 7 européen…"
            : state.status === "error"
              ? state.error
              : `${team?.name || "Son club"} n’est pas dans le Top 7 européen : comparaison avec tous les clubs.`}
        </p>
      )}
    </section>
  );
}

/** Every eligible peer behind one indicator, per 90 minutes. */
export function PlayerRankingDialog({ profile, cohorts, metricKey, onClose }) {
  const f = useFootball();
  const definition = SCOUT_METRICS[metricKey];
  const cohort = cohorts.groups.get(profile.role?.group);
  const inverted = Boolean(definition?.lowerIsBetter);
  const values = cohort?.distributions[metricKey] || [];
  const entries = (cohort?.profiles || [])
    .map((peer) => ({ peer, metric: seasonMetric(peer, metricKey, "per90") }))
    .filter(
      ({ peer, metric }) =>
        metric.value != null &&
        metric.count === peer.matches &&
        metric.minutes === peer.minutes,
    )
    .sort((a, b) =>
      inverted
        ? a.metric.value - b.metric.value
        : b.metric.value - a.metric.value,
    );
  const unit = definition?.unit ? ` ${definition.unit}` : " / 90";
  const rows = entries.map(({ peer, metric }) => {
    const better = entries.filter(({ metric: other }) =>
      inverted ? other.value < metric.value : other.value > metric.value,
    ).length;
    const raw = values.length ? percentile(values, metric.value) : null;
    return {
      id: peer.id,
      rank: better + 1,
      name: peer.name,
      imageUrl: peer.imageUrl,
      meta: [peer.teams?.join(" · "), `${number(peer.minutes)} min`]
        .filter(Boolean)
        .join(" · "),
      value: `${number(metric.value, definition?.unit ? 1 : 2)}${unit}`,
      centile: raw == null ? null : inverted ? 100 - raw : raw,
      href: f.href("/joueurs/", { id: peer.id, q: "" }),
    };
  });
  return (
    <RankingDialog
      title={`${definition?.label || metricKey}${definition?.unit ? "" : " / 90"}`}
      subtitle={`${rows.length} ${profile.role?.peers || "joueurs du même poste"} · au moins ${cohorts.minMinutes} min`}
      note={
        inverted
          ? "Moins = mieux : du plus bas au plus haut."
          : "Du meilleur au moins bon, par 90 minutes."
      }
      rows={rows}
      selfId={profile.id}
      onClose={onClose}
    />
  );
}

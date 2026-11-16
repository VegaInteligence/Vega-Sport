"use client";
/* The overview's « Profil de jeu » and « Contexte d'équipe »: where the player acts, the foot
 * he shoots with and where from (/api/players/{id}/style), and his club's style as the club
 * page reads it in its league (the same cohort, the same centiles and tags). */
import React, { useMemo } from "react";
import { Skeleton } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { FoldCard } from "./PlayerCareerCards.jsx";
import { clubStyles as c, StyleSpectrum, styleTags } from "./ClubScoutUI.jsx";
import { clubLeagues, STYLE_AXES, useLeagueCohort } from "../services/club-scout.js";
import { boxReading, footReading, passReading, usePlayerStyle, zoneReading } from "../services/profile-blocks.js";
import { number } from "../services/format.js";
import s from "./PlayerScout.module.css";

const TEAM_AXES = STYLE_AXES.filter((axis) => ["possession", "fieldTilt", "directness", "ppda"].includes(axis.key));

export function PlayStyleCard({ id, season }) {
  const [ref, visible] = useVisibleIntent(`play-style:${id}:${season}`, Boolean(id && season));
  const style = usePlayerStyle(id, season, visible);
  const lines = [zoneReading(style.value?.zones), footReading(style.value?.shots), boxReading(style.value?.shots)].filter(Boolean);
  return (
    <FoldCard title="Profil de jeu" text="Où il joue et comment il frappe, sur la saison" sectionRef={ref}>
        {!visible || style.loading ? (
          <Skeleton label="Chargement du profil de jeu…" lines={3} />
        ) : style.error ? (
          <p className={s.note} role="alert">
            Profil indisponible. <button onClick={style.retry}>Réessayer</button>
          </p>
        ) : lines.length ? (
          <div className={s.styleLines}>
            {lines.map((line) => (
              <div key={line.title}>
                <strong>{line.title}</strong>
                <p>{line.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className={s.note}>Pas assez de matchs ni de tirs cette saison pour décrire son jeu.</p>
        )}
    </FoldCard>
  );
}

export function TeamContextCard({ id, season, team }) {
  const f = useFootball();
  const [ref, visible] = useVisibleIntent(`team-context:${id}:${team?.id}:${season}`, Boolean(team?.id && season));
  const league = useMemo(
    () => (team?.id && f.data?.matches ? clubLeagues(f.data, team.id).league || null : null),
    [team?.id, f.data],
  );
  const cohort = useLeagueCohort(visible ? league : null);
  const style = usePlayerStyle(id, season, visible);
  const club = cohort.status === "ready" ? cohort.value.clubs.find((c) => c.id === team.id) : null;
  const passes = passReading(style.value?.passes);
  const tags = club ? styleTags(club).slice(0, 3) : [];
  return (
      <FoldCard
        sectionRef={ref}
        title="Contexte d’équipe"
        text={club ? `${team.name} en ${league.name}, parmi ${number(cohort.value.clubs.length)} clubs` : team ? `Style de ${team.name}` : "Style de son équipe"}
      >
        {!team || (!league && f.data?.matches) ? (
          <p className={s.note}>Pas de championnat pour situer son équipe cette saison.</p>
        ) : !visible || cohort.status === "loading" || cohort.status === "idle" ? (
          <Skeleton label="Chargement du style de l’équipe…" lines={3} />
        ) : cohort.status === "error" ? (
          <p className={s.note} role="alert">Style de l’équipe indisponible.</p>
        ) : club ? (
          <>
            {tags.length > 0 && (
              <div className={c.tags} style={{ marginBottom: 12 }}>
                {tags.map((tag) => (
                  <span key={tag} className={c.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <StyleSpectrum dossier={cohort.value} club={club} axes={TEAM_AXES} />
          </>
        ) : (
          <p className={s.note}>Son équipe n’a pas encore de match analysé dans ce championnat.</p>
        )}
        {passes && (
          <p className={s.note} style={{ marginTop: 12 }}>
            <b style={{ color: "var(--ink-strong)" }}>{passes.text}</b>
            {passes.rank ? `, ${passes.rank}` : ""} · {passes.note}.
          </p>
        )}
      </FoldCard>
  );
}

"use client";
/* A player of « Compositions » before the kick-off, in his bubble: his last five matches of the season, every club
 * competition, and four figures chosen by his line, then a link to his page (FAILURE_MODES § 71). */
import React from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { readCompact } from "../services/compact-reads.js";
import { LINE_LABEL, RECENT_MATCHES, recentForm, recentKey, recentParams } from "../services/player-recent.js";
import { GRADE_HIGH } from "../services/grades.js";
import s from "./MatchTabs.module.css";

const tone = (grade) => (grade == null ? "" : grade >= GRADE_HIGH ? s.gradeHigh : grade < 45 ? s.gradeLow : "");
const whole = (value) => Math.round(value).toLocaleString("fr-FR");
const ddmm = (day) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : "");

export default function PlayerRecent({ playerId, name, matchId, positionId, season, replaces = null }) {
  const f = useFootball();
  const params = recentParams(f.manifest, playerId, season);
  const read = useResource(recentKey(params), ({ signal } = {}) => readCompact("player", params, { signal }), Boolean(playerId && season));
  const value = read.value;
  const form = value ? recentForm(value.data || value, { playerId, matchId, positionId }) : null;
  const label = LINE_LABEL[form?.line] || "Joueur";
  const n = form?.matches.length || 0;
  return (
    <div className={s.recent} data-player-recent={playerId}>
      <p className={s.bubbleHead}>
        <span>{name}</span>
        {form?.grade != null && (
          <span className={`${s.grade} ${tone(form.grade)}`} title="Note moyenne de ces matchs">
            {whole(form.grade)}
          </span>
        )}
      </p>
      {form ? (
        <p className={s.bubbleNote}>
          {n
            ? `${label} · ${n === RECENT_MATCHES ? `${n} derniers matchs joués` : n > 1 ? `${n} derniers matchs joués` : "1 match joué"} · ${whole(form.minutes)} min`
            : `${label} · aucun match joué cette saison`}
        </p>
      ) : (
        <p className={s.bubbleNote}>{read.error ? "Derniers matchs indisponibles." : "Lecture des derniers matchs…"}</p>
      )}
      {replaces}
      {n > 0 && (
        <ul className={s.recentStrip}>
          {form.matches.map((m) => (
            <li key={m.matchId} data-recent-match={m.matchId}>
              <small>{ddmm(m.date)}</small>
              <span className={s.recentComp}>{m.competition}</span>
              <span className={s.recentMinutes}>{m.minutes}′</span>
              <b className={`${s.recentGrade} ${tone(m.grade)}`}>{m.grade == null ? "–" : whole(m.grade)}</b>
            </li>
          ))}
        </ul>
      )}
      {form?.tiles.length > 0 && (
        <dl className={s.recentTiles}>
          {form.tiles.map((t) => (
            <div key={t.label}>
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Link className={s.recentLink} href={f.href("/joueurs/", { id: playerId, season, league: "", q: "" })} prefetch={false}>
        Voir la fiche du joueur
      </Link>
    </div>
  );
}

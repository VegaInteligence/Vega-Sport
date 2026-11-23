"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { Card, Grade, Media } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { raceRowsThatFit, roundLabel, roundStar, teamLines, useLeagueRound, useLeagueRounds } from "../services/league-rounds.js";

// The race's rows on a phone, where the two cards stand one under the other.
const STACKED_RACE_ROWS = 5;

/** Lines standing in for a card while it loads. */
function Skeleton({ rows = 3 }) {
  return (
    <div className="round-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${70 - i * 12}%` }} />
      ))}
    </div>
  );
}

function shortName(name = "") {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

/** The closed rounds of a league, latest first, to pick one from (nothing with a single one). */
export function RoundSelect({ closed, value, onChange }) {
  if (closed.length < 2) return null;
  return (
    <div className="filter-field league-round-select">
      <div className="filter-input-wrap">
        <select aria-label="Journée" value={value} onChange={(event) => onChange(event.target.value)}>
          {closed.map((r) => (
            <option key={r.key} value={r.key}>
              {roundLabel(r)}
            </option>
          ))}
        </select>
        <Icon name="chevron" className="select-chevron" />
      </div>
    </div>
  );
}

/**
 * A league's Player of the Season race and Team of the Round (backend/vega/rounds.py), after
 * its latest closed matchweek or one picked among the closed ones. Nothing for a league
 * without a closed round. « Tous les joueurs » opens the whole race (`onAllPlayers`, VI-44); the
 * Team of the Round's best grade wears the Player of the Round's crown.
 */
export default function LeagueRoundCards({ competition, season, onAllPlayers }) {
  const f = useFootball();
  const rounds = useLeagueRounds(competition, season);
  const [picked, setPicked] = useState("");
  const round = useLeagueRound(competition, season, picked || rounds.value?.latest || "");
  const closed = (rounds.value?.rounds || []).filter((r) => r.status !== "open").reverse();
  // Beside the Team of the Round the race fills its card: its list sits in what the card
  // leaves (it never sets the row's height) and shows the whole rows that fit there.
  const fill = useRef(null);
  const [fits, setFits] = useState(null);
  useEffect(() => {
    const box = fill.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const list = box.firstElementChild;
      const row = list?.querySelector("li");
      if (!list || !row) return;
      const style = getComputedStyle(list);
      if (style.position !== "absolute") return setFits(STACKED_RACE_ROWS);
      setFits(raceRowsThatFit({ available: box.clientHeight, rowHeight: row.getBoundingClientRect().height, gap: parseFloat(style.rowGap) || 0, max: list.childElementCount }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [round.value]);
  if (!rounds.loading && !rounds.value?.latest) return null;
  const body = round.value;
  const lines = teamLines(body?.team);
  const star = roundStar(body?.team);
  return (
    <div className="league-round-cards">
      <Card
        title="Joueur de la saison"
        className="league-race"
        action={
          onAllPlayers && Number.isFinite(body?.raceTotal) && body.raceTotal > 0 && (
            <button type="button" className="competition-highlights-more" onClick={onAllPlayers}>
              Tous les joueurs
            </button>
          )
        }
      >
        {(body ? `Après la ${roundLabel(body.round).toLowerCase()} · note Vega moyenne de ses matchs, resserrée vers 50 tant qu’il a peu joué` : undefined) && <p className="card-note">{body ? `Après la ${roundLabel(body.round).toLowerCase()} · note Vega moyenne de ses matchs, resserrée vers 50 tant qu’il a peu joué` : undefined}</p>}
        {round.loading || rounds.loading ? (
          <Skeleton />
        ) : !body?.race?.length ? (
          <p className="standings-note">Pas encore assez de matchs joués pour départager les joueurs.</p>
        ) : (
          <div className="league-race-fill" ref={fill}>
          <ol className="league-race-list">
            {body.race.slice(0, fits ?? body.race.length).map((p) => (
              <li key={p.playerId}>
                <span className="league-race-rank">{p.rank}</span>
                <Link className="power-ranking-name" href={f.href("/joueurs/", { id: p.playerId })} prefetch={false}>
                  <Media name={p.name} url={p.imageUrl} className="player-avatar" />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.team} · {number(p.matches)} matchs
                    </small>
                  </span>
                </Link>
                <Grade value={p.grade} title="Note Vega de la saison dans ce championnat, sur 100" />
              </li>
            ))}
          </ol>
          </div>
        )}
      </Card>
      <Card
        title="Équipe de la journée"
        className="league-team"
        action={<RoundSelect closed={closed} value={picked || rounds.value?.latest || ""} onChange={setPicked} />}
      >
        {(body?.team ? `${body.team.formation} · les meilleures notes Vega de la journée, à partir de 60 minutes` : undefined) && <p className="card-note">{body?.team ? `${body.team.formation} · les meilleures notes Vega de la journée, à partir de 60 minutes` : undefined}</p>}
        {round.loading || rounds.loading ? (
          <Skeleton rows={4} />
        ) : !body?.team ? (
          <p className="standings-note">Pas assez de matchs notés dans cette journée pour composer une équipe.</p>
        ) : (
          <div className="team-pitch" role="list" aria-label={`Équipe de la ${roundLabel(body.round).toLowerCase()}, ${body.team.formation}`}>
            {lines.map((line, i) => (
              <div className="team-pitch-line" key={i}>
                {line.map((p) => (
                  <Link
                    key={p.slot}
                    role="listitem"
                    className="team-pitch-player"
                    href={f.href("/joueurs/", { id: p.playerId })}
                    prefetch={false}
                    title={`${p.name} · ${p.team} · ${p.position} · ${number(p.minutes)} min`}
                  >
                    <span className="team-pitch-avatar">
                      {p.slot === star && (
                        <span className="team-pitch-crown" role="img" aria-label="Joueur de la journée" title="Joueur de la journée">
                          <Icon name="crown" />
                        </span>
                      )}
                      <Media name={p.name} url={p.imageUrl} className="player-avatar" />
                      <Grade value={p.grade} title="Note Vega du match sur 100" />
                    </span>
                    <span className="team-pitch-name">{shortName(p.name)}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

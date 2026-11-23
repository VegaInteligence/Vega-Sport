"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Empty, Grade, Media, Pager } from "./UI.jsx";
import { RoundSelect } from "./LeagueRoundCards.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { racePage, roundLabel, useLeagueRace, useLeagueRounds } from "../services/league-rounds.js";

/**
 * A league's « Joueurs » view (VI-44): the whole Player of the Season race after a closed
 * round, by the card's rule and with its grade, 20 a page.
 */
export default function LeagueRace({ competition, season }) {
  const f = useFootball();
  const rounds = useLeagueRounds(competition, season);
  const [picked, setPicked] = useState("");
  const [page, setPage] = useState(1);
  const key = picked || rounds.value?.latest || "";
  const race = useLeagueRace(competition, season, key);
  const closed = (rounds.value?.rounds || []).filter((r) => r.status !== "open").reverse();
  const body = race.value;
  const shown = racePage(body?.race, page);
  const loading = rounds.loading || race.loading;
  return (
    <div className="league-race-view">
      <div className="league-race-view-head">
        <p className="card-note">{body ? `Après la ${roundLabel(body.round).toLowerCase()} · note Vega moyenne de ses matchs, resserrée vers 50 tant qu’il a peu joué` : " "}</p>
        <RoundSelect
          closed={closed}
          value={key}
          onChange={(next) => {
            setPicked(next);
            setPage(1);
          }}
        />
      </div>
      {loading && !body ? (
        <div className="round-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="skeleton-line" style={{ width: `${80 - i * 8}%` }} />
          ))}
        </div>
      ) : race.error ? (
        <div className="notice" role="alert">
          Course indisponible.{" "}
          <button className="button button-secondary" onClick={race.retry}>
            Réessayer
          </button>
        </div>
      ) : !body?.race?.length ? (
        <Empty>Pas encore assez de matchs joués pour départager les joueurs.</Empty>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="Course au joueur de la saison" tabIndex={0}>
            <table className="data-table league-race-table" aria-label="Course au joueur de la saison">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Joueur</th>
                  <th scope="col" className="league-race-minutes">Minutes</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((p) => (
                  <tr key={p.playerId}>
                    <td className="league-race-rank">{p.rank}</td>
                    <th scope="row">
                      <Link className="power-ranking-name" href={f.href("/joueurs/", { id: p.playerId })} prefetch={false}>
                        <Media name={p.name} url={p.imageUrl} className="player-avatar" />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.team} · {number(p.matches)} matchs
                          </small>
                        </span>
                      </Link>
                    </th>
                    <td className="league-race-minutes">{number(p.minutes)}</td>
                    <td>
                      <Grade value={p.grade} title="Note Vega de la saison dans ce championnat, sur 100" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={shown.page} total={shown.pages} onChange={setPage} label="Pages de la course" />
        </>
      )}
    </div>
  );
}

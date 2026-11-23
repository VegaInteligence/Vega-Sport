import React, { useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { AsyncState, Empty, Media } from "./UI.jsx";
import { Term } from "./Hint.jsx";
import { ZoneLegend } from "./CompetitionStandings.jsx";
import { ZONES } from "../services/standings-zones.js";
import { date, number } from "../services/format.js";
import { matchdayLabel, shortClub, useLeagueHistory } from "../services/league-history.js";

/** A club of an archived season: a link to its page when the site holds it, its name otherwise. */
function Club({ club, className, crestAfter = false }) {
  const f = useFootball();
  const crest = <Media name={club.name} url={club.imageUrl} />;
  const body = crestAfter ? <><span>{club.name}</span>{crest}</> : <>{crest} <span>{club.name}</span></>;
  return club.id ? (
    <Link className={className} href={f.href("/clubs/", { id: club.id, season: f.season })} prefetch={false}>{body}</Link>
  ) : (
    <span className={className}>{body}</span>
  );
}

function Table({ rows }) {
  const zones = rows.map((r) => r.zone);
  return (
    <div className="competition-standings">
      <div className="table-scroll standings-scroll" role="region" aria-label="Classement de la compétition" tabIndex={0}>
        <table className="data-table standings-table">
          <caption className="sr-only">Classement</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col"><Term>Équipe</Term></th>
              {["Pts", "J", "G", "N", "D", "BP", "BC", "Diff."].map((t) => (
                <th scope="col" key={t}><Term>{t}</Term></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.goalsFor - r.goalsAgainst;
              return (
                <tr key={r.rank} data-zone={r.zone || undefined} title={r.zone ? ZONES[r.zone].label : undefined}>
                  <td>{r.rank}</td>
                  <th scope="row"><Club club={r.team} className="standings-team" /></th>
                  <td className="standings-points" title={r.deduction ? `${r.deduction} point(s) retiré(s)` : undefined}>
                    {r.points}{r.deduction ? "*" : ""}
                  </td>
                  <td>{r.played}</td>
                  <td>{r.wins}</td>
                  <td>{r.draws}</td>
                  <td>{r.losses}</td>
                  <td>{r.goalsFor}</td>
                  <td>{r.goalsAgainst}</td>
                  <td>{diff > 0 ? "+" : ""}{diff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ZoneLegend zones={zones} observed />
    </div>
  );
}

function Matchdays({ groups }) {
  const [index, setIndex] = useState(groups.length - 1);
  const current = groups[Math.min(Math.max(index, 0), groups.length - 1)];
  if (!current) return <Empty>Aucun match.</Empty>;
  const label = matchdayLabel(current);
  return (
    <section className="matchday-schedule" aria-label="Matchs par journée">
      <div className="matchday-toolbar">
        <h3 className="matchday-heading" aria-live="polite">{label}</h3>
        <nav className="matchday-navigation" aria-label="Navigation entre les journées">
          <button type="button" className="button button-secondary matchday-arrow" aria-label="Journée précédente" disabled={index <= 0} onClick={() => setIndex(index - 1)}>←</button>
          <label className="sr-only" htmlFor="matchday-choice">Choisir une journée</label>
          <select id="matchday-choice" value={String(index)} onChange={(e) => setIndex(Number(e.target.value))}>
            {groups.map((g, i) => <option key={i} value={String(i)}>{matchdayLabel(g)}</option>)}
          </select>
          <button type="button" className="button button-secondary matchday-arrow" aria-label="Journée suivante" disabled={index >= groups.length - 1} onClick={() => setIndex(index + 1)}>→</button>
        </nav>
      </div>
      {current.matches.map((m, i) => (
        <div className="match-row" key={i}>
          <span className="match-date">{m.date ? date(m.date) : ""}</span>
          <span className="match-teams">
            <Club club={m.home} className="team-name home-team" crestAfter />
            <strong className="score">{m.score ? `${m.score[0]} – ${m.score[1]}` : "–"}</strong>
            <Club club={m.away} className="team-name" />
          </span>
        </div>
      ))}
    </section>
  );
}

function Players({ players }) {
  const [all, setAll] = useState(false);
  const appearances = players.kind === "appearances";
  const rows = all ? players.rows : players.rows.slice(0, 30);
  if (!players.rows.length) return <Empty>Aucun buteur dans les archives de cette saison.</Empty>;
  return (
    <div className="league-race-view">
      <div className="table-scroll" role="region" aria-label="Buteurs de la saison" tabIndex={0}>
        <table className="data-table league-race-table" aria-label="Buteurs de la saison">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Joueur</th>
              {appearances && <th scope="col" className="league-race-minutes">Minutes</th>}
              {appearances && <th scope="col" className="league-race-minutes">Passes D.</th>}
              <th scope="col">Buts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={`${p.name}:${p.club.name}`}>
                <td className="league-race-rank">{i + 1}</td>
                <th scope="row">
                  <span className="power-ranking-name">
                    <Media name={p.name} url={p.imageUrl} className="player-avatar" />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.club.name}{appearances ? ` · ${p.matches} matchs` : ""}</small>
                    </span>
                  </span>
                </th>
                {appearances && <td className="league-race-minutes">{number(p.minutes)}</td>}
                {appearances && <td className="league-race-minutes">{p.assists}</td>}
                <td><span className="rating-pill">{p.goals}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {players.incomplete && <p className="standings-note">Feuilles de match incomplètes cette saison : totaux sous-estimés.</p>}
      {!all && players.rows.length > rows.length && (
        <button type="button" className="button button-secondary" onClick={() => setAll(true)}>
          Les {players.rows.length} joueurs
        </button>
      )}
    </div>
  );
}

/** The side column: the season in four lines, then its last matchday. */
export function LeagueHistoryRail({ value }) {
  const s = value.summary;
  const last = value.matchdays.at(-1);
  return (
    <aside className="competition-highlights competition-highlights--level" aria-label="La saison">
      <section className="card competition-highlights-card competition-level">
        <div className="card-header"><h2 className="card-title">Saison {value.season}</h2></div>
        <div className="card-body">
          <ul className="competition-level-rows" aria-label="La saison">
            {s.champion && <li><span>Champion</span><span>{s.champion.team.name} · {s.champion.points} pts</span></li>}
            {s.topScorer && <li><span>Meilleur buteur</span><span>{s.topScorer.name} · {s.topScorer.goals}</span></li>}
            {s.goalsPerMatch != null && <li><span>Buts par match</span><span>{s.goalsPerMatch.toFixed(2).replace(".", ",")}</span></li>}
            {s.relegated.length > 0 && <li><span>Relégués</span><span>{s.relegated.map((t) => shortClub(t.name)).join(", ")}</span></li>}
          </ul>
        </div>
      </section>
      {last && (
        <section className="card competition-highlights-card">
          <div className="card-header"><h2 className="card-title">{matchdayLabel(last)}</h2></div>
          <div className="card-body">
            {last.matches.slice(0, 6).map((m, i) => (
              <div className="competition-highlight-match" key={i}>
                <span className="competition-highlight-date">{m.date ? date(m.date) : ""}</span>
                {[[m.home, m.score?.[0]], [m.away, m.score?.[1]]].map(([club, goals], k) => (
                  <span className="competition-highlight-team" key={k}>
                    <Media name={club.name} url={club.imageUrl} />
                    <span className="competition-highlight-name">{club.name}</span>
                    <strong className="competition-highlight-score">{goals ?? ""}</strong>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

/** An archived season's view: the table, the matchdays or the players (`view`), from GET /api/league-history. */
export function LeagueHistoryView({ resource, view }) {
  return (
    <AsyncState resource={resource}>
      {(value) =>
        !value ? (
          <Empty>Saison indisponible.</Empty>
        ) : view === "matches" ? (
          <Matchdays key={value.season} groups={value.matchdays} />
        ) : view === "players" ? (
          <Players players={value.players} />
        ) : (
          <Table rows={value.standings} />
        )
      }
    </AsyncState>
  );
}

export { useLeagueHistory };

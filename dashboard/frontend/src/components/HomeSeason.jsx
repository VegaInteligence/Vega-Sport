"use client";
import Link from "next/link";
import React, { useState } from "react";
import Icon from "./Icon.jsx";
import BallonDorIcon from "./BallonDorIcon.jsx";
import { Media } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { kickoffFormatter } from "../services/fixtures.js";
import { leagueOf, shortCompetition } from "../services/home-insights.js";
import {
  ChartTip,
  countdown,
  fixtureHref,
  FormDots,
  Kicker,
  lastName,
  ordinal,
  relativeDay,
} from "./HomeCommon.jsx";

const RACE_COLORS = [
  "var(--home-c1)",
  "var(--home-c2)",
  "var(--home-c3)",
  "var(--home-c4)",
  "var(--home-c5)",
];
const RACE_SIZE = 5;
const W = 520,
  H = 290,
  P = { l: 26, r: 30, t: 12, b: 22 };

/** Points after every matchday; hovering shows the table at that matchday. */
function RaceChart({ table, focus, onFocus }) {
  const [day, setDay] = useState(null);
  const teams = table.rows.slice(0, RACE_SIZE);
  const n = Math.max(1, ...teams.map((t) => t.cumulative.length)),
    top = Math.max(3, ...teams.map((t) => t.points)) + 2;
  const X = (i) => P.l + (i / n) * (W - P.l - P.r),
    Y = (v) => H - P.b - (v / top) * (H - P.t - P.b);
  const step = top > 60 ? 20 : top > 30 ? 10 : 5;
  const grid = Array.from(
    { length: Math.floor(top / step) + 1 },
    (_, i) => i * step,
  );
  const every = n > 24 ? 4 : n > 12 ? 2 : 1;
  const points = (t, j) =>
    j === 0 ? 0 : t.cumulative[Math.min(j, t.cumulative.length) - 1];
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect(),
      vx = ((event.clientX - rect.left) / rect.width) * W;
    setDay(
      Math.max(1, Math.min(n, Math.round(((vx - P.l) / (W - P.l - P.r)) * n))),
    );
  }
  const standings =
    day &&
    teams
      .map((t, i) => ({ t, i, points: points(t, day) }))
      .sort((a, b) => b.points - a.points);
  return (
    <div className="home-viz">
      <svg
        className="home-race-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Points cumulés du top ${teams.length} après ${table.played} journées`}
        onPointerMove={move}
        onPointerLeave={() => setDay(null)}
      >
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
        {grid.map((v) => (
          <g key={v}>
            <line
              x1={P.l}
              x2={W - P.r}
              y1={Y(v)}
              y2={Y(v)}
              className="home-grid"
            />
            <text
              x={P.l - 7}
              y={Y(v) + 3.5}
              textAnchor="end"
              className="home-axis"
            >
              {v}
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => i + 1)
          .filter((i) => i % every === 0)
          .map((i) => (
            <text
              key={i}
              x={X(i)}
              y={H - 6}
              textAnchor="middle"
              className="home-axis"
            >
              J{i}
            </text>
          ))}
        {day && (
          <line
            x1={X(day)}
            x2={X(day)}
            y1={P.t}
            y2={H - P.b}
            className="home-guide"
          />
        )}
        {teams.map((t, i) => {
          const dim = focus && focus !== t.id;
          return (
            <g key={t.id} className={dim ? "is-dim" : ""}>
              <path
                d={[0, ...t.cumulative]
                  .map(
                    (v, j) =>
                      `${j ? "L" : "M"}${X(j).toFixed(1)},${Y(v).toFixed(1)}`,
                  )
                  .join("")}
                fill="none"
                stroke={RACE_COLORS[i]}
                strokeWidth={focus === t.id || (!focus && i === 0) ? 2.8 : 1.8}
                strokeLinejoin="round"
                onPointerEnter={() => onFocus(t.id)}
                onPointerLeave={() => onFocus(null)}
              />
              <circle
                cx={X(t.cumulative.length)}
                cy={Y(t.points)}
                r="3.5"
                fill={RACE_COLORS[i]}
              />
              {day && (
                <circle
                  cx={X(day)}
                  cy={Y(points(t, day))}
                  r="3"
                  fill={RACE_COLORS[i]}
                />
              )}
            </g>
          );
        })}
      </svg>
      {standings && (
        <ChartTip x={(X(day) / W) * 100} y={(Y(standings[0].points) / H) * 100}>
          <b>Journée {day}</b>
          {standings.map(({ t, i, points: pts }) => (
            <span className="home-tip-row" key={t.id}>
              <i style={{ background: RACE_COLORS[i] }} />
              {t.name}
              <b>{pts} pts</b>
            </span>
          ))}
        </ChartTip>
      )}
    </div>
  );
}

/** Points after every game for the top five of each followed league. */
export function TitleRace({ tables, competitions, initial }) {
  const f = useFootball(),
    [league, setLeague] = useState(initial),
    [focus, setFocus] = useState(null);
  const table = tables.find((t) => t.leagueId === league) || tables[0];
  if (!table) return null;
  const leader = table.rows[0],
    second = table.rows[1];
  return (
    <article className="card home-race">
      <div className="home-card-head">
        <div>
          <Kicker>Course au titre</Kicker>
          <h2>Qui décroche en tête ?</h2>
        </div>
        <Link
          className="inline-link"
          href={f.href("/competitions/", { id: table.leagueId })}
        >
          Classement complet <Icon name="arrow" />
        </Link>
      </div>
      {tables.length > 1 && (
        <div className="home-tabs" role="group" aria-label="Championnat">
          {tables.map((t) => {
            const c = competitions.get(t.leagueId);
            return (
              <button
                key={t.leagueId}
                type="button"
                aria-pressed={t.leagueId === table.leagueId}
                onClick={() => setLeague(t.leagueId)}
              >
                <Media
                  name={c?.name || ""}
                  url={c?.imageUrl}
                  className="crest home-crest-xs"
                />
                {c?.name || t.leagueId}
              </button>
            );
          })}
        </div>
      )}
      <div className="home-race-body">
        <RaceChart table={table} focus={focus} onFocus={setFocus} />
        <div className="home-race-legend">
          {table.rows.slice(0, RACE_SIZE).map((t, i) => (
            <Link
              key={t.id}
              className={`home-race-row${focus && focus !== t.id ? " is-dim" : ""}`}
              href={f.href("/clubs/", { id: t.id })}
              prefetch={false}
              onPointerEnter={() => setFocus(t.id)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(t.id)}
              onBlur={() => setFocus(null)}
            >
              <i style={{ background: RACE_COLORS[i] }} />
              <Media name={t.name} url={t.imageUrl} className="crest" />
              <span>
                <strong>{t.name}</strong>
                <small>
                  {i
                    ? `−${leader.points - t.points} pts`
                    : second && leader.points > second.points
                      ? `+${leader.points - second.points} pts d’avance`
                      : "À égalité"}{" "}
                  · <FormDots form={t.form} />
                </small>
              </span>
              <b>{t.points}</b>
            </Link>
          ))}
          {table.games > 0 && (
            <div className="home-progress">
              Journée {table.played} sur {table.games}
              <span>
                <i
                  style={{
                    width: `${Math.min(100, (table.played / table.games) * 100)}%`,
                  }}
                />
              </span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** The next big games: a countdown to the main one, then the others in kickoff order. */
export function NextMatches({ highlights, ranks, competitions, now }) {
  const f = useFootball();
  if (!highlights.length) return null;
  const [main] = highlights,
    rest = highlights.slice(1, 5).sort((a, b) => a.time - b.time);
  const competition = (fixture) =>
    competitions.get(leagueOf(fixture)) || { name: fixture.league?.name };
  const side = (team) => {
    const rank = ranks.get(team.id);
    return (
      <span className="home-next-team">
        <Media
          name={team.name}
          url={team.image_url}
          className="crest home-crest-md"
        />
        <strong>{team.name}</strong>
        <small>{rank ? `${ordinal(rank.rank)} en championnat` : " "}</small>
        <FormDots form={rank?.form} />
      </span>
    );
  };
  const c = competition(main.fixture);
  return (
    <article className="card home-next">
      <div className="home-card-head">
        <div>
          <Kicker>À ne pas manquer</Kicker>
          <h2>Cette semaine</h2>
        </div>
        <Link className="inline-link" href={f.href("/calendrier/")}>
          Calendrier <Icon name="arrow" />
        </Link>
      </div>
      <Link
        className="home-next-main"
        href={fixtureHref(f, main.fixture)}
        prefetch={false}
      >
        <span className="home-next-when">
          <span className="home-meta">
            <Media
              name={c.name || ""}
              url={c.imageUrl}
              className="crest home-crest-xs"
            />
            {c.name}
          </span>
          <b>{countdown(main.time, now)}</b>
        </span>
        <span className="home-next-vs">
          {side(main.fixture.home_team)}
          <em>{kickoffFormatter.format(main.time)}</em>
          {side(main.fixture.away_team)}
        </span>
      </Link>
      <ul className="home-next-list">
        {rest.map(({ fixture, time }) => (
          <li key={fixture.id}>
            <Link href={fixtureHref(f, fixture)} prefetch={false}>
              <span className="home-next-time">
                <b>{kickoffFormatter.format(time)}</b>
                {relativeDay(time, now)}
              </span>
              <span className="home-next-teams">
                {[fixture.home_team, fixture.away_team].map((team, i) => (
                  <span key={i}>
                    <Media
                      name={team.name}
                      url={team.image_url}
                      className="crest home-crest-xs"
                    />
                    <em>{team.name}</em>
                    <small>
                      {i
                        ? shortCompetition(
                            leagueOf(fixture),
                            competition(fixture).name,
                          )
                        : ranks.get(team.id)
                          ? ordinal(ranks.get(team.id).rank)
                          : ""}
                    </small>
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function WinStreak({ streak, competitions, next, now }) {
  const f = useFootball();
  if (!streak) return null;
  const c = competitions.get(streak.leagueId);
  return (
    <article className="card home-trend home-streak">
      <Kicker>En série</Kicker>
      <div className="home-streak-head">
        <b>{streak.streak}</b>
        <span>
          <strong>victoires d’affilée</strong>
          <Link href={f.href("/clubs/", { id: streak.id })} prefetch={false}>
            <Media
              name={streak.name}
              url={streak.imageUrl}
              className="crest home-crest-xs"
            />
            {streak.name}
          </Link>
        </span>
      </div>
      <span className="home-streak-dots" aria-hidden="true">
        {Array.from({ length: Math.min(streak.streak, 20) }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <p className="home-trend-lead">
        {ordinal(streak.rank)}
        {c?.name ? ` de ${c.name}` : ""} · {streak.points} pts en{" "}
        {streak.played} matchs
      </p>
      {next && (
        <Link
          className="home-streak-next"
          href={fixtureHref(f, next.fixture)}
          prefetch={false}
        >
          <span>
            <small>Prochain test</small>
            <small>
              {relativeDay(next.time, now)} ·{" "}
              {kickoffFormatter.format(next.time)}
            </small>
          </span>
          <span>
            <span>
              <Media
                name={next.fixture.home_team.name}
                url={next.fixture.home_team.image_url}
                className="crest"
              />
              <strong>{next.fixture.home_team.name}</strong>
            </span>
            <span>–</span>
            <span>
              <strong>{next.fixture.away_team.name}</strong>
              <Media
                name={next.fixture.away_team.name}
                url={next.fixture.away_team.image_url}
                className="crest"
              />
            </span>
          </span>
        </Link>
      )}
    </article>
  );
}

/** The meanest defence of the followed leagues. */
export function BestDefence({ defence, competitions }) {
  const f = useFootball();
  if (!defence) return null;
  const c = competitions.get(defence.leagueId);
  return (
    <Link
      className="card home-trend home-defence"
      href={f.href("/clubs/", { id: defence.id })}
      prefetch={false}
    >
      <Kicker>Le mur</Kicker>
      <div className="home-streak-head">
        <b>{number(defence.perGame, 2)}</b>
        <span>
          <strong>but encaissé par match</strong>
          <span className="home-meta">
            <Media
              name={defence.name}
              url={defence.imageUrl}
              className="crest home-crest-xs"
            />
            {defence.name}
          </span>
        </span>
      </div>
      <dl className="home-defence-stats">
        <div>
          <dt>Buts encaissés</dt>
          <dd>{number(defence.goalsAgainst)}</dd>
        </div>
        <div>
          <dt>Matchs sans encaisser</dt>
          <dd>{number(defence.cleanSheets)}</dd>
        </div>
        <div>
          <dt>Classement</dt>
          <dd>
            {ordinal(defence.rank)}
            {c?.name ? ` · ${shortCompetition(defence.leagueId, c.name)}` : ""}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

/** Before the Champions League quarter-finals are over: a link to the ranking with the season progress and current leaders. */
export function BallonDorTeaser({ progress, leaders, ranking }) {
  const f = useFootball(),
    share = Math.round(progress * 100),
    R = 26,
    C = 2 * Math.PI * R;
  return (
    <Link
      className="card home-bdo-teaser"
      href={f.href("/classement-joueurs/")}
    >
      <span className="home-bdo-ring">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r={R} className="home-ring-track" />
          <circle
            cx="32"
            cy="32"
            r={R}
            className="home-ring-value"
            strokeDasharray={`${(C * share) / 100} ${C}`}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <span>
          <b>{share} %</b>
          <small>de la saison jouée</small>
        </span>
      </span>
      <span className="home-bdo-copy">
        <span className="home-chip home-chip-gold">
          <BallonDorIcon className="home-bdo-icon" />
          Ballon d’Or STATARENA · après les quarts de finale
        </span>
        <span className="home-bdo-title">
          Trop tôt pour un classement, pas pour suivre la tendance
        </span>
        <span className="home-bdo-text">
          Chaque joueur est comparé à ce qu’on attend à son poste, match par
          match. La course s’affiche ici dès la fin des quarts de finale retour
          de la Ligue des champions.
        </span>
      </span>
      {(ranking?.length || leaders.length) > 0 && (
        <span className="home-bdo-peek">
          <span>
            {(ranking || leaders).slice(0, 3).map((p) => (
              <Media
                key={p.playerId || p.name}
                name={p.name}
                url={p.imageUrl}
                className="player-avatar"
              />
            ))}
          </span>
          {ranking ? "En tête du classement" : "En tête des notes"} :{" "}
          <b>
            {(ranking || leaders)
              .slice(0, 3)
              .map((p) => lastName(p.name))
              .join(", ")}
          </b>
        </span>
      )}
      <Icon name="arrow" className="home-bdo-arrow" />
    </Link>
  );
}

/** From the end of the Champions League quarter-finals: podium and top ten. */
export function BallonDorRace({ leaders: rated, ratedMin, ranking }) {
  const f = useFootball();
  // The STATARENA ranking replaces the provisional list as soon as it exists.
  const leaders = ranking?.length
    ? ranking.map((e) => ({
        ...e,
        playerId: e.playerId || e.name,
        rating: e.score,
      }))
    : rated;
  if (leaders.length < 3) return null;
  const [first, second, third] = leaders;
  const podium = (p, rank) => (
    <button
      type="button"
      className={`home-pod home-pod-${rank}`}
      onClick={() => f.setPlayer(p.lastId)}
    >
      <span className="home-pod-medal">{rank}</span>
      <Media
        name={p.name}
        url={p.imageUrl}
        className={`player-avatar${rank === 1 ? " home-avatar-xl" : " home-avatar-lg"}`}
      />
      <strong>{p.name}</strong>
      <small>{p.team}</small>
      <b>{number(p.rating, 2)}</b>
      <small>
        {number(p.goals)} buts · {number(p.assists)} passes
      </small>
    </button>
  );
  return (
    <section className="card home-bdo">
      <div className="home-bdo-intro">
        <span className="home-chip home-chip-gold">
          <BallonDorIcon className="home-bdo-icon" />
          La course est lancée
        </span>
        <h2>La course au Ballon d’Or</h2>
        <p>
          Les quarts de finale de la Ligue des champions sont joués : place au
          sprint final.{" "}
          {ranking?.length
            ? "Voici le classement STATARENA de la saison."
            : `En attendant le classement STATARENA, voici les joueurs les mieux notés de la saison (${number(ratedMin)} minutes minimum).`}
        </p>
        <div className="home-podium">
          {podium(second, 2)}
          {podium(first, 1)}
          {podium(third, 3)}
        </div>
      </div>
      <div className="home-bdo-list">
        <div className="home-bdo-row is-head">
          <span>#</span>
          <span />
          <span>Joueur</span>
          <span>{ranking?.length ? "Score" : "Note moy."}</span>
          <span>Buts</span>
          <span>P.d.</span>
        </div>
        {leaders.slice(3, 10).map((p, i) => (
          <button
            type="button"
            key={p.playerId}
            className="home-bdo-row"
            onClick={() => f.setPlayer(p.lastId)}
          >
            <span>{i + 4}</span>
            <Media
              name={p.name}
              url={p.imageUrl}
              className="player-avatar home-avatar-sm"
            />
            <span>
              <strong>{p.name}</strong>
              <small>{p.team}</small>
            </span>
            <b>{number(p.rating, 2)}</b>
            <span>{number(p.goals)}</span>
            <span>{number(p.assists)}</span>
          </button>
        ))}
        <div className="home-bdo-actions">
          <Link
            className="button button-primary"
            href={f.href("/classement-joueurs/")}
          >
            Classement Ballon d’Or <Icon name="arrow" />
          </Link>
          <Link className="button button-secondary" href={f.href("/methode/")}>
            La méthode
          </Link>
        </div>
      </div>
    </section>
  );
}

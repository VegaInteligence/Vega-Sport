"use client";
import Link from "next/link";
import React, { useState } from "react";
import Icon from "./Icon.jsx";
import { Media, Segments } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { Kicker, lastName, matchHref, shortDay } from "./HomeCommon.jsx";

const plural = (n, word) => `${number(n)} ${word}${n > 1 ? "s" : ""}`;
const share = (a, b) =>
  Number.isFinite(a) && b > 0 ? `${number((a / b) * 100)} %` : "—";

/** Poster-style card of the week's best performance, with its recent form and season. */
export function PlayerOfTheWeek({ performance, match, season, recent = [] }) {
  const f = useFootball(),
    p = performance;
  if (!p) return null;
  const duels = (p.duelsWon || 0) + (p.duelsLost || 0);
  return (
    <article className="card home-potw">
      <span className="home-potw-ghost" aria-hidden="true">
        {lastName(p.name)}
      </span>
      <div className="home-potw-top">
        <Kicker tone="green">Joueur de la semaine</Kicker>
        <span className="home-chip">{shortDay(p.date)}</span>
      </div>
      <button
        type="button"
        className="home-potw-id"
        onClick={() => f.setPlayer(p.id)}
      >
        <Media
          name={p.name}
          url={p.imageUrl}
          className="player-avatar home-avatar-xl"
        />
        <span>
          <strong>{p.name}</strong>
          <small>{p.team}</small>
        </span>
      </button>
      <div className="home-potw-big">
        <div>
          <b>{number(p.rating, 2)}</b>
          <span>Note du match</span>
        </div>
        <div>
          <b>{number(p.goals || 0)}</b>
          <span>Buts</span>
        </div>
        <div>
          <b>{number(p.assists || 0)}</b>
          <span>Passes déc.</span>
        </div>
      </div>
      <dl className="home-potw-stats">
        <div>
          <dt>xG</dt>
          <dd>{number(p.xg, 2)}</dd>
        </div>
        <div>
          <dt>Tirs (cadrés)</dt>
          <dd>
            {number(p.shots)} ({number(p.shotsOnTarget)})
          </dd>
        </div>
        <div>
          <dt>Occasions créées</dt>
          <dd>{number(p.chancesCreated)}</dd>
        </div>
        <div>
          <dt>Passes réussies</dt>
          <dd>{share(p.passesAccurate, p.passesAttempted)}</dd>
        </div>
        <div>
          <dt>Duels gagnés</dt>
          <dd>{duels ? `${number(p.duelsWon || 0)}/${number(duels)}` : "—"}</dd>
        </div>
        <div>
          <dt>Touches</dt>
          <dd>{number(p.touches)}</dd>
        </div>
        <div>
          <dt>Actions défensives</dt>
          <dd>{number(p.defensiveActions)}</dd>
        </div>
        <div>
          <dt>Temps de jeu</dt>
          <dd>{number(p.minutes)}′</dd>
        </div>
      </dl>
      {recent.length > 1 && (
        <div className="home-potw-form">
          <span className="home-potw-label">Ses derniers matchs</span>
          <ol>
            {recent.map((r) => (
              <li
                key={r.id}
                title={`${shortDay(r.date)} · ${number(r.rating, 2)}`}
              >
                <i
                  className={r.id === p.id ? "is-current" : ""}
                  style={{
                    height: `${Math.max(8, ((r.rating - 5) / 5) * 100)}%`,
                  }}
                />
                <span>{number(r.rating, 1)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {season && (
        <p className="home-potw-season">
          Sur la saison : <b>{plural(season.goals, "but")}</b>,{" "}
          <b>{plural(season.assists, "passe")}</b>
          {season.rating != null && (
            <>
              , note moyenne <b>{number(season.rating, 2)}</b>
            </>
          )}{" "}
          en {plural(season.apps, "match")}.
        </p>
      )}
      {match && (
        <div className="home-potw-match">
          <span>
            {match.home.name}{" "}
            <b>
              {match.home.score}–{match.away.score}
            </b>{" "}
            {match.away.name}
          </span>
          <Link
            className="inline-link"
            href={matchHref(f, match)}
            prefetch={false}
          >
            Le match <Icon name="arrow" />
          </Link>
        </div>
      )}
    </article>
  );
}

export function AlsoShone({ performances, matches }) {
  const f = useFootball();
  if (!performances.length) return null;
  return (
    <section className="home-section" aria-labelledby="home-also">
      <div className="home-section-head">
        <h2 id="home-also">
          Ils ont aussi brillé{" "}
          <span>Meilleures notes de la semaine, 60 min minimum</span>
        </h2>
        <Link className="inline-link" href={f.href("/joueurs/")}>
          Tous les joueurs <Icon name="arrow" />
        </Link>
      </div>
      <div className="home-rail">
        {performances.map((p) => {
          const m = matches.get(p.matchId);
          return (
            <button
              type="button"
              key={p.id}
              className="card home-rail-card"
              onClick={() => f.setPlayer(p.id)}
            >
              <span className="home-rail-top">
                <Media
                  name={p.name}
                  url={p.imageUrl}
                  className="player-avatar"
                />
                <b>{number(p.rating, 2)}</b>
              </span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.team}</small>
              </span>
              <span className="home-rail-line">
                <b>{number(p.goals || 0)}</b> but{p.goals > 1 ? "s" : ""} ·{" "}
                <b>{number(p.assists || 0)}</b> passe{p.assists > 1 ? "s" : ""}
                {m && (
                  <>
                    {" "}
                    · {m.home.name} {m.home.score}–{m.away.score} {m.away.name}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Goals scored against expected goals: who finishes above or below their chances. */
export function Finishing({ leaders }) {
  const f = useFootball(),
    [mode, setMode] = useState("clinical");
  const list = leaders[mode];
  if (!leaders.clinical.length && !leaders.wasteful.length) return null;
  const max = Math.max(1, ...list.map((p) => Math.max(p.goals, p.xg))) * 1.08;
  return (
    <article className="card home-trend home-finishing">
      <div className="home-trend-head">
        <Kicker>Devant le but</Kicker>
        <Segments
          label="Efficacité"
          value={mode}
          items={[
            ["clinical", "Efficaces"],
            ["wasteful", "Maladroits"],
          ]}
          onChange={setMode}
        />
      </div>
      <h3>
        {mode === "clinical"
          ? "Ils marquent plus que prévu"
          : "Ils devraient avoir plus de buts"}
      </h3>
      <p className="home-trend-lead">
        Buts marqués (●) comparés aux buts attendus (○ xG) sur la saison.
      </p>
      <ol className="home-dumbbells">
        {list.map((p) => {
          const delta = p.goals - p.xg,
            lo = (Math.min(p.goals, p.xg) / max) * 100,
            hi = (Math.max(p.goals, p.xg) / max) * 100;
          return (
            <li key={p.playerId}>
              <button type="button" onClick={() => f.setPlayer(p.lastId)}>
                <Media
                  name={p.name}
                  url={p.imageUrl}
                  className="player-avatar home-avatar-sm"
                />
                <span className="home-dumbbell-copy">
                  <span className="home-dumbbell-name">
                    <strong>{p.name}</strong>{" "}
                    <small>
                      {p.team} · {plural(p.goals, "but")}, {number(p.xg, 1)} xG
                    </small>
                  </span>
                  <span className="home-dumbbell-track" aria-hidden="true">
                    <i
                      className="home-dumbbell-line"
                      style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                    />
                    <i
                      className="home-dumbbell-xg"
                      style={{ left: `${(p.xg / max) * 100}%` }}
                    />
                    <i
                      className={`home-dumbbell-goals${delta < 0 ? " is-below" : ""}`}
                      style={{ left: `${(p.goals / max) * 100}%` }}
                    />
                  </span>
                </span>
                <b className={delta >= 0 ? "is-up" : "is-down"}>
                  {delta >= 0 ? "+" : "−"}
                  {number(Math.abs(delta), 1)}
                </b>
              </button>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export function SeasonScorers({ leaders }) {
  const f = useFootball();
  if (!leaders.length) return null;
  return (
    <article className="card home-trend">
      <div className="home-trend-head">
        <Kicker>Buteurs de la saison</Kicker>
        <Link className="inline-link" href={f.href("/joueurs/")}>
          Tous <Icon name="arrow" />
        </Link>
      </div>
      <ol className="home-scorers-list">
        {leaders.map((p, i) => (
          <li key={p.playerId}>
            <button type="button" onClick={() => f.setPlayer(p.lastId)}>
              <span className="home-scorer-rank">{i + 1}</span>
              <Media
                name={p.name}
                url={p.imageUrl}
                className="player-avatar home-avatar-sm"
              />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.team} · {number(p.xg, 1)} xG · {plural(p.apps, "match")}
                </small>
              </span>
              <b>{number(p.goals)}</b>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
}

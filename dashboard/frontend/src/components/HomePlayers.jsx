"use client";
import Link from "next/link";
import React, { useState } from "react";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import Icon from "./Icon.jsx";
import { Media, Segments } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { json, useResource } from "../services/resources.js";
import tip from "./MatchTabs.module.css";
import { Term } from "./Hint.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { Kicker, lastName, matchHref, relativeDay, shortDay } from "./HomeCommon.jsx";
import { playerLeaderboardHref } from "../services/player-leaderboard.js";
import { matchDay, weekPeriodLabel } from "../services/home-insights.js";
import { GRADE_HIGH } from "../services/grades.js";

const plural = (n, word) => `${number(n)} ${word}${n > 1 ? "s" : ""}`;
/** Goals and assists as words, only those there are: « 1 but · 2 passes », « » for none. */
const tally = (goals, assists) =>
  [goals > 0 && plural(goals, "but"), assists > 0 && plural(assists, "passe")].filter(Boolean);
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
/** A grade as a pill (FAILURE_MODES § 80): green from GRADE_HIGH, as in the lineups, judged on the number shown (a 69.6
 * reads 70 and is green); « – » without one. */
function GradePill({ grade }) {
  const known = Number.isFinite(grade);
  return (
    <span
      className="home-grade"
      data-high={known && Math.round(grade) >= GRADE_HIGH ? "" : undefined}
      aria-label={known ? `Note Vega ${number(grade, 0)}` : "Pas de note cette semaine"}
    >
      {known ? number(grade, 0) : "–"}
    </span>
  );
}
const share = (a, b) =>
  Number.isFinite(a) && b > 0 ? `${number((a / b) * 100)} %` : "—";

/** One of the recent grades as words: the date, the score, the grade. */
function recentLabel(r) {
  const m = r.match;
  const score = m ? `${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name}` : r.team || "";
  return `${shortDay(matchDay(r))} · ${score} · note ${number(r.grade, 0)} sur 100`;
}

/** The bubble over a recent grade: the match, its competition and the player's figures in it. */
function RecentMatch({ row: r }) {
  const m = r.match;
  const facts = [
    r.minutes != null && `${number(r.minutes)}′`,
    r.goals > 0 && plural(r.goals, "but"),
    r.assists > 0 && `${plural(r.assists, "passe")} déc.`,
  ].filter(Boolean);
  return (
    <>
      <p className={tip.bubbleHead}>
        {shortDay(matchDay(r))}
        {r.league ? ` · ${r.league}` : ""}
      </p>
      {m ? (
        <div className={tip.bubbleLine}>
          <span>
            {m.home.name} – {m.away.name}
          </span>
          <b>
            {m.home.score}–{m.away.score}
          </b>
        </div>
      ) : (
        r.team && <p className={tip.bubbleNote}>{r.team}</p>
      )}
      <div className={tip.bubbleLine}>
        <span>Note Vega</span>
        <b>{number(r.grade, 0)}</b>
      </div>
      {facts.length > 0 && <p className={tip.bubbleNote}>{facts.join(" · ")}</p>}
    </>
  );
}

/** Poster-style card of the week's best performance, with its recent form and season. */
export function PlayerOfTheWeek({
  performance,
  match,
  season,
  recent = [],
  period,
}) {
  const f = useFootball(),
    p = performance;
  // On a phone the card opens on the three figures; the rest unfolds on demand.
  const detail = usePhoneFold();
  const bubble = useHoverBubble({ width: 260 });
  // The week's matches are on the page; an older one is read from its summary.
  const missing = recent.filter((r) => !r.match && r.matchId).map((r) => r.matchId);
  const older = useResource(
    `potw-recent:${missing.join(",")}`,
    () =>
      Promise.all(
        missing.map((id) =>
          json(`/api/matches/${encodeURIComponent(id)}/summary`)
            .then((body) => body?.data?.match || null)
            .catch(() => null),
        ),
      ),
    missing.length > 0,
  );
  const known = new Map((older.value || []).filter(Boolean).map((m) => [m.id, m]));
  const form = recent.map((r) => (r.match ? r : { ...r, match: known.get(r.matchId) || null }));
  if (!p) return null;
  const duels = (p.duelsWon || 0) + (p.duelsLost || 0);
  return (
    <article className="card home-potw" {...detail.fold}>
      <span className="home-potw-ghost" aria-hidden="true">
        {lastName(p.name)}
      </span>
      <div className="home-potw-top">
        <Kicker tone="green">
          Joueur de la semaine{period?.current === false && " · archives"}
        </Kicker>
        <span className="home-chip">{shortDay(matchDay(match || p))}</span>
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
          <b>{number(p.grade, 0)}</b>
          <span><Term>Note Vega du match</Term></span>
        </div>
        <div>
          <b>{number(p.goals || 0)}</b>
          <span><Term>Buts</Term></span>
        </div>
        <div>
          <b>{number(p.assists || 0)}</b>
          <span><Term>Passes déc.</Term></span>
        </div>
      </div>
      <PhoneFoldToggle {...detail.toggle} label="Ses chiffres du match" />
      <dl className="home-potw-stats phone-fold-part">
        <div>
          <dt><Term>xG</Term></dt>
          <dd>{number(p.xg, 2)}</dd>
        </div>
        <div>
          <dt><Term>Tirs (cadrés)</Term></dt>
          <dd>
            {number(p.shots)} ({number(p.shotsOnTarget)})
          </dd>
        </div>
        <div>
          <dt><Term>Occasions créées</Term></dt>
          <dd>{number(p.chancesCreated)}</dd>
        </div>
        <div>
          <dt><Term>Passes réussies</Term></dt>
          <dd>{share(p.passesAccurate, p.passesAttempted)}</dd>
        </div>
        <div>
          <dt><Term>Duels gagnés</Term></dt>
          <dd>{duels ? `${number(p.duelsWon || 0)}/${number(duels)}` : "—"}</dd>
        </div>
        <div>
          <dt><Term>Touches</Term></dt>
          <dd>{number(p.touches)}</dd>
        </div>
        <div>
          <dt><Term>Actions défensives</Term></dt>
          <dd>{number(p.defensiveActions)}</dd>
        </div>
        <div>
          <dt><Term hint="Minutes jouées dans ce match.">Temps de jeu</Term></dt>
          <dd>{number(p.minutes)}′</dd>
        </div>
      </dl>
      {form.length > 1 && (
        <div className="home-potw-form phone-fold-part">
          <span className="home-potw-label">Ses derniers matchs</span>
          <ol>
            {form.map((r) => {
              const body = (
                <>
                  <i
                    className={r.id === p.id ? "is-current" : ""}
                    style={{
                      height: `${Math.max(8, r.grade)}%`,
                    }}
                  />
                  <span>{number(r.grade, 0)}</span>
                </>
              );
              // Hovered, focused or touched: which match the grade was.
              const show = (event) =>
                bubble.show(event.currentTarget, <RecentMatch row={r} />);
              const hover = {
                onMouseEnter: show,
                onFocus: show,
                onMouseLeave: bubble.hide,
                onBlur: bubble.hide,
                "aria-label": recentLabel(r),
              };
              return (
                <li key={r.id}>
                  {r.match ? (
                    <Link
                      className="home-potw-bar"
                      href={matchHref(f, r.match)}
                      prefetch={false}
                      {...hover}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="home-potw-bar" tabIndex={0} {...hover}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {bubble.bubble}
        </div>
      )}
      {season && (
        <p className="home-potw-season phone-fold-part">
          Sur la saison : <b>{plural(season.goals, "but")}</b>,{" "}
          <b>{plural(season.assists, "passe")}</b>
          {season.grade != null && (
            <>
              , note Vega <b>{number(season.grade, 0)}</b>
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

/** « Ils ont aussi brillé » (piste B of https://claude.ai/artifact/7m8xpqAU3o9U9ndvf2xYKb, hugo 27 Nov 2026): the week's
 * other best grades as one card, a ranked list in two columns; a phone shows five, the rest on demand. */
export function AlsoShone({ performances, matches, period }) {
  const f = useFootball();
  const more = usePhoneFold();
  if (!performances.length) return null;
  const folds = performances.length > 5;
  return (
    <section className="home-section" aria-labelledby="home-also">
      <div className="home-section-head">
        <h2 id="home-also">
          Ils ont aussi brillé{" "}
          <span>
            {period
              ? `${weekPeriodLabel(period)}${period.current ? "" : " · archives"}`
              : "Meilleures notes de la semaine"}
            {" · 60 min minimum"}
          </span>
        </h2>
        <Link className="inline-link" href={f.href("/joueurs/")}>
          Tous les joueurs <Icon name="arrow" />
        </Link>
      </div>
      <div className="home-list-card" {...more.fold}>
        <ol className="home-list is-ranked">
          {performances.map((p, i) => {
            const m = matches.get(p.matchId);
            const facts = tally(p.goals || 0, p.assists || 0);
            return (
              <li key={p.id} className={i >= 5 ? "phone-fold-part" : undefined}>
                <button
                  type="button"
                  className="home-list-row"
                  onClick={() => f.setPlayer(p.id)}
                >
                  <span className="home-list-rank">{i + 1}</span>
                  <Media name={p.name} url={p.imageUrl} className="player-avatar home-list-avatar" />
                  <span className="home-list-copy">
                    <span className="home-list-name">
                      <strong>{p.name}</strong> <small>{p.team}</small>
                    </span>
                    <span className="home-list-line">
                      {m && (
                        <span>
                          {m.home.name} <b>{m.home.score}–{m.away.score}</b> {m.away.name}
                        </span>
                      )}
                      {facts.map((fact) => (
                        <span key={fact}>{fact}</span>
                      ))}
                    </span>
                  </span>
                  <GradePill grade={p.grade} />
                </button>
              </li>
            );
          })}
        </ol>
        {folds && (
          <PhoneFoldToggle
            {...more.toggle}
            label={more.toggle.open ? "Voir moins" : `Voir les ${performances.length} joueurs`}
          />
        )}
      </div>
    </section>
  );
}

/** Goals scored against expected goals: who finishes above or below their chances. */
export function Finishing({ leaders, scopeIds, favourites = null }) {
  const f = useFootball(),
    [mode, setMode] = useState("clinical");
  const list = leaders[mode];
  if (!leaders.clinical.length && !leaders.wasteful.length) return null;
  const max = Math.max(1, ...list.map((p) => Math.max(p.goals, p.xg))) * 1.08;
  return (
    <article
      className="card home-trend home-finishing"
      aria-label="Devant le but"
    >
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
            <li
              key={p.playerId}
              data-player-id={p.playerId}
              data-followed={favourites?.has(p.playerId) || undefined}
            >
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
      <Link
        className="inline-link home-trend-more"
        href={playerLeaderboardHref(f, mode, scopeIds)}
      >
        Tous les joueurs <Icon name="arrow" />
      </Link>
    </article>
  );
}

/** Season scorers and assist providers, switched like the finishing card. A row opens
 * the player's page, not his last match. */
export function SeasonScorers({ leaders, scopeIds, favourites = null }) {
  const f = useFootball(),
    [mode, setMode] = useState("goals");
  const list = leaders[mode] || [];
  if (!leaders.goals.length && !leaders.assists?.length) return null;
  const goals = mode === "goals";
  return (
    <article
      className="card home-trend home-season-scorers"
      aria-label={goals ? "Buteurs de la saison" : "Passeurs de la saison"}
    >
      <div className="home-trend-head">
        <Kicker>
          {goals ? "Buteurs de la saison" : "Passeurs de la saison"}
        </Kicker>
        <Segments
          label="Classement"
          value={mode}
          items={[
            ["goals", "Buteurs"],
            ["assists", "Passeurs"],
          ]}
          onChange={setMode}
        />
      </div>
      <ol className="home-scorers-list">
        {list.map((p, i) => (
          <li
            key={p.playerId}
            data-player-id={p.playerId}
            data-followed={favourites?.has(p.playerId) || undefined}
          >
            <Link href={f.href("/joueurs/", { id: p.playerId })}>
              <span className="home-scorer-rank">{i + 1}</span>
              <Media
                name={p.name}
                url={p.imageUrl}
                className="player-avatar home-avatar-sm"
              />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.team} ·{" "}
                  {goals ? `${number(p.xg, 1)} xG` : `${number(p.xa, 1)} xA`} ·{" "}
                  {plural(p.apps, "match")}
                </small>
              </span>
              <b>{number(goals ? p.goals : p.assists)}</b>
            </Link>
          </li>
        ))}
      </ol>
      <Link
        className="inline-link home-trend-more"
        href={playerLeaderboardHref(f, mode, scopeIds)}
      >
        Tous les joueurs <Icon name="arrow" />
      </Link>
    </article>
  );
}

/** « Vos joueurs cette semaine »: each followed player's matches of the week and his club's next match, as rows of
 * one card (piste B, hugo 27 Nov 2026; design doc, Accueil et personnalisation, retenu). */
export function YourPlayers({ players, period, now }) {
  const f = useFootball();
  if (!players?.length) return null;
  return (
    <section className="home-section" aria-labelledby="home-yours">
      <div className="home-section-head">
        <h2 id="home-yours">
          Vos joueurs cette semaine{" "}
          {period && <span>{weekPeriodLabel(period)}</span>}
        </h2>
      </div>
      <div className="home-list-card">
        <ol className="home-list">
          {players.map((p) => {
            const graded = p.matches.filter((m) => Number.isFinite(m.grade));
            return (
              <li key={p.playerId}>
                <Link className="home-list-row" href={f.href("/joueurs/", { id: p.playerId })}>
                  <Media name={p.name} url={p.imageUrl} className="player-avatar home-list-avatar" />
                  <span className="home-list-copy">
                    <span className="home-list-name">
                      <strong>{p.name}</strong> <small>{p.team}</small>
                    </span>
                    {p.matches.length ? (
                      p.matches.map((m) => (
                        <span className="home-list-line is-week" key={m.matchId}>
                          <span className="home-list-group">
                            <span>{shortDay(m.date)}</span>
                            <span className="home-list-opponent">contre {m.opponent}</span>
                            <b className="home-list-score">
                              {m.score?.[0] ?? "–"}–{m.score?.[1] ?? "–"}
                            </b>
                          </span>
                          <span className="home-list-group">
                            <span>{number(m.minutes || 0)}′</span>
                            {tally(m.goals || 0, m.assists || 0).map((fact) => (
                              <span key={fact}>{fact}</span>
                            ))}
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="home-list-line">Pas de match cette semaine</span>
                    )}
                    {p.next && p.next.time >= now && (
                      <span className="home-list-line is-next">
                        <Icon name="calendar" />
                        <span>
                          <b>{capitalized(relativeDay(p.next.time, now))}</b> · {p.next.home.name} – {p.next.away.name}
                        </span>
                      </span>
                    )}
                  </span>
                  <GradePill grade={graded.length ? Math.max(...graded.map((m) => m.grade)) : null} />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

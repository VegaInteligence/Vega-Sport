"use client";
/* The page of a match to come, as the page of a match played (FAILURE_MODES § 80, piste A of the mock-up hugo chose on
 * 27 Nov 2026): the scoreboard's strip of figures, then in « Avant-match » four cards, the model's card in three views,
 * the form and the season's grades, the face-to-face and the stakes, the absents and the past meetings. Cards go by
 * pairs of the same height or alone on the row; a card without its data goes. */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, ClubCrest, Grade, PlayerAvatar, Segments, Skeleton } from "./UI.jsx";
import { useMatchContext, seasonStatRows } from "./MatchContext.jsx";
import { StatRows } from "./StatRows.jsx";
import { PreviewAbsences, useUpcomingAbsences } from "./Absences.jsx";
import MatchOdds from "./MatchOdds.jsx";
import { matchForecastReading, projectionRows, share, useMatchForecast, useSeasonProjection } from "../services/forecasts.js";
import { beforeMatch, clubMetric, clubSquad, clubSummary } from "../services/club-analysis.js";
import { formMatches, formMeans, gridReading, inForm, place, profileCount, SEASON_MINUTES, tableRow, tableSlices, useCompetitionTable } from "../services/match-preview.js";
import { date, isNumber, number } from "../services/format.js";
import s from "./MatchPreview.module.css";
import k from "./MatchTabs.module.css";

const decimals = (value, digits = 2) => (isNumber(value) ? number(value, digits) : "—");
const RESULT = { V: "Victoire", N: "Nul", D: "Défaite" };

/** The two clubs' season before the kick-off, read once for the strip and the tab. */
function useClubs(match) {
  const context = useMatchContext(match);
  const value = context.value;
  return useMemo(() => {
    if (!value) return { loading: context.loading, value: null };
    const home = clubSummary(value.data, match.home.id, { before: match }),
      away = clubSummary(value.data, match.away.id, { before: match });
    return { loading: false, value, home, away };
  }, [value, context.loading, match]);
}

function Pills({ club }) {
  const last = (club?.forms || []).slice(0, 5).reverse();
  return (
    <span className={s.pills}>
      {last.map((form) => (
        <i key={form.match.id} className={s.pill} data-result={form.result} title={`${RESULT[form.result]} ${form.scoreFor}–${form.scoreAgainst}`}>
          {form.result}
        </i>
      ))}
    </span>
  );
}

/** The scoreboard's strip (§ 80.2): the same look as the match played's. */
export function PreviewStrip({ match }) {
  // The forecast the model card shows: with the confirmed line-ups once both are in (§ 80.2).
  const forecast = matchForecastReading(useMatchForecast(match.id), match.home?.name || "Domicile", match.away?.name || "Extérieur")?.forecast;
  const clubs = useClubs(match);
  const tiles = [];
  const pair = (home, away) => (
    <strong>
      <b className={k.homeText}>{home}</b>
      <i>–</i>
      <b className={k.awayText}>{away}</b>
    </strong>
  );
  if (forecast) {
    tiles.push(["Victoire", pair(share(forecast.home), share(forecast.away))]);
    tiles.push(["Buts attendus", pair(decimals(forecast.homeGoals), decimals(forecast.awayGoals))]);
    tiles.push([
      "Score le plus probable",
      <strong key="score">
        <b>{forecast.score[0]}</b>
        <i>–</i>
        <b>{forecast.score[1]}</b>
      </strong>,
    ]);
  }
  if (clubs.home && (clubs.home.matches || clubs.away.matches)) {
    const xg = (club) => clubMetric(club, "xgFor").value;
    if (isNumber(xg(clubs.home)) || isNumber(xg(clubs.away)))
      tiles.push(["xG / match sur la saison", pair(decimals(xg(clubs.home)), decimals(xg(clubs.away)))]);
    tiles.push([
      "5 derniers matchs",
      <strong key="form" className={s.stripPills}>
        <Pills club={clubs.home} />
        <Pills club={clubs.away} />
      </strong>,
    ]);
  }
  if (!tiles.length) return null;
  return (
    <div className={`match-kpis ${s.strip}`} data-upcoming="" style={{ "--tiles": tiles.length }}>
      {tiles.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          {value}
        </div>
      ))}
    </div>
  );
}

function Hero({ eyebrow, colour, picture, name, sub, figure, href, season, first = false }) {
  const f = useFootball();
  const body = (
    <>
      <small className={s.eyebrow}>{eyebrow}</small>
      <span className={s.heroLine} data-hero-line="">
        {picture}
        <span className={s.heroWho}>
          <b>{name}</b>
          <small>{sub}</small>
        </span>
        <strong className={s.big}>{figure}</strong>
      </span>
    </>
  );
  const props = { className: `${s.hero}${first ? ` ${s.first}` : ""}`, style: { "--c": colour } };
  return href ? (
    <Link {...props} href={playerHref(f, href, season)} prefetch={false}>
      {body}
    </Link>
  ) : (
    <div {...props}>{body}</div>
  );
}

/** A player's profile for the season the preview reads, whatever filter the page was opened with (as MatchContext did). */
const playerHref = (f, id, season) => f.href("/joueurs/", { id, season: season || "", league: "", q: "" });

/** The four cards of the top (§ 80.3). */
function Heroes({ match, reading, clubs, absents }) {
  const cards = [];
  const colour = (side) => `var(--${side})`;
  if (reading) {
    const f = reading.forecast;
    const side = f.home >= f.away ? "home" : "away";
    const other = side === "home" ? "away" : "home";
    cards.push(
      <Hero
        key="favourite"
        first
        eyebrow="Favori du modèle"
        colour={colour(side)}
        picture={<ClubCrest club={match[side]} size={40} />}
        name={match[side].name}
        sub={`Nul ${share(f.draw)} · ${match[other].name} ${share(f[other])}`}
        figure={share(f[side])}
      />,
    );
  }
  if (clubs.value)
    for (const side of ["home", "away"]) {
      const player = inForm(clubs.value.data, clubs[side]);
      if (player)
        cards.push(
          <Hero
            key={side}
            eyebrow={`En forme · ${match[side].name}`}
            colour={colour(side)}
            picture={<PlayerAvatar player={player} size={40} />}
            name={player.name}
            sub="5 derniers matchs"
            figure={number(player.grade, 0)}
            href={player.id}
            season={clubs.value?.season}
          />,
        );
    }
  const missing = greatAbsent(match, clubs, absents);
  if (missing)
    cards.push(
      <Hero
        key="absent"
        eyebrow="Grand absent"
        colour={colour(missing.side)}
        picture={<PlayerAvatar player={missing.player} size={40} />}
        name={missing.player.name}
        sub={missing.sub}
        figure={missing.figure}
        href={missing.player.id}
        season={clubs.value?.season}
      />,
    );
  if (!cards.length) return null;
  return (
    <div className={`card ${s.heroes}`} data-preview-heroes="" style={{ "--cards": cards.length }}>
      {cards}
    </div>
  );
}

/** Of the players the « Absents » card shows, the one with the best season grade over 300 minutes or more. */
function greatAbsent(match, clubs, absents) {
  if (!clubs.value) return null;
  let best = null;
  for (const side of ["home", "away"]) {
    const rows = absents[side].view?.rows || [];
    if (!rows.length) continue;
    const profiles = new Map(clubSquad(clubs.value.data, clubs[side]).profiles.map((p) => [p.id, p]));
    for (const a of rows) {
      const p = profiles.get(a.player.id);
      if (!p || !(p.minutes >= SEASON_MINUTES) || !isNumber(p.grade)) continue;
      if (!best || p.grade > best.profile.grade) best = { side, profile: p, absence: a };
    }
  }
  if (!best) return null;
  const { profile, absence } = best;
  const goals = profileCount(profile, "goals"), assists = profileCount(profile, "assists");
  const back = absence.expectedReturn ? `retour ${date(absence.expectedReturn)}` : absence.kind === "suspension" ? "suspendu" : "retour inconnu";
  return {
    side: best.side,
    player: { id: absence.player.id, name: absence.player.name, imageUrl: absence.player.imageUrl || profile.imageUrl },
    sub: [assists > 0 && `${assists} PD`, back].filter(Boolean).join(" · "),
    figure: goals > 0 ? `${goals} but${goals > 1 ? "s" : ""}` : number(profile.grade, 0),
  };
}

/** « Le match selon le modèle » (§ 80.4). */
function ModelCard({ match, answer, reading }) {
  const [view, setView] = useState("result");
  const f = reading.forecast;
  const grid = gridReading(f.grid);
  const home = match.home.name, away = match.away.name;
  const parts = [
    [home, f.home, "home"],
    ["Nul", f.draw, "draw"],
    [away, f.away, "away"],
  ];
  const columns = { gridTemplateColumns: parts.map(([, v]) => `minmax(var(--forecast-min), ${Math.max(v, 0.01)}fr)`).join(" ") };
  const figures = [
    ["Score le plus probable", <><b>{f.score[0]}</b><i>–</i><b>{f.score[1]}</b></>],
    ["Buts attendus", <><b className={k.homeText}>{decimals(f.homeGoals, 1)}</b><i>–</i><b className={k.awayText}>{decimals(f.awayGoals, 1)}</b></>],
    ...(grid
      ? [
          ["Plus de 2,5 buts", <b key="o">{share(grid.over)}</b>],
          ["Les deux marquent", <b key="b">{share(grid.both)}</b>],
        ]
      : []),
    [`${home} ne perd pas`, <b className={k.homeText}>{share(f.home + f.draw)}</b>],
    [`${away} ne perd pas`, <b className={k.awayText}>{share(f.away + f.draw)}</b>],
  ];
  const read = [
    ["Force des deux équipes", true],
    ...(answer.form ? [["10 derniers matchs (xG)", true]] : []),
    reading.lineups ? ["Compositions confirmées", true] : ["Onze probable", false],
    ["Absents", false],
  ];
  const shown = grid ? view : "result";
  return (
    <Card
      title="Le match selon le modèle"
      className={s.model}
      data-preview="model"
      action={
        grid && (
          <Segments
            label="Vue du pronostic"
            value={shown}
            onChange={setView}
            items={[["result", "Résultat"], ["score", "Score exact"], ["goals", "Buts"]]}
          />
        )
      }
    >
      {shown === "result" && (
        <div className={s.view}>
          <ul className={`match-forecast-shares ${s.shares}`} style={columns}>
            {parts.map(([name, value, side]) => (
              <li key={side} data-side={side}>
                <strong>{share(value)}</strong>
                <span>{name}</span>
              </li>
            ))}
          </ul>
          <div className={`match-forecast-bar ${s.bar}`} style={columns} role="img" aria-label={parts.map(([n, v]) => `${n} ${share(v)}`).join(", ")}>
            {parts.map(([name, , side]) => (
              <span key={side} data-side={side} title={name} />
            ))}
          </div>
        </div>
      )}
      {shown === "score" && grid && <ScoreGrid match={match} grid={f.grid} reading={grid} />}
      {shown === "goals" && grid && <GoalsView match={match} f={f} reading={grid} />}
      <div className={s.figures} data-model-figures="">
        {figures.map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {reading.elevens.length > 0 && (
        <ul className="match-forecast-elevens">
          {reading.elevens.map((eleven) => (
            <li key={eleven.side} data-side={eleven.side}>
              <span>
                <i aria-hidden="true" />
                Onze de {eleven.name}
              </span>
              <span data-tone={eleven.tone}>{eleven.words}</span>
            </li>
          ))}
        </ul>
      )}
      {reading.without && (
        <table className="match-forecast-compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Pronostic</span>
              </th>
              <th scope="col">{home}</th>
              <th scope="col">Nul</th>
              <th scope="col">{away}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Avec les compositions", f],
              ["Sans les compositions", reading.without],
            ].map(([label, values]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{share(values.home)}</td>
                <td>{share(values.draw)}</td>
                <td>{share(values.away)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={s.read} data-model-read="">
        <small>Lu par le modèle</small>
        {read.map(([label, ok]) => (
          <span key={label} className={s.chip} data-read="" data-ok={ok ? "" : undefined}>
            {label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ScoreGrid({ match, grid, reading }) {
  const top = reading.top || 1;
  const label = (n) => (n === reading.last ? `${n}+` : String(n));
  return (
    <div className={s.grid} role="table" aria-label="Probabilité de chaque score">
      <span className={s.corner} role="presentation" title={`${match.home.name} en lignes, ${match.away.name} en colonnes`}>
        <ClubCrest club={match.away} size={16} label />
        <ClubCrest club={match.home} size={16} label />
      </span>
      {grid[0].map((_, j) => (
        <span key={"a" + j} className={`${s.axis} ${k.awayText}`}>
          {label(j)}
        </span>
      ))}
      {grid.map((row, i) => (
        <React.Fragment key={i}>
          <span className={`${s.axis} ${k.homeText}`}>{label(i)}</span>
          {row.map((v, j) => (
            <span
              key={j}
              className={s.cell}
              data-score-cell={`${i}–${j}`}
              data-side={i > j ? "home" : i < j ? "away" : "draw"}
              data-likely={reading.likely[0] === i && reading.likely[1] === j ? "" : undefined}
              style={{ "--a": (v / top).toFixed(3) }}
              title={`${match.home.name} ${label(i)} – ${label(j)} ${match.away.name} : ${share(v)}`}
            >
              {v >= 0.005 ? Math.round(v * 100) : v > 0 ? "<1" : "0"}
              <small>%</small>
            </span>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function GoalsView({ match, f, reading }) {
  const sides = [
    ["home", reading.home, f.homeGoals],
    ["away", reading.away, f.awayGoals],
  ];
  return (
    <div className={s.goals} data-goals-view="">
      {sides.map(([side, shares, expected]) => {
        const top = Math.max(...shares) || 1;
        return (
          <div key={side} className={s.goalSide} data-side={side}>
            <h3>
              <ClubCrest club={match[side]} size={20} />
              <span className={s.goalName}>{match[side].name}</span>
              <span className={s.expected}>{decimals(expected)} attendus</span>
            </h3>
            <div className={s.goalCols}>
              {shares.map((v, n) => (
                <div key={n} data-goals={n}>
                  <b style={{ height: `${(100 * v) / top}%` }} />
                  <em>{share(v)}</em>
                  <small>{n === shares.length - 1 ? `${n}+` : n}</small>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** « Forme · 10 derniers matchs » (§ 80.5). */
function FormCard({ match, clubs }) {
  const rows = ["home", "away"].map((side) => ({ side, club: clubs[side], matches: formMatches(clubs[side], 10) }));
  const scale = Math.max(1.5, ...rows.flatMap((r) => r.matches.flatMap((m) => [m.xgFor, m.xgAgainst]).filter(isNumber)));
  return (
    <Card title="Forme · 10 derniers matchs" className={s.form} data-preview="form" action={<span className={s.legend}><i data-up="" />xG pour<i data-down="" />xG contre</span>}>
      {rows.map(({ side, matches }) => {
        const means = formMeans(matches);
        return (
          <section key={side} className={s.formRow} style={{ "--c": `var(--${side})` }}>
            <header>
              <ClubCrest club={match[side]} size={20} />
              <b>{match[side].name}</b>
              {matches.length > 0 && (
                <span className={s.formMeans}>
                  <em>xG</em> {decimals(means.xgFor)} · {decimals(means.xgAgainst)} <em>Buts</em> {decimals(means.goalsFor)} · {decimals(means.goalsAgainst)}
                </span>
              )}
            </header>
            {matches.length ? (
              <div className={s.formChart}>
                {[...matches].reverse().map((m) => (
                  <div
                    key={m.match.id}
                    className={s.formCol}
                    title={`${date(m.match.date)} · ${m.side === "home" ? "Dom." : "Ext."} · ${m.opponent?.name || ""}${isNumber(m.xgFor) ? ` · xG ${decimals(m.xgFor)}–${decimals(m.xgAgainst)}` : ""}`}
                  >
                    <span className={s.up}>{isNumber(m.xgFor) && <b style={{ height: `${(100 * m.xgFor) / scale}%` }} />}</span>
                    <span className={s.down}>{isNumber(m.xgAgainst) && <b style={{ height: `${(100 * m.xgAgainst) / scale}%` }} />}</span>
                    <i className={s.pill} data-result={m.result}>
                      {m.scoreFor}–{m.scoreAgainst}
                    </i>
                    <ClubCrest club={m.opponent} size={16} className={s.opponent} label />
                  </div>
                ))}
              </div>
            ) : (
              <p className={s.none}>Aucun match collecté</p>
            )}
          </section>
        );
      })}
    </Card>
  );
}

/** « Meilleures notes de la saison » (§ 80.5): the three best of each club, the six by grade. */
/** The three best season grades of each club (300 minutes or more), best first (§ 80.5). */
function bestNotes(clubs) {
  return ["home", "away"]
    .flatMap((side) =>
      clubSquad(clubs.value.data, clubs[side])
        .profiles.filter((p) => p.minutes >= SEASON_MINUTES && isNumber(p.grade))
        .sort((a, b) => b.grade - a.grade)
        .slice(0, 3)
        .map((p) => ({ side, p })),
    )
    .sort((a, b) => b.p.grade - a.p.grade);
}

function NotesCard({ match, rows, absents, season }) {
  const f = useFootball();
  const out = new Set(["home", "away"].flatMap((side) => (absents[side].view?.rows || []).map((a) => a.player.id)));
  return (
    <Card title="Meilleures notes de la saison" className={s.notes} data-preview="notes">
      <ol>
        {rows.map(({ side, p }, i) => {
          const goals = profileCount(p, "goals"), assists = profileCount(p, "assists");
          return (
            <li key={p.id} style={{ "--c": `var(--${side})` }}>
              <span className={s.rank}>{String(i + 1).padStart(2, "0")}</span>
              <Link className={s.player} href={playerHref(f, p.id, season)} prefetch={false}>
                <PlayerAvatar player={p} size={32} />
                <span>
                  <b>
                    {p.name}
                    {out.has(p.id) && <em className={s.absent}>Absent</em>}
                  </b>
                  <small>
                    {[match[side].name, goals > 0 && `${goals} but${goals > 1 ? "s" : ""}`, assists > 0 && `${assists} PD`].filter(Boolean).join(" · ")}
                  </small>
                </span>
              </Link>
              <span className={s.minutes}>{number(p.minutes)}′</span>
              <Grade value={p.grade} />
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** « L'enjeu au classement » (§ 80.6): the table around each club, and their projected places. */
function StakesCard({ match, table }) {
  const ids = [match.home.id, match.away.id];
  const row = tableRow(table, match.home.id) || tableRow(table, match.away.id);
  const projection = useSeasonProjection(match.leagueId, match.season);
  if (!row) return null;
  const slices = tableSlices(row.table.rows, ids);
  const league = projection && (!projection.format || projection.format === "league");
  const projected = league ? new Map(projectionRows(projection).map((r) => [r.id, r])) : new Map();
  const places = league ? new Map((projection.teams || []).map((t) => [t.id, t.places || []])) : new Map();
  const sideOf = (id) => (id === match.home.id ? "home" : id === match.away.id ? "away" : null);
  return (
    <Card title="L’enjeu au classement" className={s.stakes} data-preview="stakes">
      <div className={s.stakesBody} data-projection={projected.size ? "" : undefined}>
        <table className={s.slice}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Club</th>
              <th scope="col">J</th>
              <th scope="col">Diff.</th>
              <th scope="col">Pts</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((rows, n) => (
              <React.Fragment key={n}>
                {n > 0 && (
                  <tr className={s.gap} aria-hidden="true">
                    <td colSpan={5}>⋯</td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} data-side={sideOf(r.id) || undefined} style={sideOf(r.id) ? { "--c": `var(--${sideOf(r.id)})` } : undefined}>
                    <td>{r.position}</td>
                    <td>
                      <span className={s.club}>
                        <ClubCrest club={r} size={16} />
                        {r.name}
                      </span>
                    </td>
                    <td>{r.played ?? "—"}</td>
                    <td>{isNumber(r.difference) ? (r.difference > 0 ? `+${r.difference}` : r.difference) : "—"}</td>
                    <td>
                      <b>{r.points}</b>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {projected.size > 0 && (
          <div className={s.places}>
            {["home", "away"].map((side) => {
              const p = projected.get(match[side].id), shares = places.get(match[side].id) || [];
              if (!p || !shares.length) return null;
              const top = Math.max(...shares) || 1, n = shares.length;
              return (
                <div key={side} className={s.placeSide} style={{ "--c": `var(--${side})` }}>
                  <header>
                    <ClubCrest club={match[side]} size={16} />
                    <b>{match[side].name}</b>
                    <span className={s.projected}>{number(p.projectedPoints, 0)} pts en fin de saison</span>
                  </header>
                  <div className={s.placeBars} style={{ "--n": n }} role="img" aria-label={`Places en fin de saison de ${match[side].name}`}>
                    {shares.map((v, i) => (
                      <b key={i} data-zone={i < 4 ? "top" : i >= n - 3 ? "bottom" : undefined} style={{ height: `${Math.max(2, (100 * v) / top)}%` }} title={`${place(i + 1)} : ${share(v)}`} />
                    ))}
                  </div>
                  <div className={s.placeAxis} style={{ "--n": n }}>
                    <span style={{ gridColumn: 1 }}>1er</span>
                    <span style={{ gridColumn: 4 }}>4ᵉ</span>
                    <span style={{ gridColumn: n - 2 }}>{place(n - 2)}</span>
                    <span style={{ gridColumn: n }}>{place(n)}</span>
                  </div>
                  <div className={s.placeKeys}>
                    <span>
                      4 premiers <b>{share(p.topFour)}</b>
                    </span>
                    {p.bottomThree !== null && (
                      <span>
                        3 derniers <b>{share(p.bottomThree)}</b>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

/** « Confrontations précédentes » (§ 80.8). */
function MeetingsCard({ match, fixtures }) {
  const f = useFootball();
  const ids = [match.home.id, match.away.id];
  const meetings = fixtures
    .filter((m) => m.status === "finished" && beforeMatch(m, match) && ids.includes(m.home.id) && ids.includes(m.away.id) && isNumber(m.home.score) && isNumber(m.away.score))
    .sort((a, b) => String(b.timeUtc || b.date).localeCompare(String(a.timeUtc || a.date)));
  if (!meetings.length) return null;
  const winner = (m) => (m.home.score === m.away.score ? null : m.home.score > m.away.score ? m.home.id : m.away.id);
  const record = { home: 0, draw: 0, away: 0 };
  for (const m of meetings) record[winner(m) === match.home.id ? "home" : winner(m) === match.away.id ? "away" : "draw"]++;
  const total = meetings.length;
  return (
    <Card title="Confrontations précédentes" className={s.meetings} data-preview="h2h">
      <div className={s.meetingsBody}>
        <div className={s.record}>
          <div data-record="">
            <span style={{ "--c": "var(--home)" }}>
              <b>{record.home}</b>
              <small>{match.home.name}</small>
            </span>
            <span>
              <b>{record.draw}</b>
              <small>Nuls</small>
            </span>
            <span style={{ "--c": "var(--away)" }}>
              <b>{record.away}</b>
              <small>{match.away.name}</small>
            </span>
          </div>
          <div className={s.recordBar} aria-hidden="true">
            {["home", "draw", "away"].map((key) => record[key] > 0 && <span key={key} data-side={key} style={{ flex: record[key] / total }} />)}
          </div>
        </div>
        <ul className={s.tiles}>
          {meetings.slice(0, 6).map((m) => {
            const won = winner(m);
            const side = won === match.home.id ? "home" : won === match.away.id ? "away" : null;
            return (
              <li key={m.id} style={side ? { "--c": `var(--${side})` } : undefined}>
                <Link
                  href={f.href("/matchs/", { tab: "results", id: m.id, competition: m.leagueId || "", sourceSeason: m.season || "" })}
                  prefetch={false}
                >
                  <small>{date(m.date)}</small>
                  <span className={s.tileScore}>
                    <ClubCrest club={m.home} size={20} label={m.home.name} />
                    <b>
                      {m.home.score}–{m.away.score}
                    </b>
                    <ClubCrest club={m.away} size={20} label={m.away.name} />
                  </span>
                  <span className={s.tileWinner}>{side ? match[side].name : "Nul"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

/** Two cards on a row, of the same height; one alone takes the row. */
function Pair({ children, wide = false }) {
  const cards = React.Children.toArray(children).filter(Boolean);
  if (!cards.length) return null;
  return (
    <div className={`${s.pair}${cards.length === 2 ? ` ${s.two}` : ""}${wide ? ` ${s.wide}` : ""}`} data-preview-pair="">
      {cards}
    </div>
  );
}

/** « Avant-match » before the kick-off (§ 80.3 to 80.8). */
export default function MatchPreview({ match }) {
  const answer = useMatchForecast(match.id);
  const reading = matchForecastReading(answer, match.home?.name || "Domicile", match.away?.name || "Extérieur");
  const clubs = useClubs(match);
  const absents = useUpcomingAbsences(match);
  const table = useCompetitionTable(match);
  const ready = Boolean(clubs.value);
  // Known before the pair is laid out: without notes the form card takes the whole row (§ 80.5).
  const notes = ready ? bestNotes(clubs) : [];
  return (
    <div className={s.preview}>
      <Heroes match={match} reading={reading} clubs={clubs} absents={absents} />
      {reading && <ModelCard match={match} answer={answer} reading={reading} />}
      <MatchOdds match={match} />
      {ready ? (
        <>
          <Pair wide>
            <FormCard match={match} clubs={clubs} />
            {notes.length > 0 && <NotesCard match={match} rows={notes} absents={absents} season={clubs.value.season} />}
          </Pair>
          <Pair>
            {(clubs.home.matches > 0 || clubs.away.matches > 0) && (
              <Card title="Face-à-face sur la saison" className={s.face} data-preview="face">
                <StatRows match={match} stats={seasonStatRows(clubs.home, clubs.away)} />
              </Card>
            )}
            {table && tableRow(table, match.home.id) && <StakesCard match={match} table={table} />}
          </Pair>
        </>
      ) : (
        clubs.loading && <Skeleton data-page-loading="" label="Chargement de l’avant-match…" lines={6} />
      )}
      <PreviewAbsences absents={absents} />
      {ready && <MeetingsCard match={match} fixtures={clubs.value.fixtures} />}
    </div>
  );
}

"use client";
/* The nation pages (VI-18, approved mock-up of 16 Nov 2026): the national teams ranked by their
 * Vega Elo, and one nation's page built like a club's: its identity rail, then its season, its
 * Elo, its matches, the players of its latest tournament and its runs in the major tournaments.
 * Everything comes from /api/nations: a fact the base lacks (a coach, a score of an old final)
 * is left out, never filled in. */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BackLink from "./BackLink.jsx";
import NationSkeleton from "./NationSkeleton.jsx";
import Link from "next/link";
import { Empty, Media, Segments, Skeleton } from "./UI.jsx";
import { BookmarkButton, ResearchTabs } from "./ResearchUI.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { nationsOpeningScope } from "../services/preference-effects.js";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import { Card, dateShort, fmtNum, Kpis } from "./ClubScoutUI.jsx";
import { LineChart, TipBody } from "./PlayerScoutCharts.jsx";
import FillChart from "./FillChart.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { AbsenceMark } from "./Absences.jsx";
import { absenceView, useTeamAbsences } from "../services/team-absences.js";
import { Term } from "./Hint.jsx";
import { useTabParam } from "../hooks/useTabParam.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import { normalizeText, number } from "../services/format.js";
import {
  competitionLabel,
  lastTournament,
  nationName,
  roundLabel,
  sideOf,
  useNation,
  useNations,
} from "../services/nations.js";
import { editionView, tournamentEdition } from "../services/cup-catalog.js";
import {
  RUN_STEPS,
  runDepth,
  runStage,
  runTone,
  runsByTournament,
} from "../services/tournament-runs.js";
import { matchCarousel } from "../services/nation-carousel.js";
import { scorerLine } from "../services/international-scorers.js";
import { trophyArt } from "../services/trophy-art.js";
import rail from "./ClubScoutTabs.module.css";
import s from "./Nations.module.css";

/** An axis date: « 9 juil. », or « juil. 24 » when the points span several years. */
const axisDate = (value, years) =>
  years
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", {
        month: "short",
        year: "2-digit",
      })
    : dateShort(value);
const ordinal = (n) => (n == null ? "—" : n === 1 ? "1er" : `${n}e`);
const signed = (v, digits = 1) =>
  v == null
    ? "—"
    : `${v > 0 ? "+" : v < 0 ? "−" : ""}${number(Math.abs(v), digits)}`;
const tone = (v) => (v == null || v === 0 ? undefined : v > 0 ? s.up : s.down);

/** A national team's crest, else its flag, else its initials. */
function NationMark({ nation, className = "" }) {
  if (nation.imageUrl)
    return (
      <Media
        name={nation.name}
        url={nation.imageUrl}
        className={`crest ${className}`}
      />
    );
  return (
    <span className={`${s.flag} ${className}`}>
      <NationalFlag name={nation.name} />
    </span>
  );
}

function Record({ wins, draws, losses }) {
  return (
    <span className={s.record}>
      <b data-r="V">{wins}</b>
      <b data-r="N">{draws}</b>
      <b data-r="D">{losses}</b>
    </span>
  );
}

/* ---------------------------------------------------------------- index */

export function NationIndex() {
  const f = useFootball();
  const nations = useNations(f.season);
  const research = useResearch();
  const saved = useMemo(
    () =>
      new Set(
        (research?.ready ? research.data.lists : []).flatMap((list) =>
          list.entries
            .filter((entry) => entry.kind === "nations")
            .map((entry) => entry.id),
        ),
      ),
    [research?.ready, research?.data.lists],
  );
  // Effect 8: opens on « Mes sélections » when a nation is saved (as Clubs on « Mes clubs »), until the visitor picks.
  const [picked, setScope] = useState(null);
  const scope = picked ?? nationsOpeningScope(saved.size);
  const [query, setQuery] = useState("");
  const data = nations.value;
  const rows = useMemo(() => {
    const all = data?.nations || [];
    const needle = normalizeText(query.trim());
    return all
      .filter((n) =>
        scope === "saved" ? saved.has(n.id) : scope === "all" || n.ranking,
      )
      .filter(
        (n) =>
          !needle ||
          normalizeText(`${nationName(n.name)} ${n.name}`).includes(needle),
      );
  }, [data, scope, query, saved]);
  if (nations.loading && !data)
    return (
      <Skeleton
        data-page-loading=""
        label="Chargement des nations…"
        lines={8}
      />
    );
  if (nations.error)
    return (
      <p role="alert" className="notice notice-warning">
        Nations indisponibles. {String(nations.error.message || nations.error)}
      </p>
    );
  if (!data) return <Empty>Aucune sélection collectée.</Empty>;
  const ranked = scope === "ranked";
  return (
    <div className={s.page}>
      <div className={s.bar}>
        <input
          className={s.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une sélection"
          aria-label="Rechercher une sélection"
        />
        <Segments
          label="Sélections affichées"
          value={scope}
          onChange={setScope}
          items={[
            ["ranked", `Classées cette saison · ${data.ranked}`],
            ["all", `Toutes les sélections · ${data.nations.length}`],
            ["saved", `Mes sélections · ${saved.size}`],
          ]}
        />
      </div>
      <section className={`card ${s.tableCard}`}>
        <div className="table-scroll">
          <table className={`data-table ${s.table}`}>
            <thead>
              <tr>
                {ranked && <th scope="col">Rang</th>}
                <th scope="col">Sélection</th>
                <th scope="col">
                  <Term>Elo Vega</Term>
                </th>
                {ranked ? (
                  <>
                    <th scope="col">
                      <Term hint="Variation de l’Elo depuis le début de la saison.">
                        Évolution
                      </Term>
                    </th>
                    <th scope="col">Matchs</th>
                    <th scope="col">Bilan V · N · D</th>
                    <th scope="col">
                      <Term hint="Points de résultat (1 la victoire, ½ le nul) moins ceux que l’Elo attendait avant chaque match.">
                        Résultats − attendus
                      </Term>
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col">Matchs</th>
                    <th scope="col">Dernier match</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const r = n.ranking;
                const diff =
                  r && r.results != null && r.expected != null
                    ? r.results - r.expected
                    : null;
                return (
                  <tr key={n.id}>
                    {ranked && <td>{r.rank}</td>}
                    <th scope="row">
                      <Link
                        className={s.who}
                        href={f.href("/nations/", { id: n.id })}
                      >
                        <NationMark nation={n} className={s.mark} />
                        {nationName(n.name)}
                      </Link>
                    </th>
                    <td>
                      <b>{fmtNum(ranked ? r.elo : n.elo)}</b>
                    </td>
                    {ranked ? (
                      <>
                        <td className={tone(r.eloChange)}>
                          {signed(r.eloChange)}
                        </td>
                        <td>{r.matches}</td>
                        <td>
                          <Record
                            wins={r.wins}
                            draws={r.draws}
                            losses={r.losses}
                          />
                        </td>
                        <td className={tone(diff)}>{signed(diff, 2)}</td>
                      </>
                    ) : (
                      <>
                        <td>{number(n.matches)}</td>
                        <td>
                          {n.lastMatch
                            ? new Date(
                                `${n.lastMatch}T12:00:00Z`,
                              ).toLocaleDateString("fr-FR")
                            : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className={s.muted}>
                    {scope === "saved" && !saved.size
                      ? "Aucune sélection enregistrée."
                      : "Aucune sélection ne correspond."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- page */

const TABS = [
  ["overview", "Vue d’ensemble"],
  ["matches", "Matchs"],
  ["players", "Joueurs"],
];
const TAB_KEYS = TABS.map(([key]) => key);
/** The Elo card's recent window: the last matches. */
const RECENT_ELO = 16;
/** Rows of the column beside the Elo chart: the coming matches, then the latest results. */
const MATCH_ROWS = 6;

/** A match's day, with its year under it when it is not this year's. */
function MatchDate({ date }) {
  if (!date) return <span className={s.date}>—</span>;
  const year = date.slice(0, 4);
  return (
    <span className={s.date}>
      {dateShort(date)}
      {year !== String(new Date().getFullYear()) && <small>{year}</small>}
    </span>
  );
}

function MatchRow({ match, id, withScorers = false, ...rest }) {
  const f = useFootball();
  const side = sideOf(match, id);
  // International Results' scorers, only when the list is complete (§57).
  const scorers = withScorers ? scorerLine(match.scorers) : null;
  const score =
    match.homeScore == null
      ? match.status === "finished"
        ? "–"
        : "à venir"
      : `${match.homeScore}–${match.awayScore}`;
  const body = (
    <>
      <MatchDate date={match.date} />
      <span className={s.teams}>
        <b>
          {nationName(match.home.name)} – {nationName(match.away.name)}
        </b>
        <small>
          {[competitionLabel(match), roundLabel(match.round)]
            .filter(Boolean)
            .join(" · ")}
          {side.pens
            ? ` · t.a.b. ${match.homePenalties}–${match.awayPenalties}`
            : ""}
        </small>
        {scorers && (
          <small className={s.scorers} aria-label="Buteurs">
            {scorers}
          </small>
        )}
      </span>
      <span className={s.score}>{score}</span>
      {side.result ? (
        <b className={s.result} data-r={side.result}>
          {side.result}
        </b>
      ) : (
        <span />
      )}
    </>
  );
  return match.id ? (
    <Link
      className={s.match}
      href={f.href("/matchs/", { id: match.id })}
      prefetch={false}
      {...rest}
    >
      {body}
    </Link>
  ) : (
    <div className={s.match} {...rest}>
      {body}
    </div>
  );
}

function EloChart({ points, height, wide = false }) {
  if (points.length < 2)
    return (
      <p className={s.muted}>Pas assez de matchs classés pour tracer l’Elo.</p>
    );
  const values = points.map((p) => p.elo);
  const lo = Math.floor((Math.min(...values) - 10) / 20) * 20,
    hi = Math.ceil((Math.max(...values) + 10) / 20) * 20;
  const step = (hi - lo) / 4;
  const years =
    new Set(points.map((p) => (p.date || "").slice(0, 4)).filter(Boolean))
      .size > 1;
  return (
    <LineChart
      width={wide ? 1000 : 640}
      height={height}
      points={points.map((p) => ({
        x: p.date ? axisDate(p.date, years) : "",
        y: p.elo,
        row: p,
      }))}
      domain={[lo, hi]}
      ticks={[0, 1, 2, 3, 4].map((i) => Math.round(lo + i * step))}
      labelEvery={Math.max(1, Math.ceil(points.length / 7))}
      format={(value) => fmtNum(value)}
      leftMargin={44}
      ariaLabel="Elo Vega après chaque match"
      tip={(point) => (
        <TipBody
          title={
            point.row.date
              ? new Date(`${point.row.date}T12:00:00Z`).toLocaleDateString(
                  "fr-FR",
                )
              : "Match"
          }
          rows={[
            ["Elo", fmtNum(point.row.elo)],
            [
              "Résultat",
              point.row.result === 1
                ? "Victoire"
                : point.row.result === 0
                  ? "Défaite"
                  : "Nul",
            ],
          ]}
        />
      )}
    />
  );
}

function PlayersTable({ nationId, players, limit }) {
  const f = useFootball();
  // Injured or suspended today, at his club or with the side: most likely not available.
  const absences = absenceView(useTeamAbsences(nationId).value);
  const rows = limit ? players.rows.slice(0, limit) : players.rows;
  return (
    <div className="table-scroll">
      <table className={`data-table ${s.table}`}>
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Club</th>
            <th scope="col">
              <Term hint="Matchs joués au tournoi.">MJ</Term>
            </th>
            <th scope="col">Min</th>
            <th scope="col">Buts</th>
            <th scope="col">
              <Term>PD</Term>
            </th>
            <th scope="col">
              <Term>xG</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                <Link
                  className={s.who}
                  href={f.href("/joueurs/", { id: p.id })}
                  prefetch={false}
                >
                  <Media
                    name={p.name}
                    url={p.imageUrl}
                    className={`player-avatar ${s.avatar}`}
                  />
                  <span>
                    {p.name}
                    <AbsenceMark
                      absence={absences?.byPlayer.get(p.id)}
                      asOf={absences?.asOf}
                    />
                  </span>
                </Link>
              </th>
              <td className={s.muted}>
                {p.club ? (
                  <Link
                    href={f.href("/clubs/", { id: p.club.id })}
                    prefetch={false}
                  >
                    {p.club.name}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>{p.matches}</td>
              <td>{number(p.minutes)}</td>
              <td>{p.goals}</td>
              <td>{p.assists}</td>
              <td>{p.xg == null ? "—" : fmtNum(p.xg, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MEDALS = [
  ["gold", (n) => `${n} titre${n > 1 ? "s" : ""}`],
  ["silver", (n) => `${n} fois finaliste`],
  ["bronze", (n) => `${n} fois 3e`],
];

/* The nation's runs (mock-up validated 18 Nov 2026, proposal A): a row per competition with its own medals, a tile per
 * edition with a gauge when its stage is known. A tile opens the edition's available view, with the nation followed. */
function Tournaments({ runs, nation }) {
  const f = useFootball();
  return (
    <div className={s.tournaments}>
      {runsByTournament(runs).map((group) => {
        const art = trophyArt({
          title: group.label,
          trophyYear: group.runs.at(-1).year,
        });
        return (
          <div key={group.tournament} className={s.tournament}>
            <div className={s.tournamentName}>
              {art && <img src={art} alt="" />}
              <div>
                {group.label}
                <span className={s.medals}>
                  {MEDALS.filter(([tone]) => group.medals[tone]).map(
                    ([tone, words]) => (
                      <span
                        key={tone}
                        data-tone={tone}
                        title={words(group.medals[tone])}
                        aria-label={words(group.medals[tone])}
                      >
                        {group.medals[tone]}
                      </span>
                    ),
                  )}
                </span>
              </div>
            </div>
            <div className={s.runs}>
              {group.runs.map((run) => {
                const page = tournamentEdition(run.tournament, run.year);
                const stage = runStage(run);
                const depth = runDepth(run);
                const tone = runTone(run);
                const title = `${run.label} · ${stage} · ${run.matches} match${run.matches > 1 ? "s" : ""}`;
                const body = (
                  <>
                    <span className={s.runYear}>{run.year}</span>
                    {depth > 0 && (
                      <span className={s.gauge} aria-hidden="true">
                        {Array.from({ length: RUN_STEPS }, (_, step) => (
                          <i
                            key={step}
                            data-on={step < depth ? "" : undefined}
                          />
                        ))}
                      </span>
                    )}
                    <span
                      className={s.runStage}
                      data-unknown={depth === 0 ? "" : undefined}
                    >
                      {stage}
                    </span>
                  </>
                );
                return page ? (
                  <Link
                    key={run.year}
                    className={s.run}
                    data-tone={tone}
                    title={title}
                    prefetch={false}
                    href={f.href("/competitions/", {
                      id: page.id,
                      edition: page.edition,
                      view: editionView(page),
                      team: nation.name,
                    })}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    key={run.year}
                    className={s.run}
                    data-tone={tone}
                    title={title}
                  >
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One match of the carousel: round and day, each side with its flag and goals, the winner in bold, the result
 * from the nation's side; the match's page when the base holds it. */
function MatchTile({ match, id }) {
  const f = useFootball();
  const side = sideOf(match, id);
  const pens = match.homePenalties != null && match.awayPenalties != null;
  const homeWins =
    match.homeScore > match.awayScore ||
    (match.homeScore === match.awayScore &&
      pens &&
      match.homePenalties > match.awayPenalties);
  const awayWins =
    match.awayScore > match.homeScore ||
    (match.homeScore === match.awayScore &&
      pens &&
      match.awayPenalties > match.homePenalties);
  const round = roundLabel(match.round);
  const row = (team, goals, wins) => (
    <span
      className={s.tileTeam}
      data-w={wins ? "" : undefined}
      data-d={!homeWins && !awayWins ? "" : undefined}
    >
      <NationalFlag
        name={team.name}
        season={match.date}
        className={s.tileFlag}
      />
      <span className={s.tileName}>{nationName(team.name)}</span>
      <b>{goals}</b>
    </span>
  );
  const body = (
    <>
      <span className={s.tileTop}>
        <span>{round || competitionLabel(match)}</span>
        <span>{dateShort(match.date)}</span>
      </span>
      {row(match.home, match.homeScore, homeWins)}
      {row(match.away, match.awayScore, awayWins)}
      <span className={s.tileFoot}>
        <span>
          {pens ? `t.a.b. ${match.homePenalties}–${match.awayPenalties}` : ""}
        </span>
        {side.result && (
          <b className={s.result} data-r={side.result}>
            {side.result}
          </b>
        )}
      </span>
    </>
  );
  const final = round === "Finale" ? "" : undefined;
  return match.id ? (
    <Link
      className={s.tile}
      data-final={final}
      href={f.href("/matchs/", { id: match.id })}
      prefetch={false}
    >
      {body}
    </Link>
  ) : (
    <div className={s.tile} data-final={final}>
      {body}
    </div>
  );
}

/** Every played match of the nation, newest first, one group per competition edition (mock-up B, 20 Nov 2026):
 * arrows, swipe, and the row of editions to jump to. */
function MatchCarousel({ nation }) {
  const groups = useMemo(() => matchCarousel(nation), [nation]);
  const track = useRef(null);
  const [at, setAt] = useState({ group: 0, start: true, end: false });
  const update = useCallback(() => {
    const t = track.current;
    if (!t) return;
    const parts = [...t.querySelectorAll("[data-group]")];
    const group = Math.max(
      0,
      parts.findLastIndex(
        (part) => part.offsetLeft - t.offsetLeft <= t.scrollLeft + 8,
      ),
    );
    setAt({
      group,
      start: t.scrollLeft < 4,
      end: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update, groups]);
  useEffect(() => {
    // The jump row follows the group in view, sideways only: scrollIntoView would also move the
    // page to the row when it is below the fold (a phone opened 800 px down the page).
    const button = track.current?.parentElement?.parentElement?.querySelector(
      `[data-jump="${at.group}"]`,
    );
    const row = button?.parentElement;
    if (!row) return;
    const b = button.getBoundingClientRect(),
      r = row.getBoundingClientRect();
    if (b.left < r.left) row.scrollLeft += b.left - r.left;
    else if (b.right > r.right) row.scrollLeft += b.right - r.right;
  }, [at.group]);
  if (!groups.length) return null;
  const scroll = (direction) =>
    track.current?.scrollBy({
      left: direction * track.current.clientWidth * 0.8,
      behavior: "smooth",
    });
  const jump = (i) => {
    const t = track.current,
      part = t?.querySelector(`[data-group="${i}"]`);
    if (part)
      t.scrollTo({ left: part.offsetLeft - t.offsetLeft, behavior: "smooth" });
  };
  return (
    <Card
      // An element, not a string: the title is not looked up in the glossary (its « i » said what a match is).
      title={<>Matchs</>}
      action={
        <span className={s.arrows}>
          <button
            type="button"
            aria-label="Matchs plus récents"
            disabled={at.start}
            onClick={() => scroll(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Matchs plus anciens"
            disabled={at.end}
            onClick={() => scroll(1)}
          >
            ›
          </button>
        </span>
      }
    >
      <div className={s.jump} role="tablist" aria-label="Compétitions">
        {groups.map((group, i) => (
          <button
            key={group.key}
            type="button"
            role="tab"
            data-jump={i}
            aria-selected={at.group === i}
            onClick={() => jump(i)}
          >
            {group.label}
          </button>
        ))}
      </div>
      <div className={s.rail}>
        <div className={s.track} ref={track} onScroll={update}>
          {groups.map((group, i) => (
            <div key={group.key} className={s.group} data-group={i}>
              <div className={s.groupLabel}>
                <b>{group.label}</b>
                {[
                  group.stage,
                  `${group.matches.length} match${group.matches.length > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .map((part) => ` · ${part}`)
                  .join("")}
              </div>
              <div className={s.tiles}>
                {group.matches.map((match, j) => (
                  <MatchTile
                    key={match.id || `${match.date}-${j}`}
                    match={match}
                    id={nation.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function NationRail({ nation, last, backHref }) {
  const more = usePhoneFold();
  const played = nation.matches.filter(
    (m) => m.status === "finished" && m.homeScore != null,
  );
  const current = played[0];
  const form = played
    .slice(0, 6)
    .map((m) => sideOf(m, nation.id))
    .reverse();
  const r = nation.ranking,
    rec = nation.record;
  return (
    <aside
      className={rail.rail}
      aria-label="Identité de la sélection"
      {...more.fold}
    >
      <BackLink
        className={`inline-link ${rail.railBack}`}
        href={backHref}
        label="Toutes les nations"
      />
      <div className={rail.identity}>
        <NationMark
          nation={nation}
          className={`${rail.bigCrest} ${s.bigMark}`}
        />
        <h1 className={rail.name}>{nationName(nation.name)}</h1>
        <p className={rail.sub}>Sélection nationale</p>
        {current && (
          <div className={rail.chips}>
            <span className={rail.chip}>
              {[competitionLabel(current), roundLabel(current.round)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        )}
      </div>
      <div className={`${rail.railSection} phone-fold-row`}>
        <PhoneFoldToggle
          {...more.toggle}
          label="Classement, bilan et tournois"
        />
      </div>
      <div className={`${rail.railSection} phone-fold-part`}>
        <div className={rail.railTitle}>
          <div className={rail.railName}>
            <Term hint="Rang parmi les sélections classées par l’Elo Vega sur la saison.">
              Classement Vega
            </Term>
          </div>{" "}
          <span>{nation.season}</span>
        </div>
        <div className={rail.position}>
          <strong>{r ? ordinal(r.rank) : "—"}</strong>
          <span>
            {r
              ? `sur ${nation.ranked} sélections classées`
              : "non classée cette saison"}
            <small>
              {`Elo ${fmtNum(r ? r.elo : nation.elo)}${r?.eloChange != null ? ` · ${signed(r.eloChange)} cette saison` : ""}`}
            </small>
          </span>
        </div>
      </div>
      <div className={`${rail.railSection} phone-fold-part`}>
        <div className={rail.railTitle}>
          <div className={rail.railName}>Bilan</div>{" "}
          <span>{nation.season}</span>
        </div>
        {rec.played ? (
          <dl className={s.facts}>
            <div>
              <dt>
                <Term>Bilan</Term>
              </dt>
              <dd>
                {rec.wins}-{rec.draws}-{rec.losses}
              </dd>
              <small>
                {rec.played} match{rec.played > 1 ? "s" : ""}
              </small>
            </div>
            <div>
              <dt>
                <Term hint="Buts marqués et encaissés.">Buts</Term>
              </dt>
              <dd>
                {rec.goalsFor}–{rec.goalsAgainst}
              </dd>
              <small>{signed(rec.goalsFor - rec.goalsAgainst, 0)}</small>
            </div>
          </dl>
        ) : (
          <p className={s.muted}>Aucun match joué cette saison.</p>
        )}
        {form.length > 0 && (
          <>
            <div className={rail.railTitle} style={{ marginTop: 14 }}>
              <div className={rail.railName}>
                <Term>Forme</Term>
              </div>
            </div>
            <span
              className={s.form}
              aria-label="Derniers résultats, du plus ancien au plus récent"
            >
              {form.map((side, i) => (
                <b key={i} data-r={side.result || undefined}>
                  {side.result || "?"}
                </b>
              ))}
            </span>
          </>
        )}
      </div>
      {last && (
        <div className={`${rail.railSection} phone-fold-part`}>
          <div className={rail.railTitle}>
            <div className={rail.railName}>{last.label}</div>
          </div>
          <div className={rail.position}>
            <strong>{last.stage}</strong>
            <span>
              {last.matches} match{last.matches > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
      <div className={rail.railSection}>
        <div className={`research-toolbar ${s.railActions}`}>
          <BookmarkButton
            kind="nations"
            id={nation.id}
            name={nationName(nation.name)}
            imageUrl={nation.imageUrl}
            season={nation.season}
          />
        </div>
      </div>
    </aside>
  );
}

/** The Elo after each ranked match: the recent window, or the whole history. */
function EloCard({ nation, wide }) {
  const [period, setPeriod] = useState("recent");
  const points = period === "all" ? nation.elo : nation.elo.slice(-RECENT_ELO);
  const first = nation.elo.find((p) => p.date)?.date?.slice(0, 4);
  return (
    <Card
      title="Évolution de l’Elo"
      text="Après chaque match classé"
      className={s.fill}
      action={
        nation.elo.length > RECENT_ELO && (
          <Segments
            label="Période de l’Elo"
            value={period}
            onChange={setPeriod}
            items={[
              ["recent", "Récent"],
              ["all", first ? `Depuis ${first}` : "Tout"],
            ]}
          />
        )
      }
    >
      <FillChart base={240} cap={640 * 1.3}>
        {(height) => <EloChart points={points} height={height} wide={wide} />}
      </FillChart>
    </Card>
  );
}

function Overview({ nation, last, onTab }) {
  const r = nation.ranking,
    rec = nation.record;
  const upcoming = nation.matches
    .filter((m) => m.status === "not_started")
    .sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")))
    .slice(0, 4);
  // The column beside the chart holds six rows: the coming matches, then the latest results.
  const results = nation.matches
    .filter((m) => m.status === "finished" && m.homeScore != null)
    .slice(0, MATCH_ROWS - upcoming.length);
  const lastGoals = last
    ? last.games.reduce(
        (sum, g) => {
          const side = sideOf(g, nation.id);
          return side.own == null
            ? sum
            : [sum[0] + side.own, sum[1] + side.other];
        },
        [0, 0],
      )
    : null;
  return (
    <div className={s.stack}>
      <Kpis
        items={[
          ["Matchs", rec.played, nation.season],
          [
            "Bilan",
            rec.played ? `${rec.wins}-${rec.draws}-${rec.losses}` : "—",
            "V · N · D",
          ],
          [
            "Buts",
            rec.played ? `${rec.goalsFor}–${rec.goalsAgainst}` : "—",
            rec.played
              ? `${fmtNum(rec.goalsFor / rec.played, 2)} – ${fmtNum(rec.goalsAgainst / rec.played, 2)} / match`
              : null,
          ],
          [
            "Elo Vega",
            fmtNum(r ? r.elo : nation.elo),
            r?.eloChange != null ? `${signed(r.eloChange)} cette saison` : null,
          ],
          [
            "Rang Vega",
            r ? ordinal(r.rank) : "—",
            r ? `sur ${nation.ranked} sélections` : "non classée",
          ],
          [
            last ? last.label : "Grand tournoi",
            last ? last.stage : "—",
            last
              ? `${last.matches} matchs · ${lastGoals[0]}–${lastGoals[1]}`
              : null,
          ],
        ]}
      />
      {upcoming.length || results.length ? (
        <div className={s.grid2}>
          <EloCard nation={nation} />
          <Card
            title={
              upcoming.length ? <>Prochains matchs</> : <>Derniers résultats</>
            }
          >
            {upcoming.length > 0 && (
              <div className={s.matches}>
                {upcoming.map((m, i) => (
                  <MatchRow
                    key={m.id || `${m.date}:${i}`}
                    match={m}
                    id={nation.id}
                    data-upcoming={m.date || ""}
                  />
                ))}
              </div>
            )}
            {results.length > 0 && (
              <>
                {upcoming.length > 0 && (
                  <h4 className={s.subhead}>Derniers résultats</h4>
                )}
                <div className={s.matches}>
                  {results.map((m, i) => (
                    <MatchRow
                      key={m.id || `${m.date}:${i}`}
                      match={m}
                      id={nation.id}
                      data-result={m.date || ""}
                    />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      ) : (
        <EloCard nation={nation} wide />
      )}
      <MatchCarousel nation={nation} />
      {nation.players && (
        <Card
          title={`Les joueurs : ${nation.players.competition}`}
          text="Minutes, buts, passes décisives et xG au tournoi · club actuel"
          action={
            <button
              type="button"
              className={s.link}
              onClick={() => onTab("players")}
            >
              Les {nation.players.rows.length} joueurs →
            </button>
          }
        >
          <PlayersTable nationId={nation.id} players={nation.players} limit={5} />
        </Card>
      )}
      {nation.tournaments.length > 0 && (
        <Card title="Grands tournois">
          <Tournaments runs={nation.tournaments} nation={nation} />
        </Card>
      )}
    </div>
  );
}

function Matches({ nation }) {
  const [competition, setCompetition] = useState("all");
  const labels = [...new Set(nation.matches.map(competitionLabel))];
  const rows = nation.matches.filter(
    (m) => competition === "all" || competitionLabel(m) === competition,
  );
  return (
    <Card
      title="Tous les matchs"
      text={`${number(nation.matches.length)} matchs collectés, du plus récent au plus ancien`}
    >
      {labels.length > 1 && (
        <div className={s.filters}>
          <Segments
            label="Compétition"
            value={competition}
            onChange={setCompetition}
            items={[["all", "Toutes"], ...labels.map((l) => [l, l])]}
          />
        </div>
      )}
      <div className={s.matches}>
        {rows.map((m, i) => (
          <MatchRow key={m.id || `${m.date}:${i}`} match={m} id={nation.id} withScorers />
        ))}
      </div>
    </Card>
  );
}

export function NationProfile({ id }) {
  const f = useFootball();
  const nation = useNation(id, f.season);
  const [tab, setTab] = useTabParam("nationView", TAB_KEYS);
  const value = nation.value;
  const backHref = f.href("/nations/", { id: "" });
  // No identity column while reading, after an error or for an unknown nation: the link stays above.
  const back = (
    <BackLink
      className="inline-link competition-back"
      href={backHref}
      label="Toutes les nations"
    />
  );
  if (nation.loading && !value)
    return (
      <NationSkeleton
        back={
          <BackLink
            className="inline-link"
            href={backHref}
            label="Toutes les nations"
          />
        }
      />
    );
  if (nation.error)
    return (
      <>
        {back}
        <p role="alert" className="notice notice-warning">
          Sélection indisponible. {String(nation.error.message || nation.error)}
        </p>
      </>
    );
  if (!value)
    return (
      <>
        {back}
        <Empty>Cette sélection n’existe pas.</Empty>
      </>
    );
  const last = lastTournament(value);
  return (
    <>
      <div className={rail.layout}>
        <NationRail nation={value} last={last} backHref={backHref} />
        <div className={rail.main}>
          <ResearchTabs
            animated
            label="Sélection"
            items={TABS}
            value={tab}
            onChange={setTab}
            panelId="nation-panel"
          />
          <div
            id="nation-panel"
            role="tabpanel"
            aria-label={TABS.find(([key]) => key === tab)[1]}
            className={s.panel}
          >
            {tab === "overview" && (
              <Overview nation={value} last={last} onTab={setTab} />
            )}
            {tab === "matches" && <Matches nation={value} />}
            {tab === "players" &&
              (value.players ? (
                <Card
                  title={`Les joueurs : ${value.players.competition}`}
                  text="Minutes, buts, passes décisives et xG au tournoi · club actuel"
                >
                  <PlayersTable nationId={value.id} players={value.players} />
                </Card>
              ) : (
                <Empty>
                  Aucune statistique de joueur collectée pour cette sélection.
                </Empty>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

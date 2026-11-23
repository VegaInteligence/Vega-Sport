"use client";
/* Club profile: identity rail and tabs, statistics ranked in a referential
 * the user chooses, comparison and similar clubs across every competition. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import BackLink from "./BackLink.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Segments, Skeleton } from "./UI.jsx";
import { ResearchTabs } from "./ResearchUI.jsx";
import { chartTokens, RadarChart } from "./PlayerScoutCharts.jsx";
import { countryLabel } from "../services/competition-selector.js";
import { normalizeText } from "../services/format.js";
import {
  METRICS,
  PERFORMANCE_KEYS,
  PHASES,
  clubEarly,
  europeReferential,
  formatMetric,
  rebase,
  useClubDossier,
  useClubSearch,
  useEuropePool,
  useReferential,
  useSeasonCompetitions,
  useSeasonLeagues,
} from "../services/club-scout.js";
import {
  neighbourBrief,
  useClubNeighbours,
} from "../services/club-neighbours.js";
import {
  Card,
  ClubEmptySeason,
  ClubLoading,
  Crest,
  loadingLabel,
  Info,
  MatchRows,
  MenuItem,
  SearchMenu,
  clubStyles as c,
  ordinal,
} from "./ClubScoutUI.jsx";
import { RankingDialog, RankingProvider } from "./RankingDialog.jsx";
import ClubSkeleton, { ClubSkeletonRail } from "./ClubSkeleton.jsx";
import {
  IdentityRail,
  RailHead,
  Matches,
  Overview,
  Squad,
  Statistics,
  Style,
} from "./ClubScoutTabs.jsx";
import {
  Finishing,
  SetPieces,
  Standings,
  Synthesis,
  WithBall,
  WithoutBall,
} from "./ClubScoutAdvanced.jsx";
import sA from "./ClubScoutTabs.module.css";
import s from "./ClubScoutProfile.module.css";
import { Term } from "./Hint.jsx";

const TABS = [
  ["overview", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["advanced", "Stats avancées"],
  ["style", "Style de jeu"],
  ["matches", "Matchs et tendances"],
  ["squad", "Effectif"],
  ["compare", "Comparaison"],
  ["similar", "Clubs similaires"],
];

/** Tab mirrored in `?clubView=` without a navigation, as before. */
function useClubTab() {
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get(
      "clubView",
    );
    if (TABS.some(([key]) => key === requested)) setTab(requested);
  }, []);
  const change = useCallback((next) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("clubView");
    else url.searchParams.set("clubView", next);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);
  return [tab, change];
}

export default function ClubScoutProfile({ clubId, backHref, club }) {
  const state = useClubDossier(clubId);
  const read = state.status === "ready" ? state.dossier : null;
  // A season without any match of the club names nobody: the page's club does.
  const dossier =
    read && !read.allRows.length && club?.name
      ? { ...read, name: club.name, imageUrl: read.imageUrl || club.imageUrl }
      : read;
  // No rail while reading, after an error or for an empty season: the link stays above.
  const backAbove =
    backHref && (state.status === "error" || dossier?.coverage.empty);
  return (
    <div className={`${chartTokens} ${c.shell}`}>
      {backAbove && (
        <BackLink
          className="inline-link competition-back"
          href={backHref}
          label="Tous les clubs"
        />
      )}
      {!dossier && state.status !== "error" ? (
        <ClubEarly clubId={clubId} state={state} backHref={backHref} />
      ) : !dossier ? (
        <ClubLoading state={state}>
          {club?.name && <strong>{club.name}</strong>}
          <ClubSeasonSelect />
        </ClubLoading>
      ) : dossier.coverage.empty ? (
        <ClubEmptySeason dossier={dossier} played={dossier.coverage.played}>
          <ClubSeasonSelect season={dossier.season} />
        </ClubEmptySeason>
      ) : (
        <Profile key={dossier.id} dossier={dossier} backHref={backHref} />
      )}
    </div>
  );
}

/**
 * While the dossier is read (the club's shots and appearances, its league's matches): the
 * identity column's head and the last matches from the page's read of the club, already in
 * memory, the rest in grey. The page is revealed then; nothing ranked is shown before the
 * league's cohort. Without that read (another club's, or none), the whole skeleton.
 */
function ClubEarly({ clubId, state, backHref }) {
  const f = useFootball();
  const club = useMemo(
    () => clubEarly(f.data, clubId, f.season),
    [f.data, clubId, f.season],
  );
  const label = loadingLabel(state);
  if (!club) return <ClubLoading state={state} />;
  return (
    <ClubSkeleton
      live
      label={label}
      rail={
        <aside className={sA.rail} aria-label="Identité du club">
          <RailHead
            club={club}
            backHref={backHref}
            season={<ClubSeasonSelect season={club.season} />}
          />
          <div className="club-skeleton-shapes" aria-hidden="true">
            <ClubSkeletonRail />
          </div>
        </aside>
      }
      after={
        <Card
          title="Derniers matchs"
          text="Toutes compétitions · barres : xG pour (bleu) et contre (orange)"
        >
          <MatchRows rows={club.allRows} limit={6} />
        </Card>
      }
    />
  );
}

/** The club's season, chosen where the club is shown: the page reads the club in it. */
function ClubSeasonSelect({ season }) {
  const f = useFootball();
  const seasons = (f?.manifest?.seasons || []).map((item) => item.id);
  if (!seasons.length || !f.changeSeason) return null;
  return (
    <SeasonSelect
      value={season || f.season}
      seasons={seasons}
      onChange={f.changeSeason}
      className={sA.season}
    />
  );
}

/** Identity shown in a search menu before the club's dossier is read. */
const brief = (club, league) => ({
  id: club.id,
  name: club.name,
  imageUrl: club.imageUrl,
  meta: [
    club.country && countryLabel(club.country),
    league?.name || club.league,
  ]
    .filter(Boolean)
    .join(" · "),
});

function Profile({ dossier, backHref }) {
  const [tab, setTab] = useClubTab();
  const cmp = useComparison(dossier);
  const view = cmp.view;
  const referentialTab = REFERENTIAL_TABS.has(tab);
  // Ranking dialog behind any indicator of the referential tabs.
  const [ranking, setRanking] = useState(null);
  // The comparison opens on the closest club of the league, as the API ranks it (the same
  // numbers as « Clubs similaires » narrowed to the league) until the visitor picks one.
  const [chosen, setRival] = useState(null);
  const leagueNeighbours = useLeagueNeighbours(dossier);
  const rival =
    chosen ??
    (leagueNeighbours[0]
      ? neighbourBrief(leagueNeighbours[0], countryLabel)
      : null);
  const compare = (club) => {
    setRival(club);
    setTab("compare");
  };
  return (
    <RankingProvider value={setRanking}>
      <div className={sA.layout}>
        <IdentityRail
          dossier={dossier}
          onTab={setTab}
          backHref={backHref}
          season={<ClubSeasonSelect season={dossier.season} />}
        />
        <div className={sA.main}>
          <ComparisonBar dossier={dossier} cmp={cmp} active={referentialTab} />
          <ResearchTabs
            animated
            label="Analyse du club"
            items={TABS}
            value={tab}
            onChange={setTab}
            panelId="club-profile-panel"
          />
          <div
            id="club-profile-panel"
            role="tabpanel"
            aria-label={TABS.find(([key]) => key === tab)[1]}
            className={s.panel}
          >
            {tab === "overview" && (
              <Overview dossier={view} base={dossier} onTab={setTab} />
            )}
            {tab === "stats" && <Statistics dossier={view} />}
            {tab === "advanced" && <AdvancedStats dossier={view} />}
            {tab === "style" && <Style dossier={view} />}
            {tab === "matches" && <Matches dossier={dossier} />}
            {tab === "squad" && <Squad dossier={dossier} />}
            {tab === "compare" && (
              <Comparison dossier={dossier} rival={rival} onRival={setRival} />
            )}
            {tab === "similar" && (
              <Similar dossier={dossier} onCompare={compare} />
            )}
          </div>
        </div>
      </div>
      {ranking && (
        <ClubRankingDialog
          dossier={ranking.base ? dossier : view}
          target={ranking}
          onClose={() => setRanking(null)}
        />
      )}
    </RankingProvider>
  );
}

/* --------------------------------------------------------- referential */

const REFERENTIAL_TABS = new Set(["overview", "stats", "advanced", "style"]);

/**
 * Which clubs every centile, rank and median is computed against: Europe
 * (every club of the Top 7 leagues, or only those of a comparable level),
 * the club's league, or any competition the user picks.
 */
function useComparison(dossier) {
  const [scope, setScope] = useState("europe");
  const [level, setLevel] = useState(true);
  const [competition, setCompetition] = useState(null);
  const pool = useEuropePool(scope === "europe");
  const refState = useReferential(
    scope === "competition" ? competition?.leagues || null : null,
  );
  const view = useMemo(() => {
    if (scope === "europe" && pool.status === "ready")
      return europeReferential(dossier, pool.value, { level });
    if (scope === "competition" && competition && refState.status === "ready")
      return rebase(dossier, refState.value, competition.name);
    return dossier;
  }, [dossier, scope, level, competition, pool, refState]);
  const state =
    scope === "europe"
      ? pool
      : scope === "competition"
        ? refState
        : { status: "ready" };
  return {
    scope,
    level,
    competition,
    view,
    state,
    setScope,
    setLevel,
    pick(item) {
      if (item.own) setScope("league");
      else {
        setCompetition(item);
        setScope("competition");
      }
    },
  };
}

function ComparisonBar({ dossier, cmp, active }) {
  const competitions = useSeasonCompetitions();
  const { scope, level, state } = cmp;
  const single = (c) => ({ ...c, leagues: [c] });
  const own = { ...dossier.league, own: true, leagues: null };
  const played = dossier.competitions
    .filter((c) => c.id !== dossier.league?.id)
    .map((c) => single(competitions.find((x) => x.id === c.id) || c));
  const loading = state.status !== "ready";
  const leagueName = dossier.league?.name || "Championnat";
  return (
    <section
      className={s.compareBar}
      data-inactive={!active || undefined}
      aria-label="Référentiel de comparaison"
    >
      <div className={s.compareRow}>
        <span className={s.compareLabel}>Comparer à</span>
        <div
          className={`segmented-control ${s.compareScope}`}
          role="group"
          aria-label="Clubs comparés"
        >
          <button
            aria-pressed={scope === "europe"}
            onClick={() => cmp.setScope("europe")}
          >
            Europe <small>Top 7 + UEFA</small>
          </button>
          <button
            aria-pressed={scope === "league"}
            onClick={() => cmp.setScope("league")}
          >
            {leagueName}
          </button>
        </div>
        <div className={s.comparePick} data-active={scope === "competition"}>
          <SearchMenu
            placeholder="Chercher une compétition…"
            suggestionsLabel="Compétitions jouées par le club"
            suggestions={played}
            minLength={1}
            itemKey={(item) => item.id}
            search={(query) => {
              const needle = normalizeText(query);
              return competitions
                .filter(
                  (c) =>
                    normalizeText(c.name).includes(needle) ||
                    normalizeText(countryLabel(c.country)).includes(needle),
                )
                .map((c) => (c.id === dossier.league?.id ? own : single(c)));
            }}
            button={
              scope === "competition" && cmp.competition ? (
                <MenuItem item={cmp.competition} />
              ) : (
                <span>Autre compétition</span>
              )
            }
            renderItem={(item) => (
              <MenuItem item={item} meta={refMeta(item, dossier)} />
            )}
            onSelect={cmp.pick}
          />
        </div>
        {scope === "europe" && (
          <div
            className={`segmented-control ${s.compareLevel}`}
            role="group"
            aria-label="Niveau des clubs comparés"
          >
            <button aria-pressed={level} onClick={() => cmp.setLevel(true)}>
              Niveau comparable
            </button>
            <button aria-pressed={!level} onClick={() => cmp.setLevel(false)}>
              Tous les clubs
            </button>
          </div>
        )}
      </div>
      {active && loading && (
        <p className={s.compareSummary} role="status">
          {state.status === "error"
            ? state.error
            : scope === "europe"
              ? "Lecture des clubs du Top 7 européen…"
              : `Lecture de ${state.progress?.league || cmp.competition?.name} · ${state.progress?.done ?? 0} / ${state.progress?.total || "…"} clubs`}
        </p>
      )}
    </section>
  );
}

function refMeta(item, dossier) {
  if (item.own) return "Championnat du club";
  if (dossier.competitions.some((c) => c.id === item.id))
    return `${countryLabel(item.country)} · compétition jouée par le club`;
  return countryLabel(item.country);
}

/** Every club of the referential behind one indicator or phase index. */
function ClubRankingDialog({ dossier, target, onClose }) {
  const f = useFootball();
  const ref = dossier.referential;
  const mixed = Boolean(ref?.multi || ref?.inserted);
  const href = (club) => f.href("/clubs/", { id: club.id, clubView: "" });
  const meta = (club, extra) =>
    [mixed && club.league?.name, extra].filter(Boolean).join(" · ");
  const scope = `${dossier.clubs.length} clubs · ${dossier.league?.name}`;
  let title, note, rows;
  if (target.type === "metric") {
    const metric = METRICS[target.key];
    const dir = metric.better === -1 ? 1 : -1;
    title = metric.label;
    note =
      metric.better === -1
        ? "Plus bas = mieux : du plus bas au plus haut."
        : metric.better === 0
          ? "Indicateur de style, sans bon ni mauvais côté : du plus haut au plus bas."
          : "Du meilleur au moins bon.";
    rows = [...dossier.clubs]
      .sort((a, b) => {
        const x = a.values[target.key],
          y = b.values[target.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return dir * (x - y);
      })
      .map((club) => ({
        id: club.id,
        rank: club.ranks?.[target.key] ?? null,
        name: club.name,
        imageUrl: club.imageUrl,
        meta: meta(club),
        value: formatMetric(target.key, club.values[target.key], {
          total: metric.total,
        }),
        centile: metric.better === 0 ? null : club.centiles?.[target.key],
        href: href(club),
      }));
  } else {
    const phase = PHASES.find((p) => p.key === target.key);
    title = `Indice ${phase.label.toLowerCase()}`;
    note = `Moyenne des centiles : ${phase.keys.map((k) => METRICS[k].label.toLowerCase()).join(", ")}.`;
    const sorted = [...dossier.clubs].sort(
      (a, b) => (b.phases[target.key] ?? -1) - (a.phases[target.key] ?? -1),
    );
    rows = sorted.map((club) => {
      const v = club.phases[target.key];
      return {
        id: club.id,
        rank:
          v == null
            ? null
            : 1 + sorted.filter((c) => (c.phases[target.key] ?? -1) > v).length,
        name: club.name,
        imageUrl: club.imageUrl,
        meta: meta(club),
        value: v == null ? "—" : `${v} / 100`,
        centile: v,
        href: href(club),
      };
    });
  }
  return (
    <RankingDialog
      title={title}
      subtitle={scope}
      note={note}
      rows={rows}
      selfId={dossier.id}
      onClose={onClose}
    />
  );
}

/* ------------------------------------------------------ stats avancées */

const ADVANCED_VIEWS = [
  ["carte", "Carte du référentiel"],
  ["ballon", "Avec le ballon"],
  ["sans-ballon", "Sans le ballon"],
  ["cpa", "Transitions et CPA"],
  ["finition", "Finition et gardien"],
  ["attendu", "Classement attendu"],
];
const ADVANCED_TEXT = {
  carte:
    "Qui crée, qui concède : la place du club dans le référentiel choisi, puis son niveau phase par phase.",
  ballon:
    "Ce que le club produit (gauche) face à ce que ses adversaires produisent contre lui (droite).",
  "sans-ballon":
    "Hauteur et intensité du pressing, duels, et ce que le bloc laisse passer.",
  cpa: "Les phases courtes qui décident beaucoup de matchs serrés.",
  finition:
    "Les écarts aux attendus : ce que les attaquants et le gardien ajoutent, ou coûtent.",
  attendu:
    "Les points attendus rejouent chaque match selon ses xG : l’écart signale la réussite ou la malchance.",
};

function AdvancedStats({ dossier }) {
  const [view, setView] = useState("carte");
  return (
    <section className={s.advanced} aria-label="Statistiques avancées">
      <div className={s.advancedHead}>
        <h2>
          Stats avancées<span className={s.badgeNew}>Nouveau</span>
        </h2>
        <p>
          Chaque phase de jeu lue pour et contre, chaque indicateur classé parmi
          les {dossier.clubs.length} clubs de {dossier.league?.name}.
        </p>
      </div>
      <div className={s.advancedBody}>
        <div className={s.subnav}>
          <Segments
            label="Vue des statistiques avancées"
            value={view}
            onChange={setView}
            items={ADVANCED_VIEWS}
          />
          <p>{ADVANCED_TEXT[view]}</p>
        </div>
        {view === "carte" && <Synthesis dossier={dossier} bare />}
        {view === "ballon" && <WithBall dossier={dossier} bare />}
        {view === "sans-ballon" && <WithoutBall dossier={dossier} bare />}
        {view === "cpa" && <SetPieces dossier={dossier} bare />}
        {view === "finition" && <Finishing dossier={dossier} bare />}
        {view === "attendu" && <Standings dossier={dossier} bare />}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- comparison */

const COMPARE_KEYS = [
  "ppm",
  "xpts",
  "xg",
  "xga",
  "bigChances",
  "bigChancesAgainst",
  "xgPerShot",
  "possession",
  "fieldTilt",
  "ppda",
  "passAccuracy",
  "duels",
  "xgSet",
  "xgSetAgainst",
  "finishing",
  "keeper",
];

/** Club picker over every competition: league neighbours first, then search. */
/** The club's closest neighbours in its own league, from the API; none while they load. */
function useLeagueNeighbours(dossier) {
  const state = useClubNeighbours(
    dossier.season,
    dossier.id,
    dossier.league?.id || null,
  );
  return state.value || [];
}

function ClubMenu({ dossier, value, onSelect, label = "Comparer avec" }) {
  const search = useClubSearch();
  const neighbours = useLeagueNeighbours(dossier);
  const suggestions = useMemo(
    () =>
      neighbours.slice(0, 6).map((club) => neighbourBrief(club, countryLabel)),
    [neighbours],
  );
  return (
    <SearchMenu
      label={label}
      placeholder="Chercher un club, toutes compétitions…"
      suggestionsLabel={`Profils proches en ${dossier.league?.name || "championnat"} · tapez pour chercher partout`}
      suggestions={suggestions}
      search={async (query, signal) =>
        (await search(query, signal))
          .filter((club) => club.id !== dossier.id)
          .map((club) => brief(club))
      }
      button={
        value ? (
          <MenuItem item={value} meta={value.meta} />
        ) : (
          <span className={c.muted}>Choisir un club</span>
        )
      }
      renderItem={(item) => <MenuItem item={item} meta={item.meta} />}
      onSelect={onSelect}
    />
  );
}

/** The three axes where each club leads the other by the most centiles. */
function Gaps({ self, other }) {
  const diffs = PERFORMANCE_KEYS.map((key) => ({
    key,
    diff: (self.centiles[key] ?? 0) - (other.centiles[key] ?? 0),
  }));
  const side = (club, sign) =>
    diffs
      .filter((d) => d.diff * sign > 0)
      .sort((a, b) => (b.diff - a.diff) * sign)
      .slice(0, 3);
  return (
    <div className={s.gaps}>
      {[
        [self, side(self, 1), 1],
        [other, side(other, -1), -1],
      ].map(([club, list, sign]) => (
        <div key={club.id} data-side={sign > 0 ? "self" : "rival"}>
          <h4>{club.name} devant</h4>
          {list.length ? (
            <ul>
              {list.map(({ key, diff }) => (
                <li key={key}>
                  <span>{METRICS[key].label.replace(" / match", "")}</span>
                  <b>+{Math.abs(diff)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className={c.muted}>Sur aucun axe.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Comparison({ dossier, rival, onRival }) {
  const state = useClubDossier(rival?.id || null);
  const other = state.status === "ready" ? state.dossier : null;
  const self = dossier.self;
  const sameLeague = other && other.league?.id === dossier.league?.id;
  const meetings = other
    ? dossier.allRows.filter((row) => row.opponent.id === other.id)
    : [];
  return (
    <div className={c.stack}>
      <div className={s.toolbar}>
        <ClubMenu dossier={dossier} value={rival} onSelect={onRival} />
      </div>
      {!rival ? (
        <p className={c.muted}>Choisissez un club à comparer.</p>
      ) : !other ? (
        <ClubLoading state={state} compact />
      ) : (
        <>
          <div className={sA.versus}>
            {[
              [dossier, self],
              [other, other.self],
            ].map(([club, row], i) => (
              <div key={club.id} data-side={i ? "rival" : "self"}>
                <Crest club={club} />
                <span>
                  <strong>{club.name}</strong>
                  <small>
                    {ordinal(row.position)} de {club.league?.name} ·{" "}
                    {row.record.points} pts · {row.record.w}-{row.record.d}-
                    {row.record.l} · Indice {row.vegaIndex}
                  </small>
                </span>
              </div>
            ))}
          </div>
          {!sameLeague && (
            <p className={s.notice}>
              Championnats différents : valeurs par match dans le championnat de
              chaque club, centiles calculés dans ce championnat (
              {dossier.league?.name} pour {dossier.name}, {other.league?.name}{" "}
              pour {other.name}). Une même valeur ne pèse pas pareil d’une ligue
              à l’autre.
            </p>
          )}
          <div className={c.grid2}>
            <Card
              className={c.grow}
              title="Profils superposés"
              text="Centiles de performance, chacun dans son championnat."
            >
              <div className={s.radarBox}>
                <RadarChart
                  size={440}
                  axes={PERFORMANCE_KEYS.map((key) => ({
                    key,
                    label: METRICS[key].label.replace(" / match", ""),
                  }))}
                  series={[self, other.self].map((club, i) => ({
                    name: club.name,
                    color: i ? "var(--mq-series-2)" : "var(--mq-series-1)",
                    values: Object.fromEntries(
                      PERFORMANCE_KEYS.map((key) => [
                        key,
                        club.centiles[key] ?? 0,
                      ]),
                    ),
                  }))}
                />
              </div>
              <Gaps self={self} other={other.self} />
            </Card>
            <Card
              title="Côte à côte"
              text="Valeurs par match en championnat et centile ; en gras, la meilleure valeur."
            >
              <div className={c.tableScroll}>
                <table className={c.table}>
                  <thead>
                    <tr>
                      <th scope="col">
                        <Term>Indicateur</Term>
                      </th>
                      <th scope="col">{dossier.name}</th>
                      <th scope="col">{other.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_KEYS.map((key) => {
                      const a = self.values[key],
                        b = other.self.values[key],
                        better = METRICS[key].better;
                      const best =
                        better && a != null && b != null && a !== b
                          ? a > b === better > 0
                            ? 0
                            : 1
                          : null;
                      return (
                        <tr key={key}>
                          <th scope="row">
                            {METRICS[key].label}
                            <Info
                              text={METRICS[key].info}
                              label={METRICS[key].label}
                            />
                          </th>
                          {[self, other.self].map((club, i) => (
                            <td
                              key={club.id}
                              className={best === i ? s.best : undefined}
                            >
                              {formatMetric(key, club.values[key])}
                              <small className={s.centile}>
                                P{club.centiles[key] ?? "—"}
                              </small>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <Card title="Confrontations cette saison" text="Toutes compétitions.">
            {meetings.length ? (
              <MatchRows rows={meetings} />
            ) : (
              <p className={c.muted}>
                Aucune confrontation jouée cette saison.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------- similar clubs */

const MAJOR = [
  ["ENG", "Premier League"],
  ["ESP", "LaLiga"],
  ["ITA", "Serie A"],
  ["GER", "Bundesliga"],
  ["FRA", "Ligue 1"],
  ["POR", "Liga Portugal"],
  ["NED", "Eredivisie"],
];
const ALL_LEAGUES = { id: "all", name: "Tous les championnats", all: true };

/** The whole base in the league menu: a globe where a league has its crest. */
const AllLeaguesItem = ({ meta }) => (
  <span className={c.menuItem}>
    <Icon name="globe" className={c.menuIcon} />
    <span>
      <strong>{ALL_LEAGUES.name}</strong>
      {meta && <small>{meta}</small>}
    </span>
  </span>
);

/** Where a neighbour plays: its place, its league and country, its record. */
const neighbourMeta = (club) =>
  [
    club.position != null && ordinal(club.position),
    club.league &&
      [club.league.name, countryLabel(club.league.country)]
        .filter(Boolean)
        .join(", "),
    club.record &&
      `${club.record.won}-${club.record.drawn}-${club.record.lost}`,
  ]
    .filter(Boolean)
    .join(" · ");

function Similar({ dossier, onCompare }) {
  const f = useFootball();
  const leagues = useSeasonLeagues();
  const [league, setLeague] = useState(ALL_LEAGUES);
  const state = useClubNeighbours(
    dossier.season,
    dossier.id,
    league.all ? null : league.id,
  );
  const suggestions = useMemo(() => {
    const own = leagues.find((item) => item.id === dossier.league?.id);
    const major = MAJOR.map(([country, name]) =>
      leagues.find((item) => item.country === country && item.name === name),
    );
    return [ALL_LEAGUES, own, ...major].filter(
      (item, i, list) => item && list.findIndex((x) => x?.id === item.id) === i,
    );
  }, [leagues, dossier.league]);
  const list = state.value || [];
  return (
    <div className={c.stack}>
      <div className={s.toolbar}>
        <SearchMenu
          label="Chercher des profils proches dans"
          placeholder="Chercher un championnat…"
          suggestionsLabel="Toute la base, championnat du club et grands championnats"
          suggestions={suggestions}
          minLength={1}
          search={(query) => {
            const needle = normalizeText(query);
            return leagues.filter(
              (item) =>
                normalizeText(item.name).includes(needle) ||
                normalizeText(countryLabel(item.country)).includes(needle),
            );
          }}
          button={
            league.all ? (
              <AllLeaguesItem />
            ) : (
              <MenuItem item={league} meta={countryLabel(league.country)} />
            )
          }
          renderItem={(item) =>
            item.all ? (
              <AllLeaguesItem meta="Championnats de niveau comparable" />
            ) : (
              <MenuItem
                item={item}
                meta={`${countryLabel(item.country)}${item.id === dossier.league?.id ? " · championnat du club" : ""}`}
              />
            )
          }
          onSelect={setLeague}
        />
        <Info
          label="Clubs similaires"
          text="Style de jeu seulement : possession, territoire, jeu direct, pressing, centres, coups de pied arrêtés, actions défensives, xG pour et contre, précision des passes. Chaque club est classé en centiles dans son championnat ; par défaut, parmi les championnats de niveau comparable au sien."
        />
      </div>
      {state.error && !state.value ? (
        <ClubLoading state={{ status: "error", error: state.error }} compact />
      ) : state.value === undefined ? (
        <Skeleton
          label="Recherche des clubs similaires…"
          kind="table"
          lines={4}
        />
      ) : !list.length ? (
        <p className={c.muted}>
          {league.all
            ? "Pas assez de statistiques de style pour comparer ce club."
            : `Aucun club comparable en ${league.name}.`}
        </p>
      ) : (
        <div className={sA.similar}>
          {list.map((club) => (
            <article key={club.id} className={c.card}>
              <div className={sA.similarHead}>
                <Crest club={club} />
                <span>
                  <strong>{club.name}</strong>
                  <small>{neighbourMeta(club)}</small>
                </span>
                <b>
                  {club.similarity}
                  <small>/100</small>
                </b>
              </div>
              <p className={c.note}>
                Plus proches :{" "}
                {club.closest
                  .filter((key) => METRICS[key])
                  .map((key) => METRICS[key].label.replace(" / match", ""))
                  .join(" · ")}
              </p>
              <div className={sA.similarActions}>
                <button
                  className="button button-secondary"
                  onClick={() => onCompare(neighbourBrief(club, countryLabel))}
                >
                  Comparer
                </button>
                <Link
                  className="inline-link"
                  href={f.href("/clubs/", { id: club.id, clubView: "" })}
                >
                  Ouvrir la fiche →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

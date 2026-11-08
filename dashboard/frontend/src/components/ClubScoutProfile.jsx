"use client";
/* Club profile: identity rail and tabs, statistics ranked in a referential
 * the user chooses, comparison and similar clubs across every competition. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Segments } from "./UI.jsx";
import { ResearchTabs } from "./ResearchUI.jsx";
import { chartTokens, RadarChart } from "./PlayerScoutCharts.jsx";
import { countryLabel } from "../services/competition-selector.js";
import { normalizeText } from "../services/format.js";
import {
  METRICS,
  PERFORMANCE_KEYS,
  formatMetric,
  rebase,
  similarClubs,
  useClubDossier,
  useClubSearch,
  useLeagueCohort,
  useReferential,
  useSeasonCompetitions,
  useSeasonLeagues,
} from "../services/club-scout.js";
import {
  Card,
  ClubLoading,
  Crest,
  Info,
  MatchRows,
  MenuItem,
  SearchMenu,
  clubStyles as c,
  ordinal,
} from "./ClubScoutUI.jsx";
import {
  IdentityRail,
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

export default function ClubScoutProfile({ clubId }) {
  const state = useClubDossier(clubId);
  const dossier = state.status === "ready" ? state.dossier : null;
  return (
    <div className={`${chartTokens} ${c.shell}`}>
      {dossier ? (
        <Profile key={dossier.id} dossier={dossier} />
      ) : (
        <ClubLoading state={state} />
      )}
    </div>
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

function Profile({ dossier }) {
  const [tab, setTab] = useClubTab();
  // Referential chosen by the user; null keeps the club's own league.
  const [choice, setChoice] = useState(null);
  const refState = useReferential(choice?.leagues || null);
  const view = useMemo(
    () =>
      choice && refState.status === "ready"
        ? rebase(dossier, refState.value, choice.name)
        : dossier,
    [dossier, choice, refState],
  );
  const [rival, setRival] = useState(() => {
    const first = similarClubs(dossier, 1)[0]?.club;
    return first ? brief(first, dossier.league) : null;
  });
  const compare = (club) => {
    setRival(club);
    setTab("compare");
  };
  return (
    <>
      <div className={sA.layout}>
        <IdentityRail dossier={dossier} onTab={setTab} />
        <div className={sA.main}>
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
          >
            {REFERENTIAL_TABS.has(tab) ? (
              <ReferentialBar
                dossier={dossier}
                view={view}
                choice={choice}
                state={refState}
                onChoice={setChoice}
              />
            ) : (
              <p className={s.referentialLine}>
                Données du club, toutes compétitions · référentiel :{" "}
                {dossier.league?.name}
              </p>
            )}
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
    </>
  );
}

/* --------------------------------------------------------- referential */

const REFERENTIAL_TABS = new Set(["overview", "stats", "advanced", "style"]);
const TOP5 = [
  ["ENG", "Premier League"],
  ["ESP", "LaLiga"],
  ["ITA", "Serie A"],
  ["GER", "Bundesliga"],
  ["FRA", "Ligue 1"],
];

/** Which clubs every centile, rank and median is computed against. */
function ReferentialBar({ dossier, view, choice, state, onChoice }) {
  const competitions = useSeasonCompetitions();
  const top5 = TOP5.map(([country, name]) =>
    competitions.find((c) => c.country === country && c.name === name),
  ).filter(Boolean);
  const single = (c) => ({ ...c, leagues: [c] });
  const own = { ...dossier.league, own: true, leagues: null };
  const played = dossier.competitions
    .filter((c) => c.id !== dossier.league?.id)
    .map((c) => single(competitions.find((x) => x.id === c.id) || c));
  const suggestions = [
    own,
    ...played,
    { id: "top5", name: "Top 5 européens", country: "", leagues: top5 },
    ...top5.filter((c) => c.id !== dossier.league?.id).map(single),
  ];
  const current = choice || own;
  const loading = choice && state.status !== "ready";
  const ref = view.referential;
  return (
    <div className={s.referential}>
      <SearchMenu
        label="Référentiel"
        placeholder="Chercher une compétition…"
        suggestionsLabel="Championnat du club, ses coupes et les grands championnats"
        suggestions={suggestions}
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
        button={<MenuItem item={current} meta={refMeta(current, dossier)} />}
        renderItem={(item) => (
          <MenuItem item={item} meta={refMeta(item, dossier)} />
        )}
        onSelect={(item) => onChoice(item.own ? null : item)}
      />
      <p>
        {loading ? (
          state.status === "error" ? (
            state.error
          ) : (
            `Lecture de ${state.progress?.league || current.name} · ${state.progress?.done ?? 0} / ${state.progress?.total || "…"} clubs`
          )
        ) : !ref ? (
          <>
            {view.clubs.length} clubs · {dossier.self.record.matches} journées ·
            valeurs par match en championnat
          </>
        ) : ref.multi ? (
          <>
            {view.clubs.length} clubs de {ref.label} · valeurs par match de
            chaque club dans son championnat, classement par match
          </>
        ) : ref.inserted ? (
          <>
            {view.clubs.length - 1} clubs de {ref.label} + {dossier.name} ·
            valeurs du club en{" "}
            {dossier.competitions.find((c) => c.id === dossier.league?.id)
              ?.name || "championnat"}
            , classées par match parmi ce référentiel
          </>
        ) : (
          <>
            {view.clubs.length} clubs · valeurs par match en {ref.label}
          </>
        )}
      </p>
    </div>
  );
}

function refMeta(item, dossier) {
  if (item.own) return "Championnat du club";
  if (item.id === "top5")
    return `${item.leagues.length} championnats · ~100 clubs`;
  if (dossier.competitions.some((c) => c.id === item.id))
    return `${countryLabel(item.country)} · compétition jouée par le club`;
  return countryLabel(item.country);
}

/* ------------------------------------------------------ stats avancées */

const ADVANCED_VIEWS = [
  ["carte", "Carte du championnat"],
  ["ballon", "Avec le ballon"],
  ["sans-ballon", "Sans le ballon"],
  ["cpa", "Transitions et CPA"],
  ["finition", "Finition et gardien"],
  ["attendu", "Classement attendu"],
];
const ADVANCED_TEXT = {
  carte:
    "Qui crée, qui concède : la place du club dans son championnat, puis son niveau phase par phase.",
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
function ClubMenu({ dossier, value, onSelect, label = "Comparer avec" }) {
  const search = useClubSearch();
  const suggestions = useMemo(
    () =>
      similarClubs(dossier, 6).map(({ club }) => brief(club, dossier.league)),
    [dossier],
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
              title="Profils superposés"
              text="Centiles de performance, chacun dans son championnat."
            >
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
                      <th scope="col">Indicateur</th>
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
                            <Info text={METRICS[key].info} />
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

function Similar({ dossier, onCompare }) {
  const f = useFootball();
  const leagues = useSeasonLeagues();
  const [league, setLeague] = useState(dossier.league);
  const state = useLeagueCohort(league);
  const suggestions = useMemo(() => {
    const own = leagues.find((item) => item.id === dossier.league?.id);
    const major = MAJOR.map(([country, name]) =>
      leagues.find((item) => item.country === country && item.name === name),
    );
    return [own, ...major].filter(
      (item, i, list) => item && list.findIndex((x) => x?.id === item.id) === i,
    );
  }, [leagues, dossier.league]);
  const list =
    state.status === "ready" ? similarClubs(dossier, 9, state.value.clubs) : [];
  const own = league?.id === dossier.league?.id;
  return (
    <div className={c.stack}>
      <div className={s.toolbar}>
        <SearchMenu
          label="Chercher des profils proches dans"
          placeholder="Chercher un championnat…"
          suggestionsLabel="Championnat du club et grands championnats"
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
            <MenuItem item={league} meta={countryLabel(league?.country)} />
          }
          renderItem={(item) => (
            <MenuItem
              item={item}
              meta={`${countryLabel(item.country)}${item.id === dossier.league?.id ? " · championnat du club" : ""}`}
            />
          )}
          onSelect={setLeague}
        />
      </div>
      <p className={c.note} style={{ margin: 0 }}>
        {own
          ? "Proximité des centiles de style et de niveau (possession, territoire, jeu direct, pressing, centres, CPA, xG pour et contre) dans le même championnat."
          : `Chaque club est décrit en centiles dans son propre championnat : un voisin en ${league?.name} joue, dans sa ligue, comme ${dossier.name} dans la sienne. Ce n’est pas un niveau égal.`}
      </p>
      {state.status !== "ready" ? (
        <ClubLoading state={state} compact />
      ) : (
        <div className={sA.similar}>
          {list.map(({ club, similarity, parts }) => (
            <article key={club.id} className={c.card}>
              <div className={sA.similarHead}>
                <Crest club={club} />
                <span>
                  <strong>{club.name}</strong>
                  <small>
                    {ordinal(club.position)} de {league?.name} · {club.record.w}
                    -{club.record.d}-{club.record.l}
                  </small>
                </span>
                <b>
                  {similarity}
                  <small>/100</small>
                </b>
              </div>
              <p className={c.note}>
                Plus proches :{" "}
                {parts
                  .slice(0, 3)
                  .map((part) =>
                    METRICS[part.key].label.replace(" / match", ""),
                  )
                  .join(" · ")}
              </p>
              <div className={sA.similarActions}>
                <button
                  className="button button-secondary"
                  onClick={() => onCompare(brief(club, league))}
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

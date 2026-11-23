"use client";
/* Club profile tabs: identity rail and the overview, statistics, style,
 * matches and squad tabs (the player profile adapted to a club). */
import React, { useMemo, useState } from "react";
import BackLink from "./BackLink.jsx";
import Link from "next/link";
import { Segments, Skeleton } from "./UI.jsx";
import { BookmarkButton } from "./ResearchUI.jsx";
import Icon from "./Icon.jsx";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Term } from "./Hint.jsx";
import { PointsRaceLines, PointsPerMatch } from "./PointsRace.jsx";
import {
  euros,
  readDay,
  useClubSquad,
  weightedAge,
} from "../services/profile-blocks.js";
import { json, useResource } from "../services/resources.js";
import { share, useMatchForecast } from "../services/forecasts.js";
import { matchForecast } from "../services/cup-matches.js";
import ClubInformation from "./ClubInformation.jsx";
import { PercentilePizza } from "./PlayerScoutCharts.jsx";
import {
  FAMILIES,
  METRICS,
  PERFORMANCE_KEYS,
  PHASES,
  formatMetric,
  opponentEloStrength,
  opponentStrength,
  useEuropeLevels,
  usePreviousSeasonRows,
} from "../services/club-scout.js";
import {
  Card,
  Crest,
  FormStrip,
  GameState,
  GoalPeriods,
  Info,
  Kpis,
  LeaguePlot,
  LeagueTable,
  mixedReferential,
  MatchRowLink,
  MatchRows,
  MetricTable,
  PhaseBars,
  ShotPair,
  SituationTable,
  SquadTable,
  StyleSpectrum,
  XgTrend,
  clubStyles as c,
  dateShort,
  fmtNum,
  ordinal,
  styleTags,
} from "./ClubScoutUI.jsx";
import ClubSubstitutions from "./ClubSubstitutions.jsx";
import ClubPassingTriangle from "./ClubPassingTriangle.jsx";
import {
  goalsBesideXg,
  pairedPoints,
  pairedXg,
  partOf,
  seasonTotal,
} from "../services/club-supported.js";
import s from "./ClubScoutTabs.module.css";

function competitionRecords(dossier) {
  const out = new Map();
  for (const row of dossier.allRows) {
    const key = row.match.leagueId;
    const entry = out.get(key) || {
      id: key,
      name: row.match.league,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      matches: 0,
    };
    entry.matches++;
    entry[row.result === "V" ? "w" : row.result === "N" ? "d" : "l"]++;
    entry.gf += row.gf;
    entry.ga += row.ga;
    out.set(key, entry);
  }
  return [...out.values()].map((entry) => ({
    ...entry,
    imageUrl: dossier.competitions.find((comp) => comp.id === entry.id)
      ?.imageUrl,
  }));
}

/**
 * The top of the identity column: the way back, the crest, the name, the league and season,
 * the coach and stadium. `club` is the dossier, or what the page's read of the club gives
 * before it (clubEarly): the column starts the same either way.
 */
export function RailHead({ club, backHref }) {
  return (
    <>
      {backHref && (
        <BackLink
          className={`inline-link ${s.railBack}`}
          href={backHref}
          label="Tous les clubs"
        />
      )}
      <div className={s.identity}>
        <Crest club={club} className={`crest ${s.bigCrest}`} />
        <h1 className={s.name}>{club.name}</h1>
        <p className={s.sub}>
          {[club.league?.name, club.season].filter(Boolean).join(" · ")}
        </p>
        <div className={s.chips}>
          {club.coach && (
            <span className={s.chip}>Entraîneur · {club.coach}</span>
          )}
          {club.stadium && <span className={s.chip}>{club.stadium}</span>}
        </div>
      </div>
    </>
  );
}

export function IdentityRail({ dossier, onTab, backHref }) {
  const f = useFootball();
  const self = dossier.self,
    r = self.record;
  // Points and xPts of the same matches (club-supported.js).
  const paired = pairedPoints(self);
  const gap = paired.delta;
  // On a phone the header opens on the identity and the standing.
  const more = usePhoneFold();
  return (
    <aside className={s.rail} aria-label="Identité du club" {...more.fold}>
      <RailHead club={dossier} backHref={backHref} />
      <div className={s.railSection}>
        <div className={s.railTitle}>
          <div className={s.railName}>
            <Term>Classement</Term>
          </div>{" "}
          <span>{dossier.league?.name}</span>
        </div>
        <div className={s.position}>
          <strong>{ordinal(self.position)}</strong>
          <span>
            {r.points} pts · {r.matches} matchs
            <small>{ordinal(self.xptsPosition)} aux points attendus</small>
          </span>
        </div>
        <dl className={c.facts}>
          <div>
            <dt>
              <Term>Bilan</Term>
            </dt>
            <dd>
              {r.w}-{r.d}-{r.l}
            </dd>
          </div>
          <div>
            <dt>
              <Term hint="Buts marqués et encaissés.">Buts</Term>
            </dt>
            <dd>
              {r.gf}–{r.ga}
            </dd>
          </div>
          <div>
            <dt>
              <Term>xPts</Term>
            </dt>
            <dd>{fmtNum(paired.expected, 1)}</dd>
            {Number.isFinite(gap) && (
              <small className={gap >= 0 ? c.up : c.down}>
                {fmtNum(gap, 1, true)} pts vs attendu
                {paired.matches < r.matches &&
                  ` · sur ${paired.matches} match${paired.matches > 1 ? "s" : ""}`}
              </small>
            )}
          </div>
          <div>
            <dt>
              <Term>Forme</Term>
            </dt>
            <dd>
              <FormStrip rows={dossier.allRows} />
            </dd>
          </div>
        </dl>
      </div>
      <div className={`${s.railSection} phone-fold-row`}>
        <PhoneFoldToggle
          {...more.toggle}
          label="Indice Vega, compétitions et effectif"
        />
      </div>
      <div className={`${s.railSection} phone-fold-part`}>
        <div className={s.railTitle}>
          <div className={s.railName}>
            <Term>Indice Vega club</Term>
          </div>{" "}
          <span>sur 100</span>
        </div>
        <div className={s.index}>
          <strong>{self.vegaIndex ?? "—"}</strong>
          <span>
            {ordinal(self.vegaRank)} du championnat
            <small>moyenne pondérée des centiles par phase de jeu</small>
          </span>
        </div>
        <PhaseBars dossier={dossier} phases={PHASES} base />
        <button className={s.railLink} onClick={() => onTab("stats")}>
          Détail des indicateurs →
        </button>
      </div>
      <div className={`${s.railSection} phone-fold-part`}>
        <div className={s.railTitle}>
          <Term>Toutes compétitions</Term>
        </div>
        <ul className={s.comps}>
          {competitionRecords(dossier).map((comp) => (
            <li key={comp.id}>
              <Crest club={comp} />
              <span>
                {comp.name}
                <small>
                  {comp.matches} m · {comp.w}-{comp.d}-{comp.l} · {comp.gf}–
                  {comp.ga}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <SquadFacts dossier={dossier} />
      <div className={s.railSection}>
        <div className={`research-toolbar ${s.railActions}`}>
          <BookmarkButton
            kind="clubs"
            id={dossier.id}
            name={dossier.name}
            imageUrl={dossier.imageUrl}
            season={dossier.season}
          />
          <Link
            className="button button-secondary"
            href={f.href("/rapport/", { id: dossier.id })}
          >
            <Icon name="eye" />
            Rapport
          </Link>
        </div>
      </div>
    </aside>
  );
}

/**
 * The rail's squad: its value and average age as the club's record gives them today (shown
 * for the season in progress only), and the age weighted by the minutes played when the
 * ages known cover enough of them.
 */
function SquadFacts({ dossier }) {
  const f = useFootball();
  const current =
    Boolean(dossier.season) && dossier.season === f?.manifest?.defaultSeason;
  const squad = useClubSquad(dossier.id, dossier.season, current).value;
  const ages = useAgeProfile(dossier.id, dossier.season).value;
  const weighted = weightedAge(ages?.minutesByAge);
  if (!(current && squad) && !weighted) return null;
  const facts = [
    current &&
      squad && {
        label: "Valeur estimée",
        value: euros(squad.value),
        note: !squad.league
          ? squad.top18Value
            ? `${euros(squad.top18Value)} pour ses 18 premiers`
            : ""
          : squad.league.valued === squad.league.clubs
            ? `${ordinal(squad.league.rank)} du championnat sur ${squad.league.clubs}`
            : `${ordinal(squad.league.rank)} des ${squad.league.valued} clubs estimés (sur ${squad.league.clubs})`,
      },
    current &&
      squad?.averageAge != null && {
        label: "Âge moyen",
        value: `${fmtNum(squad.averageAge, 1)} ans`,
        note: squad.size
          ? `${squad.size} joueurs dans l’effectif`
          : "de l’effectif",
      },
    weighted && {
      label: "Âge pondéré",
      value: `${fmtNum(weighted.age, 1)} ans`,
      note: "par minutes jouées",
    },
  ].filter(Boolean);
  return (
    <div className={`${s.railSection} phone-fold-part`}>
      <div className={s.railTitle}>
        <div className={s.railName}>
          <Term>Effectif</Term>
        </div>{" "}
        {current && squad && <span>au {readDay(squad.readOn)}</span>}
      </div>
      <dl className={c.facts}>
        {facts.map((fact, i) => (
          <div
            key={fact.label}
            style={
              facts.length % 2 && i === facts.length - 1
                ? { gridColumn: "1 / -1" }
                : undefined
            }
          >
            <dt>
              <Term>{fact.label}</Term>
            </dt>
            <dd>{fact.value}</dd>
            {fact.note && <small>{fact.note}</small>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------- overview */

function readings(dossier) {
  const self = dossier.self;
  const ranked = Object.keys(METRICS)
    .filter(
      (key) =>
        METRICS[key].better !== 0 &&
        self.centiles[key] != null &&
        METRICS[key].family !== "results",
    )
    .map((key) => ({ key, centile: self.centiles[key] }));
  ranked.sort((a, b) => b.centile - a.centile);
  return {
    strengths: ranked.slice(0, 4),
    weaknesses: ranked.slice(-3).reverse(),
  };
}

/**
 * Points, goals and the expected table of one competition. A mixed
 * referential (several leagues) passes the club's own league instead: a
 * table across leagues with different calendars would not mean anything.
 */
export function ExpectedCard({ dossier }) {
  const self = dossier.self;
  // Each pair on the same matches; a season total on its own (club-supported.js).
  const points = pairedPoints(self),
    goals = goalsBesideXg(self),
    keeper = seasonTotal(self, "keeper").value;
  const on = (matches) =>
    partOf(matches, self.record.matches)
      ? ` · sur ${matches} match${matches > 1 ? "s" : ""}`
      : "";
  const tone = (value, better = 1) =>
    Number.isFinite(value) ? (value * better >= 0 ? c.up : c.down) : undefined;
  return (
    <Card
      fold
      title="Résultats et attendus"
      text={`Les écarts entre le réel et l’attendu signalent la finition, le gardien ou la réussite : ils tendent à se résorber. À droite, le classement de ${dossier.league?.name || "son championnat"} si chaque match s’était joué selon ses xG.`}
    >
      <dl className={`${c.facts} ${s.factsLine}`}>
        <div>
          <dt>
            <Term>Points · xPts</Term>
          </dt>
          <dd>
            {fmtNum(points.actual)} · {fmtNum(points.expected, 1)}
          </dd>
          <small className={tone(points.delta)}>
            {fmtNum(points.delta, 1, true)} pts{on(points.matches)}
          </small>
        </div>
        <div>
          <dt>
            <Term>Buts · xG</Term>
          </dt>
          <dd>
            {fmtNum(goals.for.goals)} · {fmtNum(goals.for.xg, 1)}
          </dd>
          <small className={tone(goals.for.delta)}>
            {fmtNum(goals.for.delta, 1, true)} buts{on(goals.for.matches)}
          </small>
        </div>
        <div>
          <dt>
            <Term>Encaissés · xG contre</Term>
          </dt>
          <dd>
            {fmtNum(goals.against.goals)} · {fmtNum(goals.against.xg, 1)}
          </dd>
          <small className={tone(goals.against.delta, -1)}>
            {fmtNum(goals.against.delta, 1, true)} buts
            {on(goals.against.matches)}
          </small>
        </div>
        <div>
          <dt>
            <Term>Buts évités par le gardien</Term>
          </dt>
          <dd>{fmtNum(keeper, 1, true)}</dd>
          <small>xGOT concédés − buts encaissés</small>
        </div>
      </dl>
      <div className={s.expectedGrid}>
        <div className={s.expectedSide}>
          <PointsRaceLines rows={self.rows} />
          <PointsPerMatch rows={self.rows} />
        </div>
        <LeagueTable dossier={dossier} sort="xpts" compact />
      </div>
    </Card>
  );
}

export function Overview({ dossier, onTab, base = dossier }) {
  // On a phone the profile card opens on the radar.
  const readingFold = usePhoneFold();
  const self = dossier.self,
    v = self.values,
    total = dossier.clubs.length;
  // xG for minus against on the matches that know both (club-supported.js).
  const xgPaired = pairedXg(self);
  const { strengths, weaknesses } = readings(dossier);
  const pizza = PERFORMANCE_KEYS.map((key) => ({
    key,
    label: METRICS[key].label
      .replace(" / match", "")
      .replace(" (hors penalty)", ""),
    percentile: self.centiles[key],
    value: v[key],
    decimals: METRICS[key].digits,
    signed: METRICS[key].signed,
    unit: METRICS[key].unit,
    rank: self.ranks[key],
    peers: total,
  }));
  return (
    <div className={c.stack}>
      <Kpis
        items={[
          [
            "Points / match",
            fmtNum(v.ppm, 2),
            `${ordinal(self.ranks.ppm)} / ${total}`,
          ],
          [
            "Buts",
            `${self.record.gf}–${self.record.ga}`,
            `${fmtNum(v.goalsFor, 2)} – ${fmtNum(v.goalsAgainst, 2)} / match`,
          ],
          ["xG pour", fmtNum(v.xg, 2), `${ordinal(self.ranks.xg)} / ${total}`],
          [
            "xG contre",
            fmtNum(v.xga, 2),
            `${ordinal(self.ranks.xga)} / ${total}`,
          ],
          [
            "Diff. xG / match",
            fmtNum(xgPaired.perMatch, 2, true),
            "pour moins contre",
            Number.isFinite(xgPaired.perMatch)
              ? xgPaired.perMatch >= 0
                ? "up"
                : "down"
              : undefined,
          ],
          [
            "Sans encaisser",
            `${fmtNum(v.cleanSheets)} %`,
            `${self.rows.filter((row) => row.ga === 0).length} matchs`,
          ],
        ]}
      />
      <Card
        title="Profil de performance"
        text={`Centiles face aux ${total} clubs du référentiel (${dossier.league?.name || "son championnat"}). Indicateurs concédés inversés : plus la part est grande, mieux c’est.`}
      >
        <div className={s.profileGrid} {...readingFold.fold}>
          <PercentilePizza items={pizza} cohort={total} size={440} grow={1} />
          <PhoneFoldToggle
            {...readingFold.toggle}
            label="Phases de jeu, points forts et faibles"
          />
          <div className={`${s.profileSide} phone-fold-part`}>
            <div>
              <h4 className={s.subTitle}>Indice Vega par phase de jeu</h4>
              <PhaseBars dossier={dossier} phases={PHASES} />
            </div>
            <div className={s.reading}>
              <div>
                <h4>Points forts</h4>
                <ul>
                  {strengths.map(({ key, centile }) => (
                    <li key={key}>
                      <span>{METRICS[key].label}</span>
                      <b>P{centile}</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>À surveiller</h4>
                <ul>
                  {weaknesses.map(({ key, centile }) => (
                    <li key={key}>
                      <span>{METRICS[key].label}</span>
                      <b>P{centile}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div className={s.profileTags}>
          <div className={c.tags}>
            {styleTags(self).map((tag) => (
              <span key={tag} className={c.tag}>
                {tag}
              </span>
            ))}
          </div>
          <button className={s.railLink} onClick={() => onTab("style")}>
            Voir le style de jeu →
          </button>
        </div>
      </Card>
      <ExpectedCard dossier={mixedReferential(dossier) ? base : dossier} />
      <div className={`${c.grid2} ${c.matchPair}`}>
        <Card
          title="Derniers matchs"
          text="Toutes compétitions · barres : xG pour (bleu) et contre (orange)"
        >
          <MatchRows rows={dossier.allRows} limit={6} />
        </Card>
        <Card
          title="Prochains matchs"
          text="Difficulté : centile de l’adversaire parmi les clubs du championnat (différence de xG, ou Elo hors championnat)"
        >
          <Upcoming dossier={base} />
        </Card>
      </div>
      <ClubInformation dossier={base} />
    </div>
  );
}

export function Upcoming({ dossier, limit = 6 }) {
  const shown = dossier.upcoming.slice(0, limit);
  const opponentOf = (match) =>
    match.home.id === dossier.id ? match.away : match.home;
  // An opponent outside the league (Europe, cups) is placed by its club Elo among the
  // league's clubs; the Elo is read only when such an opponent is on the list.
  const foreign = shown.some(
    (match) => !dossier.clubs.some((club) => club.id === opponentOf(match).id),
  );
  const levels = useEuropeLevels(foreign);
  if (!dossier.upcoming.length)
    return <p className={c.muted}>Aucun match à venir collecté.</p>;
  return (
    <div className={c.matchList}>
      {shown.map((match) => {
        const home = match.home.id === dossier.id;
        const opponent = opponentOf(match);
        // A member of the reference keeps its place; a difficulty needs a measured centile
        // (never level 1 by default), and the label says which of the two is missing.
        const member = dossier.clubs.find((club) => club.id === opponent.id);
        const byElo = !member && levels.status === "ready";
        const strength = member
          ? opponentStrength(dossier, opponent.id)
          : byElo
            ? opponentEloStrength(dossier, levels.value.levels, opponent.id)
            : null;
        const measured = Boolean(strength) && Number.isFinite(strength.centile);
        const pending = !member && levels.status === "loading";
        const level = measured
          ? Math.max(1, Math.ceil(strength.centile / 20))
          : 0;
        return (
          <MatchRowLink className={c.matchRow} key={match.id} match={match}>
            <span className={c.matchDate}>{dateShort(match.date)}</span>
            <span className={c.muted} style={{ fontSize: 11 }}>
              {home ? "dom." : "ext."}
            </span>
            <span className={c.matchOpp}>
              <Crest club={opponent} />
              <span className={c.oppText}>
                <span>
                  {opponent.name}
                  {member?.position != null && (
                    <small> · {ordinal(member.position)}</small>
                  )}
                </span>
                {/* On a narrow card the difficulty's column is hidden: the chances come under the name. */}
                <UpcomingChances match={match} home={home} narrow />
              </span>
            </span>
            <span className={c.matchScore}>
              {match.timeUtc
                ? new Date(match.timeUtc).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
            <span
              title={
                measured
                  ? member
                    ? `Adversaire au centile ${strength.centile} de la différence de xG`
                    : `Elo ${Math.round(strength.elo)} : centile ${strength.centile} des clubs du championnat`
                  : member
                    ? "Pas assez de matchs avec xG pour le situer"
                    : pending
                      ? undefined
                      : "Sans Elo pour le situer"
              }
            >
              <span className={c.difficultyCell}>
                {measured ? (
                  <span
                    className={c.difficulty}
                    aria-label={`Difficulté ${level} sur 5`}
                  >
                    {[1, 2, 3, 4, 5].map((i) => (
                      <i key={i} data-on={i <= level} />
                    ))}
                  </span>
                ) : (
                  <small className={c.muted}>
                    {member
                      ? "données insuffisantes"
                      : pending
                        ? "…"
                        : "sans Elo"}
                  </small>
                )}
                <UpcomingChances match={match} home={home} />
              </span>
            </span>
            <span className={c.matchComp}>{match.league}</span>
          </MatchRowLink>
        );
      })}
    </div>
  );
}

/** The club's chances in a match to come, from its side: win, draw, loss. Nothing without a forecast. */
function UpcomingChances({ match, home, narrow = false }) {
  const forecast = matchForecast(useMatchForecast(match.id)?.forecast);
  if (!forecast) return null;
  const parts = [
    ["V", "Victoire", home ? forecast.home : forecast.away],
    ["N", "Nul", forecast.draw],
    ["D", "Défaite", home ? forecast.away : forecast.home],
  ];
  const label = parts
    .map(([, word, value]) => `${word} ${share(value)}`)
    .join(", ");
  return (
    <span
      className={`${c.chances}${narrow ? ` ${c.chancesNarrow}` : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className={c.chancesBar}>
        {parts.map(([key, , value]) => (
          <i
            key={key}
            data-result={key}
            style={{ flexGrow: Math.max(value, 0.02) }}
          />
        ))}
      </span>
      <span className={c.chancesShares}>
        {parts.map(([key, , value]) => (
          <b key={key} data-result={key}>
            {share(value)}
          </b>
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------- statistics */

export function Statistics({ dossier }) {
  const families = Object.keys(FAMILIES);
  const [family, setFamily] = useState("all");
  const shown = family === "all" ? families : [family];
  return (
    <div className={c.stack}>
      <div className={s.toolbar}>
        <Segments
          label="Famille d’indicateurs"
          value={family}
          onChange={setFamily}
          items={[
            ["all", "Tout"],
            ...families.map((key) => [key, FAMILIES[key]]),
          ]}
        />
      </div>
      <div className={c.stack}>
        {shown.map((key) => (
          <Card key={key} title={FAMILIES[key]}>
            <MetricTable
              dossier={dossier}
              keys={Object.keys(METRICS).filter(
                (m) => METRICS[m].family === key,
              )}
              caption={FAMILIES[key]}
            />
          </Card>
        ))}
      </div>
      <p className={c.note}>
        ↓ : indicateur concédé, centile inversé. Barres grises : indicateur de
        style, sans meilleur côté.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ style */

export function Style({ dossier }) {
  const tags = styleTags(dossier.self);
  return (
    <div className={c.stack}>
      <div className={`${c.columns} ${c.fillRow}`}>
        <div className={c.stack}>
          <Card
            title="Identité de jeu"
            text="Position du club sur chaque axe de style, parmi les clubs du référentiel."
          >
            {tags.length > 0 && (
              <div className={c.tags} style={{ marginBottom: 18 }}>
                {tags.map((tag) => (
                  <span key={tag} className={c.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <StyleSpectrum dossier={dossier} />
          </Card>
          <Card
            title="Systèmes utilisés"
            text="Système de départ annoncé, toutes compétitions."
          >
            {dossier.formations.length ? (
              <div className={c.tableScroll}>
                <table className={c.table}>
                  <thead>
                    <tr>
                      <th scope="col">
                        <Term>Système</Term>
                      </th>
                      <th scope="col">
                        <Term>MJ</Term>
                      </th>
                      <th scope="col">
                        <Term>V-N-D</Term>
                      </th>
                      <th scope="col">
                        <Term>Buts</Term>
                      </th>
                      <th scope="col">
                        <Term>Pts / match</Term>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.formations.map((f) => (
                      <tr key={f.formation}>
                        <th scope="row">{f.formation}</th>
                        <td>{f.matches}</td>
                        <td>
                          {f.wins}-{f.draws}-{f.losses}
                        </td>
                        <td>
                          {f.goalsFor}–{f.goalsAgainst}
                        </td>
                        <td>{fmtNum((3 * f.wins + f.draws) / f.matches, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={c.muted}>Système non renseigné.</p>
            )}
          </Card>
        </div>
        <div className={c.stack}>
          <Card
            className={c.grow}
            title="Carte des styles"
            text="Possession et intensité du pressing de chaque club du référentiel."
          >
            <LeaguePlot
              dossier={dossier}
              x="possession"
              y="ppda"
              invertY
              fill
              yLabel="Passes adverses par action défensive (bas = pressing intense)"
              quadrants={[
                ["Presse sans le ballon", "top-left"],
                ["Domine et presse", "top-right"],
                ["Bloc bas", "bottom-left"],
                ["Possession patiente", "bottom-right"],
              ]}
            />
          </Card>
          <Card
            title="Comment le club se procure ses occasions"
            text="Toutes compétitions, à partir de la carte des tirs."
          >
            <SituationTable profile={dossier.shotsAll} />
          </Card>
        </div>
      </div>
      <ClubPassingTriangle id={dossier.id} season={dossier.season} />
    </div>
  );
}

/* ----------------------------------------------------------- matches */

export function Matches({ dossier }) {
  const comps = useMemo(() => {
    const seen = new Map();
    for (const row of dossier.allRows)
      seen.set(row.match.leagueId, row.match.league);
    return [...seen];
  }, [dossier]);
  const [scope, setScope] = useState("all");
  const previous = usePreviousSeasonRows(dossier.id, dossier.season);
  const rows =
    scope === "all"
      ? dossier.allRows
      : dossier.allRows.filter((row) => row.match.leagueId === scope);
  return (
    <div className={c.stack}>
      <Card title="Dynamique des xG" text="Toutes compétitions.">
        <XgTrend rows={dossier.allRows} previous={previous} />
      </Card>
      <div className={c.grid2}>
        <Card
          className={c.fillCard}
          title="Buts par période"
          text="Toutes compétitions, buts datés dans la carte des tirs."
        >
          <GoalPeriods times={dossier.summary.goalTimes} />
        </Card>
        <Card
          title="États de match"
          text="Ce que le club fait du score : temps passé à mener, réactions, avances perdues."
        >
          <GameState states={dossier.states} />
        </Card>
      </div>
      <ClubSubstitutions id={dossier.id} season={dossier.season} />
      <Card title="Cartes des tirs" text="Toutes compétitions.">
        <ShotPair profile={dossier.shotsAll} />
      </Card>
      <Card
        title="Tous les matchs"
        action={
          comps.length > 1 && (
            <Segments
              label="Compétition"
              value={scope}
              onChange={setScope}
              items={[["all", "Toutes"], ...comps]}
            />
          )
        }
      >
        <MatchRows rows={rows} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- squad */

const AGE_BANDS = [
  ["< 21", 21],
  ["21–23", 24],
  ["24–26", 27],
  ["27–29", 30],
  ["30–32", 33],
  ["33 +", Infinity],
];

function useAgeProfile(id, season) {
  return useResource(
    `team-age-profile:${id}:${season}`,
    ({ signal }) =>
      json(
        `/api/teams/${encodeURIComponent(id)}/age-profile?${new URLSearchParams({ season })}`,
        { signal },
      ).then((body) => body.data),
    Boolean(id && season),
  );
}

function SquadAgeProfile({ id, season }) {
  const { value, loading, error } = useAgeProfile(id, season);
  const bands = AGE_BANDS.map(() => 0);
  let total = 0;
  for (const { age, minutes } of value?.minutesByAge || []) {
    total += minutes;
    if (age != null && age >= 0)
      bands[AGE_BANDS.findIndex(([, limit]) => age < limit)] += minutes;
  }
  const covered = bands.reduce((sum, minutes) => sum + minutes, 0);

  return (
    <Card
      title="Profil d’âge de l’effectif"
      text="Répartition des minutes renseignées, selon l’âge au jour du match."
    >
      {loading ? (
        <Skeleton label="Chargement…" lines={2} />
      ) : error || !covered ? (
        <p className={c.note}>Profil d’âge indisponible pour cette saison.</p>
      ) : (
        <>
          <div className={s.ages}>
            {AGE_BANDS.map(([label], index) => {
              const share = (100 * bands[index]) / covered;
              return (
                <div key={label}>
                  <span style={{ height: `${share * 1.6}px` }} />
                  <b>{fmtNum(share, 1)} %</b>
                  <small>{label}</small>
                </div>
              );
            })}
          </div>
          <p className={c.note}>
            Âge connu pour {fmtNum(covered)} / {fmtNum(total)} minutes
            documentées ({fmtNum((100 * covered) / total, 1)} %).
          </p>
        </>
      )}
    </Card>
  );
}

export function Squad({ dossier }) {
  const squad = dossier.squad;
  const top = [...squad.profiles]
    .map((p) => ({
      ...p,
      ga: (p.stats.goals?.sum || 0) + (p.stats.assists?.sum || 0),
    }))
    .filter((p) => p.ga > 0)
    .sort((a, b) => b.ga - a.ga)
    .slice(0, 8);
  const maxGa = Math.max(1, ...top.map((p) => p.ga));
  return (
    <div className={c.stack}>
      <Kpis
        items={[
          ["Joueurs utilisés", fmtNum(squad.used), "toutes compétitions"],
          [
            "Minutes des 11 plus utilisés",
            `${fmtNum(squad.topElevenMinuteShare)} %`,
            "concentration du temps de jeu",
          ],
          [
            "Titulaires reconduits",
            squad.continuity == null
              ? "—"
              : `${fmtNum(squad.continuity, 1)} / 11`,
            "d’un match au suivant",
          ],
          [
            "Compositions connues",
            `${squad.lineupMatches} / ${dossier.allRecord.matches}`,
            "onze de départ complet",
          ],
        ]}
      />
      <div className={c.grid2}>
        <Card
          title="Contributions directes"
          text="Buts et passes décisives, toutes compétitions."
        >
          <div className={s.contrib}>
            {top.map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <span className={s.contribBar}>
                  <i
                    style={{
                      width: `${(100 * (p.stats.goals?.sum || 0)) / maxGa}%`,
                    }}
                  />
                  <i
                    style={{
                      width: `${(100 * (p.stats.assists?.sum || 0)) / maxGa}%`,
                    }}
                  />
                </span>
                <b>
                  {p.stats.goals?.sum || 0} + {p.stats.assists?.sum || 0}
                </b>
              </div>
            ))}
          </div>
          <div className={c.trendLegend} style={{ marginTop: 10 }}>
            <span>
              <i style={{ background: "var(--accent)" }} /> Buts
            </span>
            <span>
              <i style={{ background: "var(--mq-series-3)" }} /> Passes
              décisives
            </span>
          </div>
        </Card>
        <SquadAgeProfile id={dossier.id} season={dossier.season} />
      </div>
      <Card
        title="Temps de jeu et contributions"
        text="Toutes compétitions · part du temps : minutes / minutes possibles du club."
      >
        <SquadTable dossier={dossier} />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------- comparison */

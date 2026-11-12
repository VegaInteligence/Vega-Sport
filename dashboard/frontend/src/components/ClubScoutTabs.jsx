"use client";
/* Club profile tabs: identity rail and the overview, statistics, style,
 * matches and squad tabs (the player profile adapted to a club). */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Segments } from "./UI.jsx";
import { BookmarkButton } from "./ResearchUI.jsx";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import { FakeBadge } from "./PlayerScoutDemo.jsx";
import ClubInformation from "./ClubInformation.jsx";
import { PercentilePizza } from "./PlayerScoutCharts.jsx";
import {
  FAMILIES,
  METRICS,
  PERFORMANCE_KEYS,
  PHASES,
  formatMetric,
  opponentStrength,
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
  MatchRows,
  MetricTable,
  PhaseBars,
  PointsTrend,
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

export function IdentityRail({ dossier, onTab }) {
  const self = dossier.self,
    r = self.record;
  const gap = r.points - (self.xptsTotal ?? 0);
  // On a phone the header opens on the identity and the standing.
  const more = usePhoneFold();
  return (
    <aside className={s.rail} aria-label="Identité du club" {...more.fold}>
      <div className={s.identity}>
        <Crest club={dossier} className={`crest ${s.bigCrest}`} />
        <h2 className={s.name}>{dossier.name}</h2>
        <p className={s.sub}>
          {[dossier.league?.name, dossier.season].filter(Boolean).join(" · ")}
        </p>
        <div className={s.chips}>
          {dossier.coach && (
            <span className={s.chip}>Entraîneur · {dossier.coach}</span>
          )}
          {dossier.stadium && <span className={s.chip}>{dossier.stadium}</span>}
        </div>
      </div>
      <div className={s.railSection}>
        <div className={s.railTitle}>
          Classement <span>{dossier.league?.name}</span>
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
            <dt>Bilan</dt>
            <dd>
              {r.w}-{r.d}-{r.l}
            </dd>
          </div>
          <div>
            <dt>Buts</dt>
            <dd>
              {r.gf}–{r.ga}
            </dd>
          </div>
          <div>
            <dt>xPts</dt>
            <dd>{fmtNum(self.xptsTotal, 1)}</dd>
            <small className={gap >= 0 ? c.up : c.down}>
              {fmtNum(gap, 1, true)} pts vs attendu
            </small>
          </div>
          <div>
            <dt>Forme</dt>
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
          Indice Vega club <span>sur 100</span>
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
        <div className={s.railTitle}>Toutes compétitions</div>
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
      <div className={`${s.railSection} phone-fold-part`}>
        <div className={s.railTitle}>
          Effectif <FakeBadge />
        </div>
        <dl className={c.facts}>
          <div>
            <dt>Valeur estimée</dt>
            <dd>1,21 Md€</dd>
            <small>3e d’Europe</small>
          </div>
          <div>
            <dt>Âge pondéré</dt>
            <dd>25,4 ans</dd>
            <small>par minutes jouées</small>
          </div>
        </dl>
      </div>
      <div className={s.railSection}>
        <div className="research-toolbar">
          <BookmarkButton
            kind="clubs"
            id={dossier.id}
            name={dossier.name}
            imageUrl={dossier.imageUrl}
            season={dossier.season}
          />
        </div>
      </div>
    </aside>
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
function ExpectedCard({ dossier }) {
  const self = dossier.self,
    v = self.values;
  const gfDiff = self.record.gf - (v.xg ?? 0) * self.record.matches;
  const gaDiff = self.record.ga - (v.xga ?? 0) * self.record.matches;
  return (
      <Card
        fold
        title="Résultats et attendus"
        text={`Les écarts entre le réel et l’attendu signalent la finition, le gardien ou la réussite : ils tendent à se résorber. À droite, le classement de ${dossier.league?.name || "son championnat"} si chaque match s’était joué selon ses xG.`}
      >
        <div className={s.expectedGrid}>
          <div className={c.stack}>
            <dl className={c.facts}>
              <div>
                <dt>Points · xPts</dt>
                <dd>
                  {self.record.points} · {fmtNum(self.xptsTotal, 1)}
                </dd>
                <small
                  className={
                    self.record.points >= self.xptsTotal ? c.up : c.down
                  }
                >
                  {fmtNum(self.record.points - self.xptsTotal, 1, true)} pts
                </small>
              </div>
              <div>
                <dt>Buts · xG</dt>
                <dd>
                  {self.record.gf} ·{" "}
                  {fmtNum((v.xg ?? 0) * self.record.matches, 1)}
                </dd>
                <small className={gfDiff >= 0 ? c.up : c.down}>
                  {fmtNum(gfDiff, 1, true)} buts
                </small>
              </div>
              <div>
                <dt>Encaissés · xG contre</dt>
                <dd>
                  {self.record.ga} ·{" "}
                  {fmtNum((v.xga ?? 0) * self.record.matches, 1)}
                </dd>
                <small className={gaDiff <= 0 ? c.up : c.down}>
                  {fmtNum(gaDiff, 1, true)} buts
                </small>
              </div>
              <div>
                <dt>Buts évités par le gardien</dt>
                <dd>
                  {fmtNum((v.keeper ?? 0) * self.record.matches, 1, true)}
                </dd>
                <small>xGOT concédés − buts encaissés</small>
              </div>
            </dl>
            <PointsTrend rows={self.rows} height={250} grow={1.3} />
          </div>
          <LeagueTable dossier={dossier} sort="xpts" compact window={10} fill />
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
          [
            "xG pour",
            fmtNum(v.xg, 2),
            `${ordinal(self.ranks.xg)} / ${total}`,
          ],
          [
            "xG contre",
            fmtNum(v.xga, 2),
            `${ordinal(self.ranks.xga)} / ${total}`,
          ],
          [
            "Diff. xG / match",
            fmtNum((v.xg ?? 0) - (v.xga ?? 0), 2, true),
            "pour moins contre",
            (v.xg ?? 0) >= (v.xga ?? 0) ? "up" : "down",
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
          <PercentilePizza items={pizza} cohort={total} size={520} />
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
      <div className={c.grid2}>
        <Card
          title="Derniers matchs"
          text="Toutes compétitions · barres : xG pour (bleu) et contre (orange)"
        >
          <MatchRows rows={dossier.allRows} limit={6} />
        </Card>
        <Card
          title="Prochains matchs"
          text="Difficulté : centile de la différence de xG de l’adversaire en championnat"
        >
          <Upcoming dossier={base} />
        </Card>
      </div>
      <ClubInformation dossier={base} />
    </div>
  );
}

export function Upcoming({ dossier, limit = 6 }) {
  if (!dossier.upcoming.length)
    return <p className={c.muted}>Aucun match à venir collecté.</p>;
  return (
    <div className={c.matchList}>
      {dossier.upcoming.slice(0, limit).map((match) => {
        const home = match.home.id === dossier.id;
        const opponent = home ? match.away : match.home;
        const strength = opponentStrength(dossier, opponent.id);
        const level = strength
          ? Math.max(1, Math.ceil(strength.centile / 20))
          : 0;
        return (
          <div className={c.matchRow} key={match.id}>
            <span className={c.matchDate}>{dateShort(match.date)}</span>
            <span className={c.muted} style={{ fontSize: 11 }}>
              {home ? "dom." : "ext."}
            </span>
            <span className={c.matchOpp}>
              <Crest club={opponent} />
              <span>
                {opponent.name}
                {strength && (
                  <small> · {ordinal(strength.club.position)}</small>
                )}
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
                strength
                  ? `Adversaire au centile ${strength.centile} de la différence de xG`
                  : "Hors championnat de référence"
              }
            >
              {strength ? (
                <span
                  className={c.difficulty}
                  aria-label={`Difficulté ${level} sur 5`}
                >
                  {[1, 2, 3, 4, 5].map((i) => (
                    <i key={i} data-on={i <= level} />
                  ))}
                </span>
              ) : (
                <small className={c.muted}>hors référentiel</small>
              )}
            </span>
            <span className={c.matchComp}>{match.league}</span>
          </div>
        );
      })}
    </div>
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
        style, sans meilleur côté. PPDA approché à partir des passes adverses
        dans leur moitié de terrain.
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
            text="Position du club sur chaque axe de style, parmi les clubs du référentiel (traits gris)."
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
                      <th scope="col">Système</th>
                      <th scope="col">MJ</th>
                      <th scope="col">V-N-D</th>
                      <th scope="col">Buts</th>
                      <th scope="col">Pts / match</th>
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
              yLabel="Pressing (PPDA, bas = intense)"
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
  const rows =
    scope === "all"
      ? dossier.allRows
      : dossier.allRows.filter((row) => row.match.leagueId === scope);
  return (
    <div className={c.stack}>
      <Card
        title="Dynamique des xG"
        text="Moyenne glissante sur cinq matchs, toutes compétitions."
      >
        <XgTrend rows={dossier.allRows} />
      </Card>
      <div className={c.grid2}>
        <Card
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
      <Card
        title="Cartes des tirs"
        text="Toutes compétitions, tirs à moins de 40 m du but · taille selon les xG, plein = but."
      >
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
        <Card
          title="Profil d’âge de l’effectif"
          text="Part des minutes par tranche d’âge : avant le pic (< 24 ans), au pic (24–29), après (30 et +)."
          action={<FakeBadge />}
        >
          <div className={s.ages}>
            {[
              ["< 21", 9],
              ["21–23", 24],
              ["24–26", 31],
              ["27–29", 21],
              ["30–32", 12],
              ["33 +", 3],
            ].map(([label, value]) => (
              <div key={label}>
                <span style={{ height: `${value * 4.4}px` }} />
                <b>{value} %</b>
                <small>{label}</small>
              </div>
            ))}
          </div>
          <p className={c.note}>
            Les dates de naissance ne sont pas encore jointes aux apparitions :
            exemple à remplacer.
          </p>
        </Card>
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

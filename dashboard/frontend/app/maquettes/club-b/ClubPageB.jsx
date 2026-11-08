"use client";
/* Version B · Tableau tactique : one scrolling dashboard organised by phase
 * of play. Every block reads the club against its opponents (pour / contre)
 * and against the whole league. */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Segments } from "../../../src/components/UI.jsx";
import { FakeBadge } from "../../../src/components/PlayerScoutDemo.jsx";
import { Gauge, PercentileBar } from "../_shared/charts.jsx";
import {
  METRICS,
  PHASES,
  formatMetric,
  similarClubs,
  useClubDossier,
} from "../_shared/club-data.js";
import {
  Card,
  ClubLoading,
  ClubShell,
  Crest,
  FormStrip,
  GameState,
  GoalPeriods,
  Info,
  Kpis,
  LeaguePlot,
  LeagueTable,
  MatchRows,
  MetricTable,
  MirrorBars,
  PointsTrend,
  ShotPair,
  SituationTable,
  SquadTable,
  StyleSpectrum,
  XgTrend,
  clubStyles as c,
  fmtNum,
  ordinal,
  styleTags,
  useClubId,
} from "../_shared/club-ui.jsx";
import { Upcoming } from "../club-a/ClubPageA.jsx";
import s from "./page-b.module.css";

const SECTIONS = [
  ["synthese", "Synthèse"],
  ["ballon", "Avec le ballon"],
  ["sans-ballon", "Sans le ballon"],
  ["cpa", "Transitions et CPA"],
  ["finition", "Finition et gardien"],
  ["tendance", "Tendance et états de match"],
  ["classement", "Classement réel et attendu"],
  ["effectif", "Effectif"],
  ["calendrier", "Calendrier"],
  ["comparer", "Comparer"],
];

export default function ClubPageB() {
  const id = useClubId();
  const state = useClubDossier(id);
  const dossier = state.status === "ready" ? state.dossier : null;
  return (
    <ClubShell version="B" title="Tableau tactique" dossier={dossier}>
      {dossier ? (
        <Board key={dossier.id} dossier={dossier} />
      ) : (
        <ClubLoading state={state} />
      )}
    </ClubShell>
  );
}

function useActiveSection() {
  const [active, setActive] = useState(SECTIONS[0][0]);
  useEffect(() => {
    // The current section is the last one whose title has passed under the header.
    const update = () => {
      let current = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 180) current = id;
      }
      const last = document.getElementById(SECTIONS[SECTIONS.length - 1][0]);
      if (last && last.getBoundingClientRect().bottom <= window.innerHeight + 4)
        current = SECTIONS[SECTIONS.length - 1][0];
      setActive(current);
    };
    update();
    // The site scrolls an inner container: listen to every scroll, captured.
    const options = { passive: true, capture: true };
    document.addEventListener("scroll", update, options);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, options);
      window.removeEventListener("resize", update);
    };
  }, []);
  return active;
}

function Board({ dossier }) {
  const active = useActiveSection();
  return (
    <>
      <Header dossier={dossier} />
      <div className={s.layout}>
        <nav className={s.nav} aria-label="Sections du tableau">
          {SECTIONS.map(([id, label], i) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "true" : undefined}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {label}
            </a>
          ))}
          <p className={s.navNote}>
            Référentiel : {dossier.league?.name}, {dossier.clubs.length} clubs.
            Valeurs par match en championnat sauf mention.
          </p>
        </nav>
        <div className={s.content}>
          <Synthesis dossier={dossier} />
          <WithBall dossier={dossier} />
          <WithoutBall dossier={dossier} />
          <SetPieces dossier={dossier} />
          <Finishing dossier={dossier} />
          <Trend dossier={dossier} />
          <Standings dossier={dossier} />
          <Squad dossier={dossier} />
          <Calendar dossier={dossier} />
          <Compare dossier={dossier} />
        </div>
      </div>
    </>
  );
}

function Section({ id, index, title, text, bare, children }) {
  // Bare: the same blocks without the numbered header, for version C's tab.
  if (bare) return <div className={s.bare}>{children}</div>;
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-title`}>
      <header className={s.sectionHead}>
        <span>{String(index).padStart(2, "0")}</span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {text && <p>{text}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------ header */

function Header({ dossier }) {
  const self = dossier.self,
    r = self.record;
  const gap = r.points - self.xptsTotal;
  return (
    <div className={s.header}>
      <div className={s.identity}>
        <Crest club={dossier} className={`crest ${s.crest}`} />
        <div>
          <h1>{dossier.name}</h1>
          <p>
            {[
              dossier.league?.name,
              dossier.season,
              dossier.coach && `Entraîneur ${dossier.coach}`,
              dossier.stadium,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className={c.tags} style={{ marginTop: 8 }}>
            {styleTags(self)
              .slice(0, 4)
              .map((tag) => (
                <span className={c.tag} key={tag}>
                  {tag}
                </span>
              ))}
          </div>
        </div>
      </div>
      <dl className={s.headerStats}>
        <div>
          <dt>Classement</dt>
          <dd>{ordinal(self.position)}</dd>
          <small>
            {r.points} pts · {r.matches} m
          </small>
        </div>
        <div>
          <dt>xPts</dt>
          <dd>{fmtNum(self.xptsTotal, 1)}</dd>
          <small className={gap >= 0 ? c.up : c.down}>
            {fmtNum(gap, 1, true)} vs réel
          </small>
        </div>
        <div>
          <dt>Diff. xG / m</dt>
          <dd>
            {fmtNum((self.values.xg ?? 0) - (self.values.xga ?? 0), 2, true)}
          </dd>
          <small>
            {ordinal(self.ranks.xg)} attaque · {ordinal(self.ranks.xga)} défense
          </small>
        </div>
        <div>
          <dt>Indice Vega</dt>
          <dd>{self.vegaIndex ?? "—"}</dd>
          <small>{ordinal(self.vegaRank)} du championnat</small>
        </div>
        <div>
          <dt>Forme</dt>
          <dd>
            <FormStrip rows={dossier.allRows} />
          </dd>
          <small>toutes compétitions</small>
        </div>
      </dl>
    </div>
  );
}

/* --------------------------------------------------------- synthesis */

export function Synthesis({ dossier, bare = false }) {
  const self = dossier.self,
    total = dossier.clubs.length;
  return (
    <Section
      bare={bare}
      id="synthese"
      index={1}
      title="Synthèse"
      text="Qui crée, qui concède : la place du club dans son championnat, puis son niveau phase par phase."
    >
      <div className={s.synthesis}>
        <Card
          title="Carte du championnat"
          text="xG créés et concédés par match. En haut à droite : les équipes qui dominent leurs matchs."
        >
          <LeaguePlot
            dossier={dossier}
            x="xg"
            y="xga"
            invertY
            xLabel="xG créés / match"
            yLabel="xG concédés / match (inversé)"
            quadrants={[
              ["Solide mais stérile", "top-left"],
              ["Domine ses matchs", "top-right"],
              ["Subit ses matchs", "bottom-left"],
              ["Spectaculaire", "bottom-right"],
            ]}
          />
        </Card>
        <div className={s.phaseGrid}>
          <div className={`${c.card} ${s.gaugeCard}`}>
            <Gauge value={self.vegaIndex ?? 0} label="Indice Vega" size={150} />
            <div>
              <strong>
                {ordinal(self.vegaRank)} sur {total}
              </strong>
              <p className={c.note}>
                Moyenne pondérée des phases : attaque 30 %, défense 30 %,
                contrôle 15 %, finition 10 %, pressing 10 %, CPA 5 %.
              </p>
            </div>
          </div>
          {PHASES.map((phase) => {
            const value = self.phases[phase.key];
            const rank =
              value == null
                ? null
                : 1 +
                  dossier.clubs.filter(
                    (club) => (club.phases[phase.key] ?? -1) > value,
                  ).length;
            return (
              <div key={phase.key} className={`${c.card} ${s.phaseTile}`}>
                <span>{phase.label}</span>
                <strong>{value ?? "—"}</strong>
                {value != null && <PercentileBar value={value} />}
                <small
                  title={phase.keys
                    .map((key) => METRICS[key].label)
                    .join(" · ")}
                >
                  {rank ? `${ordinal(rank)} sur ${total}` : "non classé"}
                </small>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------- with ball */

export function WithBall({ dossier, bare = false }) {
  return (
    <Section
      bare={bare}
      id="ballon"
      index={2}
      title="Avec le ballon"
      text="Ce que le club produit (gauche) face à ce que ses adversaires produisent contre lui (droite)."
    >
      <Card title="Production offensive, pour et contre">
        <MirrorBars
          dossier={dossier}
          rows={[
            { label: "Buts", own: "goalsFor", opp: "goalsAgainst", digits: 2 },
            { label: "xG", own: "xg", opp: "xga", digits: 2 },
            {
              label: "xG en jeu ouvert",
              own: "xgOpen",
              opp: "xgOpenAgainst",
              digits: 2,
            },
            {
              label: "Grosses occasions",
              own: "bigChances",
              opp: "bigChancesAgainst",
            },
            { label: "Tirs", own: "shots", opp: "shotsAgainst" },
            {
              label: "Tirs cadrés",
              own: "shotsOnTarget",
              opp: "shotsOnTargetAgainst",
            },
            {
              label: "Ballons dans la surface",
              own: "touchesBox",
              opp: "touchesBoxAgainst",
            },
            { label: "Passes", own: "passes", opp: "passesAgainst", digits: 0 },
          ]}
        />
      </Card>
      <div className={c.grid2}>
        <Card
          title="Manière d’avoir le ballon"
          text="Axes de style : aucune position n’est bonne ou mauvaise en soi."
        >
          <StyleSpectrum
            dossier={dossier}
            axes={[
              {
                key: "possession",
                low: "Laisse le ballon",
                high: "Monopolise le ballon",
              },
              {
                key: "fieldTilt",
                low: "Joue dans son camp",
                high: "Installé chez l’adversaire",
              },
              {
                key: "directness",
                low: "Jeu court",
                high: "Jeu long et direct",
              },
              {
                key: "crosses",
                low: "Peu de centres",
                high: "Beaucoup de centres",
              },
            ]}
          />
        </Card>
        <Card title="Qualité de la possession">
          <MetricTable
            dossier={dossier}
            keys={[
              "passAccuracy",
              "fieldTilt",
              "boxShare",
              "xgPerShot",
              "boxShots",
              "touchesBox",
            ]}
          />
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- without ball */

export function WithoutBall({ dossier, bare = false }) {
  return (
    <Section
      bare={bare}
      id="sans-ballon"
      index={3}
      title="Sans le ballon"
      text="Hauteur et intensité du pressing, duels, et ce que le bloc laisse passer."
    >
      <div className={c.grid2}>
        <Card
          title="Carte des styles défensifs"
          text="Possession et PPDA de chaque club : en haut, les équipes qui pressent le plus."
        >
          <LeaguePlot
            dossier={dossier}
            x="possession"
            y="ppda"
            invertY
            ratio="6 / 7"
            yLabel="PPDA (bas = pressing intense)"
            quadrants={[
              ["Presse sans le ballon", "top-left"],
              ["Domine et presse", "top-right"],
              ["Bloc bas", "bottom-left"],
              ["Possession patiente", "bottom-right"],
            ]}
          />
        </Card>
        <Card title="Indicateurs sans ballon">
          <MetricTable
            dossier={dossier}
            keys={[
              "ppda",
              "defActions",
              "duels",
              "aerials",
              "fouls",
              "xga",
              "shotsAgainst",
              "bigChancesAgainst",
              "touchesBoxAgainst",
              "cleanSheets",
            ]}
          />
        </Card>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- set pieces */

const setXg = (side) =>
  ["corner", "setPiece", "freeKick"].reduce((t, k) => t + side[k].xg, 0);

export function SetPieces({ dossier, bare = false }) {
  const p = dossier.shotsAll;
  const fast = p.for.fastBreak,
    fastAgainst = p.against.fastBreak;
  const setFor = ["corner", "setPiece", "freeKick"].reduce(
    (t, k) => t + p.for[k].goals,
    0,
  );
  const setAgainst = ["corner", "setPiece", "freeKick"].reduce(
    (t, k) => t + p.against[k].goals,
    0,
  );
  return (
    <Section
      bare={bare}
      id="cpa"
      index={4}
      title="Transitions et coups de pied arrêtés"
      text="Les phases courtes qui décident beaucoup de matchs serrés. Toutes compétitions pour les situations de tir."
    >
      <Kpis
        items={[
          [
            "Contre-attaques : tirs",
            `${fast.shots} – ${fastAgainst.shots}`,
            "pour – contre",
          ],
          [
            "Contre-attaques : buts",
            `${fast.goals} – ${fastAgainst.goals}`,
            `${fmtNum(fast.xg, 1)} – ${fmtNum(fastAgainst.xg, 1)} xG`,
          ],
          [
            "Buts sur CPA (hors penalty)",
            `${setFor} – ${setAgainst}`,
            "corners, coups francs, touches",
          ],
          [
            "Penalties",
            `${p.for.penalty.goals}/${p.for.penalty.shots} – ${p.against.penalty.goals}/${p.against.penalty.shots}`,
            "marqués/tirés, pour – contre",
          ],
        ]}
      />
      <div className={c.grid2}>
        <Card
          title="Situations de tir"
          text="D’où viennent les tirs et les buts, des deux côtés."
        >
          <SituationTable profile={p} />
          <p className={c.note}>
            {fmtNum(dossier.self.values.setShare, 0)} % des xG du club viennent
            des coups de pied arrêtés en championnat (médiane{" "}
            {fmtNum(dossier.stats.setShare?.median, 0)} %). Contre-attaques et
            CPA réunis : {fmtNum(fast.xg + setXg(p.for), 1)} xG créés,{" "}
            {fmtNum(fastAgainst.xg + setXg(p.against), 1)} concédés.
          </p>
        </Card>
        <Card
          title="Coups de pied arrêtés, pour et contre"
          text="En championnat, par match."
        >
          <MirrorBars
            dossier={dossier}
            rows={[
              {
                label: "xG sur CPA",
                own: "xgSet",
                opp: "xgSetAgainst",
                digits: 2,
              },
              { label: "Corners", own: "corners", opp: "cornersAgainst" },
            ]}
          />
          <div style={{ marginTop: 16 }}>
            <MetricTable
              dossier={dossier}
              keys={["setShare", "xgSet", "xgSetAgainst"]}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------- finishing */

export function Finishing({ dossier, bare = false }) {
  const self = dossier.self,
    n = self.record.matches;
  return (
    <Section
      bare={bare}
      id="finition"
      index={5}
      title="Finition et gardien"
      text="Les écarts aux attendus : ce que les attaquants et le gardien ajoutent, ou coûtent."
    >
      <Kpis
        items={[
          [
            "Buts − xG",
            fmtNum((self.values.finishing ?? 0) * n, 1, true),
            `${ordinal(self.ranks.finishing)} du championnat`,
            (self.values.finishing ?? 0) >= 0 ? "up" : "down",
          ],
          [
            "Qualité de frappe",
            fmtNum((self.values.placement ?? 0) * n, 1, true),
            "xGOT − xG sur la saison",
            (self.values.placement ?? 0) >= 0 ? "up" : "down",
          ],
          [
            "Buts évités (gardien)",
            fmtNum((self.values.keeper ?? 0) * n, 1, true),
            `${ordinal(self.ranks.keeper)} du championnat`,
            (self.values.keeper ?? 0) >= 0 ? "up" : "down",
          ],
          [
            "Conversion",
            `${fmtNum(self.values.conversion, 1)} %`,
            "buts / tirs",
          ],
        ]}
      />
      <div className={c.stack}>
        <Card
          title="Efficacité des deux surfaces"
          text="À droite : attaque qui marque plus que ses xG. En haut : gardien qui encaisse moins que l’attendu."
        >
          <LeaguePlot
            dossier={dossier}
            x="finishing"
            y="keeper"
            xLabel="Buts − xG / match"
            yLabel="Buts évités / match"
            ratio="21 / 8"
            quadrants={[
              ["Gardien décisif", "top-left"],
              ["Efficace partout", "top-right"],
              ["En sous-régime", "bottom-left"],
              ["Attaque efficace", "bottom-right"],
            ]}
          />
        </Card>
        <Card
          title="Cartes des tirs"
          text="Toutes compétitions, tirs à moins de 40 m · taille selon les xG, plein = but."
        >
          <ShotPair profile={dossier.shotsAll} />
        </Card>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- trend */

function Trend({ dossier }) {
  return (
    <Section
      id="tendance"
      index={6}
      title="Tendance et états de match"
      text="La dynamique sur la saison et ce que le club fait du score."
    >
      <div className={c.grid2}>
        <Card
          title="xG pour et contre"
          text="Moyenne glissante sur cinq matchs, toutes compétitions."
        >
          <XgTrend rows={dossier.allRows} />
        </Card>
        <Card title="Points et points attendus" text="Cumul en championnat.">
          <PointsTrend rows={dossier.self.rows} />
        </Card>
      </div>
      <div className={c.grid2}>
        <Card title="Buts par période" text="Toutes compétitions.">
          <GoalPeriods times={dossier.summary.goalTimes} />
        </Card>
        <Card title="États de match" text="Toutes compétitions.">
          <GameState states={dossier.states} />
        </Card>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------- standings */

export function Standings({ dossier, bare = false }) {
  const [sort, setSort] = useState("points");
  return (
    <Section
      bare={bare}
      id="classement"
      index={7}
      title="Classement réel et attendu"
      text="Les points attendus (xPts) rejouent chaque match selon ses xG : l’écart signale la réussite ou la malchance."
    >
      <Card
        title={
          sort === "xpts" ? "Classement aux points attendus" : "Classement"
        }
        action={
          <Segments
            label="Ordre du classement"
            value={sort}
            onChange={setSort}
            items={[
              ["points", "Points"],
              ["xpts", "Points attendus"],
            ]}
          />
        }
      >
        <LeagueTable dossier={dossier} sort={sort} />
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------- squad */

function Squad({ dossier }) {
  const squad = dossier.squad;
  return (
    <Section
      id="effectif"
      index={8}
      title="Effectif"
      text="Qui joue, combien, et qui produit. Toutes compétitions."
    >
      <Kpis
        items={[
          ["Joueurs utilisés", fmtNum(squad.used)],
          [
            "Minutes des 11 plus utilisés",
            `${fmtNum(squad.topElevenMinuteShare)} %`,
          ],
          [
            "Titulaires reconduits",
            squad.continuity == null
              ? "—"
              : `${fmtNum(squad.continuity, 1)} / 11`,
            "d’un match au suivant",
          ],
          ["Valeur de l’effectif", "1,21 Md€", <FakeBadge key="fake" />],
          ["Âge pondéré", "25,4 ans", <FakeBadge key="fake2" />],
        ]}
      />
      <Card>
        <SquadTable dossier={dossier} limit={18} />
      </Card>
    </Section>
  );
}

/* ----------------------------------------------------------- calendar */

function Calendar({ dossier }) {
  return (
    <Section
      id="calendrier"
      index={9}
      title="Calendrier"
      text="Difficulté des prochains adversaires : centile de leur différence de xG en championnat."
    >
      <div className={c.grid2}>
        <Card title="À venir">
          <Upcoming dossier={dossier} limit={6} />
        </Card>
        <Card title="Derniers résultats">
          <MatchRows rows={dossier.allRows} limit={6} />
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ compare */

const COMPARE_ROWS = [
  "ppm",
  "xpts",
  "xg",
  "xga",
  "bigChances",
  "bigChancesAgainst",
  "possession",
  "fieldTilt",
  "ppda",
  "duels",
  "xgSet",
  "finishing",
  "keeper",
];

function Compare({ dossier }) {
  const fallback = similarClubs(dossier, 1)[0]?.club.id;
  const [rivalId, setRivalId] = useState(fallback);
  const self = dossier.self,
    other = dossier.clubs.find((club) => club.id === rivalId);
  return (
    <Section
      id="comparer"
      index={10}
      title="Comparer"
      text="Deux clubs du même championnat, phase par phase puis indicateur par indicateur."
    >
      <div className={s.compareBar}>
        <span className={s.compareTeam}>
          <Crest club={self} /> {self.name}
        </span>
        <span className={c.muted}>face à</span>
        <label className={c.switcher}>
          <select
            value={rivalId || ""}
            onChange={(e) => setRivalId(e.target.value)}
          >
            {dossier.clubs
              .filter((club) => club.id !== dossier.id)
              .map((club) => (
                <option key={club.id} value={club.id}>
                  {club.position}. {club.name}
                </option>
              ))}
          </select>
        </label>
        {other && (
          <Link
            className="inline-link"
            href={`/maquettes/club-b?id=${other.id}`}
          >
            Ouvrir son tableau →
          </Link>
        )}
      </div>
      {other && (
        <div className={c.grid2}>
          <Card
            title="Phase par phase"
            text="Indice Vega de chaque phase, sur 100."
          >
            <div className={s.duel}>
              <div className={s.duelHead}>
                <span>{self.name}</span>
                <span />
                <span>{other.name}</span>
              </div>
              {[{ key: "vega", label: "Indice global" }, ...PHASES].map(
                (phase) => {
                  const a =
                      phase.key === "vega"
                        ? self.vegaIndex
                        : self.phases[phase.key],
                    b =
                      phase.key === "vega"
                        ? other.vegaIndex
                        : other.phases[phase.key];
                  return (
                    <div className={s.duelRow} key={phase.key}>
                      <span
                        className={s.duelBar}
                        data-side="self"
                        data-best={a != null && b != null && a > b}
                      >
                        <b>{a ?? "—"}</b>
                        <i style={{ width: `${a ?? 0}%` }} />
                      </span>
                      <span className={s.duelLabel}>{phase.label}</span>
                      <span
                        className={s.duelBar}
                        data-side="rival"
                        data-best={a != null && b != null && b > a}
                      >
                        <i style={{ width: `${b ?? 0}%` }} />
                        <b>{b ?? "—"}</b>
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
          <Card
            title="Indicateur par indicateur"
            text="Valeurs par match et centiles dans le championnat."
          >
            <div className={c.tableScroll}>
              <table className={c.table}>
                <thead>
                  <tr>
                    <th scope="col">Indicateur</th>
                    <th scope="col">{self.name}</th>
                    <th scope="col">{other.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((key) => (
                    <tr key={key}>
                      <th scope="row">
                        {METRICS[key].label}
                        <Info text={METRICS[key].info} />
                      </th>
                      {[self, other].map((club) => (
                        <td key={club.id}>
                          <span className={s.compareCell}>
                            {formatMetric(key, club.values[key])}
                            <small>P{club.centiles[key] ?? "—"}</small>
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </Section>
  );
}

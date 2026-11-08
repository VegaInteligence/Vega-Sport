"use client";
/* Club profile, « Stats avancées » tab: each phase of play read for and
 * against, ranked in the chosen referential. */
import React, { useState } from "react";
import { Segments } from "./UI.jsx";
import { Gauge, PercentileBar } from "./PlayerScoutCharts.jsx";
import { METRICS, PHASES } from "../services/club-scout.js";
import {
  Card,
  Kpis,
  LeaguePlot,
  LeagueTable,
  MetricTable,
  MirrorBars,
  ShotPair,
  SituationTable,
  StyleSpectrum,
  clubStyles as c,
  fmtNum,
  ordinal,
} from "./ClubScoutUI.jsx";
import s from "./ClubScoutAdvanced.module.css";

/** One view of the tab: its blocks stacked, no heading of its own. */
function Section({ children }) {
  return <div className={s.bare}>{children}</div>;
}

export function Synthesis({ dossier }) {
  const self = dossier.self,
    total = dossier.clubs.length;
  return (
    <Section>
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

export function WithBall({ dossier }) {
  return (
    <Section>
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

export function WithoutBall({ dossier }) {
  return (
    <Section>
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

const setXg = (side) =>
  ["corner", "setPiece", "freeKick"].reduce((t, k) => t + side[k].xg, 0);

export function SetPieces({ dossier }) {
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
    <Section>
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

export function Finishing({ dossier }) {
  const self = dossier.self,
    n = self.record.matches;
  return (
    <Section>
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

export function Standings({ dossier }) {
  const [sort, setSort] = useState("points");
  return (
    <Section>
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

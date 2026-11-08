"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Segments } from "../../../src/components/UI.jsx";
import { MockShell, Tabs, useTab } from "../_shared/ui.jsx";
import {
  Career,
  Comparison,
  IdentityRail,
  Matches,
  Overview,
  Projection,
  Similar,
  Statistics,
} from "../joueur-a/PlayerPageA.jsx";
import {
  CareerKpis,
  Compare,
  CompetitionPanel,
  ContextBar,
  Distribution,
  IdentityStrip,
  MarketPanel,
  Physical,
  Synthesis,
  Telemetry,
  useAnalysis,
} from "../joueur-b/PlayerPageB.jsx";
import sA from "../joueur-a/page-a.module.css";
import s from "./page-c.module.css";

const TABS = [
  ["apercu", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["avancees", "Stats avancées"],
  ["physique", "Physique"],
  ["comparer", "Comparaison"],
  ["similaires", "Profils similaires"],
  ["carriere", "Carrière et marché"],
  ["projection", "Projection"],
  ["matchs", "Matchs"],
];

const ADVANCED_VIEWS = [
  ["synthese", "Synthèse du rôle"],
  ["telemetrie", "Télémétrie"],
  ["distribution", "Distribution complète"],
];

export default function PlayerPageC() {
  const [tab, setTab] = useTab(TABS);
  const [compared, setCompared] = useState(["previous"]);
  // One benchmark for every B block: Stats avancées sets it, the side-by-side comparison reads it.
  const analysis = useAnalysis();
  const railRef = useRef(null);
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const update = () => {
      const rail = railRef.current?.getBoundingClientRect();
      // Show the compact strip once the portrait and name have left the screen.
      setFloating(Boolean(rail && rail.top < -260));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const openComparison = (id) => {
    setCompared([id]);
    setTab("comparer");
  };
  return (
    <MockShell version="C" title="Fiche scout augmentée">
      <div
        className={s.floating}
        data-visible={floating}
        aria-hidden={!floating || undefined}
        inert={!floating || undefined}
      >
        <IdentityStrip className={s.floatingStrip} />
      </div>
      <Link className={sA.back} href="/joueurs/">
        ← Tous les joueurs
      </Link>
      <div className={sA.layout}>
        <div ref={railRef}>
          <IdentityRail onTab={setTab} />
        </div>
        <div className={sA.main}>
          <Tabs
            label="Analyse du joueur"
            items={TABS}
            value={tab}
            onChange={setTab}
            panelId="player-c-panel"
          />
          <div
            id="player-c-panel"
            role="tabpanel"
            aria-label={TABS.find(([key]) => key === tab)[1]}
          >
            {tab === "apercu" && <Overview onTab={setTab} />}
            {tab === "stats" && <Statistics />}
            {tab === "avancees" && (
              <AdvancedStats analysis={analysis} onTab={setTab} />
            )}
            {tab === "physique" && (
              <div className={s.block}>
                <Physical />
              </div>
            )}
            {tab === "comparer" && (
              <ComparisonViews
                selected={compared}
                onSelect={setCompared}
                ctx={analysis.ctx}
              />
            )}
            {tab === "similaires" && <Similar onCompare={openComparison} />}
            {tab === "carriere" && (
              <>
                <div className={s.block}>
                  <CareerKpis />
                  <MarketPanel wide />
                </div>
                <Career />
              </>
            )}
            {tab === "projection" && <Projection />}
            {tab === "matchs" && (
              <>
                <div className={s.block}>
                  <CompetitionPanel />
                </div>
                <Matches />
              </>
            )}
          </div>
        </div>
      </div>
    </MockShell>
  );
}

/* -------------------------------------------------------- stats avancées */

function AdvancedStats({ analysis, onTab }) {
  const [view, setView] = useState("synthese");
  const { ctx } = analysis;
  return (
    <section className={s.block} aria-label="Statistiques avancées">
      <div className={s.advancedHead}>
        <div>
          <h2>
            Stats avancées<span className={s.badgeNew}>Nouveau</span>
          </h2>
          <p>
            Choisissez le poste évalué, le championnat de référence et l’unité :
            les centiles, rangs et distributions de cet onglet suivent ce
            réglage.
          </p>
        </div>
      </div>
      <div className={s.advancedBody}>
        <ContextBar analysis={analysis} />
        <div className={s.subnav}>
          <Segments
            label="Vue des statistiques avancées"
            value={view}
            onChange={setView}
            items={ADVANCED_VIEWS}
          />
        </div>
        {view === "synthese" && (
          <Synthesis ctx={ctx} onTab={onTab} extras={false} />
        )}
        {view === "telemetrie" && <Telemetry ctx={ctx} />}
        {view === "distribution" && <Distribution ctx={ctx} />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ comparison */

const COMPARE_VIEWS = [
  ["radar", "Radar"],
  ["table", "Côte à côte"],
];

function ComparisonViews({ selected, onSelect, ctx }) {
  const [view, setView] = useState("radar");
  return (
    <>
      <div className={s.viewSwitch}>
        <Segments
          label="Affichage de la comparaison"
          value={view}
          onChange={setView}
          items={COMPARE_VIEWS}
        />
        <p>
          {view === "radar"
            ? "Superposition de trois profils au maximum"
            : `Jusqu’à quatre colonnes · référentiel des stats avancées (${ctx.config.label.toLowerCase()})`}
        </p>
      </div>
      {view === "radar" ? (
        <Comparison selected={selected} onSelect={onSelect} />
      ) : (
        <div className={s.block}>
          <Compare ctx={ctx} />
        </div>
      )}
    </>
  );
}

"use client";
import React, { lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PlayerDirectory from "./PlayerDirectory.jsx";
import { ResearchLists, ResearchTabs } from "./ResearchUI.jsx";
const PlayerExplorer = lazy(() => import("./PlayerExplorer.jsx"));
const PlayerIndices = lazy(() => import("./PlayerIndices.jsx"));
export default function PlayerWorkspace({ profiles, ...props }) {
  const params = useSearchParams();
  const items = [
    ["table", "Performances"],
    ["explore", "Explorer"],
    ["indices", "Indices"],
    ["lists", "Mes listes"],
  ];
  const view = items.some(([key]) => key === params.get("playersView"))
    ? params.get("playersView")
    : "table";
  const change = (value) => {
    const url = new URL(window.location.href);
    url.searchParams.set("playersView", value);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return (
    <>
      <ResearchTabs
        label="Vues des joueurs"
        value={view}
        items={items}
        onChange={change}
        panelId="player-workspace-panel"
      />
      <div
        id="player-workspace-panel"
        role="tabpanel"
        aria-label={items.find(([key]) => key === view)[1]}
      >
        <Suspense
          fallback={
            <div className="loading-state" role="status">
              Chargement de l’analyse…
            </div>
          }
        >
          {view === "table" && <PlayerDirectory {...props} />}
          {view === "explore" && (
            <PlayerExplorer
              rows={props.rows}
              mode={props.mode}
              onMode={props.onMode}
            />
          )}
          {view === "indices" && (
            <PlayerIndices rows={props.rows} profiles={profiles} />
          )}
          {view === "lists" && <ResearchLists kind="players" />}
        </Suspense>
      </div>
    </>
  );
}

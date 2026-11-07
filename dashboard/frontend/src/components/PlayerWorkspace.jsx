"use client";
import React, { lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PlayerDirectory from "./PlayerDirectory.jsx";
import { ResearchLists, ResearchTabs, useHasSaved } from "./ResearchUI.jsx";
import { playerDirectoryView } from "../services/player-leaderboard.js";
const PlayerExplorer = lazy(() => import("./PlayerExplorer.jsx"));
const PlayerIndices = lazy(() => import("./PlayerIndices.jsx"));
export default function PlayerWorkspace({ profiles, resource, ...props }) {
  const params = useSearchParams(),
    hasSaved = useHasSaved("players");
  const items = [
    ...(hasSaved ? [["lists", "Mes listes"]] : []),
    ["table", "Performances"],
    ["explore", "Explorer"],
    ["indices", "Indices"],
    ...(hasSaved ? [] : [["lists", "Mes listes"]]),
  ];
  const view = playerDirectoryView(params.get("playersView"));
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
          {resource?.loading ? (
            <p className="loading-state" role="status">
              Chargement{" "}
              {view === "table" ? "des joueurs" : "de la cohorte complète"}…
            </p>
          ) : resource?.error ? (
            <div role="alert">
              {resource.error}{" "}
              <button onClick={resource.retry}>Réessayer</button>
            </div>
          ) : (
            <>
              {resource?.refreshing && (
                <p className="notice" role="status">
                  Actualisation des joueurs…
                </p>
              )}
              {resource?.refreshError && (
                <p className="notice notice-warning" role="status">
                  La dernière publication reste affichée.{" "}
                  <button onClick={resource.retry}>Réessayer</button>
                </p>
              )}
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
            </>
          )}
        </Suspense>
      </div>
    </>
  );
}

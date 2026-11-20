"use client";
import { Skeleton } from "./UI.jsx";
import React, { lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PlayerDirectory from "./PlayerDirectory.jsx";
import { ResearchLists, ResearchTabs, useHasSaved } from "./ResearchUI.jsx";
import { playerDirectoryView } from "../services/player-leaderboard.js";
const PlayerReplacements = lazy(() => import("./PlayerReplacements.jsx"));
export default function PlayerWorkspace({
  profiles: _profiles,
  resource,
  ...props
}) {
  const params = useSearchParams(),
    hasSaved = useHasSaved("players");
  const items = [
    ...(hasSaved ? [["lists", "Mes listes"]] : []),
    ["table", "Performances"],
    ["replace", "Remplaçant"],
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
            <Skeleton data-page-loading="" label="Chargement de l’analyse…" />
          }
        >
          {resource?.loading ? (
            <Skeleton
              data-page-loading=""
              kind={view === "table" ? "table" : "block"}
              lines={view === "table" ? 10 : 4}
              label={`Chargement ${view === "table" ? "des joueurs" : "de la cohorte complète"}…`}
            />
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
              {view === "replace" && (
                <PlayerReplacements fallback={props.rows?.[0]} />
              )}
              {view === "lists" && <ResearchLists kind="players" />}
            </>
          )}
        </Suspense>
      </div>
    </>
  );
}

"use client";
import React, {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  cleanEntry,
  cleanResearch,
  cleanSettings,
  comparisonKey,
  EMPTY_RESEARCH,
  RESEARCH_KEY,
} from "../services/research-storage.js";
import { createBrowserStateStore, useBrowserState } from "../services/browser-state.js";
const ComparisonDialog = lazy(
  () => import("../components/PlayerComparison.jsx"),
);
const Context = createContext(null);
const researchStore = createBrowserStateStore({
  key: RESEARCH_KEY,
  storage: "localStorage",
  fallback: EMPTY_RESEARCH,
  normalize: cleanResearch,
});
export const useResearch = () => useContext(Context);
export function ResearchProvider({ children, initialState }) {
  const serverData = useMemo(() => initialState ? {
    ...EMPTY_RESEARCH,
    lists: [{ id: "main", name: "Ma sélection", entries: [
      ...(initialState.personalTeams || []).map((id) => ({ kind: "clubs", id })),
      ...(initialState.personalPlayers || []).map((id) => ({ kind: "players", id })),
    ] }],
  } : EMPTY_RESEARCH, [initialState]);
  const [data, setData, ready] = useBrowserState(researchStore, serverData);
  const [message, setMessage] = useState("");
  const [comparing, setComparing] = useState(false);
  const [comparisonKind, setComparisonKind] = useState("players");
  const update = (action) => {
    if (!setData(action))
      setMessage(
        "La sauvegarde locale est indisponible. Vos recherches restent utilisables dans cet onglet.",
      );
  };
  const currentList =
    data.lists.find((list) => list.id === data.activeList) || data.lists[0];
  function toggleFavorite(value) {
    const entry = cleanEntry(value);
    if (!entry) return;
    update((previous) => ({
      ...previous,
      lists: previous.lists.map((list) =>
        list.id !== previous.activeList
          ? list
          : {
              ...list,
              entries: list.entries.some(
                (item) => item.kind === entry.kind && item.id === entry.id,
              )
                ? list.entries.filter(
                    (item) =>
                      !(item.kind === entry.kind && item.id === entry.id),
                  )
                : [...list.entries, entry],
            },
      ),
    }));
  }
  function toggleComparison(value) {
    const entry = cleanEntry({ ...value, kind: "players" });
    if (!entry?.season) return;
    const key = comparisonKey(entry);
    const exists = data.comparison.some((item) => comparisonKey(item) === key);
    if (!exists && data.comparison.length >= 4) {
      setMessage("La comparaison contient déjà quatre joueurs ou saisons.");
      return;
    }
    setComparisonKind("players");
    update((previous) => ({
      ...previous,
      comparison: exists
        ? previous.comparison.filter((item) => comparisonKey(item) !== key)
        : [...previous.comparison, entry],
    }));
  }
  return (
    <Context.Provider
      value={{
        data,
        ready,
        update,
        currentList,
        toggleFavorite,
        toggleComparison,
        comparing,
        setComparing,
        comparisonKind,
        setComparisonKind,
        message,
        setMessage,
        setSettings: (patch) =>
          update((previous) => ({
            ...previous,
            settings: cleanSettings({ ...previous.settings, ...patch }),
          })),
        isFavorite: (kind, id) =>
          currentList.entries.some(
            (item) => item.kind === kind && item.id === id,
          ),
        isComparing: (entry) =>
          data.comparison.some(
            (item) => comparisonKey(item) === comparisonKey(entry),
          ),
      }}
    >
      {children}
      {message && (
        <div className="research-toast" role="status">
          {message}
          <button
            className="button button-ghost"
            aria-label="Fermer l’alerte"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}
      {comparing && (
        <Suspense
          fallback={
            <div role="status" className="loading-state">
              Chargement de la comparaison…
            </div>
          }
        >
          <ComparisonDialog onClose={() => setComparing(false)} />
        </Suspense>
      )}
    </Context.Provider>
  );
}

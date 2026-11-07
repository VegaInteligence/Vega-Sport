"use client";
import React, {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  cleanEntry,
  cleanResearch,
  cleanSettings,
  comparisonKey,
  EMPTY_RESEARCH,
  readResearch,
  RESEARCH_KEY,
} from "../services/research-storage.js";
const ComparisonDialog = lazy(
  () => import("../components/PlayerComparison.jsx"),
);
const Context = createContext(null);
export const useResearch = () => useContext(Context);
export function ResearchProvider({ children, initialState }) {
  const [data, setData] = useState(() => initialState ? {
    ...EMPTY_RESEARCH,
    lists: [{ id: "main", name: "Ma sélection", entries: [
      ...(initialState.personalTeams || []).map((id) => ({ kind: "clubs", id })),
      ...(initialState.personalPlayers || []).map((id) => ({ kind: "players", id })),
    ] }],
  } : EMPTY_RESEARCH);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [comparing, setComparing] = useState(false);
  const [comparisonKind, setComparisonKind] = useState("players");
  useEffect(() => {
    setData(readResearch());
    setReady(true);
    const sync = (event) => {
      if (event.key === RESEARCH_KEY) setData(readResearch());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(RESEARCH_KEY, JSON.stringify(data));
    } catch {
      setMessage(
        "La sauvegarde locale est indisponible. Vos recherches restent utilisables dans cet onglet.",
      );
    }
  }, [data, ready]);
  const update = (action) =>
    setData((previous) =>
      cleanResearch(typeof action === "function" ? action(previous) : action),
    );
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

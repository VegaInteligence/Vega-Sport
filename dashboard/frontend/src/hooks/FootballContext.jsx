"use client";
import { useSearchParams } from "next/navigation";
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
} from "react";
import { loadSeason } from "../season_data.js";
import {
  filterAppearances,
  filterMatches,
  csvString,
  per90,
  seasonLabel,
} from "../model.js";
import { json, useResource, download } from "../services/resources.js";
import { FootballDataClient } from "../services/football-client.js";
import { AsyncState } from "../components/UI.jsx";
export const FootballContext = createContext(null);
const Context = FootballContext;
export const useFootball = () => useContext(Context);
export function FootballProvider({ children, loadData = true }) {
  const initial = useSearchParams();
  const [matchFilter, setMatchFilter] = useState("all");
  const season = initial.get("season") || "";
  const filters = useMemo(
    () => ({
      query: initial.get("q") || "",
      league: initial.get("league") || "all",
      minutes: Number(initial.get("minutes") ?? 1),
      match: matchFilter,
    }),
    [initial, matchFilter],
  );
  function updateQuery(values) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value === "" || value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  function setFilters(action) {
    // History updates are synchronous; Next's search-parameter render may follow
    // a frame later. Apply quick successive edits to the latest URL scope.
    const current = new URLSearchParams(window.location.search);
    const latest = {
      ...filters,
      query: current.get("q") || "",
      league: current.get("league") || "all",
      minutes: Number(current.get("minutes") ?? 1),
    };
    const next = typeof action === "function" ? action(latest) : action;
    setMatchFilter(next.match || "all");
    updateQuery({
      q: next.query,
      league: next.league === "all" ? "" : next.league,
      minutes: next.minutes === 1 ? "" : next.minutes,
    });
  }
  const [comparison, setComparison] = useState([]),
    [player, setPlayer] = useState(null),
    [comparing, setComparing] = useState(false),
    [notice, setNotice] = useState("");
  const manifest = useResource("manifest", () =>
    json("/data/football-manifest.json"),
  );
  const chosen = manifest.value?.seasons.some((s) => s.id === season)
    ? season
    : manifest.value?.defaultSeason;
  const dataset = useResource(
    `season:${chosen}:${loadData ? "full" : "catalog"}`,
    () =>
      chosen
        ? loadData
          ? loadSeason(manifest.value, chosen)
          : Promise.resolve({
              meta: { retrievedAt: manifest.value.retrievedAt },
              competitions: [],
              matches: [],
              appearances: [],
              fixtures: [],
            })
        : Promise.resolve(null),
  );
  const data = dataset.value;
  const client = useMemo(
    () => (data ? new FootballDataClient({ data }) : null),
    [data],
  );
  const status = useResource(`status:${client?.id}`, async () => {
    if (!client) return false;
    await (loadData ? client.init() : client.checkStatus());
    return client.configured;
  });
  const scope = useMemo(
    () => ({ ...filters, season: chosen }),
    [filters, chosen],
  );
  const rows = useMemo(
    () => (data ? filterAppearances(data.appearances, scope) : []),
    [data, scope],
  );
  const matches = useMemo(
    () => (data ? filterMatches(data.matches, data.appearances, scope) : []),
    [data, scope],
  );
  const byAppearance = useMemo(
    () => new Map((data?.appearances || []).map((r) => [r.id, r])),
    [data],
  );
  function changeSeason(value) {
    updateQuery({ season: value, league: "" });
    setMatchFilter("all");
    setComparison([]);
    setPlayer(null);
  }
  const href = (page, params = {}) => {
    const query = new URLSearchParams({
      season: chosen || "",
      ...(filters.query ? { q: filters.query } : {}),
      ...(filters.league !== "all" ? { league: filters.league } : {}),
      ...(filters.minutes !== 1 ? { minutes: String(filters.minutes) } : {}),
      ...params,
    });
    return `${page}${query.size ? "?" + query : ""}`;
  };
  function toggle(id) {
    setComparison((list) =>
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length < 3
          ? [...list, id]
          : (setNotice("La comparaison est limitée à3 performances."), list),
    );
  }
  function exportRows(mode = "total") {
    const fields = [
      "date",
      "matchId",
      "playerId",
      "name",
      "team",
      "league",
      "season",
      "minutes",
      "rating",
      "goals",
      "assists",
      "xg",
      "xa",
      "shots",
      "chancesCreated",
      "defensiveActions",
      "saves",
      "goalsPrevented",
    ];
    download(
      "orion-performances.csv",
      csvString(
        fields,
        rows.map((r) =>
          fields.map((key) =>
            mode === "per90" &&
            ![
              "date",
              "matchId",
              "playerId",
              "name",
              "team",
              "league",
              "season",
              "minutes",
              "rating",
            ].includes(key)
              ? per90(r[key], r.minutes)
              : key === "season"
                ? seasonLabel(r[key])
                : r[key],
          ),
        ),
      ),
      "text/csv;charset=utf-8",
    );
  }
  useEffect(() => {
    if (chosen && !initial.get("season")) updateQuery({ season: chosen });
  }, [chosen, initial]);
  const value = {
    data,
    manifest: manifest.value,
    season: chosen,
    changeSeason,
    filters,
    setFilters,
    rows,
    matches,
    client,
    configured: status.value === true,
    statusKnown: !status.loading,
    href,
    comparison,
    setComparison,
    toggle,
    byAppearance,
    player,
    setPlayer,
    comparing,
    setComparing,
    notice,
    setNotice,
    exportRows,
  };
  return (
    <Context.Provider value={value}>
      <AsyncState resource={manifest}>
        {() => (
          <AsyncState resource={dataset}>
            {(value) =>
              value ? (
                children
              ) : (
                <div role="status">Chargement de la saison…</div>
              )
            }
          </AsyncState>
        )}
      </AsyncState>
    </Context.Provider>
  );
}

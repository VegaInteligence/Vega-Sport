import React, { useState } from "react";
import { AsyncState, Empty } from "./UI.jsx";
import DataExplorer from "./DataExplorer.jsx";
import PlayerMetrics, { periodLabel } from "./PlayerMetrics.jsx";
import { useResource, json, download } from "../services/resources.js";

const sources = [
  ["performance", "Performance"],
  ["players", "Statistiques"],
  ["player_halves", "Par mi-temps"],
  ["advanced_players", "Analyse avancée"],
  ["shots", "Tirs"],
  ["heatmaps", "Carte d’activité"],
  ["events", "Événements"],
  ["lineups", "Composition"],
  ["pass_networks", "Réseau de passes de l’équipe"],
  ["profile", "Fiche du joueur"],
];
function containsPlayer(value, id) {
  if (value === id) return true;
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).some((v) => containsPlayer(v, id))
  );
}
function playerSource(archive, source, row) {
  const entry = archive.endpoints?.[source];
  if (!entry)
    return { status: null, data: null, error: "Données non collectées." };
  const data = entry.data,
    id = row.playerId;
  let selected = data;
  if (Array.isArray(data))
    selected = data.filter((item) => item.player?.id === id);
  else if (data && typeof data === "object") {
    selected = { ...data };
    if (Array.isArray(data.players))
      selected.players = data.players.filter((p) => p.player?.id === id);
    if (source === "shots")
      selected.periods = (data.periods || []).map((p) => ({
        ...p,
        shots: (p.shots || []).filter((s) => s.player?.id === id),
      }));
    if (source === "heatmaps")
      selected.teams = (data.teams || []).filter(
        (t) => t.team?.id === row.teamId,
      );
    if (source === "events")
      selected.events = (data.events || []).filter((e) =>
        containsPlayer(e, id),
      );
    if (source === "pass_networks")
      selected.networks = (data.networks || []).filter(
        (n) => n.team?.id === row.teamId,
      );
    if (source === "lineups") {
      for (const side of ["home", "away"]) {
        const lineup = data[side];
        if (lineup)
          selected[side] = {
            ...lineup,
            starters: (lineup.starters || []).filter((p) => p.player_id === id),
            subs: (lineup.subs || []).filter((p) => p.player_id === id),
          };
      }
    }
  }
  return { ...entry, data: selected };
}

export default function PlayerData({ row, mode }) {
  const [period, setPeriod] = useState("All"),
    [source, setSource] = useState("performance"),
    resource = useResource(`player-match-source:${row.matchId}`, () =>
      json(`/api/archive/matches/${row.matchId}`),
    ),
    profile = useResource(
      `player-profile-source:${row.playerId}`,
      () => json(`/api/archive/profiles/players/${row.playerId}`),
      mode === "data" && source === "profile",
    );
  if (mode === "stats")
    return (
      <AsyncState resource={resource}>
        {(archive) => {
          const full = archive.endpoints?.players?.data,
            player = (Array.isArray(full) ? full : full?.players || []).find(
              (p) => p.player?.id === row.playerId,
            ),
            halves =
              archive.endpoints?.player_halves?.data?.players?.find(
                (p) => p.player?.id === row.playerId,
              )?.periods || [],
            periods = [
              ...(player ? [{ ...player, period: "All" }] : []),
              ...halves,
            ],
            selected = periods.find((p) => p.period === period) || periods[0];
          if (!selected)
            return (
              <Empty>Statistiques sources non collectées pour ce joueur.</Empty>
            );
          return (
            <>
              <div className="table-toolbar">
                <label htmlFor="player-stat-period">Période</label>
                <select
                  id="player-stat-period"
                  value={selected.period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      {periodLabel(p.period)}
                    </option>
                  ))}
                </select>
              </div>
              <PlayerMetrics row={selected} />
            </>
          );
        }}
      </AsyncState>
    );
  const display = (value) => (
    <>
      <div className="table-toolbar">
        <button
          className="button button-secondary"
          onClick={() =>
            download(
              `orion-${row.id}-${source}.json`,
              JSON.stringify(value, null, 2),
            )
          }
        >
          Télécharger JSON
        </button>
      </div>
      <DataExplorer
        key={source}
        value={value}
        label="Format des données du joueur"
      />
    </>
  );
  return (
    <>
      <div className="table-toolbar">
        <label htmlFor="player-data-source">Type de données</label>
        <select
          id="player-data-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {sources.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {source === "performance" ? (
        display(row)
      ) : source === "profile" ? (
        <AsyncState resource={profile}>{display}</AsyncState>
      ) : (
        <AsyncState resource={resource}>
          {(archive) =>
            display({
              matchId: row.matchId,
              playerId: row.playerId,
              season: archive.season,
              retrieved_at_utc: archive.retrieved_at_utc,
              ...playerSource(archive, source, row),
            })
          }
        </AsyncState>
      )}
    </>
  );
}

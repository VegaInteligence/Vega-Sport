import React, { useState } from "react";
import { AsyncState, Empty, Segments } from "./UI.jsx";
import PlayerMetrics, { periodShort } from "./PlayerMetrics.jsx";
import useMatchPlayerStats from "../hooks/useMatchPlayerStats.js";
import useMatchSection from "../hooks/useMatchSection.js";

export default function PlayerData({ row, match }) {
  const [period, setPeriod] = useState("All");
  const fixture = match || { id: row.matchId };
  const full = useMatchPlayerStats(fixture);
  const halves = useMatchSection(fixture, "players/halves");
  const players = Array.isArray(full.data) ? full.data : full.data?.players || [];
  const player = players.find((item) => item.player?.id === row.playerId);
  const halfPeriods = halves.data?.players?.find(
    (item) => item.player?.id === row.playerId,
  )?.periods || [];
  const periods = [
    ...(player?.stats?.length ? [{ ...player, period: "All" }] : []),
    ...halfPeriods,
  ];
  const selected = periods.find((item) => item.period === period) || periods[0];

  return (
    <AsyncState
      resource={{
        loading: !selected && (full.loading || halves.loading),
        error: full.error && halves.error ? "Statistiques détaillées indisponibles." : null,
        retry: () => {
          full.retry?.();
          halves.retry?.();
        },
        value: periods,
      }}
    >
      {() => selected ? (
        <>
          {periods.length > 1 && (
            <div className="pc-period">
              <Segments
                label="Période des statistiques"
                value={selected.period}
                onChange={setPeriod}
                items={periods.map((item) => [
                  item.period,
                  periodShort(item.period),
                ])}
              />
            </div>
          )}
          <PlayerMetrics row={selected} showMissing />
        </>
      ) : (
        <Empty>Statistiques détaillées non collectées pour ce joueur.</Empty>
      )}
    </AsyncState>
  );
}

import React, { useState } from "react";
import { AsyncState, Empty, Segments } from "./UI.jsx";
import PlayerMetrics, { periodShort } from "./PlayerMetrics.jsx";
import { useResource, json } from "../services/resources.js";

export default function PlayerData({ row }) {
  const [period, setPeriod] = useState("All");
  const resource = useResource(`player-match-source:${row.matchId}`, () =>
    json(`/api/archive/matches/${row.matchId}`),
  );
  return (
    <AsyncState resource={resource}>
      {(archive) => {
        const full = archive.endpoints?.players?.data;
        const player = (Array.isArray(full) ? full : full?.players || []).find(
          (item) => item.player?.id === row.playerId,
        );
        const halves =
          archive.endpoints?.player_halves?.data?.players?.find(
            (item) => item.player?.id === row.playerId,
          )?.periods || [];
        const periods = [
          ...(player ? [{ ...player, period: "All" }] : []),
          ...halves,
        ];
        const selected =
          periods.find((item) => item.period === period) || periods[0];
        if (!selected)
          return (
            <Empty>
              Statistiques détaillées non collectées pour ce joueur.
            </Empty>
          );
        return (
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
            <PlayerMetrics row={selected} />
          </>
        );
      }}
    </AsyncState>
  );
}

import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Media } from "./UI.jsx";

function entries(ids, catalogue, fallback) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const selected = uniqueIds
    .map((id) => catalogue.find((item) => item.id === id))
    .filter((item) => item?.name);
  if (selected.length && selected.length === uniqueIds.length) return selected;
  const seen = new Set(
    selected.map((item) => item.name.toLocaleLowerCase("fr")),
  );
  const names = String(fallback || "")
    .split(" · ")
    .map((name) => name.trim())
    .filter(Boolean);
  return [
    ...selected,
    ...names
      .filter((name) => !seen.has(name.toLocaleLowerCase("fr")))
      .map((name) => ({ name })),
  ];
}

/** Show each observed identity with its own crest when the catalogue has one. */
export default function PerformanceContext({
  teamIds = [],
  leagueIds = [],
  team,
  league,
  position,
}) {
  const { data } = useFootball();
  const teams = entries(teamIds, data?.teams || [], team);
  const leagues = entries(leagueIds, data?.competitions || [], league);
  return (
    <span className="performance-context">
      {position && position !== "—" && <span>{position}</span>}
      {[...teams, ...leagues].map((item, index) => (
        <span
          className="performance-context-item"
          key={`${item.id || item.name}:${index}`}
        >
          {item.imageUrl && (
            <Media
              name={item.name}
              url={item.imageUrl}
              className="performance-context-logo"
            />
          )}
          <span>{item.name}</span>
        </span>
      ))}
    </span>
  );
}

import React from "react";
import Icon from "./Icon.jsx";

export default function SeasonFilter({ f, compact = false }) {
  return (
    <div className="filter-field filter-season">
      <label
        htmlFor="season-filter"
        className={compact ? "sr-only" : undefined}
      >
        Saison
      </label>
      <div className="filter-input-wrap">
        <Icon name="calendar" />
        <select
          id="season-filter"
          value={f.season}
          onChange={(event) => f.changeSeason(event.target.value)}
        >
          {f.manifest.seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.id}
            </option>
          ))}
        </select>
        <Icon name="chevron" className="select-chevron" />
      </div>
    </div>
  );
}

import React, { useId } from "react";
import Icon from "./Icon.jsx";

/**
 * Season drop-down with the site's select styling (calendar icon, chevron).
 * `allLabel` adds a first option for "every season" (value "all").
 */
export default function SeasonSelect({
  value,
  seasons,
  onChange,
  label = "Saison",
  allLabel,
  className = "",
}) {
  const id = useId();
  return (
    <div className={`filter-field season-select ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <div className="filter-input-wrap">
        <Icon name="calendar" />
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {allLabel && <option value="all">{allLabel}</option>}
          {seasons.map((season) => (
            <option key={season} value={season}>
              {season}
            </option>
          ))}
        </select>
        <Icon name="chevron" className="select-chevron" />
      </div>
    </div>
  );
}

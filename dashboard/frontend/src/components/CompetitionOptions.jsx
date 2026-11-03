import React from "react";
import { competitionGroups } from "../services/competition-selector.js";

/** Native country groups preserve each filter's existing option values. */
export default function CompetitionOptions({
  competitions,
  valueKey = "id",
  label = (competition) => competition.name || competition[valueKey],
}) {
  return competitionGroups(competitions).map((group) => (
    <optgroup key={group.key} label={group.label}>
      {group.competitions.map((competition) => (
        <option key={competition[valueKey]} value={competition[valueKey]}>
          {label(competition)}
        </option>
      ))}
    </optgroup>
  ));
}

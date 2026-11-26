"use client";

import SettingsPicker from "./SettingsPicker.jsx";

const seasonOption = (season) =>
  typeof season === "string" ? { value: season, label: season } : season;

export function SeasonChoices({ options, value, onChange, label = "Saison" }) {
  return (
    <div className="home-settings-seasons" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="home-settings-season"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          data-value={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function SeasonSelect({
  value,
  seasons,
  onChange,
  label = "Saison",
  allLabel,
  className = "",
  disabled,
  controlId,
}) {
  const options = seasons.map(seasonOption);
  if (allLabel) options.unshift({ value: "all", label: allLabel });
  const selected = options.find((option) => option.value === value);
  return (
    <SettingsPicker
      pane="season"
      icon="calendar"
      label={label}
      text={selected?.label || value || label}
      className={className}
      disabled={disabled || !options.length}
      controlId={controlId}
      value={value}
    >
      {(close) => (
        <SeasonChoices
          options={options}
          value={value}
          label={label}
          onChange={(next) => {
            if (next !== value) onChange(next);
            close();
          }}
        />
      )}
    </SettingsPicker>
  );
}

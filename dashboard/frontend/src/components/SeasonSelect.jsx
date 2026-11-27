"use client";

import { useLayoutEffect, useRef } from "react";
import SettingsPicker from "./SettingsPicker.jsx";

const seasonOption = (season) =>
  typeof season === "string" ? { value: season, label: season } : season;

// Up to GROUP_FROM seasons the pills simply wrap. More (twenty seasons and beyond, hugo, 27 Nov 2026: « si j'ai 20
// saison ca peut etre le brodel », § 80): a title per decade, three seasons a row, the list scrolls by itself and
// opens on the chosen season. An « all » choice (Toutes les saisons) stays first, out of the decades.
export const GROUP_FROM = 9;
const decadeOf = (option) => {
  const year = /^(\d{4})/.exec(String(option.label ?? option.value))?.[1];
  return year ? Math.floor(Number(year) / 10) * 10 : null;
};
export function seasonDecades(options) {
  const dated = options.filter((option) => option.value !== "all");
  if (
    dated.length < GROUP_FROM ||
    dated.some((option) => decadeOf(option) === null)
  )
    return null;
  const groups = [];
  for (const option of dated) {
    const decade = decadeOf(option);
    const last = groups[groups.length - 1];
    if (last?.decade === decade) last.options.push(option);
    else groups.push({ decade, options: [option] });
  }
  return groups;
}

export function SeasonChoices({ options, value, onChange, label = "Saison" }) {
  const list = useRef(null);
  const groups = seasonDecades(options);
  useLayoutEffect(() => {
    const box = list.current;
    const chosen = box?.querySelector('[aria-pressed="true"]');
    if (!groups || !chosen || box.scrollHeight <= box.clientHeight) return;
    const top =
      chosen.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    box.scrollTop = Math.max(
      0,
      top - (box.clientHeight - chosen.offsetHeight) / 2,
    );
  }, []);
  const pill = (option) => (
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
  );
  if (!groups)
    return (
      <div className="home-settings-seasons" role="group" aria-label={label}>
        {options.map(pill)}
      </div>
    );
  const all = options.find((option) => option.value === "all");
  return (
    <div
      ref={list}
      className="home-settings-seasons is-grouped"
      role="group"
      aria-label={label}
    >
      {all && <div className="home-settings-season-all">{pill(all)}</div>}
      {groups.map((group) => (
        <section
          key={group.decade}
          className="home-settings-decade"
          aria-label={`Années ${group.decade}`}
        >
          <p className="home-settings-decade-title" aria-hidden="true">
            Années {group.decade}
          </p>
          <div className="home-settings-decade-seasons">
            {group.options.map(pill)}
          </div>
        </section>
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
  bare = false,
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
      bare={bare}
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

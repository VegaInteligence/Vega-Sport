"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import Icon from "./Icon.jsx";
import styles from "./PlayerProfileFilters.module.css";

const dateFr = (value) =>
  value ? value.split("-").reverse().join("/") : "…";

/** The player's one bar of choices: season, period (a button that opens the two
 *  dates), then what the tab adds (`after`: competitions, comparison groups), with
 *  the comparison's status line under it. `period={false}`: a tab that ignores
 *  season and dates shows only its groups. `children` replaces the season. */
export default function PlayerProfileFilters({
  children,
  period = true,
  after,
  status,
}) {
  const f = useFootball();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const barRef = useRef(null),
    buttonRef = useRef(null),
    panelRef = useRef(null);
  const fromId = useId(),
    toId = useId(),
    panelId = useId();
  const from = f.filters?.advanced?.from || "",
    to = f.filters?.advanced?.to || "";
  const update = (patch) =>
    f.setFilters((current) => ({
      ...current,
      advanced: { ...current.advanced, ...patch },
    }));
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (
        !panelRef.current?.contains(event.target) &&
        !buttonRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const toggle = () => {
    // The panel opens under the button, kept inside the bar.
    const bar = barRef.current?.getBoundingClientRect(),
      button = buttonRef.current?.getBoundingClientRect();
    if (bar && button)
      setLeft(Math.max(0, Math.min(button.left - bar.left, bar.width - 300)));
    setOpen((value) => !value);
  };
  if (!period && !after) return null;
  // § 87: the bar on the title's line is one track of the home (Saison · Période · Compétitions · Comparer à). A
  // caller that brings its own choices (`children`, the history's statistics) keeps them as they are.
  const track = children === undefined;
  return (
    <div className={`${styles.bar}${track ? ` ${styles.onTitle}` : ""}`} ref={barRef}>
      <div
        className={track ? `home-settings player-bar ${styles.track}` : styles.filters}
        role="group"
        aria-label="Filtres du joueur"
      >
        {period &&
          (children ?? (
            <SeasonSelect
              bare
              value={f.season}
              seasons={(f.manifest?.seasons || []).map((season) => season.id)}
              onChange={f.changeSeason}
            />
          ))}
        {period && (
          <button
            ref={buttonRef}
            type="button"
            className={track ? `home-settings-segment ${styles.period}` : styles.pill}
            aria-expanded={open}
            aria-controls={panelId}
            data-active={Boolean(from || to) || undefined}
            onClick={toggle}
          >
            <span>Période</span>
            <b>{from || to ? `${dateFr(from)} – ${dateFr(to)}` : "Toute la saison"}</b>
            <Icon name="chevron" className="home-settings-chevron" />
          </button>
        )}
        {after}
      </div>
      {period && open && (
        <div
          id={panelId}
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Période"
          style={{ "--panel-left": `${left}px` }}
        >
          <div className={styles.field}>
            <label htmlFor={fromId}>Du</label>
            <input
              id={fromId}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => update({ from: event.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={toId}>Au</label>
            <input
              id={toId}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => update({ to: event.target.value })}
            />
          </div>
          {(from || to) && (
            <button
              className={styles.clear}
              type="button"
              onClick={() => update({ from: "", to: "" })}
            >
              Toute la saison
            </button>
          )}
        </div>
      )}
      {status}
    </div>
  );
}

/** One labelled group of the bar (« Comparer à » and its switch). `end`: pushed
 *  to the bar's right end. */
export function FilterGroup({ label, end = false, children }) {
  // In the track (§ 87) the group is its control alone: the label goes into the control's own words.
  if (!label) return children;
  return (
    <div className={styles.group} data-end={end || undefined}>
      {label && <span className={styles.label}>{label}</span>}
      {children}
    </div>
  );
}

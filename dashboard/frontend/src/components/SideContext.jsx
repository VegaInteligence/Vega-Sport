"use client";
/* B (VI-41): the sidebar's « Contexte » tab, the state of what the page shows
 * and its timeline. A page renders <SideContext summary={…}>blocks</SideContext>
 * with data it already holds; with data-nav="b" the blocks go to Layout's
 * #side-context (and the summary to the phone's context bar), otherwise
 * nothing is rendered. The blocks below are the panel's vocabulary. */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

function useNav() {
  const [nav, setNav] = useState("");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setNav(root.dataset.nav || "a");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-nav"] });
    return () => observer.disconnect();
  }, []);
  return nav;
}

/** B with room for the sidebar column (wide screens): a page's side column moves into it. */
export function useBWide() {
  const nav = useNav();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const read = () => setWide(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return nav === "b" && wide;
}

/** Renders its children only while B is on, so other layouts make no extra reads. */
export function OnlyB({ children }) {
  return useNav() === "b" ? children : null;
}

export default function SideContext({ summary, children }) {
  const nav = useNav();
  const [slots, setSlots] = useState(null);
  useEffect(() => {
    if (nav !== "b") return setSlots(null);
    setSlots({
      body: document.getElementById("side-context"),
      bar: document.getElementById("side-context-bar"),
    });
  }, [nav]);
  if (!slots?.body) return null;
  return (
    <>
      {createPortal(<div className="side-ctx">{children}</div>, slots.body)}
      {summary &&
        slots.bar &&
        createPortal(
          <>
            <span className="side-bar-label">{summary.label}</span>
            {summary.value != null && (
              <em className="side-bar-value">{summary.value}</em>
            )}
          </>,
          slots.bar,
        )}
    </>
  );
}

/* ---------- Blocks ---------- */
export function Block({ title, sub, children }) {
  return (
    <section className="sx-block">
      <h3 className="sx-head">
        <span>{title}</span>
        {sub && <small>{sub}</small>}
      </h3>
      {children}
    </section>
  );
}
export function Row({ label, value, unit, tone }) {
  if (value == null || value === "") return null;
  return (
    <div className="sx-row">
      <span>{label}</span>
      <b className={tone ? `is-${tone}` : undefined}>
        {value}
        {unit && <u>{unit}</u>}
      </b>
    </div>
  );
}
/** A big figure with its caption (an Elo, a score). */
export function Figure({ value, caption, children }) {
  return (
    <div className="sx-figure">
      <b>{value}</b>
      <span>{caption}</span>
      {children}
    </div>
  );
}
/** Results, newest last: "W" | "D" | "L". */
export function Form({ results, label = "Forme" }) {
  if (!results?.length) return null;
  const text = { W: "V", D: "N", L: "D" };
  return (
    <div className="sx-row">
      <span>{label}</span>
      <span className="sx-form" aria-label={results.map((r) => text[r]).join(" ")}>
        {results.map((r, index) => (
          <i key={index} className={`is-${r}`}>
            {text[r]}
          </i>
        ))}
      </span>
    </div>
  );
}
/** Three shares that add up to 100 (home, draw, away). */
export function Odds({ home, draw, away, labels = [] }) {
  if ([home, draw, away].some((value) => !Number.isFinite(value))) return null;
  const pct = (value) => Math.round(value * 100);
  return (
    <div className="sx-odds" role="img" aria-label={`${labels[0] || "Domicile"} ${pct(home)} %, nul ${pct(draw)} %, ${labels[1] || "extérieur"} ${pct(away)} %`}>
      {[
        ["home", home],
        ["draw", draw],
        ["away", away],
      ].map(([key, value]) => (
        <span key={key} className={`is-${key}`} style={{ flexGrow: Math.max(value, 0.001) }}>
          {pct(value) >= 9 ? `${pct(value)}` : ""}
        </span>
      ))}
      <span className="sx-odds-legend" aria-hidden="true">
        <span>{labels[0] || "Domicile"} {pct(home)} %</span>
        <span>Nul {pct(draw)} %</span>
        <span>{labels[1] || "Extérieur"} {pct(away)} %</span>
      </span>
    </div>
  );
}
export function Meter({ label, share }) {
  if (!Number.isFinite(share)) return null;
  const pct = Math.round(share * 100);
  return (
    <div className="sx-meter">
      <span>{label}</span>
      <span className="sx-track">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <b>{pct} %</b>
    </div>
  );
}
/** A small line of values, oldest first. */
export function Spark({ values }) {
  const points = (values || []).filter(Number.isFinite);
  if (points.length < 2) return null;
  const max = Math.max(...points),
    min = Math.min(...points),
    y = (value) => 38 - ((value - min) / (max - min || 1)) * 32;
  const line = points
    .map((value, index) => `${(index / (points.length - 1)) * 280},${y(value).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="sx-spark" viewBox="0 0 280 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={line} />
      <circle cx="280" cy={y(points.at(-1))} r="2.6" />
    </svg>
  );
}
/** Events in order: state "done" | "now" | "next". */
export function Timeline({ items }) {
  if (!items?.length) return null;
  return (
    <ol className="sx-timeline">
      {items.map((item, index) => {
        const body = (
          <>
            <i aria-hidden="true" />
            <span>{item.label}</span>
            <em>{item.time}</em>
          </>
        );
        return (
          <li key={item.key || index} className={`is-${item.state || "done"}`}>
            {item.href ? <Link href={item.href}>{body}</Link> : <div>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

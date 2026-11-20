"use client";
/* B (VI-41): the sidebar. Contexte (SideContext) and Filtres (SideFilters)
 * are filled by the page; Comparer and Suivis read the visitor's own stores.
 * A tab shows only when it has something. Wide screens: a column on the left;
 * narrower: a bar above the tab bar opens it as a sheet. Hidden outside B. */
import React, { useEffect, useRef, useState } from "react";
import { Activity, Bookmark, ChevronUp, GitCompareArrows, SlidersHorizontal, X } from "lucide-react";
import { SideCompare, SideFollows, useCompareCount } from "./SideStores.jsx";

const TABS = [
  ["contexte", "Contexte", Activity],
  ["filtres", "Filtres", SlidersHorizontal],
  ["comparer", "Comparer", GitCompareArrows],
  ["suivis", "Suivis", Bookmark],
];

/** Whether a slot the page fills has content, kept up to date. */
function useFilled(ref) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Filled when a page's wrapper (side-ctx, a filters group) holds something.
    const read = () =>
      setFilled([...node.children].some((child) => child.childElementCount > 0 || child.textContent.trim()));
    read();
    const observer = new MutationObserver(read);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);
  return filled;
}

export default function BSide({ path }) {
  const context = useRef(null),
    filters = useRef(null),
    bar = useRef(null);
  const hasContext = useFilled(context),
    hasFilters = useFilled(filters),
    hasSummary = useFilled(bar);
  const compareCount = useCompareCount();
  const [chosen, setChosen] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setChosen("");
    setOpen(false);
  }, [path]);
  const available = {
    contexte: hasContext,
    filtres: hasFilters,
    comparer: true,
    suivis: true,
  };
  const fallback = hasContext ? "contexte" : hasFilters ? "filtres" : "comparer";
  const tab = available[chosen] ? chosen : fallback;
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={`b-side-bar${hasSummary ? "" : " is-plain"}`}
        aria-expanded={open}
        aria-controls="b-side"
        onClick={() => setOpen(true)}
      >
        <Activity size={17} strokeWidth={1.7} aria-hidden="true" />
        <span ref={bar} id="side-context-bar" className="b-side-bar-slot" />
        {!hasSummary && <span className="side-bar-label">Contexte</span>}
        {compareCount > 0 && (
          <span className="b-side-count" aria-label={`${compareCount} joueurs à comparer`}>
            {compareCount}
          </span>
        )}
        <ChevronUp size={17} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <div
        className={`b-side-veil${open ? " is-open" : ""}`}
        onPointerDown={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside id="b-side" className={`b-side${open ? " is-open" : ""}`} aria-label="Barre latérale">
        <div className="b-side-tabs" role="tablist">
          {TABS.filter(([key]) => available[key]).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setChosen(key)}
            >
              <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              {key === "comparer" && compareCount > 0 && (
                <span className="b-side-count">{compareCount}</span>
              )}
            </button>
          ))}
          <button type="button" className="b-side-close" aria-label="Fermer" onClick={() => setOpen(false)}>
            <X size={19} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        <div className="b-side-body">
          <div ref={context} id="side-context" hidden={tab !== "contexte"} />
          <div ref={filters} id="filter-side" className="filter-side" hidden={tab !== "filtres"} />
          {tab === "comparer" && <SideCompare />}
          {tab === "suivis" && <SideFollows />}
        </div>
      </aside>
    </>
  );
}

"use client";
/* B (VI-41): the sidebar's Comparer and Suivis tabs, read from the visitor's
 * own research store (the comparison basket and the saved lists). */
import React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { comparisonKey } from "../services/research-storage.js";
import { Block } from "./SideContext.jsx";

const MAX = 4;
const PATH = { players: "/joueurs/", clubs: "/clubs/", matches: "/matchs/" };
const TITLE = { clubs: "Clubs", players: "Joueurs", matches: "Matchs" };

export function useCompareCount() {
  return useResearch()?.data?.comparison?.length || 0;
}

function entryHref(f, entry) {
  return f.href(PATH[entry.kind], {
    id: entry.id,
    season: entry.season || f.season,
    league: "all",
    q: "",
    gmin: "",
    stats: "",
  });
}
function Avatar({ entry }) {
  return entry.imageUrl ? (
    <img src={entry.imageUrl} alt="" loading="lazy" />
  ) : (
    <span className="sx-initials" aria-hidden="true">
      {entry.name
        .split(" ")
        .map((word) => word[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}

export function SideCompare() {
  const r = useResearch(),
    f = useFootball();
  const entries = r?.data?.comparison || [];
  return (
    <div className="side-ctx">
      <Block title="Comparaison" sub={`${entries.length} / ${MAX}`}>
        {entries.map((entry) => (
          <div className="sx-item" key={comparisonKey(entry)}>
            <Avatar entry={entry} />
            <Link href={entryHref(f, entry)}>
              {entry.name}
              <small>{entry.season}</small>
            </Link>
            <button
              type="button"
              className="sx-remove"
              aria-label={`Retirer ${entry.name} de la comparaison`}
              onClick={() => r.toggleComparison(entry)}
            >
              <X size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ))}
        {entries.length < MAX && (
          <p className="sx-empty">Cochez un joueur dans une liste pour l’ajouter.</p>
        )}
      </Block>
      {entries.length >= 2 && (
        <button type="button" className="sx-button" onClick={() => r.setComparing(true)}>
          Comparer {entries.length} joueurs
        </button>
      )}
      {entries.length > 0 && (
        <button
          type="button"
          className="sx-link"
          onClick={() => r.update((previous) => ({ ...previous, comparison: [] }))}
        >
          Vider la comparaison
        </button>
      )}
    </div>
  );
}

export function SideFollows() {
  const r = useResearch(),
    f = useFootball();
  const lists = r?.data?.lists || [];
  const seen = new Set();
  const byKind = { clubs: [], players: [], matches: [] };
  for (const list of lists)
    for (const entry of list.entries || []) {
      const key = `${entry.kind}:${entry.id}`;
      if (seen.has(key) || !byKind[entry.kind]) continue;
      seen.add(key);
      byKind[entry.kind].push(entry);
    }
  const empty = !seen.size;
  return (
    <div className="side-ctx">
      {empty ? (
        <p className="b-side-empty">Enregistrez un club, un joueur ou un match avec le signet pour le retrouver ici.</p>
      ) : (
        Object.entries(byKind)
          .filter(([, entries]) => entries.length)
          .map(([kind, entries]) => (
            <Block key={kind} title={TITLE[kind]} sub={String(entries.length)}>
              {entries.slice(0, 12).map((entry) => (
                <Link className="sx-item" key={entry.id} href={entryHref(f, entry)}>
                  <Avatar entry={entry} />
                  <span>
                    {entry.name}
                    {entry.season && <small>{entry.season}</small>}
                  </span>
                </Link>
              ))}
            </Block>
          ))
      )}
    </div>
  );
}

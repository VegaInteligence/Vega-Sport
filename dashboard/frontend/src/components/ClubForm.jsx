"use client";
import Link from "next/link";
import React, { useMemo } from "react";
import { date } from "../services/format.js";
import { clubForm } from "../services/club-matches.js";

const labels = {
  V: "Victoire",
  N: "Match nul",
  D: "Défaite",
  "?": "Score indisponible",
};
const classes = { V: "win", N: "draw", D: "loss", "?": "unknown" };

export default function ClubForm({ matches, clubId, href }) {
  const form = useMemo(() => clubForm(matches, clubId), [matches, clubId]);
  return (
    <section className="club-form" aria-labelledby="club-form-heading">
      <div className="club-form-copy">
        <h3 id="club-form-heading">Forme récente</h3>
        <p>
          {form.length
            ? `${form.length} dernier${form.length > 1 ? "s" : ""} match${form.length > 1 ? "s" : ""} disponible${form.length > 1 ? "s" : ""} · Plus récent à droite`
            : "Aucun résultat disponible pour cette saison."}
        </p>
      </div>
      {form.length > 0 && (
        <ol
          className="club-form-results"
          aria-label="Résultats récents, du plus ancien au plus récent"
        >
          {form.map(({ match, result }) => {
            const home = match.home?.name || "Domicile";
            const away = match.away?.name || "Extérieur";
            const score =
              Number.isInteger(match.home?.score) &&
              Number.isInteger(match.away?.score)
                ? `${match.home.score} – ${match.away.score}`
                : "score indisponible";
            const label = `${labels[result]} : ${home} ${score} ${away}, ${date(match.date || match.timeUtc)}`;
            return (
              <li key={match.id}>
                <Link
                  className={`club-form-badge club-form-badge--${classes[result]}`}
                  href={href("/matchs/", {
                    tab: "results",
                    id: match.id,
                    competition: match.leagueId || "",
                    sourceSeason: match.season || "",
                  })}
                  aria-label={label}
                  title={label}
                >
                  {result}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

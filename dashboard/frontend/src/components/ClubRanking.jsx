"use client";
import React from "react";
import { Card, AsyncState } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import { number } from "../services/format.js";
import { clubRanking } from "../services/catalog-client.js";
import { editionYear } from "../services/api-routes.js";
import { Term } from "./Hint.jsx";

function editionLabel(edition) {
  const now = new Date();
  const ending = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
  return `${edition.period}${editionYear(edition.edition) === String(ending) ? " · en cours" : ""}`;
}

export default function ClubRanking({ clubId, title = "Classement UEFA", before = null }) {
  const result = useResource(`club-ranking:${clubId}`, () => clubRanking(clubId));
  return (
    <Card fold title={title} className="club-ranking">
      {before}
      <AsyncState resource={result}>
        {(rows) =>
          // A club never ranked (or not matched to the UEFA list) has no table of empty rows.
          rows?.some(({ row }) => row) ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th><Term>Saison</Term></th>
                    <th><Term>Rang européen</Term></th>
                    <th><Term>Coefficient</Term></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ edition, row }) => (
                    <tr key={edition.edition}>
                      <td>{editionLabel(edition)}</td>
                      <td>{row ? number(row.position) : "Non classé"}</td>
                      <td>{number(row?.points, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Ce club n’a pas de classement UEFA.</p>
          )
        }
      </AsyncState>
    </Card>
  );
}

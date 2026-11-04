"use client";
import React from "react";
import { Card, AsyncState } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import { number } from "../services/format.js";
import { clubRanking } from "../services/catalog-client.js";

function editionLabel(edition) {
  const now = new Date();
  const ending = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
  return `${edition.period}${edition.edition === `${ending}.uefa` ? " · en cours" : ""}`;
}

export default function ClubRanking({ clubId }) {
  const result = useResource(`club-ranking:${clubId}`, () => clubRanking(clubId));
  return (
    <Card title="Classement UEFA" className="club-ranking">
      <AsyncState resource={result}>
        {(rows) =>
          rows ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Saison</th>
                    <th>Rang européen</th>
                    <th>Coefficient</th>
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
            <p>Correspondance du club non établie.</p>
          )
        }
      </AsyncState>
    </Card>
  );
}

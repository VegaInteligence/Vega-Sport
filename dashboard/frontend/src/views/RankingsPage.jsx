"use client";
import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, AsyncState, Segments } from "../components/UI.jsx";
import { useResource, json } from "../services/resources.js";
import { number, normalizeText } from "../services/format.js";
export const editionLabel = (e) => {
  const now = new Date(),
    ending = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
  if (e.provider === "SportsAPI")
    return `${e.edition.slice(0, 10)} · instantané SportsAPI`;
  return `${e.period}${e.provider === "UEFA" && e.edition === `${ending}.uefa` ? " · en cours" : ""}`;
};
export function RankingTable({ rows, association = false }) {
  return (
    <div className="table-scroll">
      <table className="data-table ranking-table">
        <thead>
          <tr>
            <th>Rang</th>
            <th>Pays</th>
            <th>{association ? "Coefficient sur cinq saisons" : "Points"}</th>
            <th>Rang précédent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.entityId}:${i}`}>
              <td>{number(r.position)}</td>
              <td>{r.entityName}</td>
              <td>{number(r.points, 3)}</td>
              <td>{number(r.previousPosition)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Edition({ reference, query, kind }) {
  const result = useResource(`ranking:${reference.path}`, () =>
    json("/data/" + reference.path),
  );
  return (
    <AsyncState resource={result}>
      {(value) => (
        <>
          <div className="ranking-source">
            <strong>
              {kind === "fifa-men"
                ? "Classement mondial FIFA masculin"
                : "Coefficients UEFA des associations"}
            </strong>
            <span>
              {reference.provider} · {editionLabel(reference)} ·{" "}
              {value.rows.length} pays
            </span>
          </div>
          <RankingTable
            rows={value.rows
              .filter((r) =>
                normalizeText(r.entityName).includes(normalizeText(query)),
              )
              .sort(
                (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
              )}
            association={kind !== "fifa-men"}
          />
        </>
      )}
    </AsyncState>
  );
}
function Rankings() {
  const [kind, setKind] = useState("fifa-men"),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    index = useResource("rankings-index", () =>
      json("/data/raw/rankings/index.json"),
    );
  return (
    <AsyncState resource={index}>
      {(value) => {
        const editions = value.editions.filter((e) => e.kind === kind),
          reference =
            editions.find((e) => e.edition === selected) ||
            editions.find((e) => e.officialEdition) ||
            editions[0];
        return (
          <Card>
            <div className="rankings-toolbar">
              <Segments
                label="Type de classement"
                value={kind}
                items={[
                  ["fifa-men", "Sélections FIFA"],
                  ["uefa-associations", "Associations UEFA"],
                ]}
                onChange={(v) => {
                  setKind(v);
                  setSelected("");
                  setQuery("");
                }}
              />
              <label>
                Édition
                <select
                  aria-label="Édition du classement"
                  value={reference.edition}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {editions.map((e) => (
                    <option key={e.edition} value={e.edition}>
                      {editionLabel(e)}
                    </option>
                  ))}
                </select>
              </label>
              <input
                aria-label="Rechercher un pays dans le classement"
                placeholder="Rechercher un pays"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Edition reference={reference} query={query} kind={kind} />
          </Card>
        );
      }}
    </AsyncState>
  );
}
export function ClubRanking({ clubId }) {
  const result = useResource(`club-ranking:${clubId}`, async () => {
    const [index, links] = await Promise.all([
      json("/data/raw/rankings/index.json"),
      json("/data/raw/rankings/club-links.json"),
    ]);
    const link = links.links[clubId];
    if (!link) return null;
    return Promise.all(
      index.editions
        .filter((e) => e.kind === "uefa-clubs" && e.provider === "UEFA")
        .map(async (e) => ({
          edition: e,
          row: (await json("/data/" + e.path)).rows.find(
            (r) => r.entityId === link.entityId,
          ),
        })),
    );
  });
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
export default function RankingsPage() {
  return (
    <Layout path="/classements/" title="Classements">
      <Rankings />
    </Layout>
  );
}

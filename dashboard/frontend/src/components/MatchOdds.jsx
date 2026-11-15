"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { oddsText, share, useMatchOdds } from "../services/forecasts.js";

/**
 * A coming match's odds: each licensed bookmaker's full-time result prices (1 · N · 2), the
 * best of each, and Vega's own forecast as fair odds (1 / chance) beside the market's chances.
 * French law asks every page that shows gambling operators' offers to carry the prevention
 * message below.
 */
export default function MatchOdds({ match }) {
  const odds = useMatchOdds(match?.id);
  if (!odds?.bookmakers?.length) return null;
  const sides = ["home", "draw", "away"];
  const label = { home: "1", draw: "N", away: "2" };
  return (
    <Card title="Cotes" text="Résultat final · bookmakers agréés en France">
      <div className="table-scroll">
        <table className="data-table match-odds-table">
          <thead>
            <tr>
              <th scope="col">Opérateur</th>
              {sides.map((side) => (
                <th key={side} scope="col">
                  {label[side]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {odds.bookmakers.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.name}</th>
                {sides.map((side) => (
                  <td key={side} data-best={b[side] === odds.best[side] || undefined} title={`À l’ouverture : ${oddsText(b.opening[side])}`}>
                    {oddsText(b[side])}
                  </td>
                ))}
              </tr>
            ))}
            {odds.vega && (
              <tr className="match-odds-vega">
                <th scope="row" title="Les cotes justes du pronostic Vega : 1 ÷ sa probabilité, sans marge">
                  Vega (cote juste)
                </th>
                {sides.map((side) => (
                  <td key={side} title={`Vega ${share(odds.vega[side])} · marché ${share(odds.market[side])}`}>
                    {oddsText(odds.vega.fair[side])}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="match-forecast-note">
        Probabilités du marché, marge des opérateurs retirée : {share(odds.market.home)} · {share(odds.market.draw)} ·{" "}
        {share(odds.market.away)}. En gras, la meilleure cote de chaque issue.
      </p>
      <p className="match-odds-warning">
        Jouer comporte des risques : endettement, isolement, dépendance. Pour être aidé, appelez le 09 74 75 13 13
        (appel non surtaxé). Interdit aux moins de 18 ans.
      </p>
    </Card>
  );
}

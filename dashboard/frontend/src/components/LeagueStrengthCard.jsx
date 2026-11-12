"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { number } from "../services/format.js";

const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);
const signed = (value) => {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : "=";
};

/** A league's level on the scale common to the leagues, with its last seasons and its neighbours. */
export default function LeagueStrengthCard({ strength }) {
  if (!strength) return null;
  return (
    <Card title="Niveau du championnat" className="competition-highlights-card competition-level">
      {strength.onScale ? (
        <>
          <p className="competition-level-value">
            <strong>{number(Math.round(strength.level))}</strong>
            <span>
              {ordinal(strength.rank)} sur {number(strength.of)} championnats
            </span>
          </p>
          {strength.history.length > 0 && (
            <ul className="competition-level-rows" aria-label="Niveau par saison">
              {strength.history.map((row) => (
                <li key={row.season}>
                  <span>{row.season}</span>
                  <span>
                    {number(Math.round(row.level))}
                    {row.change !== null && <small>{signed(row.change)}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(strength.above || strength.below) && (
            <ul className="competition-level-rows competition-level-neighbours" aria-label="Championnats voisins">
              {strength.above && (
                <li>
                  <span>Devant : {strength.above.name}</span>
                  <span>{number(Math.round(strength.above.level))}</span>
                </li>
              )}
              {strength.below && (
                <li>
                  <span>Derrière : {strength.below.name}</span>
                  <span>{number(Math.round(strength.below.level))}</span>
                </li>
              )}
            </ul>
          )}
          <p className="competition-highlights-caption">
            Force moyenne de ses clubs, sur une échelle commune aux championnats.
          </p>
        </>
      ) : (
        <p className="competition-highlights-empty">
          Ses clubs ont joué trop peu de matchs contre ceux des autres championnats pour le situer sur
          l’échelle commune.
        </p>
      )}
    </Card>
  );
}

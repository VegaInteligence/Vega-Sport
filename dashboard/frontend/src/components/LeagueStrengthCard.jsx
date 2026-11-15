"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { number } from "../services/format.js";
import { COUNTRY_NAMES } from "../services/competition-selector.js";

const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);
const signed = (value) => {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : "=";
};

// Two leagues may share a name (Serie A in Italy and in Brazil): a neighbour is named with its country.
const named = (league) => {
  const country = COUNTRY_NAMES[league.country] || "";
  return country ? `${league.name} (${country})` : league.name;
};

/** A league's level on the scale common to the leagues, with its last seasons and its neighbours. */
export default function LeagueStrengthCard({ strength }) {
  if (!strength) return null;
  return (
    <Card title="Niveau du championnat" className="competition-highlights-card competition-level">
      {strength.onScale ? (
        <>
          <p className="competition-level-value">
            <strong>{strength.score != null ? number(Math.round(strength.score)) : number(Math.round(strength.level))}</strong>
            <span>
              {strength.score != null && <>sur 100 · niveau {number(Math.round(strength.level))} · </>}
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
                  <span>Devant : {named(strength.above)}</span>
                  <span>{number(Math.round(strength.above.level))}</span>
                </li>
              )}
              {strength.below && (
                <li>
                  <span>Derrière : {named(strength.below)}</span>
                  <span>{number(Math.round(strength.below.level))}</span>
                </li>
              )}
            </ul>
          )}
          <p className="competition-highlights-caption">
            Force moyenne de ses clubs, sur une échelle commune aux championnats
            {strength.score != null ? " ; sur 100, la chance d’un de ses clubs de battre un club moyen des premières divisions mesurées" : ""}.
          </p>
          {strength.evidence && (strength.evidence.matches > 0 || strength.evidence.movers > 0) && (
            <p className="competition-highlights-caption">
              Mesuré sur {number(strength.evidence.matches || 0)} matchs contre d’autres championnats
              {strength.evidence.movers > 0 ? ` et ${number(strength.evidence.movers)} joueurs venus d’autres championnats ou partis vers eux` : ""}
              {strength.margin != null && !strength.provisional ? `, à ± ${number(strength.margin)} points près` : ""}.
            </p>
          )}
          {strength.provisional && (
            <p className="competition-highlights-caption">
              Niveau provisoire{strength.margin != null ? `, à ± ${number(strength.margin)} points près` : ""} : ses clubs ont joué
              peu de matchs contre ceux des autres championnats, il tient aussi compte des joueurs venus d’autres championnats ou
              partis vers eux et de sa division.
            </p>
          )}
        </>
      ) : (
        <p className="competition-highlights-empty">
          {strength.women
            ? "Championnat féminin : ses clubs ne rencontrent pas ceux des autres championnats, son niveau ne se compare pas au leur."
            : "Ses clubs ont joué trop peu de matchs contre ceux des autres championnats pour le situer sur l’échelle commune."}
        </p>
      )}
    </Card>
  );
}

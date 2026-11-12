"use client";
import React from "react";
import { changeFacts, substituteLine, useClubSubstitutions } from "../services/club-substitutions.js";
import { Card } from "./ClubScoutUI.jsx";
import s from "./ClubScout.module.css";

/** What followed the club's first change of each match, and its most decisive substitutes. */
export default function ClubSubstitutions({ id, season }) {
  const impact = useClubSubstitutions(season, id);
  const facts = changeFacts(impact);
  if (!facts) return null;
  return (
    <Card
      title="Après les changements"
      text="Toutes compétitions : le score au premier remplacement du club, puis le résultat du match."
    >
      <div className={s.stack}>
        <dl className={s.facts}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                {fact.value} {fact.unit && <small>{fact.unit}</small>}
              </dd>
              <small>{fact.note}</small>
            </div>
          ))}
        </dl>
        <p className={s.note}>
          {impact.minute != null && `Premier changement à la ${impact.minute}e minute en moyenne. `}
          {impact.substitutes?.length > 0 &&
            `Remplaçants décisifs : ${impact.substitutes.map(substituteLine).join(" · ")}. `}
          Ce qui suit un changement ne lui est pas forcément dû.
        </p>
      </div>
    </Card>
  );
}

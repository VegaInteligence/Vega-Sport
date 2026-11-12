"use client";
import React from "react";
import { number } from "../services/format.js";
import { passingFacts, useClubPassing } from "../services/club-passing.js";
import { Card } from "./ClubScoutUI.jsx";
import s from "./ClubScout.module.css";

/** The players a club's passing runs through the most. */
export default function ClubPassingTriangle({ id, season }) {
  const facts = passingFacts(useClubPassing(season, id));
  if (!facts) return null;
  return (
    <Card
      title="Circuits de passes"
      text="Passes échangées dans les réseaux de passes de la saison, relevés jusqu’au premier changement de chaque match."
    >
      <dl className={s.facts}>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {number(fact.passes)} <small>passes</small>
            </dd>
            <small>{fact.players}</small>
          </div>
        ))}
      </dl>
    </Card>
  );
}

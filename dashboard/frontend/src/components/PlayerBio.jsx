import React from "react";
import { playerBio } from "../services/player-bio.js";

export default function PlayerBio({ profile }) {
  const fields = playerBio(profile);
  if (!fields.length) return null;
  return (
    <dl className="player-bio-inline" aria-label="Identité du joueur">
      {fields.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

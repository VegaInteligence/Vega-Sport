"use client";
import React, { useId } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { partnerRows, usePassPartners } from "../services/pass-partners.js";
import { Media } from "./UI.jsx";
import s from "./PlayerScout.module.css";

/** The team-mates a player exchanged the most passes with over the season. */
export default function PlayerPassPartners({ id }) {
  const f = useFootball();
  const heading = useId();
  const rows = partnerRows(usePassPartners(f.season, id));
  if (!rows.length) return null;
  return (
    <section className={s.card} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Partenaires de passe</h3>
          <p>Passes échangées dans les réseaux de passes, relevés jusqu’au premier changement de chaque match</p>
        </div>
      </div>
      <ol className={s.partners}>
        {rows.map((partner) => (
          <li key={partner.id}>
            <Link href={f.href("/joueurs/", { id: partner.id, season: f.season, league: "", q: "" })}>
              <Media name={partner.name} url={partner.image_url} className="player-avatar" />
              <span>
                <strong>{partner.name}</strong>
                <small>
                  {number(partner.given)} données · {number(partner.received)} reçues · {number(partner.matches)}{" "}
                  {partner.matches === 1 ? "match" : "matchs"}
                </small>
              </span>
              <b>{number(partner.passes)}</b>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

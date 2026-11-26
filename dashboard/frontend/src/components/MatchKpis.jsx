"use client";
/* The match header's figures: xG, shots, shots on target, possession and the cards (Discipline),
 * each with its detail on hover or touch (by half, who shot, what became of the shots, the
 * passes, every card with its minute and player). */
import React from "react";
import HoverCard from "./HoverCard.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { overviewStats, statValue } from "../services/match-data.js";
import { cardCount, cardsOf, shootersOf, teamStatsByPeriod } from "../services/match-tabs.js";
import { explain } from "../services/glossary.js";
import { number } from "../services/format.js";
import s from "./MatchTabs.module.css";

const HALVES = [["FirstHalf", "1re mi-temps"], ["SecondHalf", "2e mi-temps"]];

function Row({ label, home, away }) {
  return (
    <div className={s.bubbleRow}>
      <span>{label}</span>
      <b className={s.homeText}>{home}</b>
      <b className={s.awayText}>{away}</b>
    </div>
  );
}

const val = (value, digits = 0, unit = "") => (value == null ? "—" : `${number(value, digits)}${unit}`);

function ByHalf({ periods, statKey, digits = 0, unit = "" }) {
  if (!periods.FirstHalf?.[statKey]) return null;
  return HALVES.map(([key, label]) => (
    <Row key={key} label={label} home={val(periods[key]?.[statKey]?.home, digits, unit)} away={val(periods[key]?.[statKey]?.away, digits, unit)} />
  ));
}

function Shooters({ match, by }) {
  const rows = [match.home, match.away].flatMap((team, i) =>
    shootersOf(match.shots, team.id, 2).map((r) => ({ ...r, side: i ? "away" : "home" })),
  );
  if (!rows.length) return null;
  return (
    <>
      <p className={s.bubbleTitle}>{by === "xg" ? "Les occasions les plus nettes" : "Qui a tiré"}</p>
      {rows.map((r) => (
        <div className={s.bubbleLine} key={`${r.side}:${r.id || r.name}`}>
          <span>{r.name}</span>
          <b className={r.side === "home" ? s.homeText : s.awayText}>
            {by === "xg" ? `${number(r.xg, 2)} xG` : `${r.shots} tir${r.shots > 1 ? "s" : ""}`}
          </b>
          <small>{r.goals ? `${r.goals} but${r.goals > 1 ? "s" : ""}` : ""}</small>
        </div>
      ))}
    </>
  );
}

function Detail({ statKey, label, match, periods, cards }) {
  const all = periods.All || {};
  const pair = (key, digits = 0, unit = "") => [val(all[key]?.home, digits, unit), val(all[key]?.away, digits, unit)];
  const blocks = {
    expected_goals: (
      <>
        <ByHalf periods={periods} statKey="expected_goals" digits={2} />
        <Shooters match={match} by="xg" />
      </>
    ),
    total_shots: (
      <>
        {all.shots_inside_box && <Row label="Dans la surface" home={pair("shots_inside_box")[0]} away={pair("shots_inside_box")[1]} />}
        {all.shots_outside_box && <Row label="Hors surface" home={pair("shots_outside_box")[0]} away={pair("shots_outside_box")[1]} />}
        <ByHalf periods={periods} statKey="total_shots" />
        <Shooters match={match} by="shots" />
      </>
    ),
    ShotsOnTarget: (
      <>
        {[["Cadrés", "ShotsOnTarget"], ["Non cadrés", "ShotsOffTarget"], ["Contrés", "blocked_shots"], ["Poteaux", "shots_woodwork"], ["Arrêts du gardien", "keeper_saves"]]
          .filter(([, key]) => all[key])
          .map(([text, key]) => <Row key={key} label={text} home={pair(key)[0]} away={pair(key)[1]} />)}
      </>
    ),
    BallPossesion: (
      <>
        <ByHalf periods={periods} statKey="BallPossesion" unit=" %" />
        {all.passes && <Row label="Passes" home={pair("passes")[0]} away={pair("passes")[1]} />}
        {all.accurate_passes && <Row label="Passes réussies" home={pair("accurate_passes")[0]} away={pair("accurate_passes")[1]} />}
        {all.opposition_half_passes && <Row label="Dans le camp adverse" home={pair("opposition_half_passes")[0]} away={pair("opposition_half_passes")[1]} />}
      </>
    ),
    discipline: (
      <>
        {cards.length ? (
          cards.map((card, i) => (
            <div className={s.bubbleCard} key={i}>
              <span>{card.minute}′</span>
              <i className={`${s.cardIcon} ${card.kind === "yellow" ? s.yellow : s.red}`} aria-label={card.kind === "yellow" ? "Carton jaune" : card.kind === "second" ? "Deuxième jaune" : "Carton rouge"} />
              <span>{card.player?.name || "—"}</span>
              <small className={card.side === "home" ? s.homeText : s.awayText}>{card.side === "home" ? match.home.name : match.away.name}</small>
            </div>
          ))
        ) : (
          <p className={s.bubbleNote}>Aucun carton.</p>
        )}
        {all.fouls && <Row label="Fautes commises" home={pair("fouls")[0]} away={pair("fouls")[1]} />}
        {all.Offsides && <Row label="Hors-jeu" home={pair("Offsides")[0]} away={pair("Offsides")[1]} />}
      </>
    ),
  };
  const body = blocks[statKey] ?? <ByHalf periods={periods} statKey={statKey} />;
  return (
    <>
      <p className={s.bubbleHead}>{label}</p>
      {explain(label) && <p className={s.bubbleNote}>{explain(label)}</p>}
      <div className={s.bubbleTeams}>
        <span className={s.homeText}>{match.home.name}</span>
        <span className={s.awayText}>{match.away.name}</span>
      </div>
      {body}
    </>
  );
}

function Cards({ count }) {
  return (
    <span className={s.cardCount}>
      <i className={`${s.cardIcon} ${s.yellow}`} aria-hidden="true" />
      {count.yellow}
      {count.red > 0 && (
        <>
          <i className={`${s.cardIcon} ${s.red}`} aria-hidden="true" />
          {count.red}
        </>
      )}
    </span>
  );
}

export default function MatchKpis({ match }) {
  const stats = useMatchSection(match, "stats");
  const events = useMatchSection(match, "events");
  const periods = teamStatsByPeriod(stats.data);
  const cards = cardsOf(events.data?.events, match);
  const count = cardCount(cards);
  const base = overviewStats(match).slice(0, 4);
  const discipline = Boolean(events.data);
  return (
    <div className={`match-kpis${discipline ? ` ${s.fiveKpis}` : ""}`}>
      {base.map((stat) => (
        <HoverCard
          key={stat.key}
          className={s.kpi}
          fit
          label={`${stat.label} : détail`}
          content={<Detail statKey={stat.key} label={stat.label} match={match} periods={periods} cards={cards} />}
        >
          <span>{stat.label}</span>
          <strong>
            <b className={s.homeText}>{statValue(stat, "home")}</b>
            <i>–</i>
            <b className={s.awayText}>{statValue(stat, "away")}</b>
          </strong>
        </HoverCard>
      ))}
      {discipline && (
        <HoverCard
          className={s.kpi}
          fit
          label="Discipline : détail"
          content={<Detail statKey="discipline" label="Discipline" match={match} periods={periods} cards={cards} />}
        >
          <span>Discipline</span>
          <strong>
            <b className={s.homeText}>
              <Cards count={count.home} />
            </b>
            <i>–</i>
            <b className={s.awayText}>
              <Cards count={count.away} />
            </b>
          </strong>
        </HoverCard>
      )}
    </div>
  );
}

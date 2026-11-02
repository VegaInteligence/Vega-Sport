"use client";
import React, { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { AsyncState, Card, Empty, Segments } from "./UI.jsx";
import Icon from "./Icon.jsx";
import { Events, eventKind } from "./MatchSections.jsx";
import { number } from "../services/format.js";

const KINDS = {
  all: null,
  goals: ["goal", "owngoal"],
  cards: ["yellowcard", "secondyellow", "redcard"],
  substitutions: ["substitution"],
};

const ORDER = { yellowcard: 0, secondyellow: 0, redcard: 2 };
function GoalList({ match }) {
  const f = useFootball();
  const goals = (match.shots || [])
    .filter((s) => s.isGoal || s.isOwnGoal)
    .sort((a, b) => (a.minute ?? Infinity) - (b.minute ?? Infinity));
  if (!goals.length)
    return <Empty>Aucun but renseigné dans les tirs collectés.</Empty>;
  return (
    <ol className="match-goals">
      {goals.map((s, i) => (
        <li key={s.id || i}>
          <span className="goal-minute">{number(s.minute)}′</span>
          <span className="goal-ball">
            <Icon name="ball" />
          </span>
          <button
            onClick={() =>
              s.playerId && f.setPlayer(`${match.id}:${s.playerId}`)
            }
            disabled={!s.playerId}
          >
            <strong>
              {s.playerName || "Joueur non renseigné"}
              {s.isOwnGoal ? " · CSC" : ""}
            </strong>
            <span>
              {[match.home, match.away].find((t) => t.id === s.teamId)?.name ||
                "Équipe non renseignée"}
            </span>
          </button>
          <Icon name="goal" />
        </li>
      ))}
    </ol>
  );
}

function Timeline({ match, payload }) {
  const [kind, setKind] = useState("all"),
    [team, setTeam] = useState("all");
  const events = useMemo(
    () =>
      (payload?.events || [])
        .map((event, i) => ({ ...event, ordinal: i }))
        .sort(
          (a, b) =>
            (a.minute ?? Infinity) - (b.minute ?? Infinity) ||
            (a.minute_added || 0) - (b.minute_added || 0) ||
            // A second yellow is listed before the red card it causes.
            (ORDER[eventKind(a)] ?? 1) - (ORDER[eventKind(b)] ?? 1) ||
            a.ordinal - b.ordinal,
        ),
    [payload],
  );
  const teamOf = (e) => e.team?.id || e.team_id;
  const tally = (kinds, side) =>
    events.filter((e) => kinds.includes(eventKind(e)) && teamOf(e) === side)
      .length;
  const filtered = events.filter(
    (e) =>
      (!KINDS[kind] || KINDS[kind].includes(eventKind(e))) &&
      (team === "all" || teamOf(e) === team),
  );
  if (!events.length) return <Empty>Aucun événement renseigné.</Empty>;
  return (
    <>
      <dl className="match-event-summary">
        {[
          ["Cartons jaunes", KINDS.cards.slice(0, 2)],
          ["Cartons rouges", ["redcard"]],
          ["Remplacements", KINDS.substitutions],
        ].map(([label, kinds]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <b className="home-number">{tally(kinds, match.home.id)}</b>
              <i>–</i>
              <b className="away-number">{tally(kinds, match.away.id)}</b>
            </dd>
          </div>
        ))}
      </dl>
      <div className="match-event-filters">
        <Segments
          label="Types d’événements"
          value={kind}
          onChange={setKind}
          items={[
            ["all", "Tout"],
            ["goals", "Buts"],
            ["cards", "Cartons"],
            ["substitutions", "Remplacements"],
          ]}
        />
        <Segments
          label="Équipe des événements"
          value={team}
          onChange={setTeam}
          items={[
            ["all", "Les deux"],
            [match.home.id, match.home.name],
            [match.away.id, match.away.name],
          ]}
        />
      </div>
      {filtered.length ? (
        <Events payload={{ events: filtered }} match={match} />
      ) : (
        <Empty>Aucun événement pour ce filtre.</Empty>
      )}
    </>
  );
}

/** Goals from the collected shots; the full timeline loads on request. */
export default function MatchEventHighlights({ match }) {
  const f = useFootball(),
    [view, setView] = useState("goals");
  const resource = useResource(
    `match-events:${f.client.id}:${match.id}`,
    async () => {
      await f.client.ensureEndpoint(
        match,
        "events",
        Boolean(f.client.payloads.get(`${match.id}:events`)?.error),
      );
      const value = f.client.payloads.get(`${match.id}:events`);
      if (value?.error) throw new Error(value.error);
      return value?.data;
    },
    view === "timeline" && f.statusKnown,
  );
  return (
    <Card
      title="Temps forts"
      className="match-goals-card"
      action={
        <Segments
          label="Temps forts du match"
          value={view}
          onChange={setView}
          items={[
            ["goals", "Buts"],
            ["timeline", "Chronologie"],
          ]}
        />
      }
    >
      {view === "goals" ? (
        <GoalList match={match} />
      ) : (
        <AsyncState resource={resource}>
          {(payload) => <Timeline match={match} payload={payload} />}
        </AsyncState>
      )}
    </Card>
  );
}

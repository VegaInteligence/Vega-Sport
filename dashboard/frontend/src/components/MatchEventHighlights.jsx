"use client";
import React, { useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { Card, AsyncState, Empty } from "./UI.jsx";
import { Events } from "./MatchSections.jsx";
import { number } from "../services/format.js";
const names = {
  Goal: "Buts",
  Substitution: "Remplacements",
  YellowCard: "Cartons jaunes",
  RedCard: "Cartons rouges",
  Var: "VAR",
};
export default function MatchEventHighlights({ match }) {
  const f = useFootball(),
    [open, setOpen] = useState(false),
    [type, setType] = useState("all"),
    [team, setTeam] = useState("all");
  const resource = useResource(
    `match-events:${f.client.id}:${match.id}`,
    async () => {
      await f.client.ensureEndpoint(
        match,
        "events",
        Boolean(f.client.payloads.get(`${match.id}:events`)?.error),
      );
      const value = f.client.payloads.get(`${match.id}:events`);
      if (value.error) throw new Error(value.error);
      return value.data;
    },
    open && f.statusKnown,
  );
  const goals = (match.shots || []).filter((shot) => shot.isGoal);
  return (
    <Card
      title="Temps forts"
      action={
        <button
          className="inline-link"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Réduire" : "Chronologie complète"}
        </button>
      }
    >
      {!open ? (
        goals.length ? (
          <ol className="research-goal-list">
            {goals.map((shot, i) => (
              <li key={shot.id || i}>
                <strong>{number(shot.minute)}′</strong>
                <span>
                  {shot.playerName || "Buteur non renseigné"}
                  {shot.isOwnGoal ? " · CSC" : ""}
                  <small>
                    {shot.teamId === match.home.id
                      ? match.home.name
                      : shot.teamId === match.away.id
                        ? match.away.name
                        : ""}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Aucun but dans les tirs collectés.</Empty>
        )
      ) : (
        <AsyncState resource={resource}>
          {(payload) => {
            const events = (payload?.events || [])
              .map((event, i) => ({ ...event, ordinal: i }))
              .sort(
                (a, b) =>
                  (a.minute ?? Infinity) - (b.minute ?? Infinity) ||
                  (a.minute_added || 0) - (b.minute_added || 0) ||
                  a.ordinal - b.ordinal,
              );
            const filtered = events.filter(
              (e) =>
                (type === "all" || e.event_type === type) &&
                (team === "all" || e.team?.id === team || e.team_id === team),
            );
            return (
              <>
                <div className="research-toolbar">
                  <label>
                    Événements
                    <select
                      aria-label="Types d’événements"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      <option value="all">Tous</option>
                      {[
                        ...new Set(
                          events.map((e) => e.event_type).filter(Boolean),
                        ),
                      ].map((key) => (
                        <option key={key} value={key}>
                          {names[key] || key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Équipe
                    <select
                      aria-label="Équipe des événements"
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                    >
                      <option value="all">Les deux équipes</option>
                      <option value={match.home.id}>{match.home.name}</option>
                      <option value={match.away.id}>{match.away.name}</option>
                    </select>
                  </label>
                  <span>{filtered.length} événements</span>
                </div>
                <Events payload={{ events: filtered }} />
              </>
            );
          }}
        </AsyncState>
      )}
    </Card>
  );
}

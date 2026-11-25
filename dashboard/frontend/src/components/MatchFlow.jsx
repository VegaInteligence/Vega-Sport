"use client";
/* The Résumé's « Le match minute par minute » (issue #221, FAILURE_MODES § 62): one card, three views
 * of the same minutes, each offered only when it has data and the first offered selected: the chances
 * of each result (the in-play forecast), the cumulative xG (the summary's shots) and who dominated (the
 * momentum family). No card when none has data. */
import React, { useState } from "react";
import { Card, Segments } from "./UI.jsx";
import { XgTimeline } from "./Charts.jsx";
import MatchWinProbability from "./MatchWinProbability.jsx";
import MatchMomentum from "./MatchMomentum.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import { probabilityLines, useMatchWinProbability, withLive } from "../services/forecasts.js";
import { momentumPanels } from "../services/match-momentum.js";
import { isNumber } from "../services/format.js";

export const FLOW_VIEWS = [
  ["probability", "Probabilité de victoire"],
  ["xg", "xG cumulés"],
  ["momentum", "Domination"],
];

/** Whether the summary's shots draw a cumulative xG: at least one shot with a minute and an xG. */
export const hasXgLine = (match) =>
  match?.coverage?.shots !== false &&
  (match?.shots || []).some((s) => isNumber(s.xg) && isNumber(s.minute) && !s.isOwnGoal);

/** `live`: the feed's state while it runs the match (drawn by the probability view). */
export default function MatchFlow({ match, live = null, extraTime = false }) {
  const f = useFootball();
  const answer = useMatchWinProbability(match.id);
  const momentum = useMatchSection(match, "momentum");
  const events = useMatchSection(match, "events");
  const [choice, setChoice] = useState(null);
  const has = {
    probability: Boolean(probabilityLines(withLive(answer, live, match))),
    xg: hasXgLine(match),
    momentum: Boolean(momentumPanels(momentum.data?.points, events.data?.events, { homeId: match.home.id })),
  };
  const offered = FLOW_VIEWS.filter(([key]) => has[key]);
  if (!offered.length) return null;
  const view = offered.some(([key]) => key === choice) ? choice : offered[0][0];
  return (
    <Card
      title="Le match minute par minute"
      className="match-overview-wide match-flow-card"
      action={
        offered.length > 1 && (
          <Segments label="Vue du graphique" value={view} onChange={setChoice} items={offered} />
        )
      }
    >
      {view === "probability" && <MatchWinProbability match={match} live={live} bare />}
      {view === "xg" && (
        <XgTimeline match={match} onPlayer={f.setPlayer} maxHeight={290} extraTime={extraTime} />
      )}
      {view === "momentum" && (
        <MatchMomentum match={match} points={momentum.data?.points} events={events.data?.events} bare />
      )}
    </Card>
  );
}

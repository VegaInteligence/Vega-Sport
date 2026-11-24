"use client";
// The one place where the stores meet the account sync (#69, user-preferences.js). Renders nothing. Without an
// adapter (setPreferencesSync, VI-38) every call here is a no-op: no read, no timer, no request.
import { useEffect, useRef } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  connectPreferences,
  fromContract,
  preferencesChanged,
  toContract,
} from "../services/user-preferences.js";
import {
  applyTheme,
  readPreferredCompetition,
  readTheme,
  writePreferredCompetition,
} from "../services/local-preferences.js";

export default function PreferencesSync() {
  const f = useFootball();
  const research = useResearch();
  const ready = Boolean(f?.preferencesReady && research?.ready);
  const latest = useRef(null);
  latest.current = { f, research };

  useEffect(() => {
    if (!ready) return undefined;
    return connectPreferences({
      read: () =>
        toContract({
          preferences: latest.current.f.preferences,
          research: latest.current.research.data,
          theme: readTheme(),
          competition: readPreferredCompetition(),
        }),
      // The account's contract, through the existing setters.
      write: (contract) => {
        const next = fromContract(contract);
        latest.current.f.savePreferences(next.preferences);
        latest.current.research.update(() => next.research);
        if (next.theme !== readTheme()) applyTheme(next.theme);
        writePreferredCompetition(next.competition);
      },
    });
  }, [ready]);

  useEffect(() => {
    if (ready) preferencesChanged();
  }, [ready, f?.preferences, research?.data]);

  return null;
}

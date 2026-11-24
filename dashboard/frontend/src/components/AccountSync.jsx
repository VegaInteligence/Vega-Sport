"use client";
// The account's side of the preferences sync (VI-38), beside PreferencesSync in the data providers. Renders
// nothing. It reads the session after hydration and, once both stores are loaded, gives account-state.js the
// browser's contract (the same reading as PreferencesSync), which the first-sign-in merge needs.
import { useEffect, useRef } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { accountsOn, accountSyncOn } from "../services/account-switch.js";
import { provideLocalPreferences, refreshSession } from "../services/account-state.js";
import { readPreferredCompetition, readTheme } from "../services/local-preferences.js";
import { toContract } from "../services/user-preferences.js";

export default function AccountSync() {
  const f = useFootball();
  const research = useResearch();
  const ready = Boolean(f?.preferencesReady && research?.ready);
  const latest = useRef(null);
  latest.current = { f, research };

  useEffect(() => {
    if (accountsOn()) refreshSession();
  }, []);

  useEffect(() => {
    if (!ready || !accountSyncOn()) return undefined;
    return provideLocalPreferences(() =>
      toContract({
        preferences: latest.current.f.preferences,
        research: latest.current.research.data,
        theme: readTheme(),
        competition: readPreferredCompetition(),
      }),
    );
  }, [ready]);

  return null;
}

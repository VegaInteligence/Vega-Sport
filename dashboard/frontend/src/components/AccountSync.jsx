"use client";
// The account's side of the preferences sync (VI-38), beside PreferencesSync in the data providers. Renders
// nothing. It reads the session after hydration and, once both stores are loaded (PreferencesSync, mounted just
// before, has then connected them), gives account-state.js the reader of the browser's contract, which the
// first-sign-in merge needs: currentContract, the same reading as the sync's.
import { useEffect } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { accountsOn, accountSyncOn } from "../services/account-switch.js";
import { provideLocalPreferences, refreshSession } from "../services/account-state.js";
import { currentContract } from "../services/user-preferences.js";

export default function AccountSync() {
  const f = useFootball();
  const research = useResearch();
  const ready = Boolean(f?.preferencesReady && research?.ready);

  useEffect(() => {
    if (accountsOn()) refreshSession();
  }, []);

  useEffect(() => {
    if (!ready || !accountSyncOn()) return undefined;
    return provideLocalPreferences(currentContract);
  }, [ready]);

  return null;
}

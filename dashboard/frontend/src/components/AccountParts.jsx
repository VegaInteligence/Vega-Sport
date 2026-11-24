"use client";
// /compte (VI-38): what both mock-up directions share (AccountLetter « Lettre », AccountDiptych « Diptyque »): the
// page's state and actions (useAccountPage), and the controls that are the same in both: the theme, the country, the
// competitions' picker, the password, the export and the deletion. Each direction lays them out its own way.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HomeCountryMenu from "./HomeCountryMenu.jsx";
import HomePreferences from "./HomePreferences.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import { accountSyncOn } from "../services/account-switch.js";
import { authClient } from "../services/auth-client.js";
import { eraseAccount, exportAccount, signOut } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";
import { authErrorMessage, deletionMessage, planLabel, syncLabel } from "../services/account-messages.js";
import { accountSummary } from "../services/account-summary.js";
import { menuCountries } from "../services/home-country.js";
import { applyTheme, THEME_EVENT } from "../services/local-preferences.js";
import { currentContract, preferencesChanged } from "../services/user-preferences.js";
import { orderedCompetitions } from "../services/competition-selector.js";

export const CONFIRM = "SUPPRIMER";
export const PAGES = { clubs: "/clubs/", nations: "/nations/", players: "/joueurs/" };
/** The page's three parts: their anchors (the header menu's « Paramètres » is #parametres). */
export const SECTIONS = [
  ["favoris", "Favoris"],
  ["parametres", "Paramètres"],
  ["securite", "Sécurité"],
];
const GROUPS = [
  ["clubs", "Clubs"],
  ["players", "Joueurs"],
  ["nations", "Nations"],
];
/** Favourites shown per kind before « Afficher les N autres ». */
const PER_GROUP = 6;
/** Sync states that need no word on the page: it works, or is about to. */
const QUIET = new Set(["idle", "syncing", "synced"]);

function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vega-account-export.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The theme shown, followed when the header's toggle or the account's contract changes it. */
function useTheme() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const follow = (event) => setTheme(event.detail === "light" ? "light" : "dark");
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  const choose = (next) => {
    applyTheme(next);
    preferencesChanged();
  };
  return [theme, choose];
}

/**
 * Whether the account signs in with a password: Better Auth's list-accounts (through /api/auth) holds a "credential"
 * account. null while unknown or out of reach: the password action then stays hidden (a Google-only account has none).
 */
function usePassword(ready) {
  const [has, setHas] = useState(null);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    (async () => {
      try {
        const client = await authClient();
        const { data } = (await client?.listAccounts()) ?? {};
        if (live && Array.isArray(data)) setHas(data.some((account) => account?.providerId === "credential"));
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, [ready]);
  return has;
}

/** The competitions the home page follows (the picker's choice), with their names and logos from the manifest. */
function useCompetitions(f) {
  return useMemo(() => {
    const byId = new Map();
    for (const season of f.manifest?.seasons || [])
      for (const chunk of season.chunks || [])
        for (const competition of chunk.competitions || []) if (!byId.has(competition.id)) byId.set(competition.id, competition);
    if (!byId.size) for (const competition of f.competitions || []) byId.set(competition.id, competition);
    const ordered = orderedCompetitions([...byId.values()]);
    const chosen = new Set(f.preferences.favoriteLeagueIds || []);
    return ordered.filter((competition) => chosen.has(competition.id));
  }, [f.manifest, f.competitions, f.preferences.favoriteLeagueIds]);
}

/** Everything /compte reads and does, for either direction. */
export function useAccountPage() {
  const account = useAccount();
  const router = useRouter();
  const f = useFootball();
  const sync = accountSyncOn();
  const [leaving, setLeaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [theme, chooseTheme] = useTheme();
  // The browser's contract, read again each time the sync reports (a save, a load) or a setting changes here.
  const [contract, setContract] = useState(null);
  useEffect(() => {
    setContract(currentContract());
    const timer = window.setTimeout(() => setContract(currentContract()), 1200);
    return () => window.clearTimeout(timer);
  }, [account.status, account.sync, f.preferences]);
  // Every favourite, grouped by kind; a long group shows its first PER_GROUP until asked for the rest.
  const [opened, setOpened] = useState(() => new Set());
  const summary = useMemo(() => accountSummary(contract, { shown: Infinity }), [contract]);
  const groups = useMemo(
    () =>
      GROUPS.map(([kind, label]) => {
        const every = summary.favourites.filter((entry) => entry.kind === kind);
        const entries = opened.has(kind) ? every : every.slice(0, PER_GROUP);
        return { kind, label, entries, more: every.length - entries.length };
      }).filter((group) => group.entries.length),
    [summary.favourites, opened],
  );
  const competitions = useCompetitions(f);

  // Signed out on arrival: to /connexion and back. Signed out from here (this page or the header's menu): home.
  const seen = useRef(false);
  useEffect(() => {
    if (account.status === "signed-in") seen.current = true;
    if (account.status === "signed-out" && !leaving) router.replace(seen.current ? "/" : signInHref(ACCOUNT_PATH));
  }, [account.status, leaving, router]);

  const ready = account.status === "signed-in";
  const password = usePassword(ready);

  async function leave(force = false) {
    setLeaving(true);
    const out = await signOut({ force });
    if (!out.ok && out.unsaved) {
      setUnsaved(true);
      setLeaving(false);
      return;
    }
    router.replace("/");
  }

  const syncState = sync ? account.sync.state : "unavailable";
  const label = syncLabel(sync ? account.sync : { state: "unavailable" });
  return {
    f,
    ready,
    sync,
    user: account.user,
    email: account.user?.email || "",
    name: account.user?.name || "",
    plan: planLabel(account.level),
    syncState,
    // Said only when the sync does not work: « Synchronisation en échec », « arrêtée », « indisponible ».
    syncNote: QUIET.has(syncState) ? null : { text: `Synchronisation ${label.text.toLocaleLowerCase("fr")}`, detail: label.detail },
    summary,
    groups,
    competitions,
    showAll: (kind) => setOpened((now) => new Set(now).add(kind)),
    theme,
    chooseTheme,
    password,
    leaving,
    unsaved,
    leave,
    keep: () => setUnsaved(false),
    setLeaving,
  };
}

/** The sync's state when it does not work, else an empty marker (data-state: the E2E reads it). */
export function SyncNote({ page, className = "" }) {
  return (
    <div className={`account-syncblock ${className}`.trim()} data-state={page.syncState} aria-live="polite">
      {page.syncNote && (
        <p className="account-sync-note">
          {page.syncNote.text}
          {page.syncNote.detail && <span className="account-sync-detail"> · {page.syncNote.detail}</span>}
        </p>
      )}
    </div>
  );
}

/** The last save failed at sign-out: said, then « Annuler » or « Se déconnecter quand même ». */
export function UnsavedNotice({ page }) {
  if (!page.unsaved) return null;
  return (
    <div className="account-unsaved" role="alert">
      <p>Vos derniers changements n’ont pas pu être enregistrés sur le compte.</p>
      <span className="account-actions">
        <button className="account-link" type="button" onClick={page.keep}>
          Annuler
        </button>
        <button className="account-link account-link-strong" type="button" onClick={() => page.leave(true)} disabled={page.leaving}>
          Se déconnecter quand même
        </button>
      </span>
    </div>
  );
}

export function SignOutButton({ page, className = "" }) {
  return (
    <button className={`account-signout ${className}`.trim()} type="button" onClick={() => page.leave(false)} disabled={page.leaving}>
      Se déconnecter
    </button>
  );
}

/** Light or dark: two words, the chosen one marked. */
export function ThemeChoice({ page }) {
  return (
    <div className="account-choice" role="group" aria-label="Thème">
      {[
        ["light", "Clair"],
        ["dark", "Sombre"],
      ].map(([key, text]) => (
        <button key={key} type="button" aria-pressed={page.theme === key} onClick={() => page.chooseTheme(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The home country, « Automatique » first (the detected country applies). */
export function CountryChoice({ page }) {
  const { f } = page;
  const countries = useMemo(() => menuCountries(f.manifest?.competitions || []), [f.manifest]);
  const choice = f.preferences.homeCountry || "";
  return (
    <div className="account-country">
      <HomeCountryMenu
        id="account-country"
        auto
        country={/^[A-Z]{3}$/.test(choice) ? choice : null}
        choice={choice}
        countries={countries}
        onChoose={(code) => f.savePreferences({ homeCountry: code })}
      />
    </div>
  );
}

/** The home page's competitions' picker, opened from a plain word. */
export function CompetitionsChoice({ page, children = "Modifier" }) {
  return (
    <HomePreferences
      f={page.f}
      trigger={{ className: "account-link", text: children, label: "Modifier les compétitions suivies" }}
    />
  );
}

/** « Changer le mot de passe » → the current one and a new one (Better Auth's changePassword, through /api/auth). */
export function PasswordAction({ className = "" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const client = await authClient();
      const { error: failure } = await client.changePassword({
        currentPassword: String(data.get("current") || ""),
        newPassword: String(data.get("new") || ""),
        revokeOtherSessions: true,
      });
      if (failure) setError(authErrorMessage(failure));
      else {
        setOpen(false);
        setDone(true);
      }
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    }
    setBusy(false);
  }
  if (!open)
    return (
      <div className={`account-action ${className}`.trim()}>
        <button className="account-link" type="button" onClick={() => (setOpen(true), setDone(false))}>
          Changer le mot de passe
        </button>
        {done && (
          <span className="account-done" role="status">
            Modifié
          </span>
        )}
      </div>
    );
  return (
    <form className={`account-action account-form ${className}`.trim()} onSubmit={submit}>
      <label className="signin-field">
        <span>Mot de passe actuel</span>
        <input name="current" type="password" autoComplete="current-password" required autoFocus />
      </label>
      <label className="signin-field">
        <span>Nouveau mot de passe</span>
        <input name="new" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <span className="account-actions">
        <button className="account-link" type="button" onClick={() => (setOpen(false), setError(""))}>
          Annuler
        </button>
        <button className="account-button" type="submit" disabled={busy}>
          Enregistrer
        </button>
      </span>
    </form>
  );
}

/** « Exporter mes données »: the account's JSON. */
export function ExportAction({ className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      download(await exportAccount());
    } catch (thrown) {
      setError(thrown?.message || "L’export a échoué. Réessayez.");
    }
    setBusy(false);
  }
  return (
    <div className={`account-action ${className}`.trim()}>
      <button className="account-link" type="button" onClick={run} disabled={busy}>
        Exporter mes données
      </button>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** « Supprimer mon compte », behind the typed « SUPPRIMER ». */
export function DeleteAction({ page, className = "" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function erase(event) {
    event.preventDefault();
    if (typed.trim() !== CONFIRM || busy) return;
    setBusy(true);
    setError("");
    page.setLeaving(true);
    const out = await eraseAccount();
    if (out.ok) {
      router.replace("/");
      return;
    }
    page.setLeaving(false);
    setBusy(false);
    setError(deletionMessage(out.error));
  }
  if (!open)
    return (
      <div className={`account-action ${className}`.trim()}>
        <button className="account-link account-link-danger" type="button" onClick={() => setOpen(true)}>
          Supprimer mon compte
        </button>
      </div>
    );
  return (
    <form className={`account-action account-form ${className}`.trim()} onSubmit={erase}>
      <label className="signin-field">
        <span>Tapez {CONFIRM} pour supprimer le compte et ses préférences</span>
        <input
          name="confirm"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <span className="account-actions">
        <button
          className="account-link"
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError("");
          }}
        >
          Annuler
        </button>
        <button className="account-button account-button-danger" type="submit" disabled={typed.trim() !== CONFIRM || busy}>
          Supprimer définitivement
        </button>
      </span>
    </form>
  );
}

/** The sections' anchors: #parametres from the header's menu, followed once the session is read. */
export function useSectionHash(ready, onSection) {
  const latest = useRef(onSection);
  latest.current = onSection;
  useEffect(() => {
    if (!ready) return undefined;
    const go = () => {
      const id = window.location.hash.slice(1);
      latest.current(SECTIONS.some(([key]) => key === id) ? id : null);
    };
    go();
    window.addEventListener("hashchange", go);
    window.addEventListener("vega:account-section", go);
    return () => {
      window.removeEventListener("hashchange", go);
      window.removeEventListener("vega:account-section", go);
    };
  }, [ready]);
}

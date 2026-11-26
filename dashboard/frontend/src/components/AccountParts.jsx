"use client";
// /compte (VI-38, docs/COMPTES_SITE.md section 10): the page's state and actions (useAccountPage) and its controls: the
// theme, the country, the competitions' picker, the password, the export and the deletion. AccountLetter lays them out.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HomeCountryMenu from "./HomeCountryMenu.jsx";
import { FollowedCompetitionsPicker } from "./CompetitionPicker.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import { accountSyncOn } from "../services/account-switch.js";
import { authClient } from "../services/auth-client.js";
import { eraseAccount, exportAccount, signOut } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";
import { authErrorMessage, deletionMessage, planLabel } from "../services/account-messages.js";
import { favouriteGroups, hasPassword, syncNote } from "../services/account-page.js";
import { accountSummary } from "../services/account-summary.js";
import { menuCountries } from "../services/home-country.js";
import { applyTheme, readTheme, THEME_EVENT } from "../services/local-preferences.js";
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

/** The theme chosen (« system » when nothing is: the computer's, § 76.2), followed when the account's contract or
 *  the computer changes it. */
function useTheme() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    setTheme(readTheme() || "system");
    const follow = () => setTheme(readTheme() || "system");
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  const choose = (next) => {
    applyTheme(next);
    preferencesChanged();
  };
  return [theme, choose];
}

/** C2: whether the account signs in with a password (Better Auth's list-accounts, through /api/auth); null while unknown. */
function usePassword(ready) {
  const [has, setHas] = useState(null);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    (async () => {
      try {
        const client = await authClient();
        const answer = await client?.listAccounts();
        if (live) setHas(hasPassword(answer));
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

/** Everything /compte reads and does. */
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
  // C4: every favourite, grouped by kind; a long group shows its first ones until asked for the rest.
  const [opened, setOpened] = useState(() => new Set());
  const summary = useMemo(() => accountSummary(contract, { shown: Infinity }), [contract]);
  const groups = useMemo(() => favouriteGroups(summary.favourites, opened), [summary.favourites, opened]);
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

  return {
    f,
    ready,
    sync,
    user: account.user,
    email: account.user?.email || "",
    name: account.user?.name || "",
    plan: planLabel(account.level),
    syncState: sync ? account.sync.state : "unavailable",
    // C3: said only when the sync does not work.
    syncNote: syncNote(account.sync, sync),
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
export function SyncNote({ page }) {
  return (
    <div className="account-syncblock" data-state={page.syncState} aria-live="polite">
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

/** The computer's, light or dark: three words, the chosen one marked (§ 76.2). */
export function ThemeChoice({ page }) {
  return (
    <div className="account-choice" role="group" aria-label="Thème">
      {[
        ["system", "Système"],
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
    <FollowedCompetitionsPicker
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

/** How long a section is held in place while the page above it is still loading (C1). */
const HOLD_MS = 2000;
const RELEASE = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * The sections' anchors (C1): the address's hash once the session is read, a hashchange, or the header's menu when
 * already on /compte (its event names the section, "" for the top). A section is held under the header while the
 * content above it grows, until the reader moves or HOLD_MS passes.
 */
export function useSectionHash(ready, onSection) {
  const latest = useRef(onSection);
  latest.current = onSection;
  useEffect(() => {
    if (!ready) return undefined;
    let release = () => {};
    const go = (event) => {
      release();
      const asked = event?.type === "vega:account-section" ? event.detail : window.location.hash.slice(1);
      const id = SECTIONS.some(([key]) => key === asked) ? asked : null;
      latest.current(id);
      if (!id || typeof ResizeObserver !== "function") return;
      const observer = new ResizeObserver(() => latest.current(id));
      const timer = setTimeout(() => release(), HOLD_MS);
      release = () => {
        observer.disconnect();
        clearTimeout(timer);
        RELEASE.forEach((name) => window.removeEventListener(name, release, true));
        release = () => {};
      };
      observer.observe(document.body);
      RELEASE.forEach((name) => window.addEventListener(name, release, { capture: true, passive: true }));
    };
    go();
    window.addEventListener("hashchange", go);
    window.addEventListener("vega:account-section", go);
    return () => {
      release();
      window.removeEventListener("hashchange", go);
      window.removeEventListener("vega:account-section", go);
    };
  }, [ready]);
}

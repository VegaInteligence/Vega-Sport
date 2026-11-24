"use client";
// /compte (VI-38): the address, the plan, the state of the sync, sign-out, export and deletion.
// Signed out, it sends the person to /connexion and back here.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CircleAlert, CloudOff, Download, Flag, LogOut, RefreshCw, Shield, Trash2, UsersRound } from "lucide-react";
import Layout from "../components/Layout.jsx";
import AccountArt from "../components/AccountArt.jsx";
import NationalFlag from "../components/NationalFlag.jsx";
import { Media, Skeleton } from "../components/UI.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import { accountSyncOn } from "../services/account-switch.js";
import { eraseAccount, exportAccount, signOut } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";
import { deletionMessage, planLabel, syncLabel } from "../services/account-messages.js";
import { accountInitial, accountSummary } from "../services/account-summary.js";
import { countryFlag, homeCountryName } from "../services/home-country.js";
import { currentContract } from "../services/user-preferences.js";

const CONFIRM = "SUPPRIMER";
const PAGES = { clubs: "/clubs/", nations: "/nations/", players: "/joueurs/" };
const KIND = { clubs: "Club", nations: "Nation", players: "Joueur" };
const BROWSE = [
  ["Clubs", "/clubs/", Shield],
  ["Joueurs", "/joueurs/", UsersRound],
  ["Nations", "/nations/", Flag],
];
const SYNC_ICON = { synced: Check, failed: CircleAlert, stopped: CircleAlert, unavailable: CloudOff };

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

export default function AccountPage() {
  const account = useAccount();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [erasing, setErasing] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const sync = accountSyncOn();
  const f = useFootball();
  // The browser's contract, read again each time the sync reports (a save, a load): the stores have no other signal.
  const [contract, setContract] = useState(null);
  useEffect(() => {
    setContract(currentContract());
    const timer = window.setTimeout(() => setContract(currentContract()), 1200);
    return () => window.clearTimeout(timer);
  }, [account.status, account.sync]);
  const [all, setAll] = useState(false);
  const summary = useMemo(() => accountSummary(contract, all ? { shown: Infinity } : undefined), [contract, all]);
  // Teams, then players: each column reads as one kind when there are as many of each.
  const favourites = useMemo(
    () => [...summary.favourites].sort((a, b) => (a.kind === "players") - (b.kind === "players")),
    [summary.favourites],
  );

  useEffect(() => {
    if (account.status === "signed-out" && !leaving) router.replace(signInHref(ACCOUNT_PATH));
  }, [account.status, leaving, router]);

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

  async function exportData() {
    setExporting(true);
    setExportError("");
    try {
      download(await exportAccount());
    } catch (error) {
      setExportError(error?.message || "L’export a échoué. Réessayez.");
    }
    setExporting(false);
  }

  async function erase(event) {
    event.preventDefault();
    if (typed.trim() !== CONFIRM || erasing) return;
    setErasing(true);
    setDeleteError("");
    setLeaving(true);
    const out = await eraseAccount();
    if (out.ok) {
      router.replace("/");
      return;
    }
    setLeaving(false);
    setErasing(false);
    setDeleteError(deletionMessage(out.error));
  }

  const ready = account.status === "signed-in";
  const syncState = sync ? account.sync.state : "unavailable";
  const state = syncLabel(sync ? account.sync : { state: "unavailable" });
  const SyncIcon = SYNC_ICON[syncState] || RefreshCw;
  const figures = [
    ["Clubs", summary.counts.clubs],
    ["Joueurs", summary.counts.players],
    ["Nations", summary.counts.nations],
    ["Compétitions", summary.leagues],
    ["Recherches", summary.views],
  ];
  return (
    <Layout path="/compte" title="Mon compte" hideHeading performanceComparison={false}>
      {!ready ? (
        <Skeleton label="Chargement du compte…" lines={4} />
      ) : (
        <div className="account">
          <header className="account-hero">
            <AccountArt />
            <span className="account-monogram" aria-hidden="true">
              {accountInitial(account.user)}
              <span className="brand-dot" />
            </span>
            <div className="account-who">
              <h1 className="account-eyebrow">Mon compte</h1>
              <p className="account-email">{account.user.name || account.user.email}</p>
              <p className="account-tags">
                {account.user.name && <span className="account-address">{account.user.email}</span>}
                <span className="account-plan">{planLabel(account.level)}</span>
                <span className="account-sync" data-state={syncState}>
                  <span className="account-sync-dot" aria-hidden="true" />
                  {state.pill}
                </span>
              </p>
            </div>
            <button className="account-signout" type="button" onClick={() => leave(false)} disabled={leaving}>
              <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
              Se déconnecter
            </button>
          </header>

          {unsaved && (
            <div className="notice notice-warning account-unsaved" role="alert">
              <span>Vos derniers changements n’ont pas pu être enregistrés sur le compte.</span>
              <span className="account-actions">
                <button className="button button-secondary" type="button" onClick={() => setUnsaved(false)}>
                  Annuler
                </button>
                <button className="button button-primary" type="button" onClick={() => leave(true)} disabled={leaving}>
                  Se déconnecter quand même
                </button>
              </span>
            </div>
          )}

          <dl className="account-figures">
            {figures.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd data-empty={value ? undefined : true}>{value}</dd>
              </div>
            ))}
            <div>
              <dt>Pays</dt>
              <dd className="account-country" data-empty={summary.country === "auto" || summary.country === "none" ? true : undefined}>
                {summary.country === "auto" ? (
                  "Automatique"
                ) : summary.country === "none" ? (
                  "Aucun"
                ) : (
                  <>
                    <NationalFlag code={countryFlag(summary.country)} />
                    {homeCountryName(summary.country)}
                  </>
                )}
              </dd>
            </div>
          </dl>

          <div className="account-grid">
            <section className="account-block" aria-labelledby="account-favourites">
              <h2 id="account-favourites">Favoris</h2>
              {summary.favourites.length ? (
                <ul className="account-favourites" style={{ "--rows": Math.ceil(favourites.length / 2) }}>
                  {favourites.map((entry) => (
                    <li key={`${entry.kind}:${entry.id}`}>
                      <Link href={f.href(PAGES[entry.kind], { id: entry.id })} prefetch={false}>
                        <Media name={entry.name} url={entry.imageUrl} kind={entry.kind === "players" ? "player" : "club"} size={40} />
                        <span className="account-favourite-name">{entry.name}</span>
                        <span className="account-favourite-kind">{KIND[entry.kind]}</span>
                        <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="account-empty">
                  <p>Aucun favori</p>
                  <nav aria-label="Trouver des favoris">
                    {BROWSE.map(([label, page, Glyph]) => (
                      <Link key={page} href={f.href(page)}>
                        <Glyph size={20} strokeWidth={1.6} aria-hidden="true" />
                        <span>{label}</span>
                        <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />
                      </Link>
                    ))}
                  </nav>
                </div>
              )}
              {summary.more > 0 && (
                <button className="account-more" type="button" onClick={() => setAll(true)}>
                  Afficher les {summary.more} autres
                </button>
              )}
            </section>

            <div className="account-side">
              <section className="account-block account-syncblock" aria-labelledby="account-sync">
                <h2 id="account-sync">Synchronisation</h2>
                <p className="account-state" data-state={syncState}>
                  <span className="account-state-icon" aria-hidden="true">
                    <SyncIcon size={18} strokeWidth={1.9} />
                  </span>
                  <span className="account-state-text">{state.text}</span>
                </p>
                {state.detail && <p className="account-state-detail">{state.detail}</p>}
              </section>

              {sync && (
                <section className="account-block account-data" aria-labelledby="account-data">
                  <h2 id="account-data">Données</h2>
                  <div className="account-rows">
                    <button className="account-row" type="button" onClick={exportData} disabled={exporting}>
                      <Download size={17} strokeWidth={1.7} aria-hidden="true" />
                      <span>Exporter mes données</span>
                      <span className="account-row-hint">JSON</span>
                    </button>
                    {exportError && (
                      <p className="account-error" role="alert">
                        {exportError}
                      </p>
                    )}
                    {!deleteOpen ? (
                      <button className="account-row account-delete" type="button" onClick={() => setDeleteOpen(true)}>
                        <Trash2 size={17} strokeWidth={1.7} aria-hidden="true" />
                        <span>Supprimer mon compte</span>
                      </button>
                    ) : (
                      <form className="account-erase" onSubmit={erase}>
                        <label className="signin-field">
                          <span>Tapez {CONFIRM} pour supprimer le compte et ses préférences</span>
                          <input
                            name="confirm"
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck="false"
                            autoFocus
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                          />
                        </label>
                        {deleteError && (
                          <p className="account-error" role="alert">
                            {deleteError}
                          </p>
                        )}
                        <span className="account-actions">
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => {
                              setDeleteOpen(false);
                              setTyped("");
                              setDeleteError("");
                            }}
                          >
                            Annuler
                          </button>
                          <button className="button account-delete-confirm" type="submit" disabled={typed.trim() !== CONFIRM || erasing}>
                            Supprimer définitivement
                          </button>
                        </span>
                      </form>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

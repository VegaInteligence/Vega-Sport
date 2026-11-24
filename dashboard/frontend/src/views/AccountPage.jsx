"use client";
// /compte (VI-38): the address, the plan, the state of the sync, sign-out, export and deletion.
// Signed out, it sends the person to /connexion and back here.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, LogOut, Trash2 } from "lucide-react";
import Layout from "../components/Layout.jsx";
import { Skeleton } from "../components/UI.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { accountSyncOn } from "../services/account-switch.js";
import { eraseAccount, exportAccount, signOut } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";
import { deletionMessage, planLabel, syncLabel } from "../services/account-messages.js";

const CONFIRM = "SUPPRIMER";

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
  const state = syncLabel(sync ? account.sync : { state: "unavailable" });
  return (
    <Layout path="/compte" title="Mon compte" performanceComparison={false}>
      {!ready ? (
        <Skeleton label="Chargement du compte…" lines={4} />
      ) : (
        <div className="account-panel account-summary">
          <dl className="account-facts">
            <div>
              <dt>Adresse e-mail</dt>
              <dd className="account-email">{account.user.email}</dd>
            </div>
            <div>
              <dt>Offre</dt>
              <dd>{planLabel(account.level)}</dd>
            </div>
            <div>
              <dt>Synchronisation</dt>
              <dd className="account-sync" data-state={sync ? account.sync.state : "unavailable"}>
                <span className="account-sync-dot" aria-hidden="true" />
                <span>{state.text}</span>
                {state.detail && <span className="account-sync-detail">{state.detail}</span>}
              </dd>
            </div>
          </dl>

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

          <div className="account-actions">
            <button className="button button-primary" type="button" onClick={() => leave(false)} disabled={leaving}>
              <LogOut size={15} strokeWidth={1.8} aria-hidden="true" />
              Se déconnecter
            </button>
            {sync && (
              <button className="button button-secondary" type="button" onClick={exportData} disabled={exporting}>
                <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                Exporter mes données
              </button>
            )}
          </div>
          {exportError && (
            <p className="account-error" role="alert">
              {exportError}
            </p>
          )}

          {sync && (
            <section className="account-danger" aria-label="Supprimer mon compte">
              {!deleteOpen ? (
                <button className="button button-ghost account-delete" type="button" onClick={() => setDeleteOpen(true)}>
                  <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                  Supprimer mon compte
                </button>
              ) : (
                <form className="account-form" onSubmit={erase}>
                  <label className="account-field">
                    <span>Tapez {CONFIRM} pour supprimer le compte et ses préférences</span>
                    <input
                      name="confirm"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck="false"
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
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}

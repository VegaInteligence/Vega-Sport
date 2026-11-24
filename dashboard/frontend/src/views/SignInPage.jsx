"use client";
// /connexion (VI-38): sign in or create an account with an e-mail and a password, or with Google, through the
// SDK's own methods (no prebuilt UI). ?next= brings the person back, same-origin paths only (account-links.js).
// A screen of its own, without the site's header (docs/COMPTES_SITE.md S6 to S9): the night panel and the form.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, Eye, EyeOff, X } from "lucide-react";
import AccountArt from "../components/AccountArt.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { authClient } from "../services/auth-client.js";
import { expectSession, sessionChanged } from "../services/account-state.js";
import { safeNext } from "../services/account-links.js";
import { authErrorMessage } from "../services/account-messages.js";

export default function SignInPage() {
  const params = useSearchParams();
  const router = useRouter();
  const account = useAccount();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState(params.get("mode") === "creer" ? "sign-up" : "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const signUp = mode === "sign-up";

  // This page always asks (W6): a browser without the hint may still hold the session's cookie.
  useEffect(() => {
    sessionChanged();
  }, []);
  useEffect(() => {
    if (account.status === "signed-in") router.replace(next);
  }, [account.status, next, router]);

  async function run(work) {
    setBusy(true);
    setError("");
    try {
      const client = await authClient();
      const out = await work(client);
      if (out?.error) throw out.error;
      return out;
    } catch (failure) {
      setError(authErrorMessage(failure));
      setBusy(false);
      return null;
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    // Nothing is sent with an empty field: the first one takes the focus.
    const empty = !email.trim() ? "email" : !password ? "password" : "";
    if (empty) {
      event.currentTarget.elements[empty]?.focus();
      return;
    }
    const done = await run((client) =>
      signUp
        ? client.signUp.email({ email: email.trim(), password, name: "" })
        : client.signIn.email({ email: email.trim(), password }),
    );
    if (!done) return;
    setPassword("");
    setShown(false);
    await sessionChanged();
    setBusy(false);
  }

  async function google() {
    if (busy) return;
    const done = await run((client) =>
      client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}${next}` }),
    );
    if (done?.data?.url) {
      expectSession();
      window.location.assign(done.data.url);
    }
  }

  function change(next) {
    setMode(next);
    setPassword("");
    setShown(false);
    setError("");
  }

  const title = signUp ? "Créer un compte" : "Connexion";
  return (
    <main className="signin" id="main">
      <aside className="signin-brand">
        <AccountArt />
        <Link className="signin-wordmark" href="/" aria-label="Vega Sport, vue d’ensemble">
          <img src="/branding/vega/logo-dark.svg" alt="" width="300" height="66" />
        </Link>
      </aside>
      <section className="signin-panel" aria-label={signUp ? "Créer un compte" : "Se connecter"}>
        <Link className="signin-close" href={next} aria-label="Fermer">
          <X size={18} strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <div className="signin-column">
          <h1 className="signin-title">
            {title}
            <span className="brand-dot" aria-hidden="true" />
          </h1>
          <button className="signin-google" type="button" onClick={google} disabled={busy}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
            </svg>
            Continuer avec Google
          </button>
          <div className="signin-divider" role="separator">
            <span>ou</span>
          </div>
          <form className="signin-form" onSubmit={submit} noValidate>
            <label className="signin-field">
              <span>Adresse e-mail</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck="false"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <label className="signin-field">
              <span>Mot de passe</span>
              <span className="signin-secret">
                <input
                  type={shown ? "text" : "password"}
                  name="password"
                  autoComplete={signUp ? "new-password" : "current-password"}
                  autoCapitalize="none"
                  spellCheck="false"
                  minLength={signUp ? 8 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                />
                <button
                  className="signin-eye"
                  type="button"
                  aria-pressed={shown}
                  aria-label="Afficher le mot de passe"
                  onClick={() => setShown((value) => !value)}
                >
                  {shown ? <EyeOff size={17} strokeWidth={1.7} aria-hidden="true" /> : <Eye size={17} strokeWidth={1.7} aria-hidden="true" />}
                </button>
              </span>
            </label>
            {error && (
              <p className="signin-error" role="alert">
                <CircleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}
            <button className="signin-submit account-submit" type="submit" disabled={busy} data-busy={busy || undefined}>
              <span>{signUp ? "Créer le compte" : "Se connecter"}</span>
              <ArrowRight size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </form>
          <p className="signin-switch">
            <span>{signUp ? "Déjà un compte ?" : "Pas encore de compte ?"}</span>
            <button type="button" onClick={() => change(signUp ? "sign-in" : "sign-up")}>
              {signUp ? "Se connecter" : "Créer un compte"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

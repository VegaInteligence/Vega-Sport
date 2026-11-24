"use client";
// /connexion (VI-38): sign in or create an account with an e-mail and a password, or with Google, through the
// SDK's own methods (no prebuilt UI). ?next= brings the person back, same-origin paths only (account-links.js).
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { Segments } from "../components/UI.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { authClient } from "../services/auth-client.js";
import { sessionChanged } from "../services/account-state.js";
import { safeNext } from "../services/account-links.js";
import { authErrorMessage } from "../services/account-messages.js";

const MODES = [
  ["sign-in", "Se connecter"],
  ["sign-up", "Créer un compte"],
];

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
  const signUp = mode === "sign-up";

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
    const done = await run((client) =>
      signUp
        ? client.signUp.email({ email: email.trim(), password, name: "" })
        : client.signIn.email({ email: email.trim(), password }),
    );
    if (!done) return;
    setPassword("");
    await sessionChanged();
    setBusy(false);
  }

  async function google() {
    if (busy) return;
    const done = await run((client) =>
      client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}${next}` }),
    );
    if (done?.data?.url) window.location.assign(done.data.url);
  }

  return (
    <Layout path="/connexion" title={signUp ? "Créer un compte" : "Connexion"} performanceComparison={false}>
      <section className="account-panel" aria-label={signUp ? "Créer un compte" : "Se connecter"}>
        <Segments
          label="Connexion ou création de compte"
          value={mode}
          items={MODES}
          onChange={(value) => {
            setMode(value);
            setError("");
          }}
        />
        <form className="account-form" onSubmit={submit} noValidate>
          <label className="account-field">
            <span>Adresse e-mail</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <label className="account-field">
            <span>Mot de passe</span>
            <input
              type="password"
              name="password"
              autoComplete={signUp ? "new-password" : "current-password"}
              minLength={signUp ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-primary account-submit" type="submit" disabled={busy || !email || !password}>
            {signUp ? "Créer le compte" : "Se connecter"}
          </button>
        </form>
        <div className="account-divider" role="separator">
          <span>ou</span>
        </div>
        <button className="button button-secondary account-google" type="button" onClick={google} disabled={busy}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
          </svg>
          Continuer avec Google
        </button>
      </section>
    </Layout>
  );
}

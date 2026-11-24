"use client";
// /connexion (VI-38): sign in or create an account with an e-mail and a password, or with Google, through the
// SDK's own methods (no prebuilt UI). ?next= brings the person back, same-origin paths only (account-links.js).
// A screen of its own, without the site's header (docs/COMPTES_SITE.md S6 to S9): the night panel and the form.
// Three more steps live here, in memory (section 8): the address confirmation, the forgotten password and the new
// password, each through a six-digit code sent by e-mail.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, CircleAlert, Eye, EyeOff, X } from "lucide-react";
import AccountArt from "../components/AccountArt.jsx";
import { useAccount } from "../hooks/useAccount.js";
import { authClient } from "../services/auth-client.js";
import { expectSession, sessionChanged } from "../services/account-state.js";
import { safeNext } from "../services/account-links.js";
import { authErrorMessage, returnErrorMessage } from "../services/account-messages.js";
import { googleReturn, returnError } from "../services/account-return.js";
import {
  CODE_LENGTH,
  RESEND_WAIT_SECONDS,
  cleanCode,
  codeReady,
  isUnverified,
  needsConfirmation,
  requestPasswordReset,
} from "../services/account-code.js";

const STEPS = {
  "sign-in": { title: "Connexion", label: "Se connecter", submit: "Se connecter" },
  "sign-up": { title: "Créer un compte", label: "Créer un compte", submit: "Créer le compte" },
  confirm: { title: "Confirmer l’adresse", label: "Confirmer l’adresse", submit: "Confirmer" },
  forgot: { title: "Mot de passe oublié", label: "Mot de passe oublié", submit: "Recevoir un code" },
  reset: { title: "Nouveau mot de passe", label: "Nouveau mot de passe", submit: "Changer le mot de passe" },
};
// Where a long title may break: « Mot de passe » stays whole.
const TITLE_PARTS = { confirm: ["Confirmer", "l’adresse"], forgot: ["Mot de passe", "oublié"], reset: ["Nouveau", "mot de passe"] };
const MODES = { creer: "sign-up", oubli: "forgot" };
const CODE_ERRORS = ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"];
const codeRefused = (error) => CODE_ERRORS.includes(error?.error?.code ?? error?.code);

export default function SignInPage() {
  const params = useSearchParams();
  const router = useRouter();
  const account = useAccount();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState(MODES[params.get("mode")] ?? "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  // The error of Google's return is not the fields': they are not marked (section 9).
  const [fromGoogle, setFromGoogle] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [wait, setWait] = useState(0);
  const form = useRef(null);
  const mounted = useRef(false);
  const step = STEPS[mode];
  const signUp = mode === "sign-up";
  const entry = mode === "sign-in" || signUp;
  const coded = mode === "confirm" || mode === "reset";
  const address = email.trim();

  // This page always asks (W6): a browser without the hint may still hold the session's cookie.
  useEffect(() => {
    sessionChanged();
  }, []);
  // Section 9 (G2 to G4): a return from Google that Neon refused, read once on arrival, then out of the address.
  useEffect(() => {
    const returned = returnError(window.location.search);
    if (!returned.present) return;
    setError(returnErrorMessage(returned.code));
    setFromGoogle(true);
    // Through the router: a bare history.replaceState is overwritten by the router's own first commit.
    router.replace(`${window.location.pathname}${returned.search}`, { scroll: false });
    // Only the address the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (account.status === "signed-in") router.replace(next);
  }, [account.status, next, router]);
  // A new step puts the focus in its first empty field (R13); the first screen leaves it where the browser put it.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const fields = [...(form.current?.querySelectorAll("input") ?? [])];
    (fields.find((field) => !field.value) ?? fields[0])?.focus();
  }, [mode]);
  // The wait before another code (R5).
  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const focus = (name) => form.current?.elements[name]?.focus();

  /** Runs one call of the auth client: its answer, or null with the error shown (`refused` gets the raw error). */
  async function run(work, refused) {
    setBusy(true);
    setError("");
    setFromGoogle(false);
    setNote("");
    try {
      const client = await authClient();
      const out = await work(client);
      if (out?.error) throw out.error;
      return out ?? {};
    } catch (failure) {
      if (!refused?.(failure)) setError(authErrorMessage(failure));
      setBusy(false);
      return null;
    }
  }

  /** Another step: the address stays; the code, the error and (unless kept for R6) the password go (R11). */
  function change(to, { keepPassword = false, said = "" } = {}) {
    setMode(to);
    if (!keepPassword) setPassword("");
    setCode("");
    setShown(false);
    setError("");
    setFromGoogle(false);
    setNote(said);
    setBusy(false);
  }

  /** The session after a sign-in, a confirmation or a reset; the effect above then leaves for ?next=. */
  async function enter() {
    const state = await sessionChanged();
    setPassword("");
    setCode("");
    setShown(false);
    setBusy(false);
    return state.status === "signed-in";
  }

  async function submitEntry() {
    const empty = !address ? "email" : !password ? "password" : "";
    if (empty) return focus(empty);
    let unverified = false;
    const done = await run(
      (client) => (signUp ? client.signUp.email({ email: address, password, name: "" }) : client.signIn.email({ email: address, password })),
      (failure) => (unverified = !signUp && isUnverified(failure)),
    );
    if (unverified) {
      // R2: the step, and one code asked for by the site.
      change("confirm", { keepPassword: true });
      await resend({ first: true });
      return undefined;
    }
    if (!done) return undefined;
    if (signUp && needsConfirmation(done)) {
      // R1: Neon sent the code with the sign-up.
      change("confirm", { keepPassword: true });
      setWait(RESEND_WAIT_SECONDS);
      return undefined;
    }
    return enter();
  }

  async function submitConfirm() {
    if (!codeReady(code)) return focus("code");
    const done = await run((client) => client.emailOtp.verifyEmail({ email: address, otp: code }), refuseCode);
    if (!done) return undefined;
    // R6: no session from the confirmation itself: the password held since the previous step opens one.
    const held = password;
    if (await enter()) return undefined;
    if (held) {
      const signedIn = await run((client) => client.signIn.email({ email: address, password: held }));
      if (signedIn && (await enter())) return undefined;
    }
    return change("sign-in", { said: "Adresse confirmée. Connectez-vous." });
  }

  async function submitForgot() {
    if (!address) return focus("email");
    const done = await run((client) => requestPasswordReset(client, address));
    if (!done) return undefined;
    change("reset");
    setWait(RESEND_WAIT_SECONDS);
    return undefined;
  }

  async function submitReset() {
    if (!codeReady(code)) return focus("code");
    if (!password) return focus("password");
    const fresh = password;
    const done = await run((client) => client.emailOtp.resetPassword({ email: address, otp: code, password: fresh }), refuseCode);
    if (!done) return undefined;
    // R10: signed in at once with the new password.
    const signedIn = await run((client) => client.signIn.email({ email: address, password: fresh }));
    if (signedIn && (await enter())) return undefined;
    return change("sign-in", { said: "Mot de passe modifié. Connectez-vous." });
  }

  /** R4: a refused code empties its field, which takes the focus; the message is the usual one. */
  function refuseCode(failure) {
    if (codeRefused(failure)) {
      setCode("");
      focus("code");
    }
    return false;
  }

  /** Another code (R5), or the first one of a confirmation the site opens itself (R2: whatever the wait, unsaid). */
  async function resend({ first = false } = {}) {
    if (wait > 0 && !first) return;
    const done = await run((client) =>
      mode === "reset" ? requestPasswordReset(client, address) : client.emailOtp.sendVerificationOtp({ email: address, type: "email-verification" }),
    );
    if (!done) return;
    setBusy(false);
    setWait(RESEND_WAIT_SECONDS);
    if (first) return;
    setNote("Nouveau code envoyé.");
    focus("code");
  }

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    ({ "sign-in": submitEntry, "sign-up": submitEntry, confirm: submitConfirm, forgot: submitForgot, reset: submitReset })[mode]();
  }

  async function google() {
    if (busy) return;
    const done = await run((client) =>
      client.signIn.social({ provider: "google", ...googleReturn(window.location.origin, next) }),
    );
    if (done?.data?.url) {
      expectSession();
      window.location.assign(done.data.url);
    }
  }

  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => code[index] ?? "");
  return (
    <main className="signin" id="main">
      <aside className="signin-brand">
        <AccountArt />
        <Link className="signin-wordmark" href="/" aria-label="Vega Sport, vue d’ensemble">
          <img src="/branding/vega/logo-dark.svg" alt="" width="300" height="66" />
        </Link>
      </aside>
      <section className="signin-panel" aria-label={step.label}>
        <Link className="signin-close" href={next} aria-label="Fermer">
          <X size={18} strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <div className="signin-column" data-step={mode}>
          <h1 className="signin-title">
            {(TITLE_PARTS[mode] ?? [step.title]).flatMap((part, index, parts) => [
              index ? " " : null,
              <span key={part} className="signin-title-part">
                {part}
                {index === parts.length - 1 && <span className="brand-dot" aria-hidden="true" />}
              </span>,
            ])}
          </h1>
          {entry && (
            <>
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
            </>
          )}
          {coded && <p className="signin-address">{address}</p>}
          <form className="signin-form" onSubmit={submit} noValidate ref={form}>
            {!coded && (
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
                  aria-invalid={error && !fromGoogle ? true : undefined}
                />
              </label>
            )}
            {coded && (
              <label className="signin-field">
                <span>Code reçu par e-mail</span>
                <span className="signin-code" data-filled={code.length}>
                  <input
                    type="text"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={64}
                    required
                    value={code}
                    onChange={(e) => setCode(cleanCode(e.target.value))}
                    aria-invalid={error && !fromGoogle ? true : undefined}
                  />
                  {cells.map((digit, index) => (
                    <span key={index} className="signin-code-cell" data-next={index === Math.min(code.length, CODE_LENGTH - 1) || undefined} aria-hidden="true">
                      {digit}
                    </span>
                  ))}
                </span>
              </label>
            )}
            {(entry || mode === "reset") && (
              <label className="signin-field">
                <span>{mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"}</span>
                <span className="signin-secret">
                  <input
                    type={shown ? "text" : "password"}
                    name="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    autoCapitalize="none"
                    spellCheck="false"
                    minLength={mode === "sign-in" ? undefined : 8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={error && !fromGoogle ? true : undefined}
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
            )}
            {mode === "sign-in" && (
              <button className="signin-forgot" type="button" onClick={() => change("forgot")}>
                Mot de passe oublié ?
              </button>
            )}
            {error && (
              <p className="signin-error" role="alert">
                <CircleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}
            {note && !error && (
              <p className="signin-note" role="status">
                <Check size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{note}</span>
              </p>
            )}
            <button className="signin-submit account-submit" type="submit" disabled={busy} data-busy={busy || undefined}>
              <span>{step.submit}</span>
              <ArrowRight size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </form>
          {entry ? (
            <p className="signin-switch">
              <span>{signUp ? "Déjà un compte ?" : "Pas encore de compte ?"}</span>
              <button type="button" onClick={() => change(signUp ? "sign-in" : "sign-up")}>
                {signUp ? "Se connecter" : "Créer un compte"}
              </button>
            </p>
          ) : (
            <p className="signin-steps">
              {coded && (
                <button className="signin-resend" type="button" onClick={() => resend()} disabled={busy || wait > 0}>
                  {wait > 0 ? `Renvoyer le code (${wait} s)` : "Renvoyer le code"}
                </button>
              )}
              <button className="signin-back" type="button" onClick={() => change("sign-in")}>
                Retour
              </button>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

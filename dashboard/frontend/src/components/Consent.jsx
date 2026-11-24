"use client";
// The audience and speed measurement waits for the visitor's « Accepter » in Europe (src/services/consent.js).
// Mounted once by app/layout.jsx in place of <Analytics /> and <SpeedInsights />. The server's HTML never holds the
// banner: it shows only once the browser knows it must ask and finds no valid choice.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import {
  CONSENT_OPEN_EVENT,
  CONSENT_REGION_PATH,
  PRIVACY_HREF,
  openConsentSettings,
  readConsent,
  writeConsent,
} from "../services/consent.js";

// Read by both tools at every send: a refusal in this page stops what their scripts would still send.
let granted = false;
const keepIfGranted = (event) => (granted ? event : null);

export default function Consent() {
  // pending: not known yet (nothing loads); ask: no valid choice where one is needed; settled: measurement on or off.
  const [state, setState] = useState({ phase: "pending", measurement: false, chosen: false });
  const [reopened, setReopened] = useState(false);
  const [dismissedOn, setDismissedOn] = useState(null);
  const pathname = usePathname();
  const card = useRef(null);

  const settle = (measurement, chosen) => {
    granted = measurement;
    setState({ phase: "settled", measurement, chosen });
  };

  useEffect(() => {
    const saved = readConsent();
    if (saved) return settle(saved.measurement, true);
    const controller = new AbortController();
    fetch(CONSENT_REGION_PATH, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.consent === "none") settle(true, false);
        else setState({ phase: "ask", measurement: false, chosen: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "ask", measurement: false, chosen: false });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const reopen = () => {
      setReopened(true);
      setDismissedOn(null);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  // Closed without a choice (Escape): no consent, and the banner returns on the next page.
  const shown = (reopened || state.phase === "ask") && dismissedOn !== pathname;

  // While open, the page can scroll its last lines clear of the card; nothing above them moves.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!shown || !card.current) return;
    const measure = () => root.style.setProperty("--consent-h", `${card.current?.offsetHeight || 0}px`);
    measure();
    root.dataset.consent = "open";
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(card.current);
    return () => {
      observer?.disconnect();
      delete root.dataset.consent;
      root.style.removeProperty("--consent-h");
    };
  }, [shown]);

  const choose = (measurement) => {
    writeConsent(measurement);
    settle(measurement, true);
    setReopened(false);
  };
  const pressed = (value) =>
    reopened && state.phase === "settled" ? String(state.measurement === value) : undefined;

  return (
    <>
      <div className="consent-live" aria-live="polite">
        {shown && (
          <section
            ref={card}
            className="consent"
            aria-labelledby="consent-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setReopened(false);
                setDismissedOn(pathname);
              }
            }}
          >
            <h2 id="consent-title" className="consent-title">
              Mesure d’audience<span className="brand-dot" aria-hidden="true" />
            </h2>
            <p className="consent-text">
              Vega Sport mesure l’audience et la vitesse des pages avec Vercel.{" "}
              <Link href={PRIVACY_HREF} prefetch={false}>
                Confidentialité
              </Link>
            </p>
            <div className="consent-actions">
              <button type="button" className="consent-button" aria-pressed={pressed(true)} onClick={() => choose(true)}>
                Accepter
              </button>
              <button type="button" className="consent-button" aria-pressed={pressed(false)} onClick={() => choose(false)}>
                Refuser
              </button>
            </div>
          </section>
        )}
      </div>
      {state.phase === "settled" && state.measurement && (
        <>
          <SpeedInsights beforeSend={keepIfGranted} />
          <Analytics beforeSend={keepIfGranted} />
        </>
      )}
    </>
  );
}

/** The footer's « Cookies »: shows the banner again with the current choice. */
export function ConsentSettingsLink({ className = "consent-settings-link" }) {
  return (
    <button type="button" className={className} onClick={openConsentSettings}>
      Cookies
    </button>
  );
}

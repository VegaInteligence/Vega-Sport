"use client";
// The footer's « Cookies » (SiteFooter.jsx, column « Informations »): shows the consent banner again with the
// current choice (Consent.jsx listens to the event).
import { openConsentSettings } from "../services/consent.js";

export default function ConsentSettingsLink({ className = "consent-settings-link" }) {
  return (
    <button type="button" className={className} onClick={openConsentSettings}>
      Cookies
    </button>
  );
}

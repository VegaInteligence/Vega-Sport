"use client";
import SiteFooter from "../src/components/SiteFooter.jsx";
export default function ErrorPage({ reset }) {
  return (
    <div className="route-error-shell">
      <div className="route-error-body">
        <main className="route-error">
          <h1>Chargement impossible</h1>
          <button className="button button-primary" onClick={reset}>
            Réessayer
          </button>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

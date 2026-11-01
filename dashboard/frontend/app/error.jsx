"use client";
export default function ErrorPage({ reset }) {
  return (
    <main className="route-error">
      <h1>Chargement impossible</h1>
      <button className="button button-primary" onClick={reset}>
        Réessayer
      </button>
    </main>
  );
}

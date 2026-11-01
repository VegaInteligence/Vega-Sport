import Link from "next/link";
export default function NotFound() {
  return (
    <main className="route-error">
      <span className="eyebrow">404</span>
      <h1>Page introuvable</h1>
      <Link className="button button-primary" href="/">
        Vue d’ensemble
      </Link>
    </main>
  );
}

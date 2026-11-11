import Link from "next/link";
import SiteFooter from "../src/components/SiteFooter.jsx";
export default function NotFound() {
  return (
    <div className="route-error-shell">
      <div className="route-error-body">
        <main className="route-error">
          <span className="eyebrow">404</span>
          <h1>Page introuvable</h1>
          <Link className="button button-primary" href="/">
            Vue d’ensemble
          </Link>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

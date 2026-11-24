"use client";
// The header's way into the account (VI-38): « Se connecter » signed out, « Mon compte » signed in. Accounts off:
// nothing at all, the header as before. While the session is read the slot keeps its size (no shift).
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, UserRound } from "lucide-react";
import { useAccount } from "../hooks/useAccount.js";
import { refreshSession } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";

export default function AccountEntry() {
  const account = useAccount();
  const pathname = usePathname() || "/";
  // The query is read after mount: useSearchParams would need a Suspense boundary, and the shell's fallback
  // (app/shell-fallback.jsx) draws this header outside any.
  const [query, setQuery] = useState("");
  const off = account.status === "off";
  useEffect(() => {
    if (!off) refreshSession();
  }, [off]);
  const readQuery = () => setQuery(window.location.search.replace(/^\?/, ""));
  useEffect(readQuery, [pathname]);
  if (off) return null;
  if (account.status === "signed-in") {
    const here = pathname.replace(/\/$/, "") === ACCOUNT_PATH;
    return (
      <Link className="account-entry" href={ACCOUNT_PATH} aria-current={here ? "page" : undefined} aria-label="Mon compte">
        <UserRound size={17} strokeWidth={1.7} aria-hidden="true" />
        <span className="account-entry-label">Mon compte</span>
      </Link>
    );
  }
  if (account.status === "signed-out") {
    return (
      // The query may have changed since (a club opened on the same page): read again before the click.
      <Link
        className="account-entry"
        href={signInHref(`${pathname}${query ? `?${query}` : ""}`)}
        aria-label="Se connecter"
        onPointerDown={readQuery}
        onFocus={readQuery}
      >
        <LogIn size={17} strokeWidth={1.7} aria-hidden="true" />
        <span className="account-entry-label">Se connecter</span>
      </Link>
    );
  }
  return <span className="account-entry account-entry-pending" aria-hidden="true" />;
}

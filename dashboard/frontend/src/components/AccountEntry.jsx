"use client";
// The header's way into the account (VI-38): « Se connecter » signed out; signed in, the monogram and « Mon compte »,
// a button that opens a small menu (hover or keyboard focus with a mouse, a click or a tap): who is signed in, « Mon
// compte » (the top of /compte), « Paramètres » (/compte#parametres) and « Se déconnecter ». Accounts off: nothing
// at all, the header as before. While the session is read the slot keeps its size (no shift).
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { useAccount } from "../hooks/useAccount.js";
import { refreshSession, signOut } from "../services/account-state.js";
import { ACCOUNT_PATH, signInHref } from "../services/account-links.js";
import { planLabel } from "../services/account-messages.js";
import { accountInitial } from "../services/account-summary.js";

/** The menu of the signed-in entry. Same rules as the header's menus (SiteNavigation.jsx): hover opens it for a
 *  mouse, a click or a tap toggles it, Escape and a click elsewhere close it. Keyboard focus opens it too, so Tab
 *  goes from the entry into its links. */
function AccountMenu({ account, here }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const timer = useRef(null);
  const hovered = useRef(false);
  // Escape gives the focus back to the button: that focus must not open the menu again.
  const returning = useRef(false);
  const id = useId();
  const close = (refocus = false) => {
    setOpen(false);
    setUnsaved(false);
    if (refocus) {
      returning.current = true;
      button.current?.focus();
      returning.current = false;
    }
  };
  useEffect(() => close(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const enter = (event) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    hovered.current = true;
    setOpen(true);
  };
  const leave = (event) => {
    if (event.pointerType !== "mouse" || unsaved) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      hovered.current = false;
      setOpen(false);
    }, 180);
  };
  // A click on an entry the mouse already opened keeps it open (as the header's menus).
  const toggle = () => {
    if (hovered.current) return setOpen(true);
    setOpen((value) => !value);
  };
  const focus = (event) => {
    if (!returning.current && event.target === button.current && button.current.matches(":focus-visible")) setOpen(true);
  };
  const blur = (event) => {
    if (!unsaved && event.relatedTarget && !root.current?.contains(event.relatedTarget)) setOpen(false);
  };
  // Already on /compte: Next changes the address without a hashchange, so the page is told.
  const go = () => {
    close();
    if (here) setTimeout(() => window.dispatchEvent(new Event("vega:account-section")), 0);
  };

  async function out(force = false) {
    setLeaving(true);
    const result = await signOut({ force });
    setLeaving(false);
    if (!result.ok && result.unsaved) {
      setUnsaved(true);
      return;
    }
    close();
    if (here) router.replace("/");
  }

  return (
    <div className="account-menu-root" ref={root} onPointerEnter={enter} onPointerLeave={leave} onFocus={focus} onBlur={blur}>
      <button
        type="button"
        ref={button}
        className="account-entry account-entry-in"
        aria-label="Mon compte"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-current={here ? "" : undefined}
        onClick={toggle}
      >
        <span className="account-entry-monogram" aria-hidden="true">
          {accountInitial(account.user)}
        </span>
        <span className="account-entry-label">Mon compte</span>
      </button>
      {open && (
        <div className="account-menu" id={id}>
          <p className="account-menu-who">
            <span className="account-menu-address">{account.user.email}</span>
            <span className="account-menu-plan">{planLabel(account.level)}</span>
          </p>
          <nav className="account-menu-links" aria-label="Mon compte">
            <Link href={ACCOUNT_PATH} onClick={go}>
              Mon compte
            </Link>
            <Link href={`${ACCOUNT_PATH}#parametres`} onClick={go}>
              Paramètres
            </Link>
          </nav>
          {unsaved ? (
            <div className="account-menu-unsaved" role="alert">
              <p>Vos derniers changements n’ont pas pu être enregistrés sur le compte.</p>
              <span className="account-actions">
                <button className="account-link" type="button" onClick={() => setUnsaved(false)}>
                  Annuler
                </button>
                <button className="account-link account-link-strong" type="button" onClick={() => out(true)} disabled={leaving}>
                  Se déconnecter quand même
                </button>
              </span>
            </div>
          ) : (
            <div className="account-menu-foot">
              <button className="account-menu-out" type="button" onClick={() => out(false)} disabled={leaving}>
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  if (account.status === "signed-in") return <AccountMenu account={account} here={pathname.replace(/\/$/, "") === ACCOUNT_PATH} />;
  if (account.status === "signed-out") {
    return (
      // The query may have changed since (a club opened on the same page): read again before the click.
      <Link
        className="account-entry account-entry-out"
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

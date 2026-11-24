"use client";
// /compte (VI-38): the account and the site's settings on one page. Signed out, it sends the person to /connexion and
// back here. Mock-up stage: two directions behind a temporary switch, `?piste=a` (« Lettre », AccountLetter) or
// `?piste=b` (« Diptyque », AccountDiptych), remembered for the tab's session; without it, DEFAULT_PISTE.
import { useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import AccountLetter from "../components/AccountLetter.jsx";
import AccountDiptych from "../components/AccountDiptych.jsx";
import { useAccountPage } from "../components/AccountParts.jsx";
import { Skeleton } from "../components/UI.jsx";

/** The direction shown without `?piste=` (the one the accounts E2E runs on). */
const DEFAULT_PISTE = "a";
const PISTES = { a: AccountLetter, b: AccountDiptych };
const PISTE_KEY = "vega.compte.piste";

/** The mock-up's switch, read after mount (the page stays static). */
function usePiste() {
  const [piste, setPiste] = useState(DEFAULT_PISTE);
  useEffect(() => {
    let chosen = new URLSearchParams(window.location.search).get("piste");
    try {
      if (PISTES[chosen]) sessionStorage.setItem(PISTE_KEY, chosen);
      else chosen = sessionStorage.getItem(PISTE_KEY);
    } catch {}
    if (PISTES[chosen]) setPiste(chosen);
  }, []);
  return piste;
}

export default function AccountPage() {
  const page = useAccountPage();
  const piste = usePiste();
  const Direction = PISTES[piste];
  return (
    <Layout path="/compte" title="Mon compte" hideHeading performanceComparison={false} className={`account-page account-page-${piste}`}>
      {!page.ready ? <Skeleton label="Chargement du compte…" lines={4} /> : <Direction page={page} />}
    </Layout>
  );
}

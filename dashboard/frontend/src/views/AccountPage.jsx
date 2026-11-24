"use client";
// /compte (VI-38, docs/COMPTES_SITE.md section 10): the account and the site's settings on one page, « Lettre »
// (AccountLetter). Signed out, it sends the person to /connexion and back here.
import Layout from "../components/Layout.jsx";
import AccountLetter from "../components/AccountLetter.jsx";
import { useAccountPage } from "../components/AccountParts.jsx";
import { Skeleton } from "../components/UI.jsx";

export default function AccountPage() {
  const page = useAccountPage();
  return (
    <Layout path="/compte" title="Mon compte" hideHeading performanceComparison={false} className="account-page">
      {!page.ready ? <Skeleton label="Chargement du compte…" lines={4} /> : <AccountLetter page={page} />}
    </Layout>
  );
}

// /connexion (VI-38). Accounts off (account-switch.js): the 404 page, as before. Static: no session read here.
import { notFound } from "next/navigation";
import SignInPage from "../../src/views/SignInPage.jsx";
import { accountFeatures } from "../../src/services/account-switch.js";

export const metadata = { title: "Connexion", robots: { index: false } };

export default function Page() {
  if (!accountFeatures().auth) notFound();
  return <SignInPage />;
}

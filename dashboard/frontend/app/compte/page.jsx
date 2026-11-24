// /compte (VI-38). Accounts off (account-switch.js): the 404 page, as before. Static: the session is read in the
// browser (services/account-state.js).
import { notFound } from "next/navigation";
import AccountPage from "../../src/views/AccountPage.jsx";
import { accountFeatures } from "../../src/services/account-switch.js";

export const metadata = { title: "Mon compte", robots: { index: false } };

export default function Page() {
  if (!accountFeatures().auth) notFound();
  return <AccountPage />;
}

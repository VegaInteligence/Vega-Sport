// /conditions-generales-de-vente: the sales terms of the paid subscriptions (Plus, Pro), for consumers, under French
// law. Public and static: outside the data providers and the account switch (route-data.js STATIC_PAGES).
// Text: src/content/legal-sale.jsx.
import LegalPage, { legalMetadata } from "../../src/views/LegalPage.jsx";
import { sale } from "../../src/content/legal-sale.jsx";

export const metadata = legalMetadata(sale);

export default function Page() {
  return <LegalPage page={sale} />;
}

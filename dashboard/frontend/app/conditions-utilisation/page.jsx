// /conditions-utilisation: the terms of service Google asks for before it publishes the sign-in app. Public and
// static: outside the data providers and the account switch (route-data.js STATIC_PAGES). Text: src/content/legal-terms.jsx.
import LegalPage, { legalMetadata } from "../../src/views/LegalPage.jsx";
import { terms } from "../../src/content/legal-terms.jsx";

export const metadata = legalMetadata(terms);

export default function Page() {
  return <LegalPage page={terms} />;
}

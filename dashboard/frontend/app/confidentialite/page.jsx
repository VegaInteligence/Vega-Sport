// /confidentialite: the privacy page Google asks for before it publishes the sign-in app. Public and static:
// outside the data providers and the account switch (route-data.js STATIC_PAGES). Text: src/content/legal-privacy.jsx.
import LegalPage, { legalMetadata } from "../../src/views/LegalPage.jsx";
import { privacy } from "../../src/content/legal-privacy.jsx";

export const metadata = legalMetadata(privacy);

export default function Page() {
  return <LegalPage page={privacy} />;
}

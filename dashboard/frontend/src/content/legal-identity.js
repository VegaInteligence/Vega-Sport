// The facts only the owner can supply, for the legal pages (/confidentialite, /conditions-utilisation).
// Fill a value (a string) and every page shows it in place of its « [À compléter : …] » field; while one is
// null, the pages carry the line « Version provisoire … » under their banner (src/views/LegalPage.jsx).
// publisherAddress may also be false: the address is then left out, with the comma before it.
export const legalIdentity = {
  publisherName: null,
  publisherAddress: null,
  contactEmail: null,
  applicableLaw: null,
};

/** What each field shows while it is empty: « [À compléter : <label>] ». */
export const legalFieldLabels = {
  publisherName: "nom ou raison sociale de l’éditeur",
  publisherAddress: "adresse postale de l’éditeur",
  contactEmail: "adresse e-mail de contact",
  applicableLaw: "droit applicable et tribunaux compétents",
};

/** Fields the owner may decide not to publish (value false). */
export const legalOptionalFields = new Set(["publisherAddress"]);

/** Fields rendered as a link once filled. */
export const legalFieldKinds = { contactEmail: "email" };

/** The fields still empty (null), in the order above; false is a decision, not a missing fact. */
export function missingLegalFields(identity = legalIdentity) {
  return Object.keys(legalFieldLabels).filter(
    (name) => identity[name] == null || identity[name] === "",
  );
}

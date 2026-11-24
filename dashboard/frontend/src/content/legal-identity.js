// The facts only the owner can supply, for the legal pages (/confidentialite, /conditions-utilisation).
// Fill a value (a string) and every page shows it in place of its « [À compléter : …] » field; while one is
// null, the pages carry the line « Version provisoire … » under their banner (src/views/LegalPage.jsx).
export const legalIdentity = {
  publisherName: null,
  publisherStatus: null,
  publisherAddress: null,
  contactEmail: null,
  publicationDirector: null,
  applicableLaw: null,
};

/** What each field shows while it is empty: « [À compléter : <label>] ». */
export const legalFieldLabels = {
  publisherName: "nom ou raison sociale de l’éditeur",
  publisherStatus:
    "statut de l’éditeur (particulier, entreprise individuelle, société…)",
  publisherAddress: "adresse postale de l’éditeur",
  contactEmail: "adresse e-mail de contact",
  publicationDirector: "nom du directeur de la publication",
  applicableLaw: "droit applicable et tribunaux compétents",
};

/** Fields rendered as a link once filled. */
export const legalFieldKinds = { contactEmail: "email" };

/** The fields still empty, in the order above. */
export function missingLegalFields(identity = legalIdentity) {
  return Object.keys(legalFieldLabels).filter(
    (name) => identity[name] == null || identity[name] === "",
  );
}

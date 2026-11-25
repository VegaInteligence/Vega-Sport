// The facts only the owner can supply, for the legal pages (/confidentialite, /conditions-utilisation,
// /conditions-generales-de-vente).
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

// The facts only the sales terms (/conditions-generales-de-vente) need: who sells, under which VAT status, which
// consumer mediator, and the prices, none validated yet (25 November 2026). Same rule as above: a string replaces
// the field « [À compléter : …] »; while one is null, the sales terms carry the « Version provisoire » line. None may
// be false. A price is written as shown: « 6,99 € ».
export const legalSale = {
  companyId: null,
  vatStatus: null,
  mediator: null,
  pricePlusMonthly: null,
  pricePlusYearly: null,
  priceProMonthly: null,
  priceProYearly: null,
};

export const legalSaleLabels = {
  companyId: "numéro SIRET de l’éditeur",
  vatStatus: "régime de TVA de l’éditeur",
  mediator: "nom et site du médiateur de la consommation",
  pricePlusMonthly: "prix mensuel de Plus",
  pricePlusYearly: "prix annuel de Plus",
  priceProMonthly: "prix mensuel de Pro",
  priceProYearly: "prix annuel de Pro",
};

/** The sales facts still empty (null), in the order above. */
export function missingSaleFields(sale = legalSale) {
  return Object.keys(legalSaleLabels).filter(
    (name) => sale[name] == null || sale[name] === "",
  );
}

// The owner's facts on the legal pages (src/content/legal-identity.js, LegalField in src/components/Legal.jsx).
// Failure modes and expected outcomes, written before the code:
//  F1 The module holds exactly the four facts the pages use: publisherName, publisherAddress, contactEmail,
//     applicableLaw (nothing left over from phase 1), all null until the owner answers.
//  F2 null: the field shows « [À compléter : <label>] » (a no-break space before the colon), marked `data-legal-field`, and a separator given with
//     `before` (« , ») is kept in front of it.
//  F3 false (publisherAddress only: the owner may decide not to publish a postal address): nothing at all is
//     drawn, separator included, so « édité par X, Y. » reads « édité par X. » — no dangling comma.
//  F4 a value: drawn as text, after its separator; contactEmail as a mailto: link.
//  F5 false on a field that is not optional is a mistake: it throws, as an unknown name does.
//  F6 missingLegalFields() lists the null fields only: false is a decision, not a missing fact; the
//     « Version provisoire » line goes once nothing is null.
//  F7 The sales terms (/conditions-generales-de-vente) have their own facts, in `legalSale` beside the four: the
//     SIRET, the VAT status, the consumer mediator and the four prices (Plus and Pro, by the month and by the year),
//     all null (no price is validated yet), each with its label; none of them is in `legalIdentity`.
//  F8 LegalField draws a sales fact as it draws the four: null → « [À compléter : <label>] », a value as text.
//  F9 missingSaleFields() lists the null sales facts; none of them may be false (a price or a mediator is never
//     « not published »): false throws.
import test from "node:test";
import assert from "node:assert/strict";
import { React, compile, renderToStaticMarkup, src } from "./support/render-component.mjs";

const identity = await src("content/legal-identity.js");
const brand = await src("brand-mark.js");

async function render(values, element, sale = {}) {
  // The logo's asterisk lives in its own component since the consent banner uses it too.
  const BrandAsterisk = await compile("components/BrandAsterisk.jsx", { "../brand-mark.js": brand });
  const Legal = await compile("components/Legal.jsx", {
    "./BrandAsterisk.jsx": BrandAsterisk,
    "../content/legal-identity.js": {
      ...identity,
      legalIdentity: { ...identity.legalIdentity, ...values },
      legalSale: { ...identity.legalSale, ...sale },
    },
  });
  return renderToStaticMarkup(element(Legal));
}
const sentence = (Legal) =>
  React.createElement(
    "p",
    null,
    "Édité par ",
    React.createElement(Legal.LegalField, { name: "publisherName" }),
    React.createElement(Legal.LegalField, { name: "publisherAddress", before: ", " }),
    ".",
  );

test("F1: exactly the four facts the pages use, all null", () => {
  assert.deepEqual(Object.keys(identity.legalIdentity).sort(), ["applicableLaw", "contactEmail", "publisherAddress", "publisherName"]);
  assert.deepEqual(Object.keys(identity.legalFieldLabels).sort(), Object.keys(identity.legalIdentity).sort());
  for (const value of Object.values(identity.legalIdentity)) assert.equal(value, null);
  assert.equal(identity.legalFieldLabels.publisherAddress, "adresse postale de l’éditeur");
});

test("F2: null shows the bracketed field after its separator", async () => {
  const html = await render({}, sentence);
  assert.match(html, /data-legal-field="publisherAddress"/);
  assert.match(html, /, <span[^>]*data-legal-field="publisherAddress"[^>]*>\[À compléter : adresse postale de l’éditeur\]<\/span>\.<\/p>$/);
});

test("F3: false draws nothing, separator included", async () => {
  const html = await render({ publisherName: "Hugo Exemple", publisherAddress: false }, sentence);
  assert.equal(html, "<p>Édité par Hugo Exemple.</p>");
});

test("F4: a value is drawn after its separator; the e-mail as a link", async () => {
  const html = await render({ publisherName: "Hugo Exemple", publisherAddress: "1 rue du Stade, Paris" }, sentence);
  assert.equal(html, "<p>Édité par Hugo Exemple, 1 rue du Stade, Paris.</p>");
  const mail = await render({ contactEmail: "contact@example.test" }, (Legal) => React.createElement(Legal.LegalField, { name: "contactEmail" }));
  assert.equal(mail, '<a href="mailto:contact@example.test">contact@example.test</a>');
});

test("F5: false on a required field, or an unknown name, throws", async () => {
  await assert.rejects(render({ contactEmail: false }, (Legal) => React.createElement(Legal.LegalField, { name: "contactEmail" })));
  await assert.rejects(render({}, (Legal) => React.createElement(Legal.LegalField, { name: "publisherStatus" })));
});

test("F6: missingLegalFields lists null fields only", () => {
  assert.deepEqual(identity.missingLegalFields({ publisherName: "X", publisherAddress: false, contactEmail: "a@b.test", applicableLaw: "Droit français" }), []);
  assert.deepEqual(identity.missingLegalFields({ publisherName: "X", publisherAddress: null, contactEmail: "a@b.test", applicableLaw: null }), ["publisherAddress", "applicableLaw"]);
});

const SALE_FIELDS = ["companyId", "mediator", "pricePlusMonthly", "pricePlusYearly", "priceProMonthly", "priceProYearly", "vatStatus"];

test("F7: the sales facts, beside the four, all null and labelled", () => {
  assert.deepEqual(Object.keys(identity.legalSale).sort(), SALE_FIELDS);
  assert.deepEqual(Object.keys(identity.legalSaleLabels).sort(), SALE_FIELDS);
  for (const value of Object.values(identity.legalSale)) assert.equal(value, null);
  for (const name of SALE_FIELDS) assert.ok(!(name in identity.legalIdentity), `${name} is not one of the four`);
  assert.equal(identity.legalSaleLabels.pricePlusMonthly, "prix mensuel de Plus");
});

test("F8: a sales fact is drawn as the four are", async () => {
  const field = (Legal) => React.createElement(Legal.LegalField, { name: "pricePlusMonthly" });
  assert.equal(
    await render({}, field),
    '<span class="legal-field" data-legal-field="pricePlusMonthly">[À compléter\u00a0: prix mensuel de Plus]</span>',
  );
  assert.equal(await render({}, field, { pricePlusMonthly: "6,99 €" }), "6,99 €");
});

test("F9: missingSaleFields lists null sales facts; false throws", async () => {
  assert.deepEqual(identity.missingSaleFields(), Object.keys(identity.legalSale));
  assert.deepEqual(
    identity.missingSaleFields({ ...Object.fromEntries(SALE_FIELDS.map((n) => [n, "x"])), mediator: null }),
    ["mediator"],
  );
  await assert.rejects(render({}, (Legal) => React.createElement(Legal.LegalField, { name: "mediator" }), { mediator: false }));
});

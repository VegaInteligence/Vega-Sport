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
import test from "node:test";
import assert from "node:assert/strict";
import { React, compile, renderToStaticMarkup, src } from "./support/render-component.mjs";

const identity = await src("content/legal-identity.js");
const brand = await src("brand-mark.js");

async function render(values, element) {
  // The logo's asterisk lives in its own component since the consent banner uses it too.
  const BrandAsterisk = await compile("components/BrandAsterisk.jsx", { "../brand-mark.js": brand });
  const Legal = await compile("components/Legal.jsx", {
    "./BrandAsterisk.jsx": BrandAsterisk,
    "../content/legal-identity.js": { ...identity, legalIdentity: { ...identity.legalIdentity, ...values } },
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

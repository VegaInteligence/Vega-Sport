// The checks of the preference document (src/contract.mjs). Failure modes: FAILURE_MODES.md,
// section 5 (C1 to C5; C6, the round trip, is in test/store.test.mjs and the end-to-end test).
// The site owns the document's shape: only the version, the size and what the base can store
// are checked here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContract, ContractError, CONTRACT_VERSION, MAX_DOCUMENT_BYTES } from "../src/contract.mjs";
import { contract } from "./support.mjs";

const refused = (value, code) =>
  assert.throws(() => checkContract(value), (error) => error instanceof ContractError && error.code === code, `${code}: ${JSON.stringify(value)?.slice(0, 60)}`);

test("the bounds: version 1, 2 MiB of compact JSON", () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(MAX_DOCUMENT_BYTES, 2 * 1024 * 1024);
});

test("C1: the document is a JSON object", () => {
  for (const value of [null, [], [contract()], "x", 1, true, undefined]) refused(value, "CONTRACT_INVALID");
});

test("C2: v is the number 1", () => {
  for (const v of [undefined, 0, 2, "1", 1.5, null, true]) refused({ ...contract(), v }, "CONTRACT_VERSION");
  refused({ theme: "dark" }, "CONTRACT_VERSION");
});

test("C3: 2 MiB of compact JSON at most, counted in UTF-8 bytes", () => {
  const base = JSON.stringify({ v: 1, pad: "" }).length;
  assert.equal(checkContract({ v: 1, pad: "x".repeat(MAX_DOCUMENT_BYTES - base) }).length, MAX_DOCUMENT_BYTES);
  refused({ v: 1, pad: "x".repeat(MAX_DOCUMENT_BYTES - base + 1) }, "CONTRACT_LIMIT");
  refused({ v: 1, pad: "é".repeat(MAX_DOCUMENT_BYTES / 2) }, "CONTRACT_LIMIT"); // two bytes each
});

test("C4: nothing else is checked: unknown keys, nations, nested objects, empty strings and nulls pass as sent", () => {
  const value = contract({ favourites: { clubs: [] }, future: { deep: [{ a: null, b: "" }] }, theme: null });
  assert.equal(checkContract(value), JSON.stringify(value));
  assert.equal(typeof checkContract({ v: 1 }), "string");
});

test("C5: a string the base cannot hold in jsonb is refused: NUL, lone surrogates", () => {
  for (const bad of ["a\u0000b", "\ud800", "x\udfffy", "\udc00\ud800"]) refused({ v: 1, lists: [{ name: bad }] }, "CONTRACT_INVALID");
  refused({ v: 1, ["k\u0000"]: 1 }, "CONTRACT_INVALID");
  // A pair is fine, so are a backslash before « u0000 » and the characters around them.
  for (const good of ["😀", "\\u0000", "\\\\ud800", "a\u0001b", " "]) assert.ok(checkContract({ v: 1, s: good }), good);
});

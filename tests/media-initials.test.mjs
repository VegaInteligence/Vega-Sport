// Initials and size scale of Media (crests and portraits), written before the code.
//
// Failure modes and expected outcomes:
//  I1 A club's initials are the first letter of its first and last words:
//     « Olympique de Marseille » → OM (not OD), « Bayer 04 Leverkusen » → BL (not B0).
//  I2 Punctuation and symbols are never initials: « (Real) Sociedad » → RS (not « (S »),
//     « 1. FC Köln » → 1K, « ⚽ Club » → C.
//  I3 A person's surname particle counts when it is capitalised (« Kevin De Bruyne » → KD) and is
//     skipped when it is not (« Virgil van Dijk » → VD, « Frenkie de Jong » → FJ). A club keeps
//     first and last word (« Racing Club De Lens » → RL).
//  I4 No name, or a name without a letter or digit (« », « — », « ??? »), gives "" : Media then
//     shows its neutral shell, never « — » or « ? ».
//  I5 At most two characters, upper case (or a caseless letter), letters or digits only.
//  S1 The size scale is a short ascending list, and the frontend rules (dashboard/frontend/
//     AGENTS.md) state the same list, so an agent reads the scale where it reads the rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  mediaInitials,
  MEDIA_SIZES,
} from "../dashboard/frontend/src/services/format.js";

test("I1 a club takes its first and last words", () => {
  assert.equal(mediaInitials("Olympique de Marseille"), "OM");
  assert.equal(mediaInitials("Olympique Lyonnais"), "OL");
  assert.equal(mediaInitials("Paris Saint-Germain"), "PS");
  assert.equal(mediaInitials("Bayer 04 Leverkusen"), "BL");
  assert.equal(mediaInitials("Arsenal"), "A");
});

test("I2 punctuation and symbols are skipped", () => {
  assert.equal(mediaInitials("(Real) Sociedad"), "RS");
  assert.equal(mediaInitials("1. FC Köln"), "1K");
  assert.equal(mediaInitials("⚽ Club"), "C");
  assert.equal(mediaInitials("élan béarnais"), "ÉB");
});

test("I3 a capitalised surname particle counts for a person only", () => {
  assert.equal(mediaInitials("Kevin De Bruyne", { person: true }), "KD");
  assert.equal(mediaInitials("Virgil van Dijk", { person: true }), "VD");
  assert.equal(mediaInitials("Frenkie de Jong", { person: true }), "FJ");
  assert.equal(mediaInitials("N'Golo Kanté", { person: true }), "NK");
  assert.equal(mediaInitials("Vinícius Júnior", { person: true }), "VJ");
  assert.equal(mediaInitials("Racing Club De Lens"), "RL");
});

test("I4 no usable name gives the neutral shell", () => {
  for (const name of ["", "   ", "—", "???", null, undefined, 42])
    assert.equal(mediaInitials(name), "", String(name));
});

test("I5 never more than two upper-case letters or digits", () => {
  const names = [
    "a b c d",
    "Ⅻ ⓐ ‘x’",
    "São Paulo FC",
    "Śląsk Wrocław",
    "Ferencvárosi TC",
    "İstanbul Başakşehir",
    "ß",
    "ßa ßb",
    "Al-Hilal Saudi FC",
  ];
  for (const name of names)
    for (const person of [false, true]) {
      const value = mediaInitials(name, { person });
      assert.match(value, /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{0,2}$/u, `${name} → ${value}`);
      assert.ok([...value].length <= 2, `${name} → ${value}`);
    }
});

test("S1 the size scale is written in the frontend rules", async () => {
  assert.ok(MEDIA_SIZES.length >= 5 && MEDIA_SIZES.length <= 10);
  assert.deepEqual([...MEDIA_SIZES].sort((a, b) => a - b), [...MEDIA_SIZES]);
  const rules = await readFile(
    new URL("../dashboard/frontend/AGENTS.md", import.meta.url),
    "utf8",
  );
  const line = rules.match(/^(?:- )?Sizes: (.+) px\.$/m);
  assert.ok(line, "dashboard/frontend/AGENTS.md has a « Sizes: … px. » line");
  assert.deepEqual(line[1].split(" · ").map(Number), [...MEDIA_SIZES]);
});

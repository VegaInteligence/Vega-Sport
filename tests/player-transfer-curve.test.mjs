// The clubs a player joins, on his market value curve (« Carrière et marché »): which
// transfers are drawn, which are listed, and where each club's badge sits above the line.
//
// Failure modes and expected outcomes, written before the two services:
//
// What is drawn and listed (services/career-moves.js; read and worded by services/player-transfers.js)
//  1. Transfers not read (the route answers 404): null, not an empty list. Another failure
//     is an error, never « no transfer ».
//  2. Transfers not read and no valuation names a club: nothing drawn, nothing listed.
//  3. Transfers not read, valuations name their club: one badge at the first valuation that
//     names a club and one at each valuation whose club differs from the last named one;
//     a valuation without a club changes nothing. They are estimates, said so, not transfers.
//  4. Transfers read: a move whose destination is no club is neither drawn nor listed. A row
//     without a valid date is dropped.
//  5. The curve starts with the club of the last move made on or before the first
//     valuation; without one, with the first valuation's own club; without either, with none.
//  6. Every later move is drawn at its own date, also after the last valuation. Two exceptions:
//     of several moves of one day the last one is drawn; a return from loan followed by another
//     move within 92 days is not drawn. Both stay in the list.
//  7. A loan made permanent shows the club twice (the loan, then the transfer): two facts.
//  8. Wording: a fee of nothing is not shown; a kind the provider does not give is an arrival.
//
// Found on the first real rows (production, 18 Nov 2026: Yamal, Mbappé, Giroud)
// 13. The provider lists youth and reserve sides as clubs (« FC Barcelona U19 », « AS Monaco
//     Youth », « FC Porto B »): one we do not hold is not a club joined, whatever the kind of
//     move, and not the curve's first club either. One of our teams always is a club (a
//     reserve side playing in a league we hold has its id).
// 14. A move inside a club is an arrival when it is the promotion to the first team (Yamal's
//     only move to « Barcelona »): drawn, listed, and the curve's first club when made before
//     the first valuation. A move inside the club he is already shown at is nothing.
// 15. The provider marks a dissolved club in its name (« Tours FC (- 2025) »): not shown.
//
// Where a badge sits (services/curve-badges.js), in the drawing's own units
//  9. A badge floats above the highest point of the line under its own width, not only above
//     the point at its date: on a slope it clears the line.
// 10. A badge that would cover an earlier one is raised above it, as often as needed.
// 11. A badge is never pushed back down onto another to stay in the drawing (three moves of
//     one winter near the curve's peak covered each other): the chart is told how far the
//     highest badge rises above its top edge, and grows by that much.
// 12. A badge's foot is on the line, and past the line's last point at the last point's height.
import test from "node:test";
import assert from "node:assert/strict";
import { careerMoves } from "../dashboard/frontend/src/services/career-moves.js";
import {
  loadPlayerTransfers,
  moveNote,
  moveTip,
} from "../dashboard/frontend/src/services/player-transfers.js";
import { badgeOverflow, placeBadges } from "../dashboard/frontend/src/services/curve-badges.js";
import { marketValue } from "../dashboard/frontend/src/services/player-market-values.js";

const club = (name, id) => (id ? { id, name, image_url: `https://img.test/${id}.png` } : { name });
const GRENOBLE = club("Grenoble", "t_gre"), TOURS = club("Tours"), MONTPELLIER = club("Montpellier", "t_mon");
const ARSENAL = club("Arsenal", "t_ars"), CHELSEA = club("Chelsea", "t_che"), LILLE = club("Lille", "t_lil");
const value = (date, valueEur, at) => (at ? { date, valueEur, club: at } : { date, valueEur });
const move = (date, kind, from, to, feeEur = null) => ({ date, kind, feeEur, from, to });
const drawn = (moves) => moves.curve.map((m) => `${m.at} ${m.club.name}`);
const listed = (moves) => moves.list.map((m) => `${m.date} ${m.club.name}`);

async function withFetch(reply, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => reply();
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("transfers never read are unknown, not none; another failure is an error", async () => {
  const rows = [move("2018-01-31", "transfer", ARSENAL, CHELSEA, 17000000)];
  assert.deepEqual(await withFetch(() => Response.json({ data: { id: "p_1", transfers: rows } }), () => loadPlayerTransfers("p_1")), rows);
  assert.deepEqual(await withFetch(() => Response.json({ data: { id: "p_1", transfers: [] } }), () => loadPlayerTransfers("p_1")), []);
  assert.equal(await withFetch(() => new Response("{}", { status: 404 }), () => loadPlayerTransfers("p_1")), null);
  await assert.rejects(withFetch(() => new Response("{}", { status: 500 }), () => loadPlayerTransfers("p_1")));
  await assert.rejects(withFetch(() => Response.json({ data: {} }), () => loadPlayerTransfers("p_1")));
});

test("without transfers and without a club on the valuations, nothing is drawn or listed", () => {
  assert.deepEqual(careerMoves([value("2020-01-01", 1e6), value("2021-01-01", 2e6)], null), { curve: [], list: [] });
  assert.deepEqual(careerMoves([], [move("2018-01-31", "transfer", ARSENAL, CHELSEA)]).curve, []);
});

test("without transfers, the valuations' clubs give the badges, as estimates", () => {
  const moves = careerMoves(
    [
      value("2019-06-01", 1e6),
      value("2019-12-01", 2e6, ARSENAL),
      value("2020-06-01", 3e6, ARSENAL),
      value("2020-12-01", 3e6),
      value("2021-06-01", 4e6, { id: "t_ars", name: "Arsenal FC" }),
      value("2021-12-01", 5e6, CHELSEA),
      value("2022-06-01", 5e6, TOURS),
      value("2022-12-01", 5e6, club("Tours")),
    ],
    null,
  );
  assert.deepEqual(drawn(moves), ["2019-12-01 Arsenal", "2021-12-01 Chelsea", "2022-06-01 Tours"]);
  assert.deepEqual(moves.list, moves.curve);
  assert.ok(moves.curve.every((m) => m.kind === "estimate"));
  assert.deepEqual(moveTip(moves.curve[1]), { title: "Chelsea", rows: [["Estimation", "01/12/2021"]] });
  assert.equal(moveNote(moves.curve[1]), "déc. 2021");
});

const GIROUD_VALUES = [value("2008-08-18", 50000, TOURS), value("2012-01-10", 9e6, MONTPELLIER), value("2018-06-01", 15e6, CHELSEA), value("2026-06-01", 9e5, LILLE)];

test("with transfers: the club of the first valuation, then every arrival at its date", () => {
  const moves = careerMoves(GIROUD_VALUES, [
    move("2005-07-01", "internal", club("Grenoble B"), GRENOBLE),
    move("2007-07-01", "loan", GRENOBLE, club("Istres")),
    move("2008-06-30", "loan_return", club("Istres"), GRENOBLE),
    move("2008-07-01", "transfer", GRENOBLE, TOURS, 150000),
    move("2010-07-01", "transfer", TOURS, MONTPELLIER, 2000000),
    move("2012-06-26", "transfer", MONTPELLIER, ARSENAL, 12000000),
    move("2018-01-31", "transfer", ARSENAL, CHELSEA, 17000000),
    move("2025-07-01", "free", club("Los Angeles FC"), LILLE, 0),
    move("not a date", "transfer", LILLE, ARSENAL),
    move("2026-02-30", "transfer", LILLE, ARSENAL),
  ]);
  assert.deepEqual(drawn(moves), ["2008-08-18 Tours", "2010-07-01 Montpellier", "2012-06-26 Arsenal", "2018-01-31 Chelsea", "2025-07-01 Lille"]);
  // The moves made before the curve are listed, his promotion to Grenoble's first team first.
  assert.deepEqual(listed(moves), [
    "2005-07-01 Grenoble", "2007-07-01 Istres", "2008-06-30 Grenoble", "2008-07-01 Tours", "2010-07-01 Montpellier", "2012-06-26 Arsenal", "2018-01-31 Chelsea", "2025-07-01 Lille",
  ]);
  // The first badge is the transfer that brought him there, drawn at the first valuation.
  const [start, , , chelsea, lille] = moves.curve;
  assert.deepEqual([start.at, start.date, start.kind, start.key], ["2008-08-18", "2008-07-01", "transfer", moves.list[3].key]);
  assert.deepEqual(moveTip(start), { title: "Grenoble → Tours", rows: [["Transfert", "01/07/2008"], ["Montant", marketValue(150000)]] });
  assert.deepEqual(moveTip(chelsea), { title: "Arsenal → Chelsea", rows: [["Transfert", "31/01/2018"], ["Montant", "17 M€"]] });
  assert.deepEqual(moveTip(lille), { title: "Los Angeles FC → Lille", rows: [["Transfert libre", "01/07/2025"]] });
  assert.equal(moveNote(chelsea), "janv. 2018 · 17 M€");
  assert.equal(moveNote(lille), "juil. 2025 · Libre");
  assert.equal(new Set(moves.list.map((m) => m.key)).size, moves.list.length);
});

test("the curve's first club: the last move before it, else the first valuation's own, else none", () => {
  const later = [move("2012-06-26", "transfer", MONTPELLIER, ARSENAL)];
  const own = careerMoves(GIROUD_VALUES, later);
  assert.deepEqual(drawn(own), ["2008-08-18 Tours", "2012-06-26 Arsenal"]);
  assert.deepEqual([own.curve[0].kind, own.curve[0].key], ["estimate", "start"]);
  assert.deepEqual(listed(own), ["2012-06-26 Arsenal"]);
  assert.deepEqual(drawn(careerMoves([value("2008-08-18", 50000), value("2026-06-01", 9e5, LILLE)], later)), ["2012-06-26 Arsenal"]);
  // A player who never moved: his club, once.
  assert.deepEqual(drawn(careerMoves(GIROUD_VALUES, [])), ["2008-08-18 Tours"]);
  // A move made on the day of the first valuation is where the curve starts.
  assert.deepEqual(drawn(careerMoves(GIROUD_VALUES, [move("2008-08-18", "loan", GRENOBLE, ARSENAL)])), ["2008-08-18 Arsenal"]);
});

test("a destination that is no club, a transit return and a same-day pair are not drawn", () => {
  const moves = careerMoves(
    [value("2018-06-01", 1e6, CHELSEA), value("2026-06-01", 2e7, ARSENAL)],
    [
      move("2019-01-15", "loan", CHELSEA, club("Vitesse")),
      move("2019-06-30", "loan_return", club("Vitesse"), CHELSEA),
      move("2019-08-20", "loan", CHELSEA, LILLE),
      move("2020-06-30", "loan_return", LILLE, CHELSEA),
      // Bought and lent back the same day: he plays on at Chelsea.
      move("2021-01-20", "transfer", CHELSEA, MONTPELLIER, 14000000),
      move("2021-01-20", "loan", MONTPELLIER, CHELSEA),
      move("2021-06-30", "loan_return", CHELSEA, MONTPELLIER),
      move("2022-07-01", "free", MONTPELLIER, null),
      move("2023-01-10", null, null, LILLE),
      // The loan made permanent: back to the lender on paper, bought the next day.
      move("2024-01-05", "loan", LILLE, ARSENAL),
      move("2024-06-30", "loan_return", ARSENAL, LILLE),
      move("2024-07-01", "transfer", LILLE, ARSENAL, 35000000),
    ],
  );
  assert.deepEqual(drawn(moves), [
    "2018-06-01 Chelsea", "2019-01-15 Vitesse", "2019-08-20 Lille", "2020-06-30 Chelsea", "2021-01-20 Chelsea", "2021-06-30 Montpellier",
    "2023-01-10 Lille", "2024-01-05 Arsenal", "2024-07-01 Arsenal",
  ]);
  assert.equal(moves.list.length, 11);
  assert.ok(moves.list.every((m) => m.date !== "2022-07-01"), "released: no club joined");
  assert.deepEqual(moveTip(moves.curve[6]), { title: "Lille", rows: [["Arrivée", "10/01/2023"]] });
  assert.equal(moveNote(moves.curve[6]), "janv. 2023");
  assert.equal(moveNote(moves.curve[1]), "janv. 2019 · Prêt");
  assert.equal(moveNote(moves.list[1]), "juin 2019 · Retour de prêt");
});

test("a return from loan is drawn when he stays: no other move within 92 days", () => {
  const stays = (next) => drawn(careerMoves([value("2018-06-01", 1e6, CHELSEA), value("2026-06-01", 2e7)],
    [move("2019-01-15", "loan", CHELSEA, LILLE), move("2019-06-30", "loan_return", LILLE, CHELSEA), move(next, "transfer", CHELSEA, ARSENAL)]));
  assert.ok(!stays("2019-09-30").includes("2019-06-30 Chelsea"), "92 days later: in transit");
  assert.ok(stays("2019-10-01").includes("2019-06-30 Chelsea"), "93 days later: he was back");
  // Released the day after his return: the move to no club still makes the return a transit.
  const released = careerMoves([value("2018-06-01", 1e6, CHELSEA), value("2026-06-01", 2e7)],
    [move("2019-01-15", "loan", CHELSEA, LILLE), move("2019-06-30", "loan_return", LILLE, CHELSEA), move("2019-07-01", "free", CHELSEA, null)]);
  assert.deepEqual(drawn(released), ["2018-06-01 Chelsea", "2019-01-15 Lille"]);
  assert.deepEqual(listed(released), ["2019-01-15 Lille", "2019-06-30 Chelsea"]);
});

test("a youth or reserve side we do not hold is no club; the promotion to the first team is an arrival", () => {
  const BARCA = club("Barcelona", "t_bar"), MONACO = club("Monaco", "t_asm"), PSG = club("Paris Saint-Germain", "t_psg");
  // Yamal as the provider lists him: his only move to « Barcelona » is inside the club.
  const yamal = careerMoves([value("2023-08-21", 2e7, BARCA), value("2026-07-22", 2e8, BARCA)], [
    move("2014-07-01", "free", club("CF La Torreta Youth"), club("FC Barcelona Youth")),
    move("2021-07-01", "internal", club("FC Barcelona Youth"), club("FC Barcelona U16")),
    move("2022-07-01", "internal", club("FC Barcelona U16"), club("FC Barcelona U19")),
    move("2023-07-01", "internal", club("FC Barcelona U19"), BARCA),
  ]);
  assert.deepEqual(drawn(yamal), ["2023-08-21 Barcelona"]);
  assert.deepEqual(listed(yamal), ["2023-07-01 Barcelona"]);
  assert.deepEqual(moveTip(yamal.curve[0]), { title: "FC Barcelona U19 → Barcelona", rows: [["Équipe première", "01/07/2023"]] });
  assert.equal(moveNote(yamal.list[0]), "juil. 2023 · Équipe première");
  // Mbappé: first valued in Monaco's under-19s (no club of ours: no first badge), promoted a month later.
  const mbappe = careerMoves([value("2015-12-02", 5e4, club("AS Monaco U19")), value("2026-07-22", 1.8e8, club("Real Madrid", "t_rma"))], [
    move("2013-07-01", "free", club("INF Clairefontaine Youth"), club("AS Monaco Youth")),
    move("2015-07-01", "internal", club("AS Monaco Youth"), club("AS Monaco U19")),
    move("2016-01-01", "internal", club("AS Monaco U19"), MONACO),
    move("2017-08-31", "loan", MONACO, PSG),
    move("2018-06-30", "loan_return", PSG, MONACO),
    move("2018-07-01", "transfer", MONACO, PSG, 180000000),
  ]);
  assert.deepEqual(drawn(mbappe), ["2016-01-01 Monaco", "2017-08-31 Paris Saint-Germain", "2018-07-01 Paris Saint-Germain"]);
  assert.deepEqual(listed(mbappe), ["2016-01-01 Monaco", "2017-08-31 Paris Saint-Germain", "2018-06-30 Monaco", "2018-07-01 Paris Saint-Germain"]);
  // Back and forth with the reserve side: nothing; a reserve side we hold is a club like another.
  const OURS_B = club("Barcelona B", "t_bab");
  const shuffled = careerMoves([value("2020-01-01", 1e6, BARCA), value("2026-01-01", 1e6, BARCA)], [
    move("2019-07-01", "internal", club("FC Barcelona U19"), BARCA),
    move("2021-01-10", "internal", BARCA, club("FC Barcelona Atlètic Reserves")),
    move("2021-03-01", "internal", club("FC Barcelona Atlètic Reserves"), BARCA),
    move("2022-07-01", "internal", BARCA, OURS_B),
    move("2023-07-01", "transfer", OURS_B, club("Villarreal CF B")),
    move("2024-07-01", "loan", club("Villarreal CF B"), club("B 93 Copenhagen")),
  ]);
  assert.deepEqual(drawn(shuffled), ["2020-01-01 Barcelona", "2022-07-01 Barcelona B", "2024-07-01 B 93 Copenhagen"]);
  assert.deepEqual(listed(shuffled), ["2019-07-01 Barcelona", "2022-07-01 Barcelona B", "2024-07-01 B 93 Copenhagen"]);
  // Without transfers: a valuation in a youth side changes nothing.
  const estimates = careerMoves([value("2015-12-02", 5e4, club("AS Monaco U19")), value("2016-06-01", 1e6, MONACO), value("2017-01-01", 2e6, club("AS Monaco B")), value("2018-01-01", 9e7, PSG)], null);
  assert.deepEqual(drawn(estimates), ["2016-06-01 Monaco", "2018-01-01 Paris Saint-Germain"]);
});

test("a dissolved club keeps its name without the provider's mark", () => {
  const TOURS_GONE = club("Tours FC (- 2025)");
  const moves = careerMoves([value("2008-08-18", 50000, club("Grenoble", "t_gre")), value("2012-01-10", 9e6)], [
    move("2008-09-01", "transfer", GRENOBLE, TOURS_GONE, 150000),
    move("2010-07-01", "transfer", TOURS_GONE, MONTPELLIER, 2000000),
    move("2011-07-01", "loan", MONTPELLIER, club("SC Bastia (1905 - 2017)")),
    move("2011-12-31", "loan", club("SC Bastia (1905 - 2017)"), club("SE Itapirense (SP)")),
  ]);
  assert.deepEqual(drawn(moves), ["2008-08-18 Grenoble", "2008-09-01 Tours FC", "2010-07-01 Montpellier", "2011-07-01 SC Bastia", "2011-12-31 SE Itapirense (SP)"]);
  assert.equal(moveTip(moves.curve[2]).title, "Tours FC → Montpellier");
  assert.deepEqual(drawn(careerMoves([value("2009-01-01", 1e6, TOURS_GONE), value("2010-01-01", 1e6, club("Tours FC"))], null)), ["2009-01-01 Tours FC"]);
});

const flat = [{ x: 0, y: 100 }, { x: 200, y: 100 }];

test("a badge floats above the line, clear of a slope under its own width", () => {
  assert.deepEqual(placeBadges(flat, [{ x: 50 }], { radius: 10, gap: 6 }), [{ x: 50, y: 84, footY: 100 }]);
  // Rising to the right: the line is 20 higher at the badge's right edge than at its date.
  const slope = [{ x: 0, y: 200 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
  const [badge] = placeBadges(slope, [{ x: 50 }], { radius: 10, gap: 6, margin: 0 });
  assert.deepEqual(badge, { x: 50, y: 150 - 10 - 6 - 10, footY: 150 });
  // A peak inside the badge's width counts, wherever it is between two samples.
  const peak = [{ x: 0, y: 100 }, { x: 55, y: 40 }, { x: 60, y: 100 }, { x: 200, y: 100 }];
  assert.equal(placeBadges(peak, [{ x: 50 }], { radius: 10, gap: 6, margin: 0 })[0].y, 40 - 6 - 10);
  assert.deepEqual(placeBadges(flat, [], { radius: 10 }), []);
});

test("a badge that would cover an earlier one is raised above it", () => {
  const placed = placeBadges(flat, [{ x: 50 }, { x: 60 }, { x: 70 }, { x: 150 }], { radius: 10, gap: 6, spacing: 4 });
  assert.deepEqual(placed.map((b) => b.y), [84, 60, 36, 84]);
  assert.ok(placed.every((b) => b.footY === 100));
  // Exactly a diameter and the spacing apart: side by side.
  assert.deepEqual(placeBadges(flat, [{ x: 50 }, { x: 74 }], { radius: 10, gap: 6, spacing: 4 }).map((b) => b.y), [84, 84]);
});

test("the chart is told how far the highest badge rises above its top edge", () => {
  const high = [{ x: 0, y: 20 }, { x: 200, y: 20 }];
  const stack = placeBadges(high, [{ x: 50 }, { x: 60 }, { x: 70 }], { radius: 10, gap: 6, spacing: 4 });
  // Raised above one another, never held back: 4, then 24 higher each.
  assert.deepEqual(stack.map((b) => b.y), [4, -20, -44]);
  assert.equal(badgeOverflow(stack, 10), 54);
  assert.equal(badgeOverflow(stack, 10, 2), 56);
  assert.equal(badgeOverflow(placeBadges(flat, [{ x: 50 }], { radius: 10, gap: 6 }), 10), 0);
  assert.equal(badgeOverflow([], 10), 0);
});

test("past the line's end a badge's foot is at the last height", () => {
  const ends = placeBadges([{ x: 0, y: 100 }, { x: 100, y: 60 }], [{ x: 160 }], { radius: 10, gap: 6 });
  assert.deepEqual(ends, [{ x: 160, y: 44, footY: 60 }]);
  // One point only (a single valuation).
  assert.deepEqual(placeBadges([{ x: 80, y: 90 }], [{ x: 80 }], { radius: 10, gap: 6 }), [{ x: 80, y: 74, footY: 90 }]);
});

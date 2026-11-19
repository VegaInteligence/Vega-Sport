// GET /api/players/{id}/transfers: a player's transfers, oldest first, only once they were
// read; and the club of each valuation in GET /api/player-market-values. The site draws the
// club a player joins on his value curve from them.
//
// Failure modes and expected outcomes, written before the route and the views (135):
//  1. Transfers never read (no successful read of the player's « transfers » unit): 404, not
//     an empty list — « never transferred » is not known. An unknown player: 404. Any
//     parameter: 400.
//  2. Read, and the provider lists none: { id, transfers: [] }.
//  3. Order: by date, oldest first; two moves of one day in the provider's order (its key,
//     read as a number), so a return from loan comes before the departure that follows it.
//  4. A club that is one of ours: its public id, our name, its crest when it has one. A club
//     we do not hold: the provider's name alone. A club neither holds a name for: null.
//  5. Not listed: a pending transfer (agreed, not yet made), a transfer without a date,
//     another source's rows.
//  6. A kind or a fee the provider does not give: null, never a guess.
//  7. A read that failed tells nothing: 404. Since 153 (VI-31, FAILURE_MODES.md §35), a refresh that fails after an
//     accepted read keeps that list, the same body; a read never accepted is still a 404. A doubted link shows nothing
//     of the provider: 404.
//  8. Values: a valuation's club is named the same way; a valuation without a known club
//     keeps its two fields only (the history of a player read before 135 is unchanged).
//  9. A provider name that is no club (« Without Club », « Retired », a career break, unknown:
//     the reader's NO_CLUB) is not a club joined or left: null, as an unnamed one. The list
//     of these names is the reader's, a test keeps the two equal.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { get, skip } from "./context.mjs";
import { NO_CLUB } from "../src/routes/profiles.mjs";

let owner, id;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  id = (await owner.query("SELECT api.public_id('player', 102) AS id")).rows[0].id;
});
after(() => owner?.end());

const OURS = { id: "t_aaaaa1", name: "Olympique Été", image_url: "https://img.example/t1.png" };
const OURS_WITHOUT_CREST = { id: "t_aaaaa2", name: "Racing Club" };
const THEIRS = { name: "FC Ailleurs" };

test("a player whose transfers were never read has no list, not an empty one", { skip }, async () => {
  assert.equal((await get(`/api/players/${id}/transfers`)).response.status, 404);
  assert.equal((await get("/api/players/p_zzzzz9/transfers")).response.status, 404);
  assert.equal((await get(`/api/players/${id}/transfers?season=2025/2026`)).response.status, 400);
});

test("once read: his transfers, oldest first, each club named as far as it is known", { skip }, async () => {
  await owner.query(`INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
                     VALUES ('player', 'transfermarkt', '987654', 102) ON CONFLICT DO NOTHING`);
  await owner.query(`INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at)
                     VALUES ('transfers', '987654', 3, now() + interval '30 days', now())`);
  assert.deepEqual((await get(`/api/players/${id}/transfers`)).body.data, { id, transfers: [] });

  await owner.query(`INSERT INTO core.provider_clubs(provider, provider_key, name, read_on)
                     VALUES ('transfermarkt', '3524', 'FC Ailleurs', '2026-11-16'), ('transfermarkt', '515', 'Without Club', '2026-11-16'),
                            ('transfermarkt', '123', 'Karriereende', '2026-11-16')`);
  await owner.query(
    `INSERT INTO core.player_transfers(player_id, transfer_date, from_team_id, to_team_id, kind, fee_eur, source, as_of, source_key,
       from_provider_club, to_provider_club, pending) VALUES
     (102, '2021-06-30', 2, NULL, NULL, NULL, 'transfermarkt', '2026-11-16', '100', '900', '77777', false),
     (102, '2021-06-30', 1, 2, 'loan_return', NULL, 'transfermarkt', '2026-11-16', '99', '901', '900', false),
     (102, '2021-01-15', 2, 1, 'loan', 250000, 'transfermarkt', '2026-11-16', '50', '900', '901', false),
     (102, '2019-07-01', NULL, 2, 'transfer', 2000000, 'transfermarkt', '2026-11-16', '7', '3524', '900', false),
     (102, '2018-07-01', NULL, NULL, 'free', NULL, 'transfermarkt', '2026-11-16', '3', NULL, '3524', false),
     (102, '2022-07-01', 2, NULL, 'free', NULL, 'transfermarkt', '2026-11-16', '110', '900', '515', false),
     (102, '2023-01-10', NULL, 1, 'free', NULL, 'transfermarkt', '2026-11-16', '111', '515', '901', false),
     (102, '2024-06-30', 1, NULL, NULL, NULL, 'transfermarkt', '2026-11-16', '112', '901', '123', false),
     (102, NULL, 2, 1, 'transfer', NULL, 'transfermarkt', '2026-11-16', '101', '900', '901', false),
     (102, '2027-07-01', 2, 1, 'transfer', 9000000, 'transfermarkt', '2026-11-16', '102', '900', '901', true),
     (102, '2020-07-01', 1, 2, 'transfer', 1, 'other', '2026-11-16', NULL, NULL, NULL, false)`,
  );
  assert.deepEqual((await get(`/api/players/${id}/transfers`)).body.data.transfers, [
    { date: "2018-07-01", kind: "free", feeEur: null, from: null, to: THEIRS },
    { date: "2019-07-01", kind: "transfer", feeEur: 2000000, from: THEIRS, to: OURS_WITHOUT_CREST },
    { date: "2021-01-15", kind: "loan", feeEur: 250000, from: OURS_WITHOUT_CREST, to: OURS },
    { date: "2021-06-30", kind: "loan_return", feeEur: null, from: OURS, to: OURS_WITHOUT_CREST },
    { date: "2021-06-30", kind: null, feeEur: null, from: OURS_WITHOUT_CREST, to: null },
    // Without a club for six months, then retired: neither is a club.
    { date: "2022-07-01", kind: "free", feeEur: null, from: OURS_WITHOUT_CREST, to: null },
    { date: "2023-01-10", kind: "free", feeEur: null, from: null, to: OURS },
    { date: "2024-06-30", kind: null, feeEur: null, from: OURS, to: null },
  ]);

  // A refresh that failed after the accepted read keeps the accepted list (153); a read never accepted tells nothing.
  const accepted = await get(`/api/players/${id}/transfers`);
  await owner.query("UPDATE ops.transfermarkt_reads SET error_code = 'HTTP_500' WHERE kind = 'transfers' AND provider_key = '987654'");
  const failed = await get(`/api/players/${id}/transfers`);
  assert.equal(failed.response.status, 200);
  assert.deepEqual(failed.body, accepted.body);
  await owner.query("UPDATE ops.transfermarkt_reads SET read_at = NULL WHERE kind = 'transfers' AND provider_key = '987654'");
  assert.equal((await get(`/api/players/${id}/transfers`)).response.status, 404);
  await owner.query("UPDATE ops.transfermarkt_reads SET error_code = NULL, read_at = now() WHERE kind = 'transfers' AND provider_key = '987654'");
  assert.equal((await get(`/api/players/${id}/transfers`)).body.data.transfers.length, 8);
});

test("the history of values names the club of each valuation when it is known", { skip }, async () => {
  await owner.query("UPDATE core.player_market_values SET team_id = 1, provider_club = '901' WHERE player_id = 102 AND valued_at = '2026-06-02'");
  await owner.query("UPDATE core.player_market_values SET provider_club = '3524' WHERE player_id = 102 AND valued_at = '2025-06-01'");
  await owner.query(`INSERT INTO core.player_market_values(player_id, valued_at, value_eur, source, as_of, provider_club)
                     VALUES (102, '2024-06-01', 500000, 'transfermarkt', '2026-11-16', '77777'),
                            (102, '2023-06-01', 400000, 'transfermarkt', '2026-11-16', '515')`);
  assert.deepEqual((await get(`/api/player-market-values?id=${id}`)).body.data, {
    currency: "EUR", source: "Transfermarkt",
    history: [
      { date: "2023-06-01", valueEur: 400000 },
      { date: "2024-06-01", valueEur: 500000 },
      { date: "2025-06-01", valueEur: 0, club: THEIRS },
      { date: "2026-06-02", valueEur: 15000000, club: OURS },
    ],
  });
});

test("a doubted link shows nothing of the provider", { skip }, async () => {
  await owner.query(`INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                     VALUES ('player', 'transfermarkt', '987654', 102, 'snapshot', now(), 'birth_date')`);
  assert.equal((await get(`/api/players/${id}/transfers`)).response.status, 404);
});

test("the names that are no club are the reader's", () => {
  const source = readFileSync(new URL("../../vega/transfermarkt.py", import.meta.url), "utf8");
  const set = /^NO_CLUB = \{([^}]*)\}/m.exec(source);
  assert.ok(set, "transfermarkt.NO_CLUB not found");
  assert.deepEqual([...NO_CLUB].sort(), [...set[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]).sort());
});

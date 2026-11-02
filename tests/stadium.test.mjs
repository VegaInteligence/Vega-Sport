import test from "node:test";
import assert from "node:assert/strict";
import {
  extractStadium,
  fetchWikidataStadium,
} from "../dashboard/frontend/src/services/wikidata-stadium.js";

const time = (date, precision = 11) => ({
  time: `+${date}T00:00:00Z`,
  precision,
});
const statement = (v, rank = "normal", qualifiers) => ({
  rank,
  mainsnak: { datavalue: { value: v } },
  qualifiers,
});
const qualifier = (v) => [{ datavalue: { value: v } }];
const quantity = (amount) => ({ amount: `+${amount}`, unit: "1" });

test("stadium facts preserve capacity provenance, opening, creation and coordinates", () => {
  const entity = {
    claims: {
      P1083: [
        statement(quantity(80000), "normal", {
          P585: qualifier(time("2000-01-01")),
        }),
        statement(quantity(75817), "normal", {
          P585: qualifier(time("2022-09-25")),
        }),
      ],
      P1619: [statement(time("1926-09-19"))],
      P571: [statement(time("1925-08-00", 10))],
      P625: [
        statement({
          latitude: 45.478,
          longitude: 9.124,
          globe: "http://www.wikidata.org/entity/Q2",
        }),
      ],
    },
  };
  const data = extractStadium(
    entity,
    "Q133566",
    new Date("2026-11-02T00:00:00Z"),
  );
  assert.equal(data.capacity, 75817);
  assert.equal(data.capacityAsOf, "2022-09-25");
  assert.equal(data.opened, "1926-09-19");
  assert.equal(data.created, "1925-08");
  assert.deepEqual(data.coordinates, { lat: 45.478, lon: 9.124 });
  assert.equal(data.sourceUrl, "https://www.wikidata.org/wiki/Q133566");
});

test("ambiguous capacity and non-Earth coordinates are not invented", () => {
  const entity = {
    claims: {
      P1083: [statement(quantity(20000)), statement(quantity(30000))],
      P625: [
        statement({
          latitude: 20,
          longitude: 30,
          globe: "http://www.wikidata.org/entity/Q111",
        }),
      ],
      P1619: [statement(time("1900-00-00", 8))],
    },
  };
  const data = extractStadium(entity, "Q1");
  assert.equal(data.capacity, null);
  assert.equal(data.coordinates, null);
  assert.equal(data.opened, null);
});

test("expired preferred values do not mask an active capacity and year-only end is inclusive", () => {
  const entity = {
    claims: {
      P1083: [
        statement(quantity(500), "preferred", {
          P582: qualifier(time("2025-00-00", 9)),
        }),
        statement(quantity(1200), "normal", {
          P582: qualifier(time("2026-00-00", 9)),
        }),
        statement(quantity(5000), "normal", {
          P580: qualifier(time("2027-00-00", 9)),
        }),
      ],
    },
  };
  assert.equal(
    extractStadium(entity, "Q1", new Date("2026-11-02T00:00:00Z")).capacity,
    1200,
  );
});

test("stadium API accepts only an exact Wikidata identity", async () => {
  let called = false;
  const fetcher = async (url) => {
    called = true;
    assert.equal(new URL(url).searchParams.get("ids"), "Q133566");
    return Response.json({ entities: { Q133566: { claims: {} } } });
  };
  const result = await fetchWikidataStadium("Q133566", { fetcher });
  assert.equal(result.id, "Q133566");
  assert.equal(result.capacity, null);
  assert.ok(called);
  await assert.rejects(fetchWikidataStadium("Q1|Q2", { fetcher }));
});

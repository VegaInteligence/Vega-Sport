// Test preload (node --import): the OpenFootball files of $VEGA_TEST_OPENFOOTBALL in place of
// the network, for the real bridge and projection (test_source_snapshots.py, FAILURE_MODES.md §19).
// The file is {"editions": {"<competition>:<season>": <worldcup.json or euro.json body>}}. Any other
// URL answers 404, as an absent upstream file does.
import { readFileSync } from "node:fs";

const { editions } = JSON.parse(readFileSync(process.env.VEGA_TEST_OPENFOOTBALL, "utf8"));
const FILE = /^https:\/\/raw\.githubusercontent\.com\/openfootball\/(worldcup|euro)\.json\/master\/(\d{4})\/(?:worldcup|euro)\.json$/;

globalThis.fetch = async (url) => {
  const found = FILE.exec(String(url));
  const body = found && editions[`${found[1] === "euro" ? "euro" : "world-cup-history"}:${found[2]}`];
  return body === undefined || body === null ? new Response("Not Found", { status: 404 }) : Response.json(body);
};

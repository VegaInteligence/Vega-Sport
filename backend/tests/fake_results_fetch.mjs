// Test preload (node --import): International Results' results.csv from $VEGA_TEST_RESULTS_CSV in place of the
// network, for the real bridge and projection (test_collection_wakeups.py, FAILURE_MODES.md §37). Each request is
// counted: one line appended to $VEGA_TEST_FETCH_LOG per call of fetch, whatever its answer. With
// $VEGA_TEST_RESULTS_FAIL set, the source answers 503. Any other URL answers 404.
import { appendFileSync, readFileSync } from "node:fs";

const RESULTS = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";

globalThis.fetch = async (url) => {
  appendFileSync(process.env.VEGA_TEST_FETCH_LOG, String(url) + "\n");
  if (String(url) !== RESULTS) return new Response("Not Found", { status: 404 });
  if (process.env.VEGA_TEST_RESULTS_FAIL) return new Response("Service Unavailable", { status: 503 });
  return new Response(readFileSync(process.env.VEGA_TEST_RESULTS_CSV, "utf8"));
};

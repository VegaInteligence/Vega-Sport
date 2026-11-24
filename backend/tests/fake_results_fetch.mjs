// Test preload (node --import): International Results' results.csv from $VEGA_TEST_RESULTS_CSV and goalscorers.csv
// from $VEGA_TEST_GOALSCORERS_CSV in place of the network, for the real bridge and projection
// (test_collection_wakeups.py, FAILURE_MODES.md §37, §57). Each request is counted: one line appended to
// $VEGA_TEST_FETCH_LOG per call of fetch, whatever its answer. With $VEGA_TEST_RESULTS_FAIL set, both files answer 503;
// with $VEGA_TEST_GOALSCORERS_FAIL, goalscorers.csv alone. goalscorers.csv without $VEGA_TEST_GOALSCORERS_CSV, and any
// other URL, answer 404.
import { appendFileSync, readFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/martj42/international_results/master/";
const RESULTS = BASE + "results.csv", GOALS = BASE + "goalscorers.csv";

globalThis.fetch = async (url) => {
  appendFileSync(process.env.VEGA_TEST_FETCH_LOG, String(url) + "\n");
  if (String(url) !== RESULTS && String(url) !== GOALS) return new Response("Not Found", { status: 404 });
  if (process.env.VEGA_TEST_RESULTS_FAIL || (String(url) === GOALS && process.env.VEGA_TEST_GOALSCORERS_FAIL))
    return new Response("Service Unavailable", { status: 503 });
  const file = String(url) === RESULTS ? process.env.VEGA_TEST_RESULTS_CSV : process.env.VEGA_TEST_GOALSCORERS_CSV;
  if (!file) return new Response("Not Found", { status: 404 });
  return new Response(readFileSync(file, "utf8"));
};

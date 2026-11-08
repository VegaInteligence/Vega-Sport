import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function workflow(name) {
  return readFileSync(
    new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
}
function step(source, label) {
  const marker = `      - name: ${label}\n`;
  assert.ok(source.includes(marker), `missing step ${label}`);
  return source.split(marker)[1].split(/\n      - (?:name:|uses:)/)[0];
}
function condition(source) {
  const match = source.match(/(?:^|\n)\s+if: \$\{\{\s*(.*?)\s*\}\}/);
  assert.ok(match, "explicit status condition required");
  return new Function("steps", "cancelled", `return (${match[1]});`);
}
const success = { outcome: "success" },
  failure = { outcome: "failure" };
for (const name of ["collect-football", "uefa-standings"]) {
  test(`${name}: committed projection refresh survives publication failure but respects credential and cancellation`, () => {
    const source = workflow(name),
      refresh = step(source, "Refresh home projections after publication"),
      evaluate = condition(refresh);
    assert.equal(
      evaluate({ aws: success, publish: success }, () => false),
      true,
    );
    assert.equal(
      evaluate({ aws: success, publish: failure }, () => false),
      true,
    );
    assert.equal(
      evaluate({ aws: failure, publish: failure }, () => false),
      false,
    );
    assert.equal(
      evaluate({ aws: success, publish: failure }, () => true),
      false,
    );
    assert.doesNotMatch(refresh, /continue-on-error/);
    assert.match(refresh, /pipefail/);
    assert.match(refresh, /tee home-projection\.json/);
    const label =
      name === "collect-football"
        ? "Build serving tables from AWS staging"
        : "Publish normalized RDS tables from staged data";
    assert.match(step(source, label), /id: publish/);
    assert.doesNotMatch(step(source, label), /continue-on-error/);
    assert.match(source, /home-projection\.json/);
  });
}
test("rematerialize refresh respects plan, schema-only and home-only installation outcome", () => {
  const source = workflow("rematerialize"),
    refresh = step(source, "Refresh home projections after publication"),
    evaluate = condition(refresh);
  const state = (
    home,
    schema,
    publish = success,
    aws = success,
    plan = success,
  ) => ({
    aws,
    publish,
    plan: { ...plan, outputs: { home_only: home, schema_only: schema } },
  });
  assert.equal(
    evaluate(state("false", "false", success), () => false),
    true,
  );
  assert.equal(
    evaluate(state("false", "false", failure), () => false),
    true,
  );
  assert.equal(
    evaluate(state("false", "true", success), () => false),
    false,
  );
  assert.equal(
    evaluate(state("true", "false", failure), () => false),
    false,
  );
  assert.equal(
    evaluate(state("true", "false", success), () => false),
    true,
  );
  assert.equal(
    evaluate(state("false", "false", success, failure), () => false),
    false,
  );
  assert.equal(
    evaluate(state("false", "false", success, success, failure), () => false),
    false,
  );
  assert.equal(
    evaluate(state("false", "false"), () => true),
    false,
  );
  assert.doesNotMatch(refresh, /continue-on-error/);
  assert.doesNotMatch(
    step(source, "Publish relational models in AWS RDS"),
    /continue-on-error/,
  );
  assert.match(source, /home-projection\.json/);
  assert.match(source, /cron: "17 \* \* \* \*"/);
});

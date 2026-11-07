import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("explicit server timings remain available when request logging is disabled", () => {
  const module = new URL(
    "../dashboard/backend/services/metrics.js",
    import.meta.url,
  ).href;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { instrumentRequest, record } = await import(${JSON.stringify(module)});
    const response = await instrumentRequest(new Request('https://api.test/api/search?q=private'), async () => {
      record('sql_ms',17);
      record('pool_wait_ms',3);
      return new Response('{}');
    });
    console.log(JSON.stringify({timing:response.headers.get('Server-Timing')}));
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        STATARENA_METRICS_SAMPLE_RATE: "0",
        STATARENA_SERVER_TIMING: "1",
      },
    },
  );
  const { timing } = JSON.parse(output);
  assert.match(timing, /origin;dur=\d/);
  assert.match(timing, /sql;dur=17.00/);
  assert.match(timing, /pool;dur=3.00/);
  assert.ok(!output.includes("private"));
  assert.ok(!output.includes("statarena.request"));
});

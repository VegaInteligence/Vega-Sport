/** Production frontend acceptance against the configured AWS API. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.resolve(
  cwd,
  process.env.ORION_EVIDENCE_DIR || "outputs/aws-runtime",
);
await mkdir(evidence, { recursive: true });
const socket = net.createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const env = {
  ...process.env,
  ORION_EMBEDDED_API: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};
const child = Bun.spawn(
  [
    "node",
    "node_modules/next/dist/bin/next",
    "start",
    "frontend",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd, env, stdout: "pipe", stderr: "pipe" },
);
const logs = [];
const drains = [child.stdout, child.stderr].map(async (stream) => {
  for await (const chunk of stream) logs.push(new TextDecoder().decode(chunk));
});
try {
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await Bun.sleep(250);
  }
  if (!ready)
    throw new Error("AWS-backed production server did not become healthy");
  const check = Bun.spawn(
    [process.execPath, "scripts/verify_aws_runtime.mjs"],
    {
      cwd,
      env: {
        ...env,
        STATARENA_TEST_ORIGIN: base,
        STATARENA_TEST_EVIDENCE: path.join(evidence, "http-e2e.json"),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (await check.exited)
    throw new Error("AWS HTTP E2E failed; inspect http-e2e.json");
} finally {
  child.kill("SIGTERM");
  await child.exited;
  await Promise.all(drains);
  await writeFile(path.join(evidence, "server.log"), logs.join(""));
}

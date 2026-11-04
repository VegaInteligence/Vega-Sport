import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const evidence = path.resolve(
  root,
  process.env.STATARENA_CORE_EVIDENCE ||
    "docs/verification/aws-relational-core-20261104/after",
);
await mkdir(evidence, { recursive: true });
const tools =
  process.env.STATARENA_TEST_TOOLS || "/tmp/statarena-cache-test-tools";
const { default: Postgres } = await import(
  pathToFileURL(
    path.join(tools, "node_modules/embedded-postgres/dist/index.js"),
  ).href
);
const dir = await mkdtemp(path.join(tmpdir(), "statarena-relational-core-"));
const socket = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data() {} },
});
const port = socket.port;
socket.stop(true);
const logs = [];
const pg = new Postgres({
  databaseDir: path.join(dir, "db"),
  user: "fixture",
  password: "local-only-e2e",
  port,
  persistent: false,
  autoRehydrateSymlinks: true,
  onLog: (s) => logs.push(String(s)),
  onError: (s) => logs.push(String(s)),
});
let exitCode = 1;
const command = `STATARENA_CORE_EVIDENCE=${path.relative(root, evidence)} bun dashboard/scripts/verify_relational_core.mjs`;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("relational_core_e2e");
  const child = Bun.spawn(
    [
      "python3",
      "docs/verification/aws-relational-core-20261104/workflow.py",
      "--report",
      path.join(evidence, "results.json"),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        TEST_DATABASE_URL: `postgresql://fixture:local-only-e2e@127.0.0.1:${port}/relational_core_e2e`,
        PYTHONPATH:
          process.env.STATARENA_TEST_PYTHONPATH ||
          "/tmp/statarena-archive-remat-pg/python",
        STATARENA_E2E_COMMAND: command,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  exitCode = await child.exited;
  await writeFile(path.join(evidence, "python.log"), output.join("\n"));
  console.log(output.join("\n"));
  if (!exitCode && process.env.STATARENA_CORE_API === "1") {
    process.env.DATABASE_URL = `postgresql://fixture:local-only-e2e@127.0.0.1:${port}/relational_core_e2e?sslmode=disable`;
    process.env.STATARENA_DATA_PROVIDER = "aws";
    process.env.STATARENA_TEST_DATABASE = "1";
    process.env.STATARENA_METRICS_SAMPLE_RATE = "1";
    const { handleRequest } = await import("../backend/app.js");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: handleRequest,
    });
    try {
      const { verify } = await import("./verify_relational_api_cases.mjs");
      const report = await verify(`http://127.0.0.1:${server.port}`);
      await writeFile(
        path.join(evidence, "http.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
      if (report.status !== "passed") exitCode = 1;
      console.log(
        JSON.stringify({
          httpStatus: report.status,
          checks: report.checks.length,
        }),
      );
    } finally {
      server.stop(true);
      const { closeDatabase } = await import("../backend/services/postgres.js");
      await closeDatabase();
    }
  }
} finally {
  await pg.stop();
  await writeFile(path.join(evidence, "postgres.log"), logs.join("\n"));
  await writeFile(
    path.join(evidence, "RUN.json"),
    JSON.stringify(
      {
        command,
        setup:
          "Embedded PostgreSQL18 + actual Python source normalizer. Synthetic provider responses. No production, provider, S3 or JSON-file publication.",
        expected:
          "Typed relational publication, values/reference integrity, idempotence, isolation and atomic rollback.",
        exitCode,
      },
      null,
      2,
    ) + "\n",
  );
  await rm(dir, { recursive: true, force: true });
}
process.exitCode = exitCode;

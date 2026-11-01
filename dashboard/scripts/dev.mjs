import path from "node:path";
import { fileURLToPath } from "node:url";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
const apiPort = process.env.API_PORT || "8765";
const webPort = process.env.PORT || "3000";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  ORION_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
};
const commands = [
  [...(production ? [] : ["--watch"]), "backend/server.js", "--port", apiPort],
  [
    "node_modules/next/dist/bin/next",
    production ? "start" : "dev",
    "frontend",
    "--hostname",
    "127.0.0.1",
    "--port",
    webPort,
  ],
];
const children = commands.map((args) =>
  Bun.spawn([process.execPath, ...args], {
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
);
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
try {
  await Promise.race(
    children.map(async (child) => {
      const code = await child.exited;
      if (!stopped) process.exitCode = code || 1;
    }),
  );
} finally {
  stop();
  await Promise.all(children.map((child) => child.exited));
}

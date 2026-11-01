import { handleRequest } from "./app.js";
import { hostname, port } from "./config.js";

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("Request failed:", error.message);
      return new Response("Unable to serve request", { status: 500 });
    }
  },
  error() {
    return new Response("Unable to serve request", { status: 500 });
  },
});
console.log(`Dashboard: http://127.0.0.1:${server.port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });

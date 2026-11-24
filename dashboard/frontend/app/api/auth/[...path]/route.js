// Neon Auth's handler (VI-38): the browser's sign-in, sign-up, session and sign-out, same origin.
// Accounts off (account-switch.js): every method answers 404, as any unknown URL does.
import { neonAuth } from "../../../../src/server/neon-auth.js";

export const dynamic = "force-dynamic";

const notFound = () =>
  Response.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });

function handle(method) {
  return async (request, context) => {
    const auth = neonAuth();
    if (!auth) return notFound();
    const response = await auth.handler()[method](request, context);
    response.headers.set("cache-control", "no-store");
    return response;
  };
}

export const GET = handle("GET");
export const POST = handle("POST");
export const PUT = handle("PUT");
export const PATCH = handle("PATCH");
export const DELETE = handle("DELETE");

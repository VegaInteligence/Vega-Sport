// The account API, relayed from the site's own origin (VI-38, src/server/account-proxy.js): the five routes of
// backend/account/src/front.mjs, the Neon JWT added here. Every other /api/* URL stays with app/api/[...path].
import { handleAccountRequest } from "../../../../src/server/account-proxy.js";
import { neonAuth, sessionToken } from "../../../../src/server/neon-auth.js";
import { accountApiOrigin, accountFeatures } from "../../../../src/services/account-switch.js";

export const dynamic = "force-dynamic";

const handle = (request) =>
  handleAccountRequest(request, {
    features: accountFeatures(),
    upstream: accountApiOrigin(),
    getToken: () => sessionToken(neonAuth()),
  });

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;

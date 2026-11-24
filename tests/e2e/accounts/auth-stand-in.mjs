// A local stand-in for Neon Auth (VI-38 E2E only; never shipped): a real Better Auth server (Neon Auth is managed
// Better Auth, @neon/auth 0.8.2 depends on better-auth ~1.7.12) with e-mail and password, sign-up open, the JWT
// plugin (EdDSA / Ed25519, the key set at /.well-known/jwks.json) and the Email OTP plugin (six-digit codes for the
// address confirmation and the forgotten password, as Neon's « verification code » method), on the local
// PostgreSQL. Its cookies carry Neon's names (__Secure-neon-auth.*), which @neon/auth/next looks for.
// No e-mail leaves: the codes go to `outbox` ({ email, otp, type }), which the E2E reads as the person's mailbox.
// `requireVerification` (off by default, as Neon's branch was until this work): sign-in refused until the address
// is confirmed, a code sent at sign-up, none at sign-in, a session opened by the confirmation.
//
//   node tests/e2e/accounts/auth-stand-in.mjs     (AUTH_PORT=4100 SITE_ORIGIN=http://127.0.0.1:3100
//                                                  AUTH_DSN=postgresql://vega_test:local-only@127.0.0.1:5432/vega_site_auth_e2e)
//
// Differences with Neon, said in the report: the JWT's iss / aud are set to ISSUER below (the account front's
// verifier wants the origin of its auth URL, https); Google is not configured (its button shows the error path).
import http from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url);
const dashboard = new URL("../../../dashboard/", here);
const requireDashboard = createRequire(new URL("package.json", dashboard));
const requireAccount = createRequire(new URL("../../../backend/account/package.json", here));
const load = (name, from = requireDashboard) => import(pathToFileURL(from.resolve(name)).href);

export const ISSUER = "https://auth.stand-in.test";
export const BASE_PATH = "/neondb/auth";

export async function startAuthStandIn({
  port = Number(process.env.AUTH_PORT || 4100),
  siteOrigin = process.env.SITE_ORIGIN || "http://127.0.0.1:3100",
  dsn = process.env.AUTH_DSN || "postgresql://vega_test:local-only@127.0.0.1:5432/vega_site_auth_e2e",
  requireVerification = false,
  log = () => {},
} = {}) {
  const { default: pg } = await load("pg", requireAccount);
  // A fresh base for every run: the stand-in's users never outlive it.
  const admin = new pg.Client({ connectionString: dsn.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const name = new URL(dsn).pathname.slice(1);
  if (!/^vega_site_auth_e2e$/.test(name)) throw new Error("dedicated local base vega_site_auth_e2e required");
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const { betterAuth } = await load("better-auth");
  const { jwt, emailOTP } = await load("better-auth/plugins");
  const { getMigrations } = await load("better-auth/db/migration");
  const { toNodeHandler } = await load("better-auth/node");
  const pool = new pg.Pool({ connectionString: dsn, max: 4 });
  const outbox = [];
  const options = {
    appName: "Vega stand-in",
    baseURL: `http://127.0.0.1:${port}`,
    basePath: BASE_PATH,
    secret: "stand-in-secret-0123456789abcdef0123456789",
    database: pool,
    emailAndPassword: { enabled: true, requireEmailVerification: requireVerification, minPasswordLength: 8 },
    emailVerification: { sendOnSignUp: requireVerification, sendOnSignIn: false, autoSignInAfterVerification: true },
    trustedOrigins: [siteOrigin],
    advanced: { cookiePrefix: "neon-auth", useSecureCookies: true },
    rateLimit: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 900,
        allowedAttempts: 3,
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          outbox.push({ email, otp, type });
        },
      }),
      jwt({
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" }, jwksPath: "/.well-known/jwks.json" },
        jwt: { issuer: ISSUER, audience: ISSUER, expirationTime: "15m" },
      }),
    ],
    logger: { level: "error", log: (level, message) => log(`[auth ${level}] ${message}`) },
  };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  const auth = betterAuth(options);
  const handler = toNodeHandler(auth);
  const requests = [];
  const server = http.createServer((req, res) => {
    // The path only: never a body, a cookie or an address.
    requests.push(`${req.method} ${req.url.split("?")[0]}`);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}${BASE_PATH}`,
    jwksUrl: `http://127.0.0.1:${port}${BASE_PATH}/.well-known/jwks.json`,
    requests,
    pool,
    outbox,
    /** The codes sent to an address, oldest first; `type`: email-verification | forget-password | sign-in. */
    codes: (email, type) => outbox.filter((mail) => mail.email === email && (!type || mail.type === type)).map((mail) => mail.otp),
    /** Neon's deletion of a user, as the account front's Neon client would ask it. */
    async deleteUser(id) {
      const { rowCount } = await pool.query('DELETE FROM "user" WHERE id = $1', [id]);
      return { ok: true, status: rowCount ? 200 : 404 };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const standIn = await startAuthStandIn({ log: console.log });
  console.log(`auth stand-in on ${standIn.url}`);
}

import Page from "../src/views/OverviewPage.jsx";
import { cookies } from "next/headers";
import Providers from "./providers.jsx";
import { prepareHomeBootstrap } from "../src/server/home-bootstrap.js";
import {
  HOME_STATE_COOKIE,
  decodeHomeState,
} from "../src/services/home-bootstrap-preferences.js";
export const metadata = { title: "Vue d’ensemble — STATARENA" };
export default async function HomePage({ searchParams }) {
  const values = await searchParams;
  const params = new URLSearchParams(
    Object.entries(values || {}).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]],
    ),
  );
  const saved = decodeHomeState(
    (await cookies()).get(HOME_STATE_COOKIE)?.value,
  );
  let bootstrap = null;
  try {
    bootstrap = await prepareHomeBootstrap(params, saved);
  } catch {
    // The ordinary client reader retains its visible retry/error behavior.
  }
  return (
    <Providers home bootstrap={bootstrap}>
      <Page />
    </Providers>
  );
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportPublicData } from "../dashboard/scripts/export_public_data.mjs";
import { remoteDataUrl } from "../dashboard/backend/services/data-store.js";
import { dataUrl } from "../dashboard/frontend/src/data-url.js";

const revision = "1234567890abcdef1234567890abcdef12345678";

test("the build publishes versioned football data without the private source tree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "statarena-assets-"));
  try {
    await fs.mkdir(path.join(root, "data/raw/seasons"), { recursive: true });
    await fs.mkdir(path.join(root, "data/computed/dashboard"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "data/sources"), { recursive: true });
    await fs.writeFile(
      path.join(root, "data/raw/seasons/match.json.gz"),
      "match",
    );
    await fs.writeFile(
      path.join(root, "data/computed/dashboard/index.json"),
      "{}",
    );
    await fs.writeFile(path.join(root, "data/sources/private.txt"), "private");
    const target = await exportPublicData(
      path.join(root, "data"),
      path.join(root, "public"),
      revision,
    );
    assert.equal(
      await fs.readFile(path.join(target, "raw/seasons/match.json.gz"), "utf8"),
      "match",
    );
    assert.equal(
      await fs.readFile(
        path.join(target, "computed/dashboard/index.json"),
        "utf8",
      ),
      "{}",
    );
    await assert.rejects(fs.access(path.join(target, "sources/private.txt")));
    await assert.rejects(
      exportPublicData(
        path.join(root, "data"),
        path.join(root, "public"),
        "../bad",
      ),
    );
  } finally {
    const parent = await fs.realpath(os.tmpdir());
    const target = await fs.realpath(root);
    if (
      path.dirname(target) !== parent ||
      !path.basename(target).startsWith("statarena-assets-")
    )
      throw new Error("Unexpected temporary directory");
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("browser and server use the same deployment-specific data", () => {
  const names = [
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "NEXT_PUBLIC_DATA_REVISION",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_SHA = revision;
    process.env.VERCEL_PROJECT_PRODUCTION_URL =
      "statarena-analytics.vercel.app";
    process.env.NEXT_PUBLIC_DATA_REVISION = revision;
    assert.equal(
      dataUrl("dashboard-manifest.json"),
      `/assets/${revision}/computed/dashboard/index.json`,
    );
    assert.equal(
      remoteDataUrl("raw/index.json"),
      `https://statarena-analytics.vercel.app/assets/${revision}/raw/index.json`,
    );
    assert.throws(() => remoteDataUrl("raw/../private"), /Invalid data path/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

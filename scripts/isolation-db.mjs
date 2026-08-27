#!/usr/bin/env node
/**
 * The isolation suite's substrate: a bare `postgres:17` container.
 *
 * Deliberately *not* `supabase start`. Measured on 2026-08-27 in a scratch
 * container: cold start 31s against 541s, warm 0.66s against 27s, 161MB
 * compressed against ~8.5GB across twelve containers, and a full
 * drop -> migrate -> sweep cycle in 2.22s against 15-26s. Every acceptance
 * criterion the isolation suite checks is a catalog or SQL fact, and bare
 * Postgres proves all of them -- including role-tier isolation inside a
 * tenant. `ltree`, `pgcrypto`, `btree_gist`, `pg_trgm` and `gen_random_uuid()`
 * are all in the stock image.
 *
 * The trade, stated rather than hidden: bare Postgres grants *more* than
 * Supabase does, so a migration that is green here can still fail to apply to
 * a real project. See the deferred-work entry; the mitigation is portability
 * discipline in the migration itself.
 *
 * Usage
 *   node scripts/isolation-db.mjs up     # start and wait for readiness
 *   node scripts/isolation-db.mjs down   # remove the container
 *   node scripts/isolation-db.mjs url    # print the admin connection string
 *
 * In CI there is no container to start: the workflow runs a `services:
 * postgres` container and sets ISOLATION_DATABASE_URL, and `up` then only
 * waits for it. That is what makes this file usable identically by a
 * developer and by CI -- one command, either substrate.
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CONTAINER = "aira-isolation-db";
const IMAGE = "postgres:17";
const PORT = process.env.ISOLATION_DB_PORT ?? "54329";

/**
 * `?sslmode=disable` is not optional. Supabase CLI 2.116 negotiates TLS by
 * default and fails against a stock Postgres container before it applies
 * anything.
 */
export const DEFAULT_ADMIN_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;

export const adminUrl = () => process.env.ISOLATION_DATABASE_URL ?? DEFAULT_ADMIN_URL;

/** True when something other than this script owns the database. */
const externallyProvided = () => Boolean(process.env.ISOLATION_DATABASE_URL);

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", ...options });

const dockerAvailable = () => run("docker", ["version", "--format", "{{.Server.Os}}"]).status === 0;

function containerState() {
  const result = run("docker", ["inspect", "-f", "{{.State.Status}}", CONTAINER]);
  return result.status === 0 ? result.stdout.trim() : null;
}

async function waitForReady(probe, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (probe()) return;
    await sleep(500);
  }
  throw new Error(`${label} did not become ready within 60s`);
}

async function up() {
  if (externallyProvided()) {
    // CI: the service container is already running. Prove it answers before
    // handing the URL to the migration runner, so a slow start reads as a
    // wait rather than as a migration failure.
    await waitForReady(
      () => run("node", ["-e", readyProbe(process.env.ISOLATION_DATABASE_URL)]).status === 0,
      `the database at ISOLATION_DATABASE_URL`,
    );
    process.stdout.write(`isolation db: using ISOLATION_DATABASE_URL\n`);
    return;
  }

  if (!dockerAvailable()) {
    throw new Error(
      "Docker is not running. Start Docker, or point ISOLATION_DATABASE_URL at a Postgres 17 you already have.",
    );
  }

  const state = containerState();
  if (state === null) {
    const created = run("docker", [
      "run",
      "-d",
      "--name",
      CONTAINER,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_DB=postgres",
      "-p",
      `${PORT}:5432`,
      IMAGE,
    ]);
    if (created.status !== 0) throw new Error(`docker run failed: ${created.stderr}`);
  } else if (state !== "running") {
    const started = run("docker", ["start", CONTAINER]);
    if (started.status !== 0) throw new Error(`docker start failed: ${started.stderr}`);
  }

  await waitForReady(
    () => run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres", "-q"]).status === 0,
    `container ${CONTAINER}`,
  );
  process.stdout.write(`isolation db: ${DEFAULT_ADMIN_URL}\n`);
}

/** A one-liner the readiness loop can run in a child process. */
const readyProbe = (url) =>
  `import("pg").then(async (m)=>{const c=new m.default.Client(${JSON.stringify(url)});await c.connect();await c.end();}).catch(()=>process.exit(1))`;

function down() {
  if (externallyProvided()) return;
  run("docker", ["rm", "-f", CONTAINER]);
}

const command = process.argv[2] ?? "up";
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === "up") await up();
  else if (command === "down") down();
  else if (command === "url") process.stdout.write(`${adminUrl()}\n`);
  else {
    process.stderr.write(`unknown command: ${command}\n`);
    process.exit(1);
  }
}

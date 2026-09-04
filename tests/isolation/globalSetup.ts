/**
 * Brings the substrate to a known state, once, before the isolation project
 * runs: drop, migrate, bootstrap the app login role, seed two tenants.
 *
 * Migrations are applied with `supabase migration up --db-url`, not `psql -f`.
 * The CLI is the runner that will apply these same files to the real project,
 * and it writes `supabase_migrations.schema_migrations` as it goes -- so a
 * migration that the CLI rejects fails here rather than in production. It is
 * pinned as a devDependency for exactly that reason: the local and CI versions
 * cannot drift.
 *
 * Everything is dropped first. The suite must be re-runnable against a
 * container that is already migrated, and a migration whose effect depends on
 * what was already there is a migration that has not really been tested.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURES } from "./support/fixtures";
import {
  ADMIN_URL,
  APP_PASSWORD,
  APP_ROLE,
  assertAppRoleCannotBypassRls,
  installSupabaseDefaultPrivileges,
  withAdmin,
} from "./support/substrate";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Test-substrate only, and deliberately not in a migration. A login role with
 * a known password has no business in a schema that ships. Supabase provides
 * `authenticator` itself; here it has to be made.
 *
 * NOINHERIT matters: `authenticator` must hold no privilege until a request
 * explicitly switches into `authenticated`.
 */
const BOOTSTRAP_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} login password '${APP_PASSWORD}' noinherit;
  end if;
end
$$;
grant anon, authenticated to ${APP_ROLE};
alter role ${APP_ROLE} nosuperuser nocreatedb nocreaterole nobypassrls;
`;

async function reset(): Promise<void> {
  await withAdmin(async (client) => {
    // `supabase_migrations` too, or the runner believes the dropped migrations
    // are still applied and silently applies nothing.
    await client.query("drop schema if exists supabase_migrations cascade");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query("grant usage on schema public to public");
  });
}

/**
 * Makes the container as permissive as the real project, BEFORE migrating.
 *
 * This is the fix for a whole class of defect the gate could not see, and the
 * class runs the opposite way from the one Story 1.4 worried about.
 *
 * Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
 * authenticated` in `public`, from both `postgres` and `supabase_admin`. Every
 * table a migration creates there is therefore BORN fully writable by both
 * request roles, and a later `grant select ... to authenticated` adds nothing.
 * A bare `postgres:17` container has no default ACLs at all, so the identical
 * migration produced the intended narrow grants here and a wide-open table in
 * production. Measured on the live project after Story 1.6 was applied:
 *
 *   public.memberships relacl:  anon = arwdDxtm | authenticated = arwdDxtm
 *
 * on a table designed to have no write surface whatsoever. RLS still held, so
 * nothing leaked -- but "refused by privilege" had silently become "filtered
 * to zero rows", which is the distinction the design turns on.
 *
 * The container was the STRICTER substrate, which is the direction nobody
 * checks. `docs/07` and `scripts/isolation-db.mjs` both record the opposite
 * trade -- "bare Postgres grants more than Supabase does" -- and that framing
 * is what made this invisible: it is true of what a ROLE may do and false of
 * what a TABLE is born with.
 *
 * So the container now inherits the same defaults. A migration that creates a
 * table and forgets to revoke produces `arwdDxtm` here too, and the privilege
 * assertion in `catalog-sweep.test.ts` fails on it locally, in CI, before it
 * can reach a project where it would be real.
 *
 * The roles have to exist first: `20260827000000` creates them, but default
 * privileges must be installed before the tables they apply to, so the guarded
 * `create role` is repeated here. Dropping `public` in `reset()` drops the
 * default ACL entries with it -- they are keyed on the schema -- which is why
 * this runs on every setup rather than once.
 */
async function simulateSupabaseDefaultPrivileges(): Promise<void> {
  // The statements live in `support/substrate.ts` so that this and the
  // negative control in `catalog-sweep.test.ts` cannot drift apart -- one of
  // them installs the hazard to exercise the migrations against it, the other
  // installs it to prove the privilege reader can see it, and they have to be
  // describing the same substrate for either to mean anything.
  await withAdmin(installSupabaseDefaultPrivileges);
}

/**
 * The pinned CLI, resolved from `node_modules/.bin` rather than through
 * `npx`.
 *
 * `npx supabase` undercuts the exact-version pin it exists to protect: on a
 * cold `node_modules` it fetches whatever version the registry offers and runs
 * that, silently, instead of failing. The binary is a devDependency; if it is
 * missing, the right outcome is an error naming `npm ci`.
 */
function supabaseBinary(): string {
  const binary = resolve(ROOT, "node_modules/.bin/supabase" + (process.platform === "win32" ? ".cmd" : ""));
  if (!existsSync(binary)) {
    throw new Error(
      `The pinned Supabase CLI is not installed at ${binary}. Run \`npm ci\`. ` +
        `Falling back to \`npx supabase\` would apply migrations with an unpinned version.`,
    );
  }
  return binary;
}

function migrate(): void {
  const result = spawnSync(
    supabaseBinary(),
    ["migration", "up", "--db-url", ADMIN_URL],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `supabase migration up failed (exit ${String(result.status)}).\n` +
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

async function bootstrapAndSeed(): Promise<void> {
  await withAdmin(async (client) => {
    await client.query(BOOTSTRAP_SQL);
    for (const fixture of FIXTURES) {
      await fixture.seed(client);
    }
  });
}

export async function setup(): Promise<void> {
  await reset();
  // Before `migrate()`, not after: a default ACL applies to objects created
  // while it is in force, so installing it afterwards would change nothing
  // about the tables the migrations just made.
  await simulateSupabaseDefaultPrivileges();
  migrate();
  await bootstrapAndSeed();
  await assertAppRoleCannotBypassRls();
}

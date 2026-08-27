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
  migrate();
  await bootstrapAndSeed();
  await assertAppRoleCannotBypassRls();
}

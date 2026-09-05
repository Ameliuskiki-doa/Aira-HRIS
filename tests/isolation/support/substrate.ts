/**
 * Connections to the isolation substrate, and the ways a request reaches it.
 *
 * Two roles, and the difference between them is the whole point:
 *
 *   - the **admin** connection is the migration runner and the fixture writer.
 *     It is a superuser, which means RLS does not apply to it *even with FORCE*
 *     -- verified, not assumed. Nothing that asserts isolation may use it.
 *   - the **app** connection logs in as `authenticator`, a non-superuser with
 *     no privileges of its own, and each request switches into `authenticated`
 *     or `anon` for the duration of one transaction. That is the shape a
 *     PostgREST request actually has, and it is the only shape an isolation
 *     assertion is allowed to take.
 *
 * There is deliberately no third connection. No `service_role`, no bypass
 * role, nothing that can see across tenants -- CLAUDE.md rule 5, and the
 * reason a "just check the fixture really is there" shortcut is not available.
 */
import { Client } from "pg";

import { adminUrl } from "../../../scripts/isolation-db.mjs";

export const ADMIN_URL: string = adminUrl();

/**
 * The login role the isolation assertions use. Created by the test bootstrap,
 * never by a migration: a login role with a known password belongs to the test
 * substrate, not to a production schema.
 */
export const APP_ROLE = "authenticator";
export const APP_PASSWORD = "authenticator";

export const APP_URL: string = (() => {
  const url = new URL(ADMIN_URL);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
})();

/** The claim set a request carries. Mirrors the Custom Access Token Hook. */
export type Principal = {
  /** auth.users.id -- the JWT `sub`. */
  userId: string;
  /** companies.id, from `app_metadata`. Null for a signup with no tenant yet. */
  tenantId: string | null;
};

/** The two roles a PostgREST request can become. */
export type RequestRole = "authenticated" | "anon";

/**
 * How `request.jwt.claims` is set for one transaction.
 *
 * `unset` and `raw: ""` are **different states and both are reachable**.
 * PostgREST clears `request.*` GUCs to the empty string on a pooled
 * connection rather than unsetting them, so `raw: ""` is the likely anonymous
 * path -- and it raised `22P02` until the claim functions were fixed. An
 * earlier version of this file offered only `unset`, the one variant that
 * happened to behave.
 */
export type ClaimSource =
  | { kind: "principal"; principal: Principal }
  | { kind: "raw"; value: string }
  | { kind: "unset" };

export const claimsJson = (principal: Principal) =>
  JSON.stringify({
    sub: principal.userId,
    role: "authenticated",
    app_metadata: principal.tenantId === null ? {} : { tenant_id: principal.tenantId },
  });

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs `fn` as the superuser. Migrations and fixtures only. */
export async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(ADMIN_URL);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Runs `fn` inside one transaction as `role`, carrying `claims`.
 *
 * Both settings are `set local`, so they die with the transaction and cannot
 * leak into the next caller.
 */
export async function asRequest<T>(
  options: { role?: RequestRole; claims: ClaimSource; rollback?: boolean },
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const role: RequestRole = options.role ?? "authenticated";
  const client = await connect(APP_URL);
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    if (options.claims.kind === "principal") {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        claimsJson(options.claims.principal),
      ]);
    } else if (options.claims.kind === "raw") {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        options.claims.value,
      ]);
    }
    const result = await fn(client);
    // `rollback: true` is how a test proves a *successful* write is permitted
    // without leaving the row behind for the next suite to trip over.
    await client.query(options.rollback ? "rollback" : "commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** The common case: one authenticated principal, or no claim at all. */
export const asPrincipal = <T>(
  principal: Principal | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> =>
  asRequest(
    { role: "authenticated", claims: principal ? { kind: "principal", principal } : { kind: "unset" } },
    fn,
  );

/** An unauthenticated request. `anon` must never see a row, by any route. */
export const asAnon = <T>(fn: (client: Client) => Promise<T>): Promise<T> =>
  asRequest({ role: "anon", claims: { kind: "unset" } }, fn);

export type PrivilegeIdentity = {
  identity: string;
  name: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
};

/**
 * The privileges the app connection actually holds.
 *
 * Returned rather than asserted, so the assertion can live in a test file
 * where deleting it is visible, instead of being a single line in globalSetup
 * whose removal would make every purity assertion vacuous in silence.
 * `globalSetup` calls it too, to fail fast with a clear message.
 *
 * Both identities matter. `session_user` is the login role the connection was
 * opened as; `current_user` is the role the request switched into. Either one
 * carrying superuser or BYPASSRLS makes the whole suite meaningless, and only
 * `pg_roles` sees both -- `pg_user` filters to roles that can log in, so the
 * switched-into role is simply absent from it.
 */
export async function appRolePrivileges(): Promise<PrivilegeIdentity[]> {
  return asPrincipal(null, async (client) => {
    const { rows } = await client.query<PrivilegeIdentity>(
      `select 'session_user' as identity, r.rolname as name, r.rolsuper, r.rolbypassrls
         from pg_roles r where r.rolname = session_user
       union all
       select 'current_user', r.rolname, r.rolsuper, r.rolbypassrls
         from pg_roles r where r.rolname = current_user`,
    );
    return rows;
  });
}

export async function assertAppRoleCannotBypassRls(): Promise<void> {
  const identities = await appRolePrivileges();
  if (identities.length < 2) {
    throw new Error(
      `Expected both session_user and current_user to resolve in pg_roles; got ${JSON.stringify(identities)}.`,
    );
  }
  for (const identity of identities) {
    if (identity.rolsuper || identity.rolbypassrls) {
      throw new Error(
        `The isolation suite's ${identity.identity} (${identity.name}) can bypass RLS ` +
          `(rolsuper=${String(identity.rolsuper)}, rolbypassrls=${String(identity.rolbypassrls)}). ` +
          `Every isolation assertion would pass vacuously.`,
      );
    }
  }
}

/**
 * The default privileges a real Supabase project ships in `public`.
 *
 * Verbatim in effect, not in spirit: `ALTER DEFAULT PRIVILEGES ... GRANT ALL
 * ON TABLES TO anon, authenticated`, from `postgres` and from
 * `supabase_admin`. Every table a migration creates there is BORN with all
 * eight privileges for both request roles; a bare `postgres:17` container
 * ships none of this, so the identical migration produced a narrow table here
 * and a wide-open one in production. `public.memberships` -- designed with no
 * write surface at all -- was `arwdDxtm` for both roles on the live project.
 *
 * Exported rather than inlined in `globalSetup` because two callers need the
 * same definition and they must not drift: `globalSetup` installs it before
 * migrating, so the migrations are exercised against the hostile substrate;
 * `catalog-sweep.test.ts` installs it inside a rolled-back transaction to
 * prove the privilege reader actually sees a table born under it.
 *
 * `for role` is deliberately omitted: a default ACL is keyed on the role that
 * CREATES the object, so targeting the current role is what reproduces the
 * mechanism that matters.
 */
export const SUPABASE_DEFAULT_PRIVILEGES: readonly string[] = [
  "alter default privileges in schema public grant all on tables to anon, authenticated",
  "alter default privileges in schema public grant all on sequences to anon, authenticated",
  "alter default privileges in schema public grant all on functions to anon, authenticated",
];

/** The guarded role creation those grants need in a bare container. */
export const REQUEST_ROLE_BOOTSTRAP = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;`;

/** Installs them on an open connection. Transactional, so it can be rolled back. */
export async function installSupabaseDefaultPrivileges(client: Client): Promise<void> {
  await client.query(REQUEST_ROLE_BOOTSTRAP);
  for (const statement of SUPABASE_DEFAULT_PRIVILEGES) await client.query(statement);
}

/** Postgres error codes the suite distinguishes. */
export const PG_INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Reads a relation as `role`, treating "permission denied" as "no rows".
 *
 * A relation a role cannot select at all is as safe as one whose policy
 * filters it to nothing, and the two are different mechanisms -- so the
 * assertion has to accept either without accepting a row.
 */
export async function readOrDenied(
  relation: string,
  options: { role?: RequestRole; claims: ClaimSource },
): Promise<{ denied: boolean; rows: Array<Record<string, unknown>> }> {
  try {
    const rows = await asRequest(options, async (client) => {
      const result = await client.query(`select * from ${relation}`);
      return result.rows as Array<Record<string, unknown>>;
    });
    return { denied: false, rows };
  } catch (error) {
    if ((error as { code?: string }).code === PG_INSUFFICIENT_PRIVILEGE) {
      return { denied: true, rows: [] };
    }
    throw error;
  }
}

/**
 * Runs a write, treating "permission denied" as "nothing was written".
 *
 * The write half of `readOrDenied`, and it exists for the same reason. A
 * relation is protected from a write by either mechanism -- a policy that
 * admits no row, or a privilege the role was never granted -- and an assertion
 * that only understands one of them cannot be applied to a table that uses the
 * other. `memberships` is the first such table: `authenticated` holds SELECT
 * and nothing else, deliberately, so every write against it is refused before
 * a policy is ever consulted.
 *
 * The distinction is preserved rather than flattened, because it is a real
 * one: `denied` is an error the caller sees and `affected: 0` is silence.
 * Tests that care which one they got read the field.
 */
export async function updateOrDenied(
  sql: string,
  params: unknown[],
  options: { role?: RequestRole; claims: ClaimSource; rollback?: boolean },
): Promise<{ denied: boolean; affected: number }> {
  try {
    const affected = await asRequest(options, async (client) => {
      const result = await client.query(sql, params);
      return result.rowCount ?? 0;
    });
    return { denied: false, affected };
  } catch (error) {
    if ((error as { code?: string }).code === PG_INSUFFICIENT_PRIVILEGE) {
      return { denied: true, affected: 0 };
    }
    throw error;
  }
}

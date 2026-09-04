/**
 * What the sweep knows about the schema, and the exemptions it honours.
 *
 * The property being enforced is not a list of removals. It is:
 *
 *   **no surface in `public` may return a row belonging to another tenant, by
 *   any means.**
 *
 * A list of removals cannot express that, and an earlier version of this file
 * tried. It swept `relkind in ('r','p')` and therefore never looked at views,
 * matviews, foreign tables or security-definer functions -- three proven leak
 * surfaces, all of which PostgREST exposes as if they were tables:
 *
 *   - a view defaults to `security_invoker = false`, so its body runs as the
 *     view *owner* and RLS is skipped entirely. Reproduced: the base table
 *     returned 1 row and the view over it returned both tenants'.
 *   - a materialized view cannot carry RLS at all -- Postgres has no
 *     `alter materialized view ... enable row level security` -- and is
 *     populated as its owner at REFRESH time. Its only protection is that
 *     nothing a request can become is allowed to read it.
 *   - a `security definer` function returning tenant rows bypasses the
 *     caller's policies by construction. Reproduced: 2 rows across tenants.
 *
 * Everything here reads the catalog. Nothing reads a hand-maintained list of
 * tables, because the failure being defended against is *forgetting*.
 */
import type { Client } from "pg";

// --- the exemptions ---------------------------------------------------------

/** Rules an exemption can lift. Never RLS on a table, never the policy. */
export type WaivableRule =
  | "tenant_id_column"
  | "tenant_id_index"
  | "policy_claim_reference"
  | "tenant_fixture"
  | "discovery";

/**
 * The complete allowlist. Three entries, agreed at epic level; a fourth needs
 * a human decision, not a commit. Every entry carries a `justification`, and
 * `catalog-sweep.test.ts` fails if one is blank -- an exemption nobody has to
 * explain is how an allowlist becomes a habit.
 */
export type Exemption = {
  id: string;
  /** What the entry exempts: a whole schema, or tables matching a pattern. */
  kind: "schema" | "tables";
  /** Schema name for `schema`; for `tables`, the schema the pattern applies in. */
  schema: string;
  /** Regex over table names. Ignored for `kind: "schema"`. */
  match: string;
  waives: WaivableRule[];
  justification: string;
};

export const EXEMPTIONS: readonly Exemption[] = [
  {
    id: "global-statutory-tables",
    kind: "tables",
    schema: "public",
    match: "^stat_",
    waives: ["tenant_id_column", "tenant_id_index", "policy_claim_reference", "tenant_fixture"],
    justification:
      "TER bands, PTKP, BPJS rates and overtime multipliers are statutory and ours, not the tenant's " +
      "(CLAUDE.md rule 9). They are the same rows for every tenant, so a tenant_id column would be a " +
      "constant, a tenant_id-leading index would index a constant, an unconditioned read policy is " +
      "correct, and a two-tenant fixture would be meaningless -- there is no tenant dimension to " +
      "isolate. This is the one exemption that lifts the purity assertion, and it can only do so " +
      "because these rows are identical for everyone. They still carry RLS, force, a policy, and the " +
      "no-anon-read rule; writes stay privileged.",
  },
  {
    id: "pgboss-schema",
    kind: "schema",
    schema: "pgboss",
    match: "",
    waives: ["discovery"],
    justification:
      "pg-boss owns its own schema and rewrites it on version upgrades. Adding columns or policies to " +
      "tables a library manages breaks the next upgrade, so the schema is excluded from discovery " +
      "outright rather than rule by rule. Tenant context reaches the worker through the job payload and " +
      "an explicit per-transaction `set local`, never through the queue's own tables.",
  },
  {
    id: "above-tenant-boundary",
    kind: "tables",
    schema: "public",
    match: "^(organizations|companies)$",
    waives: ["tenant_id_column"],
    justification:
      "organizations sits above the tenant boundary and companies.id IS the tenant_id, so a tenant_id " +
      "column on either would be meaningless or a copy of its own primary key. This waives the column " +
      "rule ONLY: both still require RLS enabled, RLS forced, a policy that references a claim function, " +
      "and an index leading with the column their policy is keyed on.",
  },
];

/**
 * Functions in `public` allowed to be `security definer`.
 *
 * Was empty through Story 1.5, pinned so that the first entry would be a
 * visible, deliberate change rather than a line in a migration nobody reads.
 * Story 1.6 fills it with three, and `catalog-sweep.test.ts` pins the list to
 * exactly those names -- a fourth is a decision, not a commit.
 *
 * The third was added on the owner's decision, after the story deliberately
 * stopped short of it: nothing created the founding membership, so the hook
 * and the switcher both worked and had no row to work on.
 *
 * None of the three is here because `security definer` was convenient. Each
 * was measured against the alternative and the alternative did not work: with
 * `force row level security` on `memberships`, an invoker-rights function
 * reads zero rows for the hook (`supabase_auth_admin` is `rolbypassrls =
 * false`), reads only the active tenant for the switcher, and cannot write at
 * all for the founding membership -- because `memberships` grants
 * `authenticated` no write, which is itself the property being defended.
 *
 * What keeps them safe is not the tag. It is that every statement in all three
 * is filtered to one `user_id`, taken from the JWT and never from an argument.
 * The tests prove exactly that, by attempting the alternative.
 */
export type FunctionExemption = { name: string; justification: string };
export const SECURITY_DEFINER_EXEMPTIONS: readonly FunctionExemption[] = [
  {
    name: "custom_access_token_hook",
    justification:
      "Runs as supabase_auth_admin during token issuance, before any claim exists for a policy to " +
      "adjudicate by, so there is no invoker context to run under. Supabase's documented alternative " +
      "-- security invoker plus grants to supabase_auth_admin -- was measured against this schema and " +
      "returns zero rows, because memberships has FORCE ROW LEVEL SECURITY and supabase_auth_admin is " +
      "rolbypassrls = false on the live project. Four forms were tested and definer-owned-by-postgres " +
      "is the only one that works. Narrowness is what makes it safe: it reads one table filtered to one " +
      "user_id and returns claims rather than rows, and EXECUTE is revoked from public, anon and " +
      "authenticated so the only caller is GoTrue itself.",
  },
  {
    name: "switch_company",
    justification:
      "The company switcher has to read membership rows in companies the caller is not currently in -- " +
      "that is what switching means -- and memberships_tenant is keyed on the ACTIVE tenant, so an " +
      "invoker-rights read returns only the company the user already occupies. The alternatives were " +
      "weighed: widening the policy to user_id = auth_user_id() would make memberships multi-tenant to " +
      "a single caller and take it out from under the purity assertion, and putting the company list in " +
      "the token would grow every claim set with the user's memberships. Every statement in the " +
      "function is filtered on m.user_id = public.auth_user_id(), which comes from the caller's own JWT " +
      "and cannot be passed in; no argument names a user.",
  },
  {
    name: "create_founding_membership",
    justification:
      "The only thing in the schema that may write memberships.tenant_id or memberships.role, and it " +
      "exists because nothing else may: `authenticated` is granted no write on that table at all, " +
      "since a writable tenant key hands out the tenant boundary's own keys and a writable role is " +
      "self-service escalation. register_company stays security invoker and is still adjudicated by " +
      "organizations_owner and companies_create_under_owned_org; only this one insert is privileged. " +
      "It touches exactly one row: an admin membership for the JWT subject in a company the JWT " +
      "subject owns. It takes no user argument, so it cannot be aimed at anyone else, and because " +
      "security definer skips the policy that would have checked ownership, the check against " +
      "organizations.owner_user_id is made explicitly in the body. Idempotent, so a retry resumes.",
  },
];

/* ── the privilege surface ─────────────────────────────────────────────────── */

/**
 * What each request role is allowed to hold on a relation.
 *
 * **This registry exists because the gate had a hole with a whole class of
 * defect in it.** Every rule above this line is about POLICY -- RLS enabled,
 * RLS forced, a policy present, the claim wrapped, no policy reaching `anon`.
 * None of them is about PRIVILEGE, and a policy only ever runs on a statement
 * the privilege system already let through.
 *
 * That gap was invisible because the two substrates disagree in a direction
 * nobody checks. Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
 * TABLES TO anon, authenticated` in `public`; a bare `postgres:17` container
 * ships none. So `public.memberships` -- a table designed to have no write
 * surface at all -- was born `arwdDxtm` for both request roles on the live
 * project and exactly `r` for `authenticated` here, from one migration. RLS
 * held either way, so nothing leaked; what changed was that a refused write
 * reported ZERO ROWS instead of `permission denied`, which is precisely the
 * distinction the table's design turns on.
 *
 * `globalSetup.ts` now installs the same default ACLs in the container, so the
 * defect reproduces locally. This registry is the other half: the declaration
 * that says what SHOULD be held, so that reproducing it fails.
 *
 * The rules the sweep applies:
 *
 *   - a relation with no entry here FAILS. Not "is skipped" -- the failure
 *     mode being defended against is a table nobody thought about, and a
 *     registry you may omit yourself from defends against nothing;
 *   - the privileges held must EXACTLY equal the declaration. Not "at least"
 *     and not "at most": a missing grant is a broken feature and an extra one
 *     is the hole above, and only equality catches both.
 *
 * `table` lists privileges held on the whole relation. `columns` lists
 * privileges held on a column but NOT on the table -- a table-level grant
 * already implies every column, so listing those again would be noise that
 * drifts.
 */
export type RolePrivileges = {
  readonly table: readonly string[];
  readonly columns: Readonly<Record<string, readonly string[]>>;
};

export type DeclaredPrivileges = {
  readonly anon: RolePrivileges;
  readonly authenticated: RolePrivileges;
  /** Why this is the right surface. Asserted non-trivial, like an exemption. */
  readonly why: string;
};

/** Nothing at all, which is what `anon` gets everywhere. */
const NOTHING: RolePrivileges = { table: [], columns: {} };

export const REQUEST_ROLE_PRIVILEGES: Readonly<Record<string, DeclaredPrivileges>> = {
  "public.organizations": {
    anon: NOTHING,
    authenticated: {
      table: ["SELECT"],
      // Column-level, from 20260827140000. `plan` is absent because billing
      // sets the tier and a request path does not -- a customer upgrading
      // themselves was reproduced as `UPDATE 1` before that grant was
      // narrowed. `id` and `created_at` are absent because a caller choosing a
      // primary key can squat on an id another tenant is about to be given,
      // and one choosing `created_at` rewrites the tie-break that
      // `register_company`'s resume lookup orders by.
      columns: {
        name: ["INSERT", "UPDATE"],
        owner_user_id: ["INSERT", "UPDATE"],
      },
    },
    why:
      "Above the tenant boundary, keyed on ownership. Readable by its owner, and writable only in " +
      "the two columns that are the owner's to set. No DELETE: deleting a billing account is an " +
      "offboarding decision, not a request a form can make -- and it was granted in 20260827000000 " +
      "and never claimed by anything since, which is how this registry found it.",
  },
  "public.companies": {
    anon: NOTHING,
    authenticated: {
      // Table-level rather than column-level, deliberately: `companies_tenant`
      // and `companies_create_under_owned_org` adjudicate these writes, and
      // the purity suite proves it by asserting that a company carrying
      // another tenant's id is refused BY POLICY. Narrowing `id` out of the
      // INSERT grant would make that test pass for a privilege reason instead,
      // and stop testing the policy at all.
      table: ["SELECT", "INSERT", "UPDATE"],
      columns: {},
    },
    why:
      "The tenant boundary itself. Signup must be able to create one and its owner must be able to " +
      "correct it, so INSERT and UPDATE are genuinely needed and are adjudicated by policy rather " +
      "than by privilege. No DELETE: companies.id is the tenant_id every other table's rows hang " +
      "off, so removing this row orphans the tenant's entire dataset behind a key that no longer " +
      "resolves.",
  },
  "public.memberships": {
    anon: NOTHING,
    authenticated: { table: ["SELECT"], columns: {} },
    why:
      "SELECT and nothing else, which is the property the whole tenant-context design rests on. A " +
      "writable tenant_id hands out the tenant boundary's own keys; a writable role is self-service " +
      "privilege escalation; a writable last_active_at moves which company a COLLEAGUE lands in on " +
      "their next refresh, which was reproduced as a successful write. The only write paths are " +
      "switch_company() and create_founding_membership(), both scoped to the caller's own rows by " +
      "construction, so the refusal here comes from privilege and says so rather than reporting " +
      "zero rows an attacker reads as 'not yet'.",
  },
};

export const declaredPrivilegesFor = (schema: string, name: string) =>
  REQUEST_ROLE_PRIVILEGES[qualify(schema, name)];

/** The roles a PostgREST request can become. Nothing else is swept for this. */
export const REQUEST_ROLES = ["anon", "authenticated"] as const;
export type RequestRoleName = (typeof REQUEST_ROLES)[number];

/**
 * Every table privilege Postgres 17 has, checked one by one.
 *
 * All eight, not the four anyone thinks about. Supabase's default ACL is
 * `arwdDxtm`, which is INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES,
 * TRIGGER and MAINTAIN -- so a check that looked only at the first four would
 * report a table as clean while `anon` held TRUNCATE on it.
 */
export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

/** The subset Postgres can grant on a single column. */
export const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;

export type RelationPrivileges = Record<RequestRoleName, RolePrivileges>;

/**
 * What each request role can ACTUALLY do, asked of Postgres rather than parsed.
 *
 * `has_table_privilege` and `has_column_privilege` are used instead of reading
 * `relacl` and `attacl`, and that is the load-bearing choice here: they answer
 * "may this role do this", which folds in grants made to `PUBLIC` and grants
 * inherited through role membership. An ACL parser sees `authenticated=r` and
 * reports SELECT; it does not see the `GRANT ALL ON t TO public` two lines
 * later that gave `anon` everything.
 *
 * A column privilege is reported only where the table-level one is absent. A
 * table-level grant already implies every column, so listing them again would
 * be a hundred lines of noise that drifts the moment a column is added.
 */
export async function readRequestRolePrivileges(
  client: Client,
): Promise<Record<string, RelationPrivileges>> {
  const { rows: tableRows } = await client.query<{
    schema: string;
    name: string;
    role: RequestRoleName;
    privilege: string;
    held: boolean;
  }>(
    `
    select n.nspname as schema,
           c.relname  as name,
           r.rolname  as role,
           p.privilege,
           has_table_privilege(r.rolname, c.oid, p.privilege) as held
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest($1::text[]) as r(rolname)
      cross join unnest($2::text[]) as p(privilege)
     where c.relkind in ('r', 'p', 'v', 'm', 'f')
       and n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg\\_%'
       and n.nspname <> all ($3::text[])
       and exists (select 1 from pg_roles pr where pr.rolname = r.rolname)
    `,
    [[...REQUEST_ROLES], [...TABLE_PRIVILEGES], [...RUNNER_SCHEMAS]],
  );

  const { rows: columnRows } = await client.query<{
    schema: string;
    name: string;
    role: RequestRoleName;
    column: string;
    privilege: string;
  }>(
    `
    select n.nspname as schema,
           c.relname  as name,
           r.rolname  as role,
           a.attname  as column,
           p.privilege
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest($1::text[]) as r(rolname)
      cross join unnest($2::text[]) as p(privilege)
     where c.relkind in ('r', 'p', 'v', 'm', 'f')
       and n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg\\_%'
       and n.nspname <> all ($3::text[])
       and exists (select 1 from pg_roles pr where pr.rolname = r.rolname)
       and has_column_privilege(r.rolname, c.oid, a.attnum, p.privilege)
       and not has_table_privilege(r.rolname, c.oid, p.privilege)
    `,
    [[...REQUEST_ROLES], [...COLUMN_PRIVILEGES], [...RUNNER_SCHEMAS]],
  );

  const held: Record<string, RelationPrivileges> = {};
  const ensure = (schema: string, name: string) => {
    const key = qualify(schema, name);
    held[key] ??= {
      anon: { table: [], columns: {} },
      authenticated: { table: [], columns: {} },
    };
    return held[key];
  };

  for (const row of tableRows) {
    const relation = ensure(row.schema, row.name);
    if (row.held) (relation[row.role].table as string[]).push(row.privilege);
  }
  for (const row of columnRows) {
    const relation = ensure(row.schema, row.name);
    const columns = relation[row.role].columns as Record<string, string[]>;
    (columns[row.column] ??= []).push(row.privilege);
  }
  return held;
}

/** Sorted, so an assertion compares sets rather than statement order. */
export function normalisePrivileges(privileges: RolePrivileges): RolePrivileges {
  const columns: Record<string, readonly string[]> = {};
  for (const column of Object.keys(privileges.columns).sort()) {
    columns[column] = [...privileges.columns[column]].sort();
  }
  return { table: [...privileges.table].sort(), columns };
}

/**
 * Schemas the migration runner writes for its own bookkeeping.
 *
 * Not an exemption from anything: `supabase_migrations` holds migration
 * version strings written by `supabase migration up` itself and contains no
 * application data. It is excluded because it is not our schema, not because
 * a rule was lifted. Recorded in deferred-work as a second place a name can be
 * added to make the sweep look away.
 */
export const RUNNER_SCHEMAS = ["supabase_migrations"] as const;

/** Qualified name, which is how everything here is keyed. `public.employees`. */
export const qualify = (schema: string, name: string) => `${schema}.${name}`;

const discoveryExemptSchemas = new Set(
  EXEMPTIONS.filter((e) => e.kind === "schema" && e.waives.includes("discovery")).map(
    (e) => e.schema,
  ),
);

/**
 * Which rules a relation is excused from.
 *
 * Keyed on the **qualified** name. Keying on the bare name would let a future
 * `hr.employees` inherit whatever `public.employees` was excused from.
 */
export function waivedFor(schema: string, table: string): Set<WaivableRule> {
  const waived = new Set<WaivableRule>();
  for (const exemption of EXEMPTIONS) {
    if (exemption.kind !== "tables") continue;
    if (exemption.schema !== schema) continue;
    if (new RegExp(exemption.match).test(table)) {
      for (const rule of exemption.waives) waived.add(rule);
    }
  }
  return waived;
}

// --- catalog reads ----------------------------------------------------------

/** `r` table, `p` partitioned, `v` view, `m` materialized view, `f` foreign table. */
export type RelKind = "r" | "p" | "v" | "m" | "f";

export type CatalogRelation = {
  schema: string;
  name: string;
  qualified: string;
  kind: RelKind;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policyCount: number;
  permissivePolicyCount: number;
  /** `security_invoker=true` in reloptions. Views and matviews only. */
  securityInvoker: boolean;
  tenantIdColumn: { type: string; notNull: boolean } | null;
  /** Valid, non-partial indexes only: the first column of each. */
  indexes: Array<{ name: string; leadingColumn: string | null }>;
  /** Roles that can SELECT this relation. Only `anon`/`authenticated` matter. */
  selectableByAnon: boolean;
  selectableByAuthenticated: boolean;
};

/**
 * Every relation a request could reach, discovered.
 *
 * `relkind in ('r','p','v','m','f')` -- not just tables. A partition of an
 * RLS-enabled parent does NOT inherit `relrowsecurity`, so partitions are
 * swept too rather than trusted.
 *
 * Index facts are filtered to `indisvalid and indpred is null`: an invalid
 * index (a failed CONCURRENTLY build) is not an access path, and a partial
 * index covers only the rows its predicate admits, so neither satisfies "the
 * tenant path is indexed". An expression as the leading element yields
 * `indkey[0] = 0`, which finds no attribute and so reports null.
 */
export async function readRelations(client: Client): Promise<CatalogRelation[]> {
  const { rows } = await client.query<{
    schema: string;
    name: string;
    kind: RelKind;
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_count: string;
    permissive_policy_count: string;
    security_invoker: boolean;
    tenant_id_type: string | null;
    tenant_id_not_null: boolean | null;
    indexes: Array<{ name: string; leading_column: string | null }> | null;
    selectable_by_anon: boolean;
    selectable_by_authenticated: boolean;
  }>(
    `
    select n.nspname                 as schema,
           c.relname                 as name,
           c.relkind::text           as kind,
           c.relrowsecurity          as rls_enabled,
           c.relforcerowsecurity     as rls_forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count,
           (select count(*) from pg_policy p where p.polrelid = c.oid and p.polpermissive)
                                     as permissive_policy_count,
           coalesce(array_to_string(c.reloptions, ',') like '%security_invoker=true%', false)
                                     as security_invoker,
           (select format_type(a.atttypid, null)
              from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'tenant_id'
               and a.attnum > 0 and not a.attisdropped)  as tenant_id_type,
           (select a.attnotnull
              from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'tenant_id'
               and a.attnum > 0 and not a.attisdropped)  as tenant_id_not_null,
           (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'name', ic.relname,
                      'leading_column', (
                        select a.attname from pg_attribute a
                         where a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                      )
                    )), '[]'::jsonb)
             from pg_index i
             join pg_class ic on ic.oid = i.indexrelid
             where i.indrelid = c.oid
               and i.indisvalid
               and i.indpred is null
           )                         as indexes,
           -- Privilege, not policy. A relation nothing can select is safe
           -- whatever its RLS says; a relation anon can select is not.
           coalesce(has_table_privilege('anon', c.oid, 'SELECT'), false)
                                     as selectable_by_anon,
           coalesce(has_table_privilege('authenticated', c.oid, 'SELECT'), false)
                                     as selectable_by_authenticated
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\\_%'
      and n.nspname <> all ($1::text[])
    order by n.nspname, c.relname
    `,
    [[...RUNNER_SCHEMAS]],
  );

  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    qualified: qualify(row.schema, row.name),
    kind: row.kind,
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
    policyCount: Number(row.policy_count),
    permissivePolicyCount: Number(row.permissive_policy_count),
    securityInvoker: row.security_invoker,
    tenantIdColumn: row.tenant_id_type
      ? { type: row.tenant_id_type, notNull: row.tenant_id_not_null === true }
      : null,
    indexes: (row.indexes ?? []).map((index) => ({
      name: index.name,
      leadingColumn: index.leading_column,
    })),
    selectableByAnon: row.selectable_by_anon,
    selectableByAuthenticated: row.selectable_by_authenticated,
  }));
}

/** Relations the sweep polices: everything discovered outside an exempt schema. */
export const applicationRelations = (relations: CatalogRelation[]) =>
  relations.filter((relation) => !discoveryExemptSchemas.has(relation.schema));

/** The subset that carries rows of its own and can therefore carry RLS. */
export const RLS_CAPABLE: RelKind[] = ["r", "p", "f"];

export type CatalogPolicy = {
  schema: string;
  table: string;
  qualified: string;
  name: string;
  /** `r` select, `a` insert, `w` update, `d` delete, `*` all. */
  cmd: string;
  permissive: boolean;
  /** Roles the policy applies to. `{public}` when `to` was omitted. */
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

/**
 * Policies, with the three columns an earlier version dropped.
 *
 * `qual` and `with_check` alone are not enough to tell a safe policy from an
 * open one: `to anon using (true)` satisfied every check the old sweep made --
 * policy present, no unwrapped call, tenant_id column present, index present,
 * fixture present -- while `set local role anon` returned both tenants' rows.
 * `roles`, `cmd` and `permissive` were sitting in `pg_policies` the whole time.
 */
export async function readPolicies(client: Client): Promise<CatalogPolicy[]> {
  const { rows } = await client.query<{
    schema: string;
    table: string;
    name: string;
    cmd: string;
    permissive: string;
    roles: string[] | null;
    qual: string | null;
    with_check: string | null;
  }>(
    `select n.nspname as schema,
            c.relname as "table",
            pol.polname as name,
            pol.polcmd::text as cmd,
            case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as permissive,
            -- Cast to text[], not the bare name[] array_agg produces:
            -- node-pg has no parser for oid 1003 and hands back the raw
            -- '{anon}' literal as a string, which .map then fails on.
            coalesce(
              (select array_agg(pg_get_userbyid(r)::text) from unnest(pol.polroles) as r),
              array['public']
            )::text[] as roles,
            pg_get_expr(pol.polqual, pol.polrelid) as qual,
            pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
     from pg_policy pol
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
     order by n.nspname, c.relname, pol.polname`,
  );
  return rows.map((row) => ({
    schema: row.schema,
    table: row.table,
    qualified: qualify(row.schema, row.table),
    name: row.name,
    cmd: row.cmd,
    permissive: row.permissive === "PERMISSIVE",
    // `polroles` holds oid 0 for PUBLIC, which pg_get_userbyid renders as
    // `-`; normalise it so a `to public` policy is not mistaken for a role.
    roles: (row.roles ?? []).map((role) => (role === "-" ? "public" : role)),
    using: row.qual,
    withCheck: row.with_check,
  }));
}

export type CatalogFunction = {
  schema: string;
  name: string;
  /** `s` safe, `r` restricted, `u` unsafe. */
  parallel: string;
  securityDefiner: boolean;
  readsClaims: boolean;
  /** Roles that can EXECUTE it. */
  executableByAnon: boolean;
  executableByAuthenticated: boolean;
};

/**
 * Functions in `public`, with the two properties that matter.
 *
 * `prosecdef` is a leak surface: a security-definer function returning tenant
 * rows runs as its owner and skips the caller's policies. `proparallel` is a
 * performance cliff: one parallel-unsafe function anywhere in a plan disables
 * parallel query for the whole statement, which is precisely the tenant-wide
 * scan the `(select ...)` rule exists to make cheap.
 *
 * The claim functions are discovered by what they read, not by name, so a
 * later `public.membership_role()` gets both checks for free.
 */
export async function readFunctions(client: Client): Promise<CatalogFunction[]> {
  const { rows } = await client.query<{
    schema: string;
    name: string;
    parallel: string;
    security_definer: boolean;
    reads_claims: boolean;
    exec_anon: boolean;
    exec_authenticated: boolean;
  }>(
    `select n.nspname as schema,
            p.proname as name,
            p.proparallel::text as parallel,
            p.prosecdef as security_definer,
            coalesce(p.prosrc like '%request.jwt.claims%', false) as reads_claims,
            coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as exec_anon,
            coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
              as exec_authenticated
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
     order by p.proname`,
  );
  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    parallel: row.parallel,
    securityDefiner: row.security_definer,
    readsClaims: row.reads_claims,
    executableByAnon: row.exec_anon,
    executableByAuthenticated: row.exec_authenticated,
  }));
}

// --- the (select ...) rule --------------------------------------------------

/**
 * Policy expressions that call a claim function without wrapping it.
 *
 * `pg_get_expr` renders the wrapped form as `( SELECT tenant_id() AS
 * tenant_id)` and the unwrapped form as plain `tenant_id()`, and it drops the
 * `public.` qualifier whenever `public` is on the rendering session's
 * search_path -- which is why the schema prefix is optional in both patterns
 * below. Strip every wrapped occurrence, then anything left that still calls
 * the function is unwrapped.
 *
 * Measured cost of getting this wrong, 500k rows with 375k matching: 30.5-37.1ms
 * wrapped against 229.9-234.0ms unwrapped, ~7.4x, identical buffers, pure CPU --
 * the plan shows `Filter: (tenant_id = (InitPlan 1).col1)` against the whole
 * `current_setting(...)` expression inlined per row. Note the nuance: this is
 * scan-shaped only. On a selective index lookup both forms fold into the Index
 * Cond and the unwrapped form measured marginally faster (0.040ms against
 * 0.139ms). The rule stands because scans are what a tenant-wide query does.
 */
export function unwrappedClaimCalls(expression: string | null, functions: string[]): string[] {
  if (!expression) return [];
  const found: string[] = [];
  for (const fn of functions) {
    const wrapped = new RegExp(
      `\\(\\s*SELECT\\s+(?:public\\.)?${fn}\\(\\)\\s+AS\\s+\\w+\\s*\\)`,
      "gi",
    );
    const stripped = expression.replace(wrapped, "");
    if (new RegExp(`(?:public\\.)?\\b${fn}\\s*\\(`).test(stripped)) found.push(fn);
  }
  return found;
}

/**
 * Whether a policy expression is conditioned on who is asking.
 *
 * This is the check that catches `using (true)`, and it is stated positively
 * on purpose. A denylist of open expressions has to guess the spellings --
 * `true`, `1 = 1`, `id is not null` -- and the reviewer's proof used the first
 * one only because it was shortest. Requiring a claim function to appear
 * admits none of them.
 */
export function referencesClaim(expression: string | null, functions: string[]): boolean {
  if (!expression) return false;
  return functions.some((fn) => new RegExp(`(?:public\\.)?\\b${fn}\\s*\\(`).test(expression));
}

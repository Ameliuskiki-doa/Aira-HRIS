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
 * Empty, and a test asserts it stays empty, so the first entry is a visible,
 * deliberate change rather than a line in a migration nobody reads. Story 1.6's
 * Custom Access Token Hook is the likely first occupant.
 */
export type FunctionExemption = { name: string; justification: string };
export const SECURITY_DEFINER_EXEMPTIONS: readonly FunctionExemption[] = [];

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

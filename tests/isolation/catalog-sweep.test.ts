/**
 * The sweep. Reads the catalog, not the code, and not a list.
 *
 * The property is: **no surface in `public` may return a row belonging to
 * another tenant, by any means.** Not "these eight things are present" -- a
 * checklist of removals cannot fail on a leak surface that was *added*, and an
 * earlier version of this file proved it by missing three of them.
 *
 * Every finding here is one a behavioural purity test structurally cannot
 * make. Each was reproduced in a live container:
 *
 *   - an **unwrapped policy** isolates perfectly. `foreign = 0`, every purity
 *     assertion green, and ~7.4x the CPU on every tenant-wide scan.
 *   - **RLS on with no policy** returns zero rows, indistinguishable from a
 *     fixture that failed to seed.
 *   - **RLS missing entirely** passes vacuously until rows exist.
 *   - a **view** over a protected table returned both tenants' rows while the
 *     base table returned one. Views default to `security_invoker = false`.
 *   - a **`security definer` function** returned 2 rows across tenants.
 *   - a policy **`to anon using (true)`** satisfied every earlier check while
 *     `set local role anon` returned everything.
 *
 * The sweep discovers its subjects. A hand-maintained list cannot fail on the
 * thing this gate exists for: a surface someone forgot.
 */
import { describe, expect, it } from "vitest";

import {
  applicationRelations,
  COLUMN_PRIVILEGES,
  declaredPrivilegesFor,
  EXEMPTIONS,
  normalisePrivileges,
  readFunctions,
  readPolicies,
  readRelations,
  readRequestRolePrivileges,
  referencesClaim,
  REQUEST_ROLE_PRIVILEGES,
  REQUEST_ROLES,
  RLS_CAPABLE,
  SECURITY_DEFINER_EXEMPTIONS,
  TABLE_PRIVILEGES,
  unwrappedClaimCalls,
  waivedFor,
} from "./support/catalog";
import { fixtureFor } from "./support/fixtures";
import {
  appRolePrivileges,
  installSupabaseDefaultPrivileges,
  withAdmin,
} from "./support/substrate";

const { relations, policies, functions, privileges, grants } = await withAdmin(async (client) => ({
  relations: await readRelations(client),
  policies: await readPolicies(client),
  functions: await readFunctions(client),
  privileges: await appRolePrivileges(),
  grants: await readRequestRolePrivileges(client),
}));

const swept = applicationRelations(relations);
const claimFunctions = functions.filter((fn) => fn.readsClaims).map((fn) => fn.name);

/** The column a relation's policy is keyed on: `tenant_id` unless declared. */
const isolationColumnOf = (schema: string, name: string) =>
  fixtureFor(schema, name)?.isolationColumn ?? "tenant_id";

describe("the suite is not running privileged", () => {
  // Guard on the guard. globalSetup calls the same check so a misconfigured
  // substrate fails fast, but a line in setup can be deleted in silence and
  // every purity assertion in the project would then pass vacuously. This is
  // the copy that lives where its removal is visible.
  it("has both identities to check", () => {
    expect(privileges.map((identity) => identity.identity).sort()).toEqual([
      "current_user",
      "session_user",
    ]);
  });

  it.each(privileges.map((identity) => [identity.identity, identity] as const))(
    "%s cannot bypass RLS",
    (_label, identity) => {
      // A superuser reads past a policy even with FORCE, and so does a role
      // holding BYPASSRLS.
      expect(identity.rolsuper, `${identity.name} is a superuser`).toBe(false);
      expect(identity.rolbypassrls, `${identity.name} holds BYPASSRLS`).toBe(false);
    },
  );
});

describe("the sweep has something to sweep", () => {
  it("discovers relations from the catalog", () => {
    // A broken discovery query returns an empty array, and every per-relation
    // assertion below then passes by iterating over nothing.
    expect(swept.length, "the catalog sweep found no relations at all").toBeGreaterThan(0);
    expect(swept.map((relation) => relation.qualified)).toEqual(
      expect.arrayContaining(["public.organizations", "public.companies"]),
    );
  });

  it("looks at every relation kind a request can read, not just tables", () => {
    // The filter that let views through. Stated as the set the query uses so
    // narrowing it back to ('r','p') fails here rather than going unnoticed.
    expect(RLS_CAPABLE).toEqual(["r", "p", "f"]);
  });

  it("finds the claim functions the policies are supposed to call", () => {
    expect(claimFunctions, "no function in public reads request.jwt.claims").toContain("tenant_id");
  });

  it("finds policies to check", () => {
    expect(policies.length, "no policies exist, so the wrapping rule checks nothing").toBeGreaterThan(0);
  });
});

describe.each(swept.map((relation) => [relation.qualified, relation] as const))(
  "%s",
  (_label, relation) => {
    const waived = waivedFor(relation.schema, relation.name);
    const rlsCapable = RLS_CAPABLE.includes(relation.kind);

    it("is a relation kind the harness knows how to protect", () => {
      expect(["r", "p", "v", "m", "f"]).toContain(relation.kind);
    });

    if (rlsCapable) {
      it("has row level security enabled", () => {
        expect(relation.rlsEnabled).toBe(true);
      });

      it("has row level security forced", () => {
        // Without FORCE the table owner -- which is what a migration and any
        // owner-privileged path runs as -- reads straight past the policy.
        expect(relation.rlsForced).toBe(true);
      });

      it("has at least one permissive policy", () => {
        // RLS with no policy denies everything, which looks like isolation and
        // is actually an outage waiting for the first real query.
        expect(relation.permissivePolicyCount).toBeGreaterThan(0);
      });

      it("carries a tenant_id column of the right type, or an exemption", () => {
        if (waived.has("tenant_id_column")) return;
        const column = relation.tenantIdColumn;
        expect(column, `${relation.qualified} has no tenant_id column and no exemption`).not.toBeNull();
        // Presence alone is not the rule. `tenant_id text` joins nothing and
        // compares by string; a nullable one makes `tenant_id = null` -- which
        // RLS reads as "no" -- a row that no tenant can ever reach.
        expect(column?.type, `${relation.qualified}.tenant_id is ${column?.type}, not uuid`).toBe("uuid");
        expect(column?.notNull, `${relation.qualified}.tenant_id is nullable`).toBe(true);
      });

      it("has an index leading with the column its policy is keyed on", () => {
        if (waived.has("tenant_id_index")) return;
        const column = isolationColumnOf(relation.schema, relation.name);
        const leading = relation.indexes.map((index) => index.leadingColumn);
        expect(
          leading,
          `${relation.qualified} has no valid, non-partial index whose first column is ${column}; ` +
            `indexes present: ${relation.indexes.map((i) => `${i.name}(${String(i.leadingColumn)})`).join(", ") || "none"}`,
        ).toContain(column);
      });
    }

    if (relation.kind === "v") {
      it("is a security_invoker view", () => {
        // A view defaults to security_invoker = false, so its body runs as the
        // view owner and the caller's policies never apply. PostgREST exposes
        // views as if they were tables. Reproduced: base table 1 row, view 2.
        expect(
          relation.securityInvoker,
          `view ${relation.qualified} is not security_invoker=true, so it reads its base tables ` +
            `as the view owner and skips RLS entirely`,
        ).toBe(true);
      });
    }

    if (relation.kind === "m") {
      it("is unreachable by any request role", () => {
        // Postgres has no `alter materialized view ... enable row level
        // security`, and a matview is populated as its owner at REFRESH time.
        // Privilege is its only protection: wrap it in a security_invoker view
        // or a function, and grant nothing on the matview itself.
        expect(
          relation.selectableByAnon || relation.selectableByAuthenticated,
          `materialized view ${relation.qualified} is selectable by a request role. ` +
            `A matview cannot carry RLS, so this returns every tenant's rows.`,
        ).toBe(false);
      });
    }

    it("is not readable by anon", () => {
      // `anon` holds no tenant claim by definition, so nothing it can select
      // is defensible. Cheaper and broader than reasoning about each policy.
      expect(
        relation.selectableByAnon,
        `${relation.qualified} is selectable by anon`,
      ).toBe(false);
    });

    it("is seeded for both tenants by the fixture registry", () => {
      // The link that makes a relation added in a later story fail loudly here
      // rather than go unmentioned by the purity suite. Waived only for the
      // global statutory tables, which have no tenant dimension to isolate.
      if (waived.has("tenant_fixture")) return;
      expect(
        fixtureFor(relation.schema, relation.name),
        `${relation.qualified} exists in the catalog but has no entry in FIXTURES, ` +
          `so nothing asserts it isolates`,
      ).toBeDefined();
    });

    it("declares what anon and authenticated may hold", () => {
      // A relation with no declaration FAILS rather than being skipped. The
      // failure mode this defends against is a table nobody thought about, and
      // a registry a table may omit itself from defends against nothing.
      expect(
        declaredPrivilegesFor(relation.schema, relation.name),
        `${relation.qualified} exists in the catalog but declares no privilege intent in ` +
          `REQUEST_ROLE_PRIVILEGES. On Supabase every table in public is BORN with ALL privileges ` +
          `for anon and authenticated -- so a table that says nothing about its grants is not a ` +
          `table with no grants, it is a table with all of them.`,
      ).toBeDefined();
    });

    it.each([...REQUEST_ROLES])("holds exactly the privileges it declares, for %s", (role) => {
      const declared = declaredPrivilegesFor(relation.schema, relation.name);
      if (!declared) return; // The assertion above owns this failure.
      const actual = grants[relation.qualified] ?? { table: [], columns: {} };
      expect(
        normalisePrivileges(actual[role] ?? { table: [], columns: {} }),
        `${relation.qualified} does not hold what it declares for ${role}. ` +
          `An EXTRA privilege is the Supabase default ACL leaking through -- the migration needs ` +
          `\`revoke all on ${relation.qualified} from ${role}\` before its grants, because ` +
          `\`revoke ... from public\` does not remove an explicit role grant. A MISSING one is a ` +
          `feature that will fail with 42501 in production.`,
      ).toEqual(normalisePrivileges(declared[role]));
    });

    it("declares a non-tenant_id isolation column only if exempted from the column rule", () => {
      // `isolationColumn` drives both the purity assertion and the index rule,
      // so an unrestricted override could retarget the index rule onto the
      // primary key -- which every relation satisfies for free.
      const column = isolationColumnOf(relation.schema, relation.name);
      if (column === "tenant_id") return;
      expect(
        waived.has("tenant_id_column"),
        `${relation.qualified} declares isolationColumn "${column}" but carries no ` +
          `above-the-boundary exemption, so its tenant rule and its index rule both point ` +
          `at the wrong column`,
      ).toBe(true);
    });
  },
);

describe("policies", () => {
  it.each(policies.map((policy) => [`${policy.qualified}.${policy.name}`, policy] as const))(
    "%s wraps the claim in a subquery",
    (_label, policy) => {
      const offenders = [
        ...unwrappedClaimCalls(policy.using, claimFunctions),
        ...unwrappedClaimCalls(policy.withCheck, claimFunctions),
      ];
      expect(
        offenders,
        `policy ${policy.name} on ${policy.qualified} calls ${offenders.join(", ")} unwrapped. ` +
          `It isolates correctly, which is why no behavioural test will ever catch it -- ` +
          `and Postgres re-evaluates the call once per row. Write (select public.${offenders[0] ?? "tenant_id"}()).`,
      ).toEqual([]);
    },
  );

  it.each(
    policies
      .filter((policy) => policy.permissive)
      .map((policy) => [`${policy.qualified}.${policy.name}`, policy] as const),
  )("%s is conditioned on who is asking", (_label, policy) => {
    // The check that catches `using (true)`. Stated positively: a denylist of
    // open expressions has to guess the spellings, and `to anon using (true)`
    // satisfied every other rule in this file while returning both tenants'
    // rows. A restrictive policy is excluded because it only ever narrows.
    if (waivedFor(policy.schema, policy.table).has("policy_claim_reference")) return;
    const expressions = [policy.using, policy.withCheck].filter(
      (expression): expression is string => expression !== null,
    );
    expect(
      expressions.length,
      `policy ${policy.name} on ${policy.qualified} has neither USING nor WITH CHECK`,
    ).toBeGreaterThan(0);
    for (const expression of expressions) {
      expect(
        referencesClaim(expression, claimFunctions),
        `policy ${policy.name} on ${policy.qualified} (cmd=${policy.cmd}, to ${policy.roles.join(",")}) ` +
          `has an expression that names no claim function: ${expression}. ` +
          `It admits rows without asking who is asking.`,
      ).toBe(true);
    }
  });

  it("grants no policy to anon on a swept relation", () => {
    const sweptNames = new Set(swept.map((relation) => relation.qualified));
    const anonPolicies = policies.filter(
      (policy) =>
        sweptNames.has(policy.qualified) &&
        (policy.roles.includes("anon") || policy.roles.includes("public")),
    );
    expect(
      anonPolicies.map((policy) => `${policy.qualified}.${policy.name} -> ${policy.roles.join(",")}`),
      "a policy reaching anon (or public, which includes anon) on a tenant relation",
    ).toEqual([]);
  });
});

describe("functions in public", () => {
  it.each(
    functions.filter((fn) => fn.readsClaims).map((fn) => [fn.name, fn] as const),
  )("%s is parallel safe", (_name, fn) => {
    // Postgres defaults to parallel-unsafe, and a single unsafe function
    // anywhere in a plan disables parallel query for the entire statement --
    // undercutting exactly the tenant-wide scan the (select ...) rule exists
    // to make cheap. `current_setting` is itself proparallel = 's', so there
    // is nothing here that has to be unsafe.
    expect(
      fn.parallel,
      `public.${fn.name}() is proparallel = '${fn.parallel}'; a claim function must be 's'`,
    ).toBe("s");
  });

  it("declares no security definer function without an exemption", () => {
    // A security-definer function returning tenant rows runs as its owner and
    // skips the caller's policies by construction. Reproduced: 2 rows across
    // tenants through one.
    const exempted = new Set(SECURITY_DEFINER_EXEMPTIONS.map((entry) => entry.name));
    const offenders = functions
      .filter((fn) => fn.securityDefiner && !exempted.has(fn.name))
      .map((fn) => `public.${fn.name}()`);
    expect(
      offenders,
      "security definer functions in public bypass the caller's policies; " +
        "add an entry to SECURITY_DEFINER_EXEMPTIONS with a justification if one is genuinely needed",
    ).toEqual([]);
  });

  it("holds exactly the three agreed security definer exemptions", () => {
    // Pinned empty through Story 1.5 so the first entry would be a visible
    // change rather than a line in a migration nobody reads. Story 1.6 fills
    // it, and the pin MOVES rather than being deleted -- which is the list
    // doing its job: the third entry was a decision taken by the owner after
    // the story stopped short of taking it alone. A fourth is the same kind of
    // decision, and this line is what makes adding one impossible to do
    // quietly.
    expect(SECURITY_DEFINER_EXEMPTIONS.map((entry) => entry.name)).toEqual([
      "custom_access_token_hook",
      "switch_company",
      "create_founding_membership",
    ]);
  });

  it("exempts nothing that does not exist", () => {
    // An exemption for a function that was renamed or dropped is a hole with a
    // justification attached: the sweep would go on honouring the name while
    // whatever replaced it goes unexamined.
    const present = new Set(functions.map((fn) => fn.name));
    for (const entry of SECURITY_DEFINER_EXEMPTIONS) {
      expect(
        present.has(entry.name),
        `SECURITY_DEFINER_EXEMPTIONS names public.${entry.name}(), which is not in the catalog`,
      ).toBe(true);
    }
  });

  it.each(SECURITY_DEFINER_EXEMPTIONS.map((entry) => [entry.name, entry] as const))(
    "%s states why it is security definer",
    (_name, entry) => {
      expect(entry.justification.trim().length).toBeGreaterThan(80);
    },
  );
});

describe("the privilege surface is declared, not inherited", () => {
  /**
   * The registry's own hygiene, and the reason it is a separate block.
   *
   * The per-relation assertions above prove that what is HELD matches what is
   * DECLARED. They say nothing about whether the declaration is honest: a
   * registry that declared `anon: { table: ["SELECT", "UPDATE", "DELETE"] }`
   * would pass every one of them while describing a hole.
   */

  it("declares nothing for a relation that does not exist", () => {
    // A declaration for a dropped or renamed table is a rule with nothing
    // under it, and worse, it is a rule a reader will believe is protecting
    // something.
    const present = new Set(swept.map((relation) => relation.qualified));
    for (const qualified of Object.keys(REQUEST_ROLE_PRIVILEGES)) {
      expect(
        present.has(qualified),
        `REQUEST_ROLE_PRIVILEGES declares ${qualified}, which is not in the catalog`,
      ).toBe(true);
    }
  });

  it("gives anon nothing, anywhere", () => {
    // `anon` holds no tenant claim by definition, so no privilege it could
    // hold is defensible. Stated once here as a property of the registry
    // rather than trusted to three separate declarations staying right.
    for (const [qualified, declared] of Object.entries(REQUEST_ROLE_PRIVILEGES)) {
      expect(
        normalisePrivileges(declared.anon),
        `${qualified} declares a privilege for anon`,
      ).toEqual({ table: [], columns: {} });
    }
  });

  it("declares no privilege Postgres does not have", () => {
    // A typo -- "SELCT", "MODIFY" -- would make a declaration unmatchable and
    // the per-relation assertion would read as a missing grant, which sends
    // the next reader to the migration instead of to the registry.
    for (const [qualified, declared] of Object.entries(REQUEST_ROLE_PRIVILEGES)) {
      for (const role of REQUEST_ROLES) {
        for (const privilege of declared[role].table) {
          expect(TABLE_PRIVILEGES, `${qualified}.${role} declares "${privilege}"`).toContain(
            privilege,
          );
        }
        for (const [column, privileges] of Object.entries(declared[role].columns)) {
          for (const privilege of privileges) {
            expect(
              COLUMN_PRIVILEGES,
              `${qualified}.${role}.${column} declares "${privilege}", which Postgres cannot grant ` +
                `on a single column`,
            ).toContain(privilege);
          }
        }
      }
    }
  });

  it("never declares a column privilege the table grant already implies", () => {
    // The reader reports a column privilege only where the table-level one is
    // absent, so declaring both makes a relation permanently unmatchable.
    for (const [qualified, declared] of Object.entries(REQUEST_ROLE_PRIVILEGES)) {
      for (const role of REQUEST_ROLES) {
        for (const [column, privileges] of Object.entries(declared[role].columns)) {
          for (const privilege of privileges) {
            expect(
              declared[role].table,
              `${qualified}.${role} declares ${privilege} on both the table and column ${column}`,
            ).not.toContain(privilege);
          }
        }
      }
    }
  });

  it("leaves no default privilege that would expose the NEXT table", async () => {
    // The other half of 20260828000000. Resetting the three tables that exist
    // fixes today; revoking the default ACL is what stops Story 1.7's
    // `branches` being born writable by `anon` before anyone has written a
    // line about it.
    //
    // Only the migration role's defaults are checked, and only those can be:
    // a default ACL is keyed on the role that CREATES the object, and
    // `postgres` is not a member of `supabase_admin` on a Supabase project, so
    // that role's defaults cannot be altered from a migration. They do not
    // need to be -- nothing in this repository creates an object as
    // `supabase_admin`.
    const leftover = await withAdmin(async (client) => {
      const { rows } = await client.query<{ grantor: string; objtype: string; acl: string }>(
        `select pg_get_userbyid(d.defaclrole) as grantor,
                d.defaclobjtype::text        as objtype,
                d.defaclacl::text            as acl
           from pg_default_acl d
           join pg_namespace n on n.oid = d.defaclnamespace
          where n.nspname = 'public'
            and d.defaclrole = (select oid from pg_roles where rolname = current_user)
            and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%authenticated=%')`,
      );
      return rows;
    });
    expect(
      leftover,
      "a default privilege in public still grants a request role, so the next table created " +
        "by a migration will be born with it",
    ).toEqual([]);
  });

  it.each(Object.entries(REQUEST_ROLE_PRIVILEGES))("%s states why", (_qualified, declared) => {
    // Same discipline as an exemption. A grant nobody has to justify is how a
    // write surface grows one column at a time.
    expect(declared.why.trim().length).toBeGreaterThan(80);
  });

  it("sees a table born under Supabase's default privileges as fully granted", async () => {
    // THE NEGATIVE CONTROL, and the one that makes this whole block worth
    // having. Everything above asserts that three tables match their
    // declarations, which would be equally true of a reader that returned the
    // declaration back to itself.
    //
    // `globalSetup` installs Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT
    // ALL ON TABLES TO anon, authenticated` before migrating, so a table
    // created with no grants of its own is born with all of them -- exactly as
    // `public.memberships` was on the live project. This proves the reader
    // sees that, and therefore that a future migration which forgets its
    // `revoke` fails here rather than in production.
    const born = await withAdmin(async (client) => {
      await client.query("begin");
      try {
        // Installed HERE rather than relied on from `globalSetup`, and that is
        // the point of the fix that produced this line. The migration in
        // 20260828000000 revokes the default privileges for the migration
        // role, so by the time the suite runs they are gone -- which is
        // correct for production and would have made this control silently
        // pass against a substrate that no longer has the hazard. It installs
        // its own, from the same shared definition `globalSetup` uses, and
        // rolls it back.
        await installSupabaseDefaultPrivileges(client);
        await client.query(
          `create table public.privilege_control (id uuid primary key, tenant_id uuid not null)`,
        );
        // The pattern the earlier migrations used, which is NOT enough: the
        // default ACL grants anon EXPLICITLY, and revoking from PUBLIC does
        // not remove an explicit role grant.
        await client.query(`revoke all on public.privilege_control from public`);
        await client.query(`grant select on public.privilege_control to authenticated`);
        const held = await readRequestRolePrivileges(client);
        return held["public.privilege_control"];
      } finally {
        await client.query("rollback");
      }
    });

    expect(born, "the privilege reader did not see a newly created table").toBeDefined();
    // Both roles, everything. If this ever reports `{table: []}` the container
    // has stopped simulating the real project and the assertions above have
    // quietly stopped meaning anything.
    expect(
      normalisePrivileges(born.anon).table,
      "the container is no longer reproducing Supabase's default ACLs; every privilege " +
        "assertion in this file is now weaker than production",
    ).toEqual([...TABLE_PRIVILEGES].sort());
    expect(normalisePrivileges(born.authenticated).table).toEqual([...TABLE_PRIVILEGES].sort());
  });

  it("sees an explicit revoke bring the same table back to its intent", async () => {
    // The positive half: the fix works, and the fix is the pattern every
    // migration from here has to use -- revoke from the ROLES, then grant.
    const fixed = await withAdmin(async (client) => {
      await client.query("begin");
      try {
        await installSupabaseDefaultPrivileges(client);
        await client.query(
          `create table public.privilege_control (id uuid primary key, tenant_id uuid not null)`,
        );
        await client.query(`revoke all on public.privilege_control from anon, authenticated`);
        await client.query(`grant select on public.privilege_control to authenticated`);
        await client.query(`grant insert (tenant_id) on public.privilege_control to authenticated`);
        const held = await readRequestRolePrivileges(client);
        return held["public.privilege_control"];
      } finally {
        await client.query("rollback");
      }
    });

    expect(normalisePrivileges(fixed.anon)).toEqual({ table: [], columns: {} });
    expect(normalisePrivileges(fixed.authenticated)).toEqual({
      table: ["SELECT"],
      columns: { tenant_id: ["INSERT"] },
    });
  });
});

describe("the exemption allowlist", () => {
  it("holds exactly the three agreed entries", () => {
    // A fourth is a decision, not a commit. Widening this list is on the
    // spec's Ask First line.
    expect(EXEMPTIONS.map((exemption) => exemption.id)).toEqual([
      "global-statutory-tables",
      "pgboss-schema",
      "above-tenant-boundary",
    ]);
  });

  it.each(EXEMPTIONS.map((exemption) => [exemption.id, exemption] as const))(
    "%s states why",
    (_id, exemption) => {
      // An exemption nobody has to justify is how an allowlist becomes a
      // habit. The length floor is crude on purpose: it rejects "n/a".
      expect(exemption.justification.trim().length).toBeGreaterThan(80);
      expect(exemption.waives.length).toBeGreaterThan(0);
    },
  );

  it("never waives RLS or discovery for a relation in an application schema", () => {
    for (const exemption of EXEMPTIONS) {
      if (exemption.kind === "tables") {
        expect(exemption.waives, `${exemption.id} lifts discovery on tables in ${exemption.schema}`).not.toContain(
          "discovery",
        );
      }
    }
  });

  it("actually excludes the schemas it says it excludes", () => {
    // The waiver was dead code once: `waivedFor` returned it and nothing read
    // it. Assert the effect, not the declaration.
    const excluded = EXEMPTIONS.filter((e) => e.kind === "schema").map((e) => e.schema);
    for (const schema of excluded) {
      expect(swept.some((relation) => relation.schema === schema)).toBe(false);
    }
  });
});

/**
 * The gate proving itself.
 *
 * Every rule above is asserted positively against a schema that satisfies it,
 * which says nothing about whether the rule would fire. These build the
 * offending object inside a transaction, read it back through the same
 * discovery the sweep uses, and roll it back.
 */
describe("negative controls", () => {
  const inRolledBackTransaction = <T>(ddl: string[], read: (client: Parameters<Parameters<typeof withAdmin>[0]>[0]) => Promise<T>) =>
    withAdmin(async (client) => {
      await client.query("begin");
      try {
        for (const statement of ddl) await client.query(statement);
        return await read(client);
      } finally {
        await client.query("rollback");
      }
    });

  it("flags a table with no RLS and no policy", async () => {
    const found = await inRolledBackTransaction(
      [
        `create table public.negative_control_table (
           id uuid primary key, tenant_id uuid not null)`,
      ],
      async (client) =>
        (await readRelations(client)).find((r) => r.name === "negative_control_table"),
    );
    expect(found, "discovery did not see a newly created table").toBeDefined();
    expect(found?.rlsEnabled).toBe(false);
    expect(found?.permissivePolicyCount).toBe(0);
    expect(found?.indexes.some((index) => index.leadingColumn === "tenant_id")).toBe(false);
    expect(fixtureFor("public", "negative_control_table")).toBeUndefined();
  });

  it("flags a view that is not security_invoker", async () => {
    const found = await inRolledBackTransaction(
      [`create view public.negative_control_view as select id from public.companies`],
      async (client) =>
        (await readRelations(client)).find((r) => r.name === "negative_control_view"),
    );
    expect(found?.kind).toBe("v");
    expect(found?.securityInvoker, "a plain view reported as security_invoker").toBe(false);
  });

  it("sees a security_invoker view as protected", async () => {
    const found = await inRolledBackTransaction(
      [
        `create view public.negative_control_ok
           with (security_invoker = true) as select id from public.companies`,
      ],
      async (client) => (await readRelations(client)).find((r) => r.name === "negative_control_ok"),
    );
    expect(found?.securityInvoker).toBe(true);
  });

  it("flags a security definer function", async () => {
    const found = await inRolledBackTransaction(
      [
        `create function public.negative_control_fn() returns setof public.companies
           language sql security definer as 'select * from public.companies'`,
      ],
      async (client) =>
        (await readFunctions(client)).find((fn) => fn.name === "negative_control_fn"),
    );
    expect(found?.securityDefiner).toBe(true);
    // Also the default nobody sets deliberately.
    expect(found?.parallel).toBe("u");
  });

  it("flags a policy granted to anon with an unconditioned qual", async () => {
    const found = await inRolledBackTransaction(
      [
        `create table public.negative_control_open (id uuid primary key, tenant_id uuid not null)`,
        `alter table public.negative_control_open enable row level security`,
        `create policy open_to_all on public.negative_control_open for select to anon using (true)`,
      ],
      async (client) =>
        (await readPolicies(client)).find((policy) => policy.name === "open_to_all"),
    );
    expect(found?.roles).toEqual(["anon"]);
    expect(found?.permissive).toBe(true);
    expect(referencesClaim(found?.using ?? null, claimFunctions)).toBe(false);
  });

  it("flags a partial index as no index at all", async () => {
    const found = await inRolledBackTransaction(
      [
        `create table public.negative_control_partial (id uuid primary key, tenant_id uuid not null)`,
        `create index ncp_idx on public.negative_control_partial (tenant_id)
           where tenant_id is not null`,
      ],
      async (client) =>
        (await readRelations(client)).find((r) => r.name === "negative_control_partial"),
    );
    expect(found?.indexes.map((index) => index.name)).not.toContain("ncp_idx");
  });
});

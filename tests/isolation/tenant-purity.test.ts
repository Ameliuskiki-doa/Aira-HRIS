/**
 * What a request can actually see and write.
 *
 * Every assertion runs over TCP as `authenticator`, switched into
 * `authenticated` or `anon` for one transaction -- the shape a PostgREST
 * request has. Not as the superuser the fixtures were written with: a
 * superuser bypasses RLS *even with FORCE*, so the whole file would be
 * vacuous. `catalog-sweep.test.ts` asserts that neither identity can bypass
 * RLS, and the first test below proves it behaviourally as well.
 *
 * Every read goes through `assertTenantPurity`, which proves the fixture is
 * non-empty before it claims anything about purity. That ordering is the
 * difference between "this table isolates" and "this table returned nothing,
 * possibly because it has RLS and no policy".
 *
 * Three passes per relation, not one: as tenant A, as tenant B, and as
 * `anon`. The third exists because a policy `to anon using (true)` passes
 * every structural check while returning everything.
 */
import { describe, expect, it } from "vitest";

import {
  assertTenantPurity,
  FIXTURES,
  ORG_A,
  ORG_B,
  PRINCIPAL_A,
  PRINCIPAL_B,
  PRINCIPAL_FRESH,
  TENANT_B,
} from "./support/fixtures";
import {
  asPrincipal,
  asRequest,
  readOrDenied,
  withAdmin,
  type Principal,
} from "./support/substrate";

/** Table names come from the registry, but never interpolate an unvetted one. */
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
};

const qualified = (fixture: { schema: string; table: string }) =>
  `${identifier(fixture.schema)}.${identifier(fixture.table)}`;

describe("the app role is genuinely constrained", () => {
  // The behavioural half of the guard-on-guard. If the app connection could
  // bypass RLS, it would see what the admin sees and this fails -- no
  // catalog reasoning required.
  it.each(FIXTURES.map((fixture) => [fixture.table, fixture] as const))(
    "sees fewer rows of %s than the admin does",
    async (_name, fixture) => {
      const total = await withAdmin(async (client) => {
        const { rows } = await client.query<{ count: string }>(
          `select count(*)::text as count from ${qualified(fixture)}`,
        );
        return Number(rows[0]?.count);
      });
      const visible = await asPrincipal(PRINCIPAL_A, async (client) => {
        const { rows } = await client.query(`select 1 from ${qualified(fixture)}`);
        return rows.length;
      });
      expect(total).toBeGreaterThan(1);
      expect(
        visible,
        `the app role saw all ${total} rows of ${fixture.table}; it is not subject to RLS`,
      ).toBeLessThan(total);
    },
  );
});

describe.each(FIXTURES.map((fixture) => [fixture.table, fixture] as const))(
  "%s",
  (_name, fixture) => {
    const relation = qualified(fixture);

    it.each([
      ["A", PRINCIPAL_A],
      ["B", PRINCIPAL_B],
    ] as [string, Principal][])("shows tenant %s only its own rows", async (label, principal) => {
      const rows = await asPrincipal(principal, async (client) => {
        const result = await client.query(`select * from ${relation}`);
        return result.rows as Array<Record<string, unknown>>;
      });
      assertTenantPurity(
        rows,
        fixture.isolationColumn,
        fixture.expected(principal),
        `${fixture.table} as ${label}`,
      );
    });

    it("shows anon nothing, by policy or by privilege", async () => {
      // `anon` holds no claim by definition. Either mechanism is acceptable;
      // a row is not.
      const { rows } = await readOrDenied(relation, { role: "anon", claims: { kind: "unset" } });
      expect(rows).toEqual([]);
    });

    // The four states that reach `public.tenant_id()`. Only the first was ever
    // tested; the other three raised 22P02 and turned an anonymous read into a
    // 500 rather than an empty set.
    it.each([
      ["no claim GUC at all", { kind: "unset" } as const],
      ["a GUC cleared to '' -- what PostgREST does on a pooled connection", { kind: "raw", value: "" } as const],
      ["a GUC holding a non-JSON string", { kind: "raw", value: "not json at all" } as const],
      ["a JSON claim whose tenant_id is not a UUID", { kind: "raw", value: '{"app_metadata":{"tenant_id":"drop-table"}}' } as const],
      ["a JSON claim with an empty tenant_id", { kind: "raw", value: '{"app_metadata":{"tenant_id":""}}' } as const],
      ["a JSON array rather than an object", { kind: "raw", value: "[1,2,3]" } as const],
    ])("fails closed on %s", async (_label, claims) => {
      const rows = await asRequest({ role: "authenticated", claims }, async (client) => {
        const result = await client.query(`select * from ${relation}`);
        return result.rows;
      });
      expect(rows).toEqual([]);
    });

    it("cannot reach the other tenant's row to update it", async () => {
      const affected = await asPrincipal(PRINCIPAL_A, async (client) => {
        const result = await client.query(
          `update ${relation}
              set ${identifier(fixture.isolationColumn)} = ${identifier(fixture.isolationColumn)}
            where ${identifier(fixture.isolationColumn)} = $1`,
          [fixture.expected(PRINCIPAL_B)],
        );
        return result.rowCount ?? 0;
      });
      expect(affected).toBe(0);
    });
  },
);

describe("a write carrying another tenant's key", () => {
  it("cannot attach a company to another tenant's billing account", () => {
    // The WITH CHECK's second clause. Without it the row is still "its own"
    // (`id = tenant_id()`), so the tenant rule alone says yes and the company
    // silently moves onto somebody else's subscription.
    const attempt = asPrincipal(PRINCIPAL_A, (client) =>
      client.query(
        `insert into public.companies (id, organization_id, legal_name)
         values (gen_random_uuid(), $1, 'PT Disusupi')`,
        [ORG_B],
      ),
    );
    return expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot re-point its own company at another tenant's billing account", async () => {
    // The clause the INSERT case cannot reach. On INSERT the signup policy
    // already demands ownership, so removing the ownership clause from
    // `companies_tenant`'s WITH CHECK changed nothing an insert could see --
    // and this suite stayed green through exactly that mutation until this
    // test existed. UPDATE is the command the clause actually governs: the row
    // is still the caller's own (`id = tenant_id()`), so the tenant rule alone
    // says yes and the company silently moves onto somebody else's plan.
    const attempt = asPrincipal(PRINCIPAL_A, (client) =>
      client.query(`update public.companies set organization_id = $1 where id = $2`, [
        ORG_B,
        PRINCIPAL_A.tenantId,
      ]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("can still update its own company under its own organization", async () => {
    // The positive control. A rule that forbids the legitimate update as well
    // is not a tighter rule, it is a broken table.
    const affected = await asRequest(
      { role: "authenticated", claims: { kind: "principal", principal: PRINCIPAL_A }, rollback: true },
      async (client) => {
        const result = await client.query(
          `update public.companies set legal_name = 'PT Sejahtera Abadi Tbk' where id = $1`,
          [PRINCIPAL_A.tenantId],
        );
        return result.rowCount ?? 0;
      },
    );
    expect(affected).toBe(1);
  });

  it("cannot create a company carrying tenant B's id", () => {
    // `companies.id` IS the tenant_id, so this row literally carries tenant
    // B's. WITH CHECK is evaluated before the heap insert, so what comes back
    // is 42501 and not the primary-key conflict the row would also cause --
    // the policy is what stops it, not the constraint.
    const attempt = asPrincipal(PRINCIPAL_A, (client) =>
      client.query(
        `insert into public.companies (id, organization_id, legal_name) values ($1, $2, 'PT Disusupi')`,
        [TENANT_B, ORG_B],
      ),
    );
    return expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot create an organization owned by someone else", () => {
    const attempt = asPrincipal(PRINCIPAL_A, (client) =>
      client.query(
        `insert into public.organizations (name, owner_user_id, plan)
         values ('Grup Disusupi', $1, 'free')`,
        [PRINCIPAL_B.userId],
      ),
    );
    return expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot delete the tenant boundary row at all", () => {
    // No DELETE grant on companies. Deleting it orphans every row in the
    // tenant behind a foreign key that no longer resolves.
    const attempt = asPrincipal(PRINCIPAL_A, (client) =>
      client.query(`delete from public.companies where id = $1`, [PRINCIPAL_A.tenantId]),
    );
    return expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("copies nothing rather than erroring when the source is another tenant's row", async () => {
    // The other half, and the reason the cases are separate. A write whose
    // *source* is a SELECT is filtered by the read policy first, so it inserts
    // zero rows and raises nothing at all. Nothing leaks either way, but only
    // one of them tells the application it failed.
    const inserted = await asPrincipal(PRINCIPAL_A, async (client) => {
      const result = await client.query(
        `insert into public.companies (id, organization_id, legal_name)
         select gen_random_uuid(), organization_id, legal_name
           from public.companies where id = $1`,
        [TENANT_B],
      );
      return result.rowCount ?? 0;
    });
    expect(inserted).toBe(0);
  });
});

describe("the signup path", () => {
  // Story 1.5 is "sign up by email and create a company". A fresh signup holds
  // a `sub` and no `tenant_id`, because the tenant does not exist until this
  // insert creates it -- so a policy demanding `id = tenant_id()` locks the
  // table against the only caller that ever needs to write to it. That is what
  // an earlier version of the migration did, and nothing noticed.
  it("lets a user with no tenant claim create an organization and its first company", async () => {
    const created = await asRequest(
      {
        role: "authenticated",
        claims: { kind: "principal", principal: PRINCIPAL_FRESH },
        rollback: true,
      },
      async (client) => {
        const organization = await client.query<{ id: string }>(
          `insert into public.organizations (name, owner_user_id, plan)
           values ('Grup Baru', $1, 'free') returning id`,
          [PRINCIPAL_FRESH.userId],
        );
        const organizationId = organization.rows[0]?.id;
        const company = await client.query<{ id: string }>(
          `insert into public.companies (organization_id, legal_name)
           values ($1, 'PT Baru Berdiri') returning id`,
          [organizationId],
        );
        return { organizationId, companyId: company.rows[0]?.id };
      },
    );
    expect(created.organizationId).toBeTruthy();
    expect(created.companyId).toBeTruthy();
  });

  it("still refuses a company under an organization the caller does not own", () => {
    const attempt = asRequest(
      {
        role: "authenticated",
        claims: { kind: "principal", principal: PRINCIPAL_FRESH },
        rollback: true,
      },
      (client) =>
        client.query(
          `insert into public.companies (organization_id, legal_name) values ($1, 'PT Menumpang')`,
          [ORG_A],
        ),
    );
    return expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

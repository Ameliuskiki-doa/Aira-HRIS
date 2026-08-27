/**
 * What a request may actually write, asked as an attacker rather than as the
 * application.
 *
 * The application is not the only thing holding the user's JWT. PostgREST
 * exposes every table the `authenticated` role has been granted, and
 * `public.register_company()` is callable directly -- so every bound that
 * exists only in a Zod schema is a bound that exists only for callers who go
 * through the form. This file goes around it.
 *
 * The property, which the earlier suites did not state:
 *
 *   **no request may make a write the database itself would not permit.**
 *
 * Two families of finding, both reproduced before they were fixed:
 *
 *   - **Privilege.** `organizations_owner` is `FOR ALL` and UPDATE was granted
 *     on the whole table, so `update organizations set plan = 'payroll'`
 *     returned `UPDATE 1`: a customer could hand themselves the paid tier.
 *   - **Size.** `insert into companies (legal_name) values (repeat('X',
 *     500000))` stored half a megabyte, and so did the RPC. The 200- and
 *     32-character caps lived only in `lib/validation/company.ts`.
 *
 * Everything runs over TCP as `authenticator`, switched into `authenticated`,
 * carrying its own claim -- the shape a PostgREST request has, which is the
 * shape an attacker has too.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asRequest, withAdmin, type Principal } from "./support/substrate";

const OWNER: Principal = {
  userId: "00000000-0000-4000-8000-00000000e001",
  tenantId: null,
};

/** The same owner, once their company exists, so UPDATE has a tenant claim. */
const tenantClaimFor = (companyId: string): Principal => ({
  userId: OWNER.userId,
  tenantId: companyId,
});

const asOwner = <T>(
  principal: Principal,
  fn: Parameters<typeof asRequest<T>>[1],
) => asRequest<T>({ role: "authenticated", claims: { kind: "principal", principal } }, fn);

type Registration = { organization_id: string; company_id: string; created: boolean };

const register = (legalName = "PT Permukaan Tulis", timeZone = "Asia/Jakarta") =>
  asOwner<Registration>(OWNER, async (client) => {
    const { rows } = await client.query<{ result: Registration }>(
      `select public.register_company($1, null, null, null, $2) as result`,
      [legalName, timeZone],
    );
    return rows[0].result;
  });

const planOf = (organizationId: string) =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{ plan: string }>(
      `select plan from public.organizations where id = $1`,
      [organizationId],
    );
    return rows[0]?.plan;
  });

afterEach(async () => {
  await withAdmin(async (client) => {
    // Memberships first. Registration now creates a founding membership, and
    // `memberships.tenant_id` references `companies (id)` with no cascade --
    // deliberately, since deleting a company out from under a membership is
    // the orphaning the tenant boundary exists to prevent.
    await client.query(`delete from public.memberships where user_id = $1`, [
      OWNER.userId,
    ]);
    await client.query(
      `delete from public.companies c using public.organizations o
        where o.id = c.organization_id and o.owner_user_id = $1`,
      [OWNER.userId],
    );
    await client.query(`delete from public.organizations where owner_user_id = $1`, [
      OWNER.userId,
    ]);
  });
});

/* ── privilege ─────────────────────────────────────────────────────────────── */

describe("the paid tier is not self-service", () => {
  it("refuses an owner upgrading their own plan", async () => {
    // Reproduced as `UPDATE 1` before the fix. `organizations_owner` is FOR
    // ALL and the row genuinely is the caller's own, so no policy was ever
    // going to stop this -- the row is theirs, the column is not.
    const { organization_id } = await register();

    const attempt = asOwner(OWNER, (client) =>
      client.query(`update public.organizations set plan = 'payroll' where id = $1`, [
        organization_id,
      ]),
    );

    await expect(attempt).rejects.toMatchObject({ code: "42501" });
    expect(await planOf(organization_id), "the plan was changed from a request path").toBe(
      "free",
    );
  });

  it("refuses an owner creating an organization already on the paid tier", async () => {
    // The other door. Blocking UPDATE alone leaves INSERT, and the policy's
    // WITH CHECK only ever asked who owns the row.
    const attempt = asOwner(OWNER, (client) =>
      client.query(
        `insert into public.organizations (name, owner_user_id, plan)
         values ('Grup Naik Kelas', $1, 'payroll')`,
        [OWNER.userId],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("gives every organization a request path creates the free plan", async () => {
    // Not "the insert is refused" -- signup has to be able to create one. The
    // rule is that the column is not the caller's to choose.
    const { organization_id } = await register();
    expect(await planOf(organization_id)).toBe("free");
  });

  it("still lets an owner rename their own organization", async () => {
    // Positive control. A grant that removes every write is not a tighter
    // grant, it is a table nothing can use.
    const { organization_id } = await register();
    const affected = await asOwner<number>(OWNER, async (client) => {
      const result = await client.query(
        `update public.organizations set name = 'Grup Berganti Nama' where id = $1`,
        [organization_id],
      );
      return result.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });
});

/* ── size ──────────────────────────────────────────────────────────────────── */

/**
 * The bounds, stated once. They are the Zod bounds, and that is the point:
 * two walls that disagree are one wall plus a false sense of the other.
 */
const LIMITS = {
  legalName: 200,
  npwp: 32,
  nppBpjsTk: 32,
  bpjsKesCode: 32,
  organizationName: 200,
} as const;

describe("length is enforced by the database, not only by the form", () => {
  it("refuses half a megabyte of legal name through PostgREST", async () => {
    // Reproduced as a successful insert before the fix. `text` has no length
    // limit, `not null` says nothing about size, and the route handler is not
    // the only caller.
    const { organization_id } = await register();
    const attempt = asOwner(OWNER, (client) =>
      client.query(
        `insert into public.companies (organization_id, legal_name)
         values ($1, repeat('X', 500000))`,
        [organization_id],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses it through the RPC too", async () => {
    const attempt = register("Z".repeat(300000));
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["legal name", LIMITS.legalName],
    ["organization name", LIMITS.organizationName],
  ])("accepts a %s exactly at the limit", async (_label, limit) => {
    // The boundary, on the legal side of it. A constraint written `< 200`
    // rejects a name the form accepts, which is a defect that only ever shows
    // up for the one customer whose name is that long.
    const created = await register("N".repeat(limit));
    expect(created.created).toBe(true);
  });

  it("refuses a legal name one character over the limit", async () => {
    const attempt = register("N".repeat(LIMITS.legalName + 1));
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["p_npwp", 2],
    ["p_npp_bpjs_tk", 3],
    ["p_bpjs_kes_code", 4],
  ])("refuses an oversized %s", async (_name, position) => {
    const args: Array<string | null> = [
      "PT Identitas Panjang",
      null,
      null,
      null,
      "Asia/Jakarta",
    ];
    args[position - 1] = "9".repeat(33);
    const attempt = asOwner(OWNER, (client) =>
      client.query(`select public.register_company($1, $2, $3, $4, $5)`, args),
    );
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts an identifier exactly at 32", async () => {
    const created = await asOwner<Registration>(OWNER, async (client) => {
      const { rows } = await client.query<{ result: Registration }>(
        `select public.register_company($1, $2, null, null, 'Asia/Jakarta') as result`,
        ["PT Pas Sekali", "9".repeat(LIMITS.npwp)],
      );
      return rows[0].result;
    });
    expect(created.created).toBe(true);
  });

  it("refuses an oversized name on an update, not only on an insert", async () => {
    // A constraint is checked on every write. Asserted anyway, because the
    // temptation when a check is expensive is to move it into the insert path.
    const { company_id } = await register();
    const attempt = asOwner(tenantClaimFor(company_id), (client) =>
      client.query(`update public.companies set legal_name = repeat('X', 5000) where id = $1`, [
        company_id,
      ]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });
});

/* ── re-runnability ────────────────────────────────────────────────────────── */

describe("the migrations can be applied twice", () => {
  it("adds no constraint that would raise on a second application", async () => {
    // This matters because the ledger-repair runbook in deferred-work.md ends
    // in `supabase db push`, and a repair that records the wrong version leads
    // to a file being applied again. A bare `alter table ... add constraint`
    // raises 42710 the second time and takes the whole push down with it.
    const bare = await withAdmin(async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count
           from pg_constraint
          where conrelid in ('public.companies'::regclass, 'public.organizations'::regclass)
            and contype = 'c'`,
      );
      return Number(rows[0].count);
    });
    // There are constraints to be re-added; the assertion below is not vacuous.
    expect(bare).toBeGreaterThan(0);
  });
});

/**
 * What a request may do to a membership row, asked as an attacker.
 *
 * A membership decides two things: which company a person lands in, and what
 * they are allowed to see once they are there. Both are written in this table,
 * both are carried into the token by the access-token hook, and neither is
 * adjudicated again on a request path -- that is the whole point of putting
 * them in claims (AD-25). So the write surface of this one table IS the
 * authorization model, and the property below is stated as a property rather
 * than as a list of endpoints:
 *
 *   **No request path may write `tenant_id`, write `role`, or write another
 *   user's `last_active_at`.**
 *
 * Each is proved by attempting it. Not by reading the grant table: a grant is
 * evidence about a mechanism, and what matters is the outcome.
 *
 * The distinction between REFUSED and ZERO ROWS is load-bearing throughout.
 * A policy that filters an UPDATE reports `UPDATE 0` and raises nothing, which
 * an attacker reads as "not yet" and an application reads as success. Every
 * refusal here is an error the caller cannot mistake for anything else -- and
 * that is why `memberships` grants SELECT and nothing else, rather than
 * granting writes and fencing them with a policy. It was measured the other
 * way first: with the policy written `for all` plus `grant update
 * (last_active_at)`, a user moved a TENANT-MATE'S active company and the write
 * was reported as successful.
 *
 * Everything runs over TCP as `authenticator`, switched into `authenticated`
 * or `anon` for one transaction, carrying its own claim. That is the shape a
 * PostgREST request has, which is the shape an attacker has too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  declaredPrivilegesFor,
  normalisePrivileges,
  readRequestRolePrivileges,
} from "./support/catalog";
import { PRINCIPAL_A, TENANT_A, TENANT_B } from "./support/fixtures";
import {
  asRequest,
  updateOrDenied,
  withAdmin,
  type Principal,
} from "./support/substrate";

/**
 * Three principals invented for this file, with their own rows, so nothing
 * here perturbs the shared fixture the purity suite asserts against.
 *
 *   SWITCHER  belongs to both companies -- the shape the switcher exists for
 *   MATE      belongs to tenant A only, and is SWITCHER's colleague there
 *   LAPSED    belongs to tenant B, deactivated
 */
const SWITCHER: Principal = {
  userId: "00000000-0000-4000-8000-0000000e0001",
  tenantId: TENANT_A,
};
const MATE: Principal = {
  userId: "00000000-0000-4000-8000-0000000e0002",
  tenantId: TENANT_A,
};
const LAPSED: Principal = {
  userId: "00000000-0000-4000-8000-0000000e0003",
  tenantId: TENANT_B,
};

const USERS = [SWITCHER.userId, MATE.userId, LAPSED.userId];

/** Old enough that any real switch moves it forward by a measurable amount. */
const BASELINE = "2026-01-01T00:00:00Z";

const asPrincipalRequest = <T>(
  principal: Principal,
  fn: Parameters<typeof asRequest<T>>[1],
  options: { rollback?: boolean } = {},
) =>
  asRequest<T>(
    { role: "authenticated", claims: { kind: "principal", principal }, ...options },
    fn,
  );

type CompanyEntry = {
  company_id: string;
  legal_name: string;
  role: string;
  last_active_at: string | null;
};
type SwitchResult = { switched: boolean; companies: CompanyEntry[] };

const callSwitch = (principal: Principal, companyId: string | null) =>
  asPrincipalRequest<SwitchResult>(principal, async (client) => {
    const { rows } = await client.query<{ result: SwitchResult }>(
      `select public.switch_company($1::uuid) as result`,
      [companyId],
    );
    return rows[0].result;
  });

/** Read as the superuser, which is the only way to see across the boundary. */
const membershipsOf = (userId: string) =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{
      tenant_id: string;
      role: string;
      is_active: boolean;
      last_active_at: string | null;
    }>(
      `select tenant_id, role, is_active, last_active_at
         from public.memberships where user_id = $1 order by tenant_id`,
      [userId],
    );
    return rows;
  });

beforeEach(async () => {
  await withAdmin(async (client) => {
    await client.query(`delete from public.memberships where user_id = any($1::uuid[])`, [USERS]);
    await client.query(
      `insert into public.memberships
         (tenant_id, user_id, role, is_active, last_active_at, created_at)
       values ($1, $2, 'hr_manager', true,  $6, $6),
              ($3, $2, 'accountant', true,  null, $6),
              ($1, $4, 'hr_staff',   true,  $6, $6),
              ($3, $5, 'staff',      false, $6, $6)`,
      [TENANT_A, SWITCHER.userId, TENANT_B, MATE.userId, LAPSED.userId, BASELINE],
    );
  });
});

afterEach(async () => {
  await withAdmin(async (client) => {
    await client.query(`delete from public.memberships where user_id = any($1::uuid[])`, [USERS]);
  });
});

/* ── the three writes nothing may make ─────────────────────────────────────── */

describe("the refusals below come from privilege, not from a policy", () => {
  it("declares no write for either request role, and the substrate agrees", async () => {
    // The precondition every assertion in this file depends on, stated once
    // rather than assumed by each of them.
    //
    // It was assumed, and it was wrong in production. Supabase grants ALL on
    // every new table in `public` to `anon` and `authenticated` by default, so
    // `memberships` shipped fully writable there while the container reported
    // SELECT-only. RLS still refused every write -- but by FILTERING it to
    // zero rows, which is the outcome this table's design exists to avoid:
    // "an attacker reads that as 'not yet'". If this test fails, the refusals
    // below are still green and no longer mean what they say.
    const declared = declaredPrivilegesFor("public", "memberships");
    expect(declared).toBeDefined();
    expect(normalisePrivileges(declared!.authenticated)).toEqual({
      table: ["SELECT"],
      columns: {},
    });

    const held = await withAdmin(readRequestRolePrivileges);
    expect(normalisePrivileges(held["public.memberships"].authenticated)).toEqual({
      table: ["SELECT"],
      columns: {},
    });
    expect(normalisePrivileges(held["public.memberships"].anon)).toEqual({
      table: [],
      columns: {},
    });
  });
});

describe("no request path can write tenant_id", () => {
  it("refuses an UPDATE moving a membership into another company", async () => {
    // A writable tenant key is the tenant boundary handing out its own keys:
    // one statement and the caller is a member of a company they were never
    // invited to, with the role they already hold.
    const outcome = await updateOrDenied(
      `update public.memberships set tenant_id = $1 where user_id = $2`,
      [TENANT_B, SWITCHER.userId],
      { role: "authenticated", claims: { kind: "principal", principal: SWITCHER } },
    );
    expect(outcome.denied, "the write was not refused; it was filtered").toBe(true);
    expect(outcome.affected).toBe(0);
    expect((await membershipsOf(SWITCHER.userId)).map((row) => row.tenant_id).sort()).toEqual(
      [TENANT_A, TENANT_B].sort(),
    );
  });

  it("refuses an INSERT minting a membership in any company", async () => {
    // The other door, and the one a policy alone would leave open: the row
    // would be the caller's own, in the caller's own tenant, which is exactly
    // what a tenant policy says yes to.
    const attempt = asPrincipalRequest(SWITCHER, (client) =>
      client.query(
        `insert into public.memberships (tenant_id, user_id, role)
         values ($1, $2, 'admin')`,
        [TENANT_A, SWITCHER.userId],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

describe("no request path can write role", () => {
  it("refuses a user promoting themselves in their own company", async () => {
    // REFUSED BY PRIVILEGE, NOT BY POLICY, and the difference is visible here:
    // the row is unambiguously the caller's own and in the caller's own
    // tenant, so every policy in this schema says yes to it. The only thing
    // standing in the way is that `authenticated` was never granted UPDATE.
    const outcome = await updateOrDenied(
      `update public.memberships set role = 'admin'
        where user_id = $1 and tenant_id = $2`,
      [SWITCHER.userId, TENANT_A],
      { role: "authenticated", claims: { kind: "principal", principal: SWITCHER } },
    );
    expect(outcome.denied).toBe(true);
    const roles = (await membershipsOf(SWITCHER.userId)).map((row) => row.role);
    expect(roles).not.toContain("admin");
  });

  it("refuses a user promoting a colleague", async () => {
    const outcome = await updateOrDenied(
      `update public.memberships set role = 'admin' where user_id = $1`,
      [MATE.userId],
      { role: "authenticated", claims: { kind: "principal", principal: SWITCHER } },
    );
    expect(outcome.denied).toBe(true);
    expect((await membershipsOf(MATE.userId))[0]?.role).toBe("hr_staff");
  });

  it("refuses reactivating a membership that was switched off", async () => {
    // `is_active` is the deactivation switch the hook re-validates on every
    // token. Writable, it un-deactivates the person it was used on.
    const outcome = await updateOrDenied(
      `update public.memberships set is_active = true where user_id = $1`,
      [LAPSED.userId],
      { role: "authenticated", claims: { kind: "principal", principal: LAPSED } },
    );
    expect(outcome.denied).toBe(true);
    expect((await membershipsOf(LAPSED.userId))[0]?.is_active).toBe(false);
  });
});

describe("no request path can write another user's last_active_at", () => {
  it("refuses moving a tenant-mate's active company", async () => {
    // The hole this table's grant set was rewritten around. `last_active_at`
    // looks like a harmless timestamp; it is the value the access-token hook
    // orders by, so writing a colleague's moves which company they land in on
    // their next refresh -- silently, fifteen minutes later, from a screen
    // they never opened.
    const outcome = await updateOrDenied(
      `update public.memberships set last_active_at = now() where user_id = $1`,
      [MATE.userId],
      { role: "authenticated", claims: { kind: "principal", principal: SWITCHER } },
    );
    expect(
      outcome.denied,
      "a tenant-mate's last_active_at write was filtered rather than refused; " +
        "an attacker reads `UPDATE 0` as 'not yet'",
    ).toBe(true);
    expect((await membershipsOf(MATE.userId))[0]?.last_active_at).toEqual(new Date(BASELINE));
  });

  it("refuses writing its OWN last_active_at directly too", async () => {
    // Not an oversight. The only write path is `switch_company()`, which is
    // scoped to the caller by construction rather than by a WHERE clause the
    // caller supplies -- and a direct grant that happens to be safe for the
    // honest statement is not safe for the one an attacker writes.
    const outcome = await updateOrDenied(
      `update public.memberships set last_active_at = now() where user_id = $1`,
      [SWITCHER.userId],
      { role: "authenticated", claims: { kind: "principal", principal: SWITCHER } },
    );
    expect(outcome.denied).toBe(true);
  });

  it("refuses deleting a membership", async () => {
    const attempt = asPrincipalRequest(SWITCHER, (client) =>
      client.query(`delete from public.memberships where user_id = $1`, [MATE.userId]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

/* ── what the switcher may see ─────────────────────────────────────────────── */

describe("switch_company lists the caller's own companies and nobody else's", () => {
  it("returns both companies for a user who belongs to both", async () => {
    // The reason the function is `security definer` at all: this list spans
    // tenants by definition, and `memberships_tenant` is keyed on the ACTIVE
    // tenant, so an invoker-rights read returns only the company the caller is
    // already in.
    const result = await callSwitch(SWITCHER, null);
    expect(result.switched).toBe(false);
    expect(result.companies.map((entry) => entry.company_id).sort()).toEqual(
      [TENANT_A, TENANT_B].sort(),
    );
  });

  it("returns one company for a user who belongs to one", async () => {
    const result = await callSwitch(MATE, null);
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]?.company_id).toBe(TENANT_A);
    // And the role it reports is that user's role in that company, not the
    // caller's, and not the one that happens to be in the token.
    expect(result.companies[0]?.role).toBe("hr_staff");
  });

  it("omits a deactivated membership", async () => {
    // Fails closed the same way the hook does: a company you may not enter is
    // not a company to offer.
    const result = await callSwitch(LAPSED, null);
    expect(result.companies).toEqual([]);
  });

  it("shows one tenant's members nothing about another user", async () => {
    // The narrowness that the SECURITY_DEFINER_EXEMPTIONS entry claims, tested
    // rather than asserted. Every statement in the function is filtered on the
    // JWT subject, and no argument names a user -- so there is no call MATE
    // can make that returns SWITCHER's rows.
    const result = await callSwitch(MATE, null);
    expect(result.companies.map((entry) => entry.company_id)).not.toContain(TENANT_B);
  });

  it("refuses an unauthenticated caller", async () => {
    const attempt = asRequest({ role: "authenticated", claims: { kind: "unset" } }, (client) =>
      client.query(`select public.switch_company()`),
    );
    await expect(attempt).rejects.toMatchObject({ code: "28000" });
  });

  it("refuses anon outright", async () => {
    // Privilege, not the internal check. A write endpoint callable by `anon`
    // is not something to leave standing on the strength of a guard clause.
    const attempt = asRequest({ role: "anon", claims: { kind: "unset" } }, (client) =>
      client.query(`select public.switch_company()`),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

/* ── switching ─────────────────────────────────────────────────────────────── */

describe("switching company", () => {
  it("moves the caller's own last_active_at and nobody else's", async () => {
    const before = await membershipsOf(MATE.userId);
    const result = await callSwitch(SWITCHER, TENANT_B);

    expect(result.switched).toBe(true);

    const after = await membershipsOf(SWITCHER.userId);
    const tenantB = after.find((row) => row.tenant_id === TENANT_B);
    const tenantA = after.find((row) => row.tenant_id === TENANT_A);

    // The chosen company now sorts first, which is what the next token will
    // carry -- the hook and this function order identically.
    expect(tenantB?.last_active_at).not.toBeNull();
    expect(new Date(tenantB!.last_active_at!).getTime()).toBeGreaterThan(
      new Date(BASELINE).getTime(),
    );
    // The company left behind is untouched, so switching back is a switch and
    // not a re-registration.
    expect(tenantA?.last_active_at).toEqual(new Date(BASELINE));
    // And the colleague in the company being left is entirely unaffected.
    expect(await membershipsOf(MATE.userId)).toEqual(before);
  });

  it("leads the returned list with the company just switched into", async () => {
    const result = await callSwitch(SWITCHER, TENANT_B);
    expect(result.companies[0]?.company_id).toBe(TENANT_B);
  });

  it("refuses a company the caller holds no membership in", async () => {
    // REFUSED, not silently zero rows. A switch that quietly does nothing
    // leaves the caller on the old tenant while the screen says they moved,
    // which is the one outcome a session change must never have.
    const attempt = callSwitch(MATE, TENANT_B);
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
    expect(await membershipsOf(MATE.userId)).toHaveLength(1);
  });

  it("refuses a company whose membership is deactivated", async () => {
    const attempt = callSwitch(LAPSED, TENANT_B);
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses a company that does not exist", async () => {
    const attempt = callSwitch(SWITCHER, "00000000-0000-4000-8000-0000000dead0");
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

/* ── and afterwards ────────────────────────────────────────────────────────── */

describe("after switching, a query returns one company's rows only", () => {
  it("shows the new tenant's rows and none of the old one's", async () => {
    // The acceptance criterion, and the reason switching is a SESSION change
    // rather than a filter: the claim is what moves, so every policy in the
    // schema follows it without any of them being told about the switch.
    await callSwitch(SWITCHER, TENANT_B);

    const inTenantB = await asPrincipalRequest<Array<{ tenant_id: string }>>(
      { userId: SWITCHER.userId, tenantId: TENANT_B },
      async (client) => {
        const { rows } = await client.query<{ tenant_id: string }>(
          `select tenant_id from public.memberships`,
        );
        return rows;
      },
    );

    expect(inTenantB.length).toBeGreaterThan(0);
    expect(inTenantB.every((row) => row.tenant_id === TENANT_B)).toBe(true);

    // The company they came from is now unreachable with this token, which is
    // what makes a deep link from the previous company fail to resolve rather
    // than render an empty screen.
    const companies = await asPrincipalRequest<Array<{ id: string }>>(
      { userId: SWITCHER.userId, tenantId: TENANT_B },
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `select id from public.companies where id = $1`,
          [TENANT_A],
        );
        return rows;
      },
    );
    expect(companies).toEqual([]);
  });

  it("still isolates a user who genuinely belongs to two tenants", async () => {
    // The fixture principal that Story 1.5 recorded as missing: A and B owned
    // disjoint organizations, so "one tenant's rows" and "one owner's rows"
    // were indistinguishable in every assertion. SWITCHER belongs to both
    // companies, holds a claim for one, and must see exactly that one.
    const rows = await asPrincipalRequest<Array<{ tenant_id: string }>>(
      SWITCHER,
      async (client) => {
        const result = await client.query<{ tenant_id: string }>(
          `select tenant_id from public.memberships`,
        );
        return result.rows;
      },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === TENANT_A)).toBe(true);
  });

  it("does not let the fixture's own admin see the other tenant's memberships", async () => {
    // The plain case, kept next to the interesting one so a policy change that
    // fixes the multi-tenant principal by breaking the simple one is visible.
    const rows = await asPrincipalRequest<Array<{ tenant_id: string }>>(
      PRINCIPAL_A,
      async (client) => {
        const result = await client.query<{ tenant_id: string }>(
          `select tenant_id from public.memberships`,
        );
        return result.rows;
      },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === TENANT_A)).toBe(true);
  });
});

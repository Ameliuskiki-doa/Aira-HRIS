/**
 * The row that makes a tenant reachable, and the reasons it is safe to write.
 *
 * Until this existed, Story 1.6 shipped a working access token hook, a working
 * switcher, and nothing for either to act on: `register_company()` created an
 * organization and a company and stopped, so the owner held a `sub`, owned a
 * company, and had no membership -- which meant no `tenant_id` in their token
 * and every tenant policy in the schema still evaluating to "see nothing".
 *
 * `public.create_founding_membership()` closes that, and it is the third and
 * last `security definer` function in the schema. The tag is the hazard, so
 * the file is organised around what the tag does NOT excuse:
 *
 *   1. **It is the only write path, and the table is still closed.**
 *      `authenticated` holds no INSERT or UPDATE on `memberships` after this
 *      change, exactly as before it. The privilege lives in one function's
 *      owner, not in a grant, and the grant is what an attacker would use.
 *   2. **`security definer` skips the policy that would have checked
 *      ownership**, so the check is made in the body -- against
 *      `organizations.owner_user_id`, the same fact
 *      `companies_create_under_owned_org` asserts. Without it, any
 *      authenticated caller hands it any company id and becomes its admin.
 *   3. **It cannot be aimed at anybody else.** The user comes from the JWT
 *      subject. There is no argument that names one, which is stronger than
 *      refusing one -- it is a call that cannot be written.
 *
 * And the acceptance criterion the story was missing: a fresh signup now
 * produces an organization, a company **and** a membership, and the hook
 * called for that user returns a real `tenant_id` and `role: admin` where
 * before it returned `{}`. That transition is asserted here as a before and an
 * after, not as an end state -- an end state alone would pass against a hook
 * that had always worked and a signup that had always been complete.
 */
import type { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { PRINCIPAL_A, TENANT_A } from "./support/fixtures";
import {
  asRequest,
  updateOrDenied,
  withAdmin,
  type Principal,
} from "./support/substrate";

/** Users this suite owns outright, so nothing it commits disturbs another. */
const FOUNDER: Principal = {
  userId: "00000000-0000-4000-8000-0000000c0001",
  tenantId: null,
};
const OUTSIDER: Principal = {
  userId: "00000000-0000-4000-8000-0000000c0002",
  tenantId: null,
};
const REPAIRED: Principal = {
  userId: "00000000-0000-4000-8000-0000000c0003",
  tenantId: null,
};

const OWNED_BY_THIS_SUITE = [FOUNDER, OUTSIDER, REPAIRED].map((p) => p.userId);

const asOwner = <T>(principal: Principal, fn: Parameters<typeof asRequest<T>>[1]) =>
  asRequest<T>({ role: "authenticated", claims: { kind: "principal", principal } }, fn);

type Registration = { organization_id: string; company_id: string; created: boolean };

const register = (principal: Principal, legalName: string) =>
  asOwner<Registration>(principal, async (client) => {
    const { rows } = await client.query<{ result: Registration }>(
      `select public.register_company($1) as result`,
      [legalName],
    );
    return rows[0].result;
  });

const membershipsOf = (userId: string) =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{
      tenant_id: string;
      role: string;
      employee_id: string | null;
      is_active: boolean;
      last_active_at: string | null;
    }>(
      `select tenant_id, role, employee_id, is_active, last_active_at
         from public.memberships where user_id = $1`,
      [userId],
    );
    return rows;
  });

/** The hook, called the way GoTrue calls it: as the owner, with an event. */
const claimsFor = (userId: string) =>
  withAdmin(async (client: Client) => {
    const { rows } = await client.query<{
      result: { claims?: { app_metadata?: Record<string, unknown> } } | null;
    }>(`select public.custom_access_token_hook($1::jsonb) as result`, [
      JSON.stringify({
        user_id: userId,
        claims: { sub: userId, app_metadata: {} },
      }),
    ]);
    return rows[0].result?.claims?.app_metadata ?? {};
  });

afterEach(async () => {
  // Memberships, companies, organizations -- the foreign keys point that way.
  await withAdmin(async (client) => {
    await client.query(`delete from public.memberships where user_id = any($1::uuid[])`, [
      OWNED_BY_THIS_SUITE,
    ]);
    await client.query(
      `delete from public.companies c using public.organizations o
        where o.id = c.organization_id and o.owner_user_id = any($1::uuid[])`,
      [OWNED_BY_THIS_SUITE],
    );
    await client.query(
      `delete from public.organizations where owner_user_id = any($1::uuid[])`,
      [OWNED_BY_THIS_SUITE],
    );
  });
});

/* ── the criterion the story was missing ───────────────────────────────────── */

describe("a fresh signup produces a tenant a session can actually enter", () => {
  it("returns an empty app_metadata before registering, and a real one after", async () => {
    // The before half is what makes this a transition rather than an end
    // state. Without it the assertion would pass against a product where
    // signup had always created a membership -- which is precisely the bug
    // being fixed, only invisible.
    expect(
      await claimsFor(FOUNDER.userId),
      "a user with no registration already had a tenant claim",
    ).toEqual({});

    const registered = await register(FOUNDER, "PT Berdiri Sendiri");

    const after = await claimsFor(FOUNDER.userId);
    expect(after).toMatchObject({
      tenant_id: registered.company_id,
      role: "admin",
    });
    // Null, not absent: there are no employees until Story 1.8, and "this
    // membership has no employee record" is a different fact from "this token
    // predates employee ids".
    expect(after).toHaveProperty("employee_id", null);
  });

  it("creates all three rows, and the membership is admin with no employee", async () => {
    const registered = await register(FOUNDER, "PT Tiga Baris");
    const memberships = await membershipsOf(FOUNDER.userId);

    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      tenant_id: registered.company_id,
      role: "admin",
      employee_id: null,
      is_active: true,
    });
    // Set, because the hook orders by it and the founder is about to act here.
    expect(memberships[0].last_active_at).not.toBeNull();
  });

  it("lets the new tenant read its own company through the switcher", async () => {
    // End to end through the surface the shell actually uses, rather than
    // through the table. A membership that exists and is invisible to
    // `switch_company()` would leave the header saying "No company yet".
    const registered = await register(FOUNDER, "PT Lewat Peralihan");
    const listed = await asOwner<{ companies: Array<{ company_id: string; role: string }> }>(
      FOUNDER,
      async (client) => {
        const { rows } = await client.query<{
          result: { companies: Array<{ company_id: string; role: string }> };
        }>(`select public.switch_company() as result`);
        return rows[0].result;
      },
    );
    expect(listed.companies).toHaveLength(1);
    expect(listed.companies[0]).toMatchObject({
      company_id: registered.company_id,
      role: "admin",
    });
  });
});

/* ── idempotence, and the repair it buys ───────────────────────────────────── */

describe("registering twice creates one membership", () => {
  it("is a no-op on the second call, not a duplicate and not an error", async () => {
    const first = await register(FOUNDER, "PT Dua Kali");
    const second = await register(FOUNDER, "PT Dua Kali");

    expect(second.created).toBe(false);
    expect(second.company_id).toBe(first.company_id);
    expect(await membershipsOf(FOUNDER.userId)).toHaveLength(1);
  });

  it("returns the existing membership when the function is called directly again", async () => {
    const registered = await register(FOUNDER, "PT Panggil Lagi");
    const ids = await asOwner<string[]>(FOUNDER, async (client) => {
      const first = await client.query<{ id: string }>(
        `select public.create_founding_membership($1) as id`,
        [registered.company_id],
      );
      const second = await client.query<{ id: string }>(
        `select public.create_founding_membership($1) as id`,
        [registered.company_id],
      );
      return [first.rows[0].id, second.rows[0].id];
    });
    expect(ids[0]).toBe(ids[1]);
    expect(await membershipsOf(FOUNDER.userId)).toHaveLength(1);
  });

  it("completes a registration that predates memberships", async () => {
    // The state every account on the live project is in right now: an
    // organization and a company, and no membership. Reconstructed by deleting
    // the row, because that is exactly what those accounts look like. Calling
    // `register_company` again is the repair path, which is why the call site
    // is unconditional rather than inside the "company was just created"
    // branch.
    const registered = await register(REPAIRED, "PT Sudah Lama Ada");
    await withAdmin((client) =>
      client.query(`delete from public.memberships where user_id = $1`, [REPAIRED.userId]),
    );
    expect(await claimsFor(REPAIRED.userId)).toEqual({});

    const resumed = await register(REPAIRED, "PT Sudah Lama Ada");

    expect(resumed.created, "the repair created a second company").toBe(false);
    expect(resumed.company_id).toBe(registered.company_id);
    expect(await membershipsOf(REPAIRED.userId)).toHaveLength(1);
    expect(await claimsFor(REPAIRED.userId)).toMatchObject({ role: "admin" });
  });
});

/* ── the attacks ───────────────────────────────────────────────────────────── */

describe("the privilege cannot be aimed anywhere else", () => {
  it("refuses a founding membership in a company the caller does not own", async () => {
    // THE hazard of `security definer`: RLS does not run, so nothing would have
    // checked this if the body did not. `TENANT_A` belongs to another owner
    // entirely, and one successful call here makes the caller its admin.
    const attempt = asOwner(OUTSIDER, (client) =>
      client.query(`select public.create_founding_membership($1)`, [TENANT_A]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
    expect(await membershipsOf(OUTSIDER.userId)).toEqual([]);
  });

  it("refuses a company that exists under an organization owned by someone else", async () => {
    // The same refusal reached from the other direction: the outsider has a
    // registration of their own, so they are a legitimate tenant -- and still
    // may not reach into a company they do not own.
    await register(OUTSIDER, "PT Punya Sendiri");
    const attempt = asOwner(OUTSIDER, (client) =>
      client.query(`select public.create_founding_membership($1)`, [TENANT_A]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
    const memberships = await membershipsOf(OUTSIDER.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].tenant_id).not.toBe(TENANT_A);
  });

  it("refuses a company that does not exist", async () => {
    const attempt = asOwner(OUTSIDER, (client) =>
      client.query(`select public.create_founding_membership($1)`, [
        "00000000-0000-4000-8000-0000000c0bad",
      ]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("takes no argument that could name another user", async () => {
    // Structural, and stronger than a refusal: "create a membership for
    // somebody else" is not a call that can be written. Read from the catalog
    // rather than from the source, so a second overload added later -- which
    // is how this would actually regress -- fails here.
    const overloads = await withAdmin(async (client) => {
      const { rows } = await client.query<{ args: string }>(
        `select pg_get_function_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_founding_membership'`,
      );
      return rows.map((row) => row.args);
    });
    expect(overloads).toEqual(["p_company_id uuid"]);
  });

  it("creates the membership for the caller even when another user owns nothing", async () => {
    // The behavioural companion. Two principals, one company: only its owner
    // ends up with a row, and the row carries the OWNER's id -- not a value
    // either of them supplied.
    const registered = await register(FOUNDER, "PT Milik Pendiri");
    const attempt = asOwner(OUTSIDER, (client) =>
      client.query(`select public.create_founding_membership($1)`, [registered.company_id]),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
    expect(await membershipsOf(OUTSIDER.userId)).toEqual([]);
    expect(await membershipsOf(FOUNDER.userId)).toHaveLength(1);
  });

  it("fails closed for a caller carrying no claim, and for anon", async () => {
    const unauthenticated = asRequest(
      { role: "authenticated", claims: { kind: "unset" } },
      (client) => client.query(`select public.create_founding_membership($1)`, [TENANT_A]),
    );
    await expect(unauthenticated).rejects.toMatchObject({ code: "28000" });

    // Privilege, not the internal check. EXECUTE is granted to PUBLIC by
    // default, so the revoke in the migration is what makes this 42501.
    const anonymous = asRequest({ role: "anon", claims: { kind: "unset" } }, (client) =>
      client.query(`select public.create_founding_membership($1)`, [TENANT_A]),
    );
    await expect(anonymous).rejects.toMatchObject({ code: "42501" });
  });
});

/* ── and the table is still closed ─────────────────────────────────────────── */

describe("memberships still grants no write to any request role", () => {
  // The pin the owner asked for. The whole point of routing this through a
  // function is that the TABLE stays shut: if adding the founding membership
  // had been done with a grant plus a policy, every assertion in
  // `membership-switching.test.ts` would have quietly become weaker.

  it("still answers permission denied to an UPDATE, after the change", async () => {
    const registered = await register(FOUNDER, "PT Masih Terkunci");
    const outcome = await updateOrDenied(
      `update public.memberships set last_active_at = now() where user_id = $1`,
      [FOUNDER.userId],
      {
        role: "authenticated",
        claims: {
          kind: "principal",
          principal: { userId: FOUNDER.userId, tenantId: registered.company_id },
        },
      },
    );
    expect(
      outcome.denied,
      "memberships gained a write surface when the founding membership landed",
    ).toBe(true);
  });

  it("still refuses a direct INSERT, so the function is the only way in", async () => {
    const registered = await register(FOUNDER, "PT Satu Pintu");
    const attempt = asRequest(
      {
        role: "authenticated",
        claims: {
          kind: "principal",
          principal: { userId: FOUNDER.userId, tenantId: registered.company_id },
        },
      },
      (client) =>
        client.query(
          `insert into public.memberships (tenant_id, user_id, role)
           values ($1, $2, 'admin')`,
          [registered.company_id, FOUNDER.userId],
        ),
    );
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });

  it("holds no INSERT, UPDATE or DELETE privilege at all, by the catalog", async () => {
    // Read from `has_table_privilege` as well as attempted, because a grant
    // could be added for a column the behavioural tests do not happen to name.
    const privileges = await withAdmin(async (client) => {
      const { rows } = await client.query<{
        ins: boolean;
        upd: boolean;
        del: boolean;
      }>(
        `select has_table_privilege('authenticated', 'public.memberships', 'INSERT') as ins,
                has_table_privilege('authenticated', 'public.memberships', 'UPDATE') as upd,
                has_table_privilege('authenticated', 'public.memberships', 'DELETE') as del`,
      );
      return rows[0];
    });
    expect(privileges).toEqual({ ins: false, upd: false, del: false });
  });
});

/* ── register_company is still not privileged ──────────────────────────────── */

describe("register_company stays security invoker", () => {
  it("is still adjudicated by RLS for the organization and the company", async () => {
    // The owner's condition, pinned. Only the membership insert is privileged;
    // the two rows above it are written under the caller's own policies
    // exactly as they were before this change.
    const row = await withAdmin(async (client) => {
      const { rows } = await client.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'register_company'`,
      );
      return rows[0];
    });
    expect(row.prosecdef, "register_company became security definer").toBe(false);
    expect(row.proconfig).toContain('search_path=""');
  });

  it("still cannot create a company under an organization the caller does not own", async () => {
    // The fixture's own owner, reached from an outsider's session. Unchanged
    // by this story, asserted because the new call sits inside that function.
    const mine = await register(FOUNDER, "PT Milik Saya");
    const theirs = await register(OUTSIDER, "PT Milik Mereka");
    expect(theirs.organization_id).not.toBe(mine.organization_id);
    expect(theirs.company_id).not.toBe(mine.company_id);
  });

  it("leaves the fixture's own admin membership alone when called by its owner", async () => {
    // `PRINCIPAL_A` already holds a seeded admin membership in `TENANT_A`.
    // Calling the founding function for that company must return the existing
    // row rather than raising -- the idempotence that makes the repair path
    // safe to run against accounts that are already fine.
    const id = await asOwner<string | null>(PRINCIPAL_A, async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        `select public.create_founding_membership($1) as id`,
        [TENANT_A],
      );
      return rows[0].id;
    });
    expect(id).toBeTruthy();
    const memberships = await membershipsOf(PRINCIPAL_A.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("admin");
  });
});

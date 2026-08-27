/**
 * Signup's only write, asserted as behaviour.
 *
 * Two properties, and the suite is worthless if either can stop holding
 * without turning red:
 *
 *   1. **The registration is atomic.** When the company insert fails, no
 *      organization is left behind.
 *   2. **A retry resumes.** A caller who already owns an organization does not
 *      acquire a second one, and `organizations.owner_user_id` carries no
 *      unique constraint to enforce that for us.
 *
 * Neither is read off the source. Property 1 is proved by *forcing* the second
 * insert to fail -- with a time zone the check constraint refuses -- and then
 * counting rows through a connection that cannot see past RLS. Property 2 is
 * proved by calling the function twice and counting.
 *
 * The negative control matters as much as the assertions: the same story told
 * as two sequential PostgREST inserts leaves an orphan organization behind,
 * which is what the RPC exists to prevent. Without it, "no orphan" could just
 * mean the failure never happened.
 *
 * Everything here runs over TCP as `authenticator`, switched into
 * `authenticated` for one transaction -- the shape a PostgREST request has.
 * Counting is done as admin because the point is what *exists*, not what is
 * visible; RLS would happily report zero rows for a row that is really there.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asRequest, withAdmin, type Principal } from "./support/substrate";

/**
 * Users this suite owns outright. Distinct from the fixture principals so the
 * rows it commits, and the rows it deletes afterwards, cannot disturb a suite
 * running beside it in another worker.
 */
const OWNER_ATOMIC: Principal = {
  userId: "00000000-0000-4000-8000-00000000d001",
  tenantId: null,
};
const OWNER_RETRY: Principal = {
  userId: "00000000-0000-4000-8000-00000000d002",
  tenantId: null,
};
const OWNER_RESUME: Principal = {
  userId: "00000000-0000-4000-8000-00000000d003",
  tenantId: null,
};
const OWNER_CONTROL: Principal = {
  userId: "00000000-0000-4000-8000-00000000d004",
  tenantId: null,
};
const OWNER_FIELDS: Principal = {
  userId: "00000000-0000-4000-8000-00000000d005",
  tenantId: null,
};

const OWNED_BY_THIS_SUITE = [
  OWNER_ATOMIC,
  OWNER_RETRY,
  OWNER_RESUME,
  OWNER_CONTROL,
  OWNER_FIELDS,
].map((principal) => principal.userId);

/** A time zone that is real, is not Indonesian, and the constraint refuses. */
const REJECTED_TIME_ZONE = "Asia/Bangkok";

type Registration = {
  organization_id: string;
  company_id: string;
  legal_name: string;
  created: boolean;
};

/**
 * One committed request. `rollback` is deliberately absent: a test that rolls
 * its own write back cannot then claim anything about what survived.
 */
const asOwner = <T>(principal: Principal, fn: Parameters<typeof asRequest<T>>[1]) =>
  asRequest<T>({ role: "authenticated", claims: { kind: "principal", principal } }, fn);

const register = (
  principal: Principal,
  args: {
    legalName: string;
    npwp?: string | null;
    nppBpjsTk?: string | null;
    bpjsKesCode?: string | null;
    timeZone?: string;
  },
) =>
  asOwner<Registration>(principal, async (client) => {
    const { rows } = await client.query<{ result: Registration }>(
      `select public.register_company($1, $2, $3, $4, $5) as result`,
      [
        args.legalName,
        args.npwp ?? null,
        args.nppBpjsTk ?? null,
        args.bpjsKesCode ?? null,
        args.timeZone ?? "Asia/Jakarta",
      ],
    );
    return rows[0].result;
  });

/** What actually exists, counted past RLS. */
const countOrganizations = (ownerUserId: string) =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `select count(*)::text as count from public.organizations where owner_user_id = $1`,
      [ownerUserId],
    );
    return Number(rows[0].count);
  });

const countCompanies = (ownerUserId: string) =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `select count(*)::text as count
         from public.companies c
         join public.organizations o on o.id = c.organization_id
        where o.owner_user_id = $1`,
      [ownerUserId],
    );
    return Number(rows[0].count);
  });

afterEach(async () => {
  // Committed rows, so they have to be removed explicitly. Companies first:
  // the foreign key points that way.
  await withAdmin(async (client) => {
    await client.query(
      `delete from public.companies c
        using public.organizations o
        where o.id = c.organization_id and o.owner_user_id = any($1::uuid[])`,
      [OWNED_BY_THIS_SUITE],
    );
    await client.query(
      `delete from public.organizations where owner_user_id = any($1::uuid[])`,
      [OWNED_BY_THIS_SUITE],
    );
  });
});

describe("the registration is atomic", () => {
  it("leaves no organization behind when the company insert fails", async () => {
    // Forced, not simulated: the time zone check constraint refuses this row,
    // and it refuses it *after* the organization has already been inserted --
    // which is precisely the half-made state the RPC exists to make
    // unreachable.
    const attempt = register(OWNER_ATOMIC, {
      legalName: "PT Gagal Separuh",
      timeZone: REJECTED_TIME_ZONE,
    });

    await expect(attempt).rejects.toMatchObject({ code: "23514" });

    expect(
      await countOrganizations(OWNER_ATOMIC.userId),
      "the company insert failed and an organization survived it -- the registration is not atomic",
    ).toBe(0);
    expect(await countCompanies(OWNER_ATOMIC.userId)).toBe(0);
  });

  it("leaves an orphan when the same story is told as two separate requests", async () => {
    // The negative control, and the reason the assertion above is not
    // vacuous. Two sequential PostgREST inserts are two transactions: the
    // first commits, the second fails, and the billing account is stranded --
    // measured at `orphan orgs visible | 1` before this function existed.
    const organizationId = await asOwner<string>(OWNER_CONTROL, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.organizations (name, owner_user_id)
         values ('Grup Yatim', $1) returning id`,
        [OWNER_CONTROL.userId],
      );
      return rows[0].id;
    });

    const secondInsert = asOwner(OWNER_CONTROL, (client) =>
      client.query(
        `insert into public.companies (organization_id, legal_name, timezone)
         values ($1, 'PT Tak Jadi', $2)`,
        [organizationId, REJECTED_TIME_ZONE],
      ),
    );
    await expect(secondInsert).rejects.toMatchObject({ code: "23514" });

    expect(
      await countOrganizations(OWNER_CONTROL.userId),
      "two separate requests did NOT strand an organization, so the atomicity test above proves nothing",
    ).toBe(1);
    expect(await countCompanies(OWNER_CONTROL.userId)).toBe(0);
  });
});

describe("a retry resumes rather than duplicating", () => {
  it("returns the same company on a second successful call", async () => {
    const first = await register(OWNER_RETRY, { legalName: "PT Coba Lagi" });
    const second = await register(OWNER_RETRY, { legalName: "PT Coba Lagi" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.organization_id).toBe(first.organization_id);
    expect(second.company_id).toBe(first.company_id);

    expect(
      await countOrganizations(OWNER_RETRY.userId),
      "a retry created a second organization; owner_user_id carries no unique constraint to stop it",
    ).toBe(1);
    expect(await countCompanies(OWNER_RETRY.userId)).toBe(1);
  });

  it("tells the loser which name is actually stored, not the one it sent", async () => {
    // Measured with six concurrent sessions: the advisory lock serialises them
    // correctly and one organization is created -- but the five losers each
    // got `created:false` and their own `p_legal_name` silently vanished. The
    // caller has to be able to say "a company is already registered as X"
    // rather than implying the name just typed is the one that exists.
    const winner = await register(OWNER_RETRY, { legalName: "PT Yang Menang" });
    const loser = await register(OWNER_RETRY, { legalName: "PT Yang Kalah" });

    expect(loser.created).toBe(false);
    expect(loser.company_id).toBe(winner.company_id);
    expect(
      loser.legal_name,
      "the resumed call reported the submitted name rather than the stored one",
    ).toBe("PT Yang Menang");
  });

  it("reports the stored name on a fresh registration too", async () => {
    // Trimmed, as stored. A caller that renders this back gets the row, not
    // its own input echoed.
    const created = await register(OWNER_RESUME, { legalName: "  PT Baru Sekali  " });
    expect(created.created).toBe(true);
    expect(created.legal_name).toBe("PT Baru Sekali");
  });

  it("completes a half-made registration instead of starting a new one", async () => {
    // The state a user is actually in after the failure above, reconstructed:
    // an organization with no company. The retry must finish it.
    await asOwner(OWNER_RESUME, (client) =>
      client.query(
        `insert into public.organizations (name, owner_user_id)
         values ('Grup Setengah Jadi', $1)`,
        [OWNER_RESUME.userId],
      ),
    );

    const resumed = await register(OWNER_RESUME, { legalName: "PT Akhirnya Jadi" });

    expect(resumed.created).toBe(true);
    expect(await countOrganizations(OWNER_RESUME.userId)).toBe(1);
    expect(await countCompanies(OWNER_RESUME.userId)).toBe(1);
  });
});

describe("what the function accepts", () => {
  it("stores blank optional identifiers as null, not as empty strings", async () => {
    const created = await register(OWNER_FIELDS, {
      legalName: "  PT Rapi Sekali  ",
      npwp: "   ",
      nppBpjsTk: "",
      bpjsKesCode: null,
      timeZone: "Asia/Jayapura",
    });

    const row = await withAdmin(async (client) => {
      const { rows } = await client.query<{
        legal_name: string;
        npwp: string | null;
        npp_bpjs_tk: string | null;
        bpjs_kes_code: string | null;
        timezone: string;
      }>(`select legal_name, npwp, npp_bpjs_tk, bpjs_kes_code, timezone
            from public.companies where id = $1`, [created.company_id]);
      return rows[0];
    });

    expect(row.legal_name).toBe("PT Rapi Sekali");
    expect(row.npwp).toBeNull();
    expect(row.npp_bpjs_tk).toBeNull();
    expect(row.bpjs_kes_code).toBeNull();
    expect(row.timezone).toBe("Asia/Jayapura");
  });

  it.each([
    "Asia/Jakarta",
    // West Kalimantan, and WIB. Indonesia has three legal zones spread over
    // four IANA identifiers, and this is the fourth -- the one that gets
    // forgotten. A Pontianak company that cannot register is a company that
    // cannot use the product.
    "Asia/Pontianak",
    "Asia/Makassar",
    "Asia/Jayapura",
  ])(
    "accepts %s",
    async (timeZone) => {
      const created = await register(OWNER_FIELDS, {
        legalName: "PT Zona Waktu",
        timeZone,
      });
      expect(created.created).toBe(true);
    },
  );

  it.each(["Asia/Bangkok", "UTC", "Europe/London", "Asia/Singapore", "not-a-zone"])(
    "refuses %s at the database, not only at the boundary",
    async (timeZone) => {
      // The Zod schema refuses these too. This is the second wall: the table
      // is also written by the RPC, and will be written by later stories, so
      // the invariant lives where every path meets it.
      const attempt = register(OWNER_FIELDS, {
        legalName: "PT Zona Salah",
        timeZone,
      });
      await expect(attempt).rejects.toMatchObject({ code: "23514" });
    },
  );

  it("refuses a blank legal name", async () => {
    const attempt = register(OWNER_FIELDS, { legalName: "   " });
    await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });
});

describe("who may call it", () => {
  it("fails closed for a caller carrying no claim at all", async () => {
    const attempt = asRequest(
      { role: "authenticated", claims: { kind: "unset" } },
      (client) =>
        client.query(`select public.register_company('PT Tanpa Identitas')`),
    );
    await expect(attempt).rejects.toMatchObject({ code: "28000" });
  });

  it.each([
    ["a GUC cleared to ''", ""],
    ["a non-JSON claim", "not json at all"],
    ["a claim whose sub is not a UUID", '{"sub":"drop-table"}'],
  ])("fails closed on %s", async (_label, value) => {
    const attempt = asRequest(
      { role: "authenticated", claims: { kind: "raw", value } },
      (client) => client.query(`select public.register_company('PT Klaim Rusak')`),
    );
    await expect(attempt).rejects.toMatchObject({ code: "28000" });
  });

  it("cannot be executed by anon at all", async () => {
    const attempt = asRequest(
      { role: "anon", claims: { kind: "unset" } },
      (client) => client.query(`select public.register_company('PT Anonim')`),
    );
    // Privilege, not an internal check. EXECUTE is granted to PUBLIC by
    // default, so the revoke in the migration is what makes this 42501.
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});

describe("the function is not privileged", () => {
  it("is security invoker, so RLS still adjudicates every row it writes", async () => {
    const row = await withAdmin(async (client) => {
      const { rows } = await client.query<{
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `select p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'register_company'`,
      );
      return rows[0];
    });
    expect(row, "public.register_company() does not exist").toBeDefined();
    expect(
      row.prosecdef,
      "register_company is security definer, which bypasses the caller's policies by construction",
    ).toBe(false);
    // Pinned empty, so an unqualified name inside the body cannot resolve
    // through whatever search_path the caller happens to carry.
    expect(row.proconfig).toContain('search_path=""');
  });

  it("cannot create a company under an organization the caller does not own", async () => {
    // The RPC is not a way around `companies_create_under_owned_org`. It never
    // takes an organization id, and the one it finds is found under the
    // caller's own read policy -- so the only reachable organization is one
    // the caller owns. Asserted as behaviour: register as one owner, then
    // register as another, and the two must not share an organization.
    const mine = await register(OWNER_RETRY, { legalName: "PT Milik Saya" });
    const theirs = await register(OWNER_RESUME, { legalName: "PT Milik Mereka" });
    expect(theirs.organization_id).not.toBe(mine.organization_id);
    expect(theirs.company_id).not.toBe(mine.company_id);
  });
});

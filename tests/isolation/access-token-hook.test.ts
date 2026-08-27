/**
 * The Custom Access Token Hook, called the way GoTrue calls it.
 *
 * This is the single point of failure for the whole product, and the reasons
 * are structural rather than dramatic. Confirmed in GoTrue's source: the hook
 * runs on every sign-in AND on every `token_refresh`; every hook failure
 * returns before `SignJWT` with no fallback to default claims; the timeout is
 * a hard 2 seconds; there are no retries. So a function that raises does not
 * produce a bad row -- it produces a failed login and a failed refresh, which
 * evicts every signed-in user within the 15-minute token TTL (AD-9).
 *
 * The properties this file exists to break, stated as the spec states them.
 * The suite must fail if the hook:
 *
 *   - stops being TOTAL -- any input that raises is an outage;
 *   - stops RE-VALIDATING `is_active` at issuance;
 *   - stops STRIPPING an inbound `tenant_id` -- the half that matters, because
 *     a hook that only ever adds passes a deactivated user's old claim through;
 *   - resolves the active membership by anything other than greatest
 *     `last_active_at`, tie-broken by `created_at`;
 *   - lets any caller other than `supabase_auth_admin` execute it.
 *
 * Everything below builds its rows inside a transaction and rolls it back, so
 * the shared fixture the rest of the isolation project asserts against is
 * never perturbed -- and so an ordering case can set `created_at` to whatever
 * it needs to without racing another test.
 *
 * The connection is the ADMIN one, and that is correct here rather than a
 * shortcut: this function is invoked by GoTrue as `supabase_auth_admin`, never
 * by a request role, so there is no request shape to imitate. What a request
 * role may do with it is asserted as a privilege fact at the bottom of the
 * file.
 */
import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { TENANT_A, TENANT_B } from "./support/fixtures";
import { withAdmin } from "./support/substrate";

/** Users invented for this file. Nothing else in the project knows them. */
const USER = {
  single: "00000000-0000-4000-8000-0000000f0001",
  deactivated: "00000000-0000-4000-8000-0000000f0002",
  mixed: "00000000-0000-4000-8000-0000000f0003",
  ordered: "00000000-0000-4000-8000-0000000f0004",
  unknown: "00000000-0000-4000-8000-0000000f00ff",
} as const;

/**
 * The claim set GoTrue actually hands the hook.
 *
 * All ten keys the output schema requires are present, because "merge into the
 * event's claims, never construct a fresh object" is only testable against an
 * event that has something worth losing. A hook that rebuilds the object
 * passes every assertion about `app_metadata` and fails
 * `keeps every claim GoTrue's output schema requires`.
 */
const REQUIRED_CLAIMS = [
  "aud",
  "exp",
  "iat",
  "sub",
  "email",
  "phone",
  "role",
  "aal",
  "session_id",
  "is_anonymous",
] as const;

type Claims = Record<string, unknown>;

const eventFor = (userId: string, appMetadata: Claims = {}): Claims => ({
  user_id: userId,
  authentication_method: "password",
  claims: {
    aud: "authenticated",
    exp: 1_800_000_900,
    iat: 1_800_000_000,
    sub: userId,
    email: "hr@nusantara.co.id",
    phone: "",
    role: "authenticated",
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-00000000f001",
    is_anonymous: false,
    app_metadata: appMetadata,
    user_metadata: { anything: "the user wrote this" },
  },
});

type HookResult = {
  claims?: { app_metadata?: Claims } & Claims;
} & Claims;

const callHook = async (client: Client, event: unknown): Promise<HookResult | null> => {
  const { rows } = await client.query<{ result: HookResult | null }>(
    `select public.custom_access_token_hook($1::jsonb) as result`,
    [event === null ? null : JSON.stringify(event)],
  );
  return rows[0].result;
};

const appMetadataOf = (result: HookResult | null) =>
  (result?.claims?.app_metadata ?? {}) as Claims;

/**
 * Runs `fn` against rows that never outlive it.
 *
 * Rolled back rather than deleted afterwards: a `delete` in an `afterEach`
 * runs only when the test got that far, and a failing ordering case would
 * otherwise leave rows that change what the NEXT case resolves to.
 */
async function withRows<T>(
  seed: string,
  params: unknown[],
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return withAdmin(async (client) => {
    await client.query("begin");
    try {
      await client.query(seed, params);
      return await fn(client);
    } finally {
      await client.query("rollback");
    }
  });
}

const INSERT_MEMBERSHIP = `
  insert into public.memberships
    (tenant_id, user_id, role, employee_id, is_active, last_active_at, created_at)
  values ($1, $2, $3, $4, $5, $6, $7)`;

/* ── totality ──────────────────────────────────────────────────────────────── */

describe("the hook is total", () => {
  // Not "handles bad input gracefully". Every one of these is a shape that
  // reaches a real deployment, and a raise on any of them is a 500 from
  // GoTrue -- which is a failed login and a failed refresh, not a bad row.
  const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
    ["a user_id that is not a uuid", { user_id: "not-a-uuid", claims: { sub: "x" } }],
    ["a user_id that is empty", { user_id: "", claims: { sub: "x" } }],
    ["no user_id at all", { claims: { sub: "x" } }],
    ["a user_id that is a number", { user_id: 42, claims: { sub: "x" } }],
    ["a uuid with the right shape and no such user", { user_id: USER.unknown, claims: { sub: "x" } }],
    ["no claims key", { user_id: USER.single }],
    ["claims that are not an object", { user_id: USER.single, claims: "nope" }],
    ["claims that are an array", { user_id: USER.single, claims: [1, 2, 3] }],
    ["an event that is an array", [1, 2, 3]],
    ["an event that is a string", "not an object"],
    ["an event that is a number", 7],
    ["an event that is JSON null", null],
    ["an empty object", {}],
  ];

  it.each(MALFORMED)("does not raise on %s", async (_label, event) => {
    // `select custom_access_token_hook('{"user_id":"not-a-uuid"}')` raised
    // 22P02 before the regex guard existed. The assertion is that the call
    // RESOLVES -- `.resolves` is what fails the test on a raise, and the
    // matcher after it only has to be trivially true.
    await expect(withAdmin((client) => callHook(client, event))).resolves.not.toBeUndefined();
  });

  it("returns a malformed event unchanged rather than repairing it", async () => {
    // "Total" has to mean more than "does not throw". A hook that swallowed a
    // malformed event and returned `{}` would satisfy every case above and
    // then fail GoTrue's output schema, which is the same outage one step
    // later.
    const event = { user_id: "not-a-uuid", claims: { sub: "x", app_metadata: {} } };
    const result = await withAdmin((client) => callHook(client, event));
    expect(result).toEqual(event);
  });

  it("keeps every claim GoTrue's output schema requires", async () => {
    // The reason the hook merges into `event -> 'claims'` instead of building
    // a fresh object. GoTrue validates the returned claims against a schema
    // requiring all ten of these; a constructed object drops them and the
    // login fails validation rather than the function failing.
    const result = await withRows(
      INSERT_MEMBERSHIP,
      [TENANT_A, USER.single, "hr_manager", null, true, new Date().toISOString(), new Date().toISOString()],
      (client) => callHook(client, eventFor(USER.single)),
    );
    for (const claim of REQUIRED_CLAIMS) {
      expect(result?.claims, `the hook dropped the ${claim} claim`).toHaveProperty(claim);
    }
  });
});

/* ── what it injects ───────────────────────────────────────────────────────── */

describe("a user with one active membership", () => {
  it("gets tenant_id, role and employee_id in app_metadata", async () => {
    const result = await withRows(
      INSERT_MEMBERSHIP,
      [TENANT_A, USER.single, "hr_manager", null, true, new Date().toISOString(), new Date().toISOString()],
      (client) => callHook(client, eventFor(USER.single)),
    );
    expect(appMetadataOf(result)).toMatchObject({
      tenant_id: TENANT_A,
      role: "hr_manager",
    });
    // A JSON null, not an absent key. "This membership has no employee record"
    // and "this token predates employee ids" are different facts.
    expect(appMetadataOf(result)).toHaveProperty("employee_id", null);
  });

  it("reads past FORCE ROW LEVEL SECURITY, which is the whole reason it is definer", async () => {
    // The measurement that put `custom_access_token_hook` in
    // SECURITY_DEFINER_EXEMPTIONS. Supabase's documented form -- security
    // invoker plus grants to supabase_auth_admin -- returns `{"n":0}` against
    // a table with FORCE RLS, because supabase_auth_admin is
    // rolbypassrls = false. Asserted as the owner's privilege rather than
    // re-derived, so a future `alter function ... owner to` that quietly
    // rehomes it fails here instead of silently emptying every token.
    const owner = await withAdmin(async (client) => {
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
        `select r.rolname, r.rolsuper, r.rolbypassrls
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           join pg_roles r on r.oid = p.proowner
          where n.nspname = 'public' and p.proname = 'custom_access_token_hook'`,
      );
      return rows[0];
    });
    expect(owner, "public.custom_access_token_hook() is not in the catalog").toBeDefined();
    expect(
      owner.rolsuper || owner.rolbypassrls,
      `the hook is owned by ${owner.rolname}, which cannot read past FORCE ROW LEVEL SECURITY; ` +
        `it will return an empty app_metadata for every user`,
    ).toBe(true);
  });

  it("leaves user_metadata alone", async () => {
    // CLAUDE.md rule 4. `user_metadata` is user-writable, so nothing
    // authorization depends on may be read from it or written to it.
    const result = await withRows(
      INSERT_MEMBERSHIP,
      [TENANT_A, USER.single, "admin", null, true, new Date().toISOString(), new Date().toISOString()],
      (client) => callHook(client, eventFor(USER.single)),
    );
    expect(result?.claims?.user_metadata).toEqual({ anything: "the user wrote this" });
  });
});

describe("a user with no membership at all", () => {
  it("gets no tenant_id, no role and no employee_id", async () => {
    const result = await withAdmin((client) => callHook(client, eventFor(USER.unknown)));
    const metadata = appMetadataOf(result);
    expect(metadata).not.toHaveProperty("tenant_id");
    expect(metadata).not.toHaveProperty("role");
    expect(metadata).not.toHaveProperty("employee_id");
  });
});

/* ── fails closed ──────────────────────────────────────────────────────────── */

describe("a user whose memberships are all deactivated", () => {
  it("gets no tenant_id", async () => {
    const result = await withRows(
      INSERT_MEMBERSHIP,
      [TENANT_A, USER.deactivated, "admin", null, false, new Date().toISOString(), new Date().toISOString()],
      (client) => callHook(client, eventFor(USER.deactivated)),
    );
    expect(appMetadataOf(result)).not.toHaveProperty("tenant_id");
  });

  it("has an inbound tenant_id STRIPPED, not passed through", async () => {
    // The half that matters, and the one a hook written as "look up and add"
    // gets wrong. On a refresh the event carries the previous token's
    // app_metadata; if the hook only ever adds, a user deactivated five
    // minutes ago keeps their tenant claim for as long as they keep
    // refreshing, which is forever.
    const result = await withRows(
      INSERT_MEMBERSHIP,
      [TENANT_A, USER.deactivated, "admin", null, false, new Date().toISOString(), new Date().toISOString()],
      (client) =>
        callHook(
          client,
          eventFor(USER.deactivated, {
            tenant_id: TENANT_A,
            role: "admin",
            employee_id: "00000000-0000-4000-8000-00000000e0e0",
            provider: "email",
          }),
        ),
    );
    const metadata = appMetadataOf(result);
    expect(metadata).not.toHaveProperty("tenant_id");
    expect(metadata).not.toHaveProperty("role");
    expect(metadata).not.toHaveProperty("employee_id");
    // And it strips those three only. `provider` and `providers` are GoTrue's
    // own app_metadata and removing them would be a different outage.
    expect(metadata).toHaveProperty("provider", "email");
  });

  it("strips an inbound tenant_id for a user with no membership row either", async () => {
    // The same property one step further out: a token issued before a
    // membership was deleted must not survive the deletion.
    const result = await withAdmin((client) =>
      callHook(client, eventFor(USER.unknown, { tenant_id: TENANT_B, role: "admin" })),
    );
    expect(appMetadataOf(result)).not.toHaveProperty("tenant_id");
    expect(appMetadataOf(result)).not.toHaveProperty("role");
  });

  it("falls back to an older active membership when the newest is deactivated", async () => {
    // `is_active` is a filter, not a tie-break. A hook that ordered first and
    // filtered afterwards would return nothing here, which reads as "no
    // membership" and locks out a user who has one.
    const result = await withRows(
      `${INSERT_MEMBERSHIP}, ($8, $9, $10, $11, $12, $13, $14)`,
      [
        // Newest by last_active_at, and deactivated.
        TENANT_B, USER.mixed, "accountant", null, false, "2026-08-27T10:00:00Z", "2026-08-01T00:00:00Z",
        // Older, and active. This is the answer.
        TENANT_A, USER.mixed, "hr_staff", null, true, "2026-08-20T10:00:00Z", "2026-07-01T00:00:00Z",
      ],
      (client) => callHook(client, eventFor(USER.mixed)),
    );
    expect(appMetadataOf(result)).toMatchObject({ tenant_id: TENANT_A, role: "hr_staff" });
  });
});

/* ── which membership is the active one ────────────────────────────────────── */

describe("the active membership is resolved deterministically", () => {
  const twoMemberships = (
    a: { tenant: string; lastActive: string | null; created: string },
    b: { tenant: string; lastActive: string | null; created: string },
  ) =>
    withRows(
      `${INSERT_MEMBERSHIP}, ($8, $9, $10, $11, $12, $13, $14)`,
      [
        a.tenant, USER.ordered, "admin", null, true, a.lastActive, a.created,
        b.tenant, USER.ordered, "hr_staff", null, true, b.lastActive, b.created,
      ],
      (client) => callHook(client, eventFor(USER.ordered)),
    );

  it("picks the greatest last_active_at", async () => {
    const result = await twoMemberships(
      { tenant: TENANT_A, lastActive: "2026-08-01T00:00:00Z", created: "2026-01-01T00:00:00Z" },
      { tenant: TENANT_B, lastActive: "2026-08-27T00:00:00Z", created: "2026-06-01T00:00:00Z" },
    );
    expect(appMetadataOf(result)).toMatchObject({ tenant_id: TENANT_B });
  });

  it("treats a membership never acted in as losing to one that was", async () => {
    // `nulls last`. Without it Postgres sorts nulls FIRST under `desc`, and a
    // company the user has never once opened wins over the one they live in.
    const result = await twoMemberships(
      { tenant: TENANT_A, lastActive: "2026-08-01T00:00:00Z", created: "2026-01-01T00:00:00Z" },
      { tenant: TENANT_B, lastActive: null, created: "2026-06-01T00:00:00Z" },
    );
    expect(appMetadataOf(result)).toMatchObject({ tenant_id: TENANT_A });
  });

  it("breaks a last_active_at tie on created_at, and the tie-break is what decides", async () => {
    // Proved by flipping created_at with last_active_at held equal. Both
    // directions, because an assertion in one direction alone is satisfied by
    // a hook that ignores created_at and happens to return rows in insertion
    // order.
    const tie = "2026-08-27T09:00:00Z";

    const older = await twoMemberships(
      { tenant: TENANT_A, lastActive: tie, created: "2026-01-01T00:00:00Z" },
      { tenant: TENANT_B, lastActive: tie, created: "2026-06-01T00:00:00Z" },
    );
    expect(appMetadataOf(older)).toMatchObject({ tenant_id: TENANT_A });

    const flipped = await twoMemberships(
      { tenant: TENANT_A, lastActive: tie, created: "2026-06-01T00:00:00Z" },
      { tenant: TENANT_B, lastActive: tie, created: "2026-01-01T00:00:00Z" },
    );
    expect(appMetadataOf(flipped)).toMatchObject({ tenant_id: TENANT_B });
  });

  it("gives the same answer every time when last_active_at and created_at both tie", async () => {
    // "Deterministic, never arbitrary" has to be total: two rows written in
    // the same transaction share `now()` to the microsecond, so `created_at`
    // ties are reachable rather than theoretical. `id` is the final ordering
    // key, which makes the answer stable without making it meaningful.
    const tie = "2026-08-27T09:00:00Z";
    // The same INPUT, which means the same rows -- so the repeats happen
    // inside one transaction rather than by re-seeding. Re-seeding would give
    // each round fresh `gen_random_uuid()` ids, and since `id` is the final
    // ordering key that would be a different question with a legitimately
    // different answer, measured as flake.
    const answers = await withRows(
      `${INSERT_MEMBERSHIP}, ($8, $9, $10, $11, $12, $13, $14)`,
      [
        TENANT_A, USER.ordered, "admin", null, true, tie, tie,
        TENANT_B, USER.ordered, "hr_staff", null, true, tie, tie,
      ],
      async (client) => {
        const seen: unknown[] = [];
        for (let round = 0; round < 3; round += 1) {
          const result = await callHook(client, eventFor(USER.ordered));
          seen.push(appMetadataOf(result).tenant_id);
        }
        return seen;
      },
    );
    expect(answers[0], "a full tie resolved to nothing at all").toBeDefined();
    expect(new Set(answers).size, `the hook returned ${answers.join(", ")}`).toBe(1);
  });
});

/* ── who may call it ───────────────────────────────────────────────────────── */

describe("only GoTrue may execute the hook", () => {
  const privilegeFor = (role: string) =>
    withAdmin(async (client) => {
      const { rows } = await client.query<{ allowed: boolean }>(
        `select coalesce(has_function_privilege($1, p.oid, 'EXECUTE'), false) as allowed
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'custom_access_token_hook'`,
        [role],
      );
      return rows[0]?.allowed ?? false;
    });

  it.each(["authenticated", "anon", "public"])(
    "refuses EXECUTE to %s",
    async (role) => {
      // EXECUTE is granted to PUBLIC by default, so all three of these are on
      // by omission rather than by decision. The function takes a `user_id`
      // argument and reads that user's membership, so a callable-by-anyone
      // version is a privileged read of somebody else's role and tenant.
      expect(await privilegeFor(role)).toBe(false);
    },
  );

  it("grants EXECUTE to supabase_auth_admin", async () => {
    // The positive control. A revoke that also removes GoTrue's grant is not a
    // tighter rule, it is every login in the product failing.
    expect(await privilegeFor("supabase_auth_admin")).toBe(true);
  });

  it("lets supabase_auth_admin reach the schema the function lives in", async () => {
    // EXECUTE on the function is not enough on its own: without USAGE on
    // `public` the call does not resolve, and the error is a name-resolution
    // failure that looks nothing like a missing grant.
    const allowed = await withAdmin(async (client) => {
      const { rows } = await client.query<{ allowed: boolean }>(
        `select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') as allowed`,
      );
      return rows[0].allowed;
    });
    expect(allowed).toBe(true);
  });
});

/* ── the hook and the switcher agree ───────────────────────────────────────── */

describe("the hook and switch_company resolve the same active company", () => {
  it("leads the switcher's list with the company the next token will carry", async () => {
    // The ordering is written twice -- once in the hook, once in the RPC -- so
    // that the switcher can mark the current company without a second source
    // of truth. Two copies of a rule is a divergence waiting to happen, which
    // is what this asserts against: the list's first entry IS the hook's
    // answer, whatever the rule is.
    const tie = "2026-08-27T09:00:00Z";
    const { hookTenant, listed } = await withRows(
      `${INSERT_MEMBERSHIP}, ($8, $9, $10, $11, $12, $13, $14)`,
      [
        TENANT_A, USER.ordered, "admin", null, true, tie, "2026-01-01T00:00:00Z",
        TENANT_B, USER.ordered, "hr_staff", null, true, tie, "2026-06-01T00:00:00Z",
      ],
      async (client) => {
        const result = await callHook(client, eventFor(USER.ordered));
        // The RPC reads its subject from the request claim, so the claim is
        // what has to be set here -- there is no argument that names a user.
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: USER.ordered }),
        ]);
        const { rows } = await client.query<{
          result: { companies: Array<{ company_id: string }> };
        }>(`select public.switch_company() as result`);
        return {
          hookTenant: appMetadataOf(result).tenant_id,
          listed: rows[0].result.companies,
        };
      },
    );

    expect(listed).toHaveLength(2);
    expect(listed[0]?.company_id).toBe(hookTenant);
  });
});

/**
 * The company-switch boundary, in `unit` because it needs no database.
 *
 * Switching company is the only request in the product that changes **which
 * tenant a session is acting in**, which makes this route handler a different
 * kind of thing from every other one: its output is not a row, it is a new
 * access token. Three properties follow from that and none of them is visible
 * to the isolation suite, which talks to Postgres and never to a handler:
 *
 *   1. **The reissue is part of the switch.** `switch_company()` moves
 *      `last_active_at` and nothing else; until a new token is minted the
 *      session is still in the old company. A handler that answered 200 after
 *      the write and before the refresh would report a switch that had not
 *      happened, and the screen would render the previous company's rows under
 *      the new company's name.
 *   2. **A refusal is a 403, not a 500.** The database refuses a company the
 *      caller holds no membership in -- deliberately, rather than reporting
 *      zero rows -- and that is a well-formed request with the answer "no".
 *   3. **Nothing about the schema reaches the caller.** `cause.message` on
 *      this path is PostgREST and Postgres text: constraint names, column
 *      names, the shape of the tables. This endpoint is reachable by anyone
 *      with an account.
 *
 * The database half -- that no request path can write `tenant_id`, `role`, or
 * a colleague's `last_active_at`, and that a switch into a company the caller
 * does not belong to is refused rather than ignored -- lives in
 * `tests/isolation/membership-switching.test.ts` and runs against a real
 * Postgres.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  refreshSession: vi.fn(),
  /** The order calls were made in, which is the point of test (1) above. */
  order: [] as string[],
}));

vi.mock("@/lib/supabase/route", () => ({
  createRouteSupabaseClient: async () => ({
    auth: {
      getUser: supabase.getUser,
      refreshSession: supabase.refreshSession,
    },
    rpc: supabase.rpc,
  }),
}));

const { POST: switchRoute } = await import("@/app/api/memberships/switch/route");

const SIGNED_IN = {
  data: { user: { id: "00000000-0000-4000-8000-0000000000ff" } },
  error: null,
};
const SIGNED_OUT = { data: { user: null }, error: null };

const COMPANY_ID = "00000000-0000-4000-8000-00000000b001";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/memberships/switch", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

type ApiBody = { error?: string; fields?: Record<string, string>; redirectTo?: string };
const bodyOf = async (response: Response) => (await response.json()) as ApiBody;

/** Text that must never leave the server, whatever went wrong. */
const DB_TEXT =
  'permission denied for table memberships; policy "memberships_tenant" on public.memberships';

beforeEach(() => {
  supabase.order.length = 0;
  supabase.getUser.mockReset().mockResolvedValue(SIGNED_IN);
  supabase.rpc.mockReset().mockImplementation(async () => {
    supabase.order.push("rpc");
    return { data: { switched: true, companies: [] }, error: null };
  });
  supabase.refreshSession.mockReset().mockImplementation(async () => {
    supabase.order.push("refresh");
    return { data: {}, error: null };
  });
});

/* ── the two gates, in order ───────────────────────────────────────────────── */

describe("the session is checked before anything else", () => {
  it("refuses a caller with no session", async () => {
    supabase.getUser.mockResolvedValue(SIGNED_OUT);
    const response = await switchRoute(post({ companyId: COMPANY_ID }));
    expect(response.status).toBe(401);
    expect(supabase.rpc, "an unauthenticated request reached the database").not.toHaveBeenCalled();
  });

  it("refuses before it looks at the body, so a malformed one is still a 401", async () => {
    // Validating first would turn "not signed in" into "choose a company",
    // which tells an anonymous caller which fields exist and buries the real
    // reason.
    supabase.getUser.mockResolvedValue(SIGNED_OUT);
    const response = await switchRoute(post("}{ not json"));
    expect(response.status).toBe(401);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("no input reaches the database without passing its schema", () => {
  const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
    ["no company id", {}],
    ["a company id that is not a uuid", { companyId: "co-b" }],
    ["a company id that is not a string", { companyId: 42 }],
    ["a null company id", { companyId: null }],
    // `.strict()`. A role riding along in the body is the shape an escalation
    // attempt has, and it is refused here as well as by the database -- which
    // grants no write on that column to any request role at all.
    ["a role riding along", { companyId: COMPANY_ID, role: "admin" }],
    ["a tenant id riding along", { companyId: COMPANY_ID, tenantId: COMPANY_ID }],
    ["a body that is an array", [{ companyId: COMPANY_ID }]],
    ["a body that is not JSON at all", "}{"],
  ];

  it.each(REJECTED)("refuses %s and calls nothing", async (_label, body) => {
    const response = await switchRoute(post(body));
    expect(response.status).toBe(400);
    expect(
      supabase.rpc,
      "an unvalidated value was handed to the database",
    ).not.toHaveBeenCalled();
    expect(supabase.refreshSession, "a token was reissued for a refused switch").not.toHaveBeenCalled();
  });

  it("refuses a form-encoded post outright", async () => {
    // The simple-request hole. A cross-site `<form enctype="text/plain">`
    // sends no preflight and does attach cookies -- and on THIS endpoint that
    // would move a victim's active company without them touching anything.
    const response = await switchRoute(
      post({ companyId: COMPANY_ID }, { "content-type": "text/plain" }),
    );
    expect(response.status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

/* ── the switch itself ─────────────────────────────────────────────────────── */

describe("a successful switch", () => {
  it("writes, reissues, and only then answers", async () => {
    // The order is the assertion. `switch_company()` moves `last_active_at`;
    // the tenant claim lives in the token, so the session is still in the old
    // company until a new one is minted. Answering between those two steps
    // reports a switch that has not happened.
    const response = await switchRoute(post({ companyId: COMPANY_ID }));
    expect(response.status).toBe(200);
    expect(supabase.order).toEqual(["rpc", "refresh"]);
    expect(supabase.rpc).toHaveBeenCalledWith("switch_company", {
      p_company_id: COMPANY_ID,
    });
  });

  it("sends the caller back to the dashboard root", async () => {
    // Not a cosmetic redirect: a deep link into the previous company must not
    // survive a session change, and the surest way to guarantee that is to not
    // be on it any more.
    const body = await bodyOf(await switchRoute(post({ companyId: COMPANY_ID })));
    expect(body.redirectTo).toBe("/");
  });
});

describe("a switch that cannot be completed is not reported as one", () => {
  it("answers 403 when the database refuses the company", async () => {
    // `42501`. The database refuses rather than reporting zero rows precisely
    // so that this branch can exist -- a silent no-op would arrive here as a
    // success.
    supabase.rpc.mockRejectedValue(
      Object.assign(new Error(DB_TEXT), { code: "42501" }),
    );
    const response = await switchRoute(post({ companyId: COMPANY_ID }));
    expect(response.status).toBe(403);
    expect(supabase.refreshSession, "a token was reissued for a refused switch").not.toHaveBeenCalled();
  });

  it("answers 500 when the token cannot be reissued", async () => {
    // The write has already landed at this point and the next natural refresh
    // would pick it up -- but the caller is still holding the old tenant, so
    // "done" would put the previous company's data on a screen labelled with
    // the new company's name. Fail closed.
    supabase.refreshSession.mockResolvedValue({
      data: {},
      error: Object.assign(new Error("refresh_token_not_found"), { status: 400 }),
    });
    const response = await switchRoute(post({ companyId: COMPANY_ID }));
    expect(response.status).toBe(500);
    expect(await bodyOf(response)).not.toHaveProperty("redirectTo");
  });

  it("answers 500 for anything else, and says nothing about the schema", async () => {
    supabase.rpc.mockRejectedValue(new Error(DB_TEXT));
    const response = await switchRoute(post({ companyId: COMPANY_ID }));
    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    const serialised = JSON.stringify(body);
    for (const leak of ["memberships", "policy", "permission denied", "public."]) {
      expect(serialised, `the response leaked "${leak}"`).not.toContain(leak);
    }
  });

  it("leaks nothing on a refusal either", async () => {
    supabase.rpc.mockRejectedValue(
      Object.assign(new Error(DB_TEXT), { code: "42501" }),
    );
    const body = await bodyOf(await switchRoute(post({ companyId: COMPANY_ID })));
    expect(JSON.stringify(body)).not.toContain("memberships");
    // And it still says something a person can act on.
    expect(body.error).toMatch(/access/i);
  });
});

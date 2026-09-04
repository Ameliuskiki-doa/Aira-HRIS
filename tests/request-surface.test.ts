/**
 * The front door, asked as an attacker.
 *
 * The earlier suites were complete against a property that never named the
 * request itself: atomicity, retry, Zod, the credential, the session gate.
 * Everything they check is about what happens *after* a request is accepted.
 * The property here is the one that was missing:
 *
 *   **no request may cause a redirect off-origin, a mail to an unverified
 *   host, or a state change without a same-origin intent.**
 *
 * Every case below was reproduced before it was fixed. None of them needed a
 * malformed body, an invalid schema or a missing session -- which is exactly
 * why a suite built around those three could be green and blind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  refreshSession: vi.fn(),
  rpc: vi.fn(),
  rows: vi.fn(),
}));

vi.mock("@/lib/supabase/route", () => ({
  createRouteSupabaseClient: async () => ({
    auth: {
      getUser: supabase.getUser,
      signUp: supabase.signUp,
      signInWithPassword: supabase.signInWithPassword,
      exchangeCodeForSession: supabase.exchangeCodeForSession,
      // Story 1.6: registering a company creates the caller's founding
      // membership, so /api/companies now reissues the token before it
      // answers. Without this the route throws here rather than returning the
      // 200 these redirect and cross-site cases are measuring.
      refreshSession: supabase.refreshSession,
    },
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({ returns: async () => ({ data: supabase.rows(), error: null }) }),
        }),
      }),
    }),
    rpc: supabase.rpc,
  }),
}));

const { POST: signupRoute } = await import("@/app/api/auth/signup/route");
const { POST: signinRoute } = await import("@/app/api/auth/signin/route");
const { POST: companiesRoute } = await import("@/app/api/companies/route");
const { GET: callbackRoute } = await import("@/app/(auth)/auth/callback/route");
const { safeRedirectPath, trustedOrigin } = await import("@/lib/api/boundary");

const SITE = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  supabase.getUser.mockReset().mockResolvedValue({
    data: { user: { id: "00000000-0000-4000-8000-0000000000ff" } },
    error: null,
  });
  supabase.signUp.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
  supabase.signInWithPassword
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "u" }, session: { access_token: "at" } }, error: null });
  supabase.rpc.mockReset().mockResolvedValue({
    data: { organization_id: "org", company_id: "co", legal_name: "PT X", created: true },
    error: null,
  });
  supabase.exchangeCodeForSession
    .mockReset()
    .mockResolvedValue({ data: { session: { access_token: "at" } }, error: null });
  supabase.refreshSession.mockReset().mockResolvedValue({ data: {}, error: null });
  supabase.rows.mockReset().mockReturnValue([]);
});

/* ── 1. redirect safety ────────────────────────────────────────────────────── */

describe("a redirect target cannot leave the origin", () => {
  /**
   * Five spellings that all resolve to `https://evil.example/`, and one that
   * does not.
   *
   * The first version of the guard was `startsWith("/") && !startsWith("//")`,
   * which is testing the wrong thing entirely. WHATWG URL treats `\` as `/`
   * for special schemes and strips tab, LF and CR *before* parsing, so every
   * row below except the first was accepted and then resolved off-origin --
   * measured: `new URL("/\\evil.example", origin)` is `https://evil.example/`,
   * the origin ignored completely.
   *
   * The fix is not "also reject backslash". That is the `qual = 'true'`
   * mistake from Story 1.4 in a new costume: a denylist has to guess the
   * spellings, and this list is the spellings someone already thought of. The
   * rule is stated positively instead -- resolve the value against two
   * different placeholder origins and require it to stay inside each -- so a
   * sixth spelling nobody has thought of is refused by construction.
   */
  const ESCAPES: ReadonlyArray<readonly [string, string]> = [
    ["a protocol-relative path", "//evil.example"],
    ["a backslash instead of a slash", "/\\evil.example"],
    ["a backslash then a slash", "/\\/evil.example"],
    ["a tab inside the path", "/\t/evil.example"],
    ["a newline inside the path", "/\n//evil.example"],
    ["a carriage return inside the path", "/\r//evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a scheme-relative URL with credentials", "//user:pass@evil.example"],
    ["a path that climbs out and back", "/a/../../b"],
    ["a value that is not a path at all", "javascript:alert(1)"],
    ["a leading space before a path", " /company/new"],
  ];

  const FALLBACK = "/company/new";

  it.each(ESCAPES)("refuses %s", (_label, value) => {
    expect(safeRedirectPath(value, FALLBACK)).toBe(FALLBACK);
  });

  it.each(ESCAPES)("and %s cannot reach an off-origin URL through the callback", async (_label, value) => {
    // Not only the helper. The property is about where the *response* points,
    // and this is the confirmation-link path -- the most trusted click a user
    // will ever give this product.
    const response = await callbackRoute(
      new Request(
        `${SITE}/auth/callback?code=x&next=${encodeURIComponent(value)}`,
      ),
    );
    const location = response.headers.get("location") ?? "";
    expect(
      location.startsWith(`${SITE}/`),
      `the callback redirected to ${location}`,
    ).toBe(true);
    expect(location).not.toContain("evil.example");
  });

  it.each([
    ["the plain destination", "/company/new"],
    ["the root", "/"],
    ["a nested path", "/employees/123"],
    ["a path with a query", "/employees?page=2"],
  ])("still allows %s", (_label, value) => {
    expect(safeRedirectPath(value, "/fallback")).toBe(value);
  });
});

/* ── 2. host trust ─────────────────────────────────────────────────────────── */

describe("the origin a mail is sent to is not the caller's to choose", () => {
  const forged = (headers: Record<string, string>) =>
    new Request("http://internal.local/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, ...headers },
      body: JSON.stringify({ email: "hr@nusantara.co.id", password: "correct-horse" }),
    });

  it("ignores an unverified x-forwarded-host", async () => {
    // Reproduced: `X-Forwarded-Host: evil.example` made Supabase mail a
    // confirmation link pointing at the attacker's host -- and that link
    // carries the PKCE code, so following it hands over the session.
    await signupRoute(forged({ "x-forwarded-host": "evil.example" }));

    const call = supabase.signUp.mock.calls[0][0] as {
      options: { emailRedirectTo: string };
    };
    expect(call.options.emailRedirectTo).not.toContain("evil.example");
    expect(call.options.emailRedirectTo.startsWith(`${SITE}/`)).toBe(true);
  });

  it("ignores an unverified host hidden in the multi-proxy form", async () => {
    // `x-forwarded-host: a, b` is the shape a second proxy produces. It also
    // made `new URL()` throw, which was a 500 rather than a refusal.
    await signupRoute(
      forged({ "x-forwarded-host": "evil.example, app.aira.id" }),
    );
    const call = supabase.signUp.mock.calls[0][0] as {
      options: { emailRedirectTo: string };
    };
    expect(call.options.emailRedirectTo).not.toContain("evil.example");
  });

  it.each([
    ["a comma-joined list", "a.example, b.example"],
    ["an empty value", ""],
    ["whitespace", "   "],
    ["a value with a port and junk", "evil.example:99999"],
    ["a value containing a slash", "evil.example/path"],
    ["a value containing an @", "app.aira.id@evil.example"],
  ])("does not throw on %s", (_label, host) => {
    const request = new Request("http://internal.local/api/auth/signup", {
      method: "POST",
      headers: { "x-forwarded-host": host },
    });
    expect(() => trustedOrigin(request)).not.toThrow();
    expect(trustedOrigin(request)).toBe(SITE);
  });

  it("honours a forwarded host that is configured", async () => {
    // Positive control. Behind a real proxy the public host is the only one
    // that produces a working link, so refusing every forwarded host would
    // break the deployed product to protect it.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.aira.id");
    const request = new Request("http://internal.local/api/auth/signup", {
      method: "POST",
      headers: { "x-forwarded-host": "app.aira.id", "x-forwarded-proto": "https" },
    });
    expect(trustedOrigin(request)).toBe("https://app.aira.id");
  });
});

/* ── 3. cross-site intent ──────────────────────────────────────────────────── */

describe("a state change needs same-origin intent", () => {
  const ROUTES: ReadonlyArray<
    readonly [string, (request: Request) => Promise<Response>, unknown]
  > = [
    ["/api/auth/signup", signupRoute, { email: "hr@nusantara.co.id", password: "correct-horse" }],
    ["/api/auth/signin", signinRoute, { email: "hr@nusantara.co.id", password: "correct-horse" }],
    ["/api/companies", companiesRoute, { legalName: "PT Disusupi" }],
  ];

  const calledSupabase = () =>
    supabase.signUp.mock.calls.length +
    supabase.signInWithPassword.mock.calls.length +
    supabase.rpc.mock.calls.length;

  it.each(ROUTES)(
    "%s refuses a cross-site form post",
    async (path, handler, body) => {
      // The reproduction. `<form enctype="text/plain" action="…/api/auth/signin">`
      // is a simple request: no preflight, cookies attached, and the body is
      // close enough to JSON that `request.json()` parsed it. On signin that
      // logs a victim into the attacker's tenant, and everything they then
      // enter is the attacker's data.
      const response = await handler(
        new Request(`${SITE}${path}`, {
          method: "POST",
          headers: {
            "content-type": "text/plain;charset=UTF-8",
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(403);
      expect(calledSupabase(), "a cross-site request reached Supabase").toBe(0);
    },
  );

  it.each(ROUTES)("%s refuses a cross-site JSON post too", async (path, handler, body) => {
    // A JSON content type is not a defence on its own -- it is only a
    // preflight trigger, and a preflight the browser never sends is a
    // protection that never runs. The Origin check is what covers a caller
    // that can set headers.
    const response = await handler(
      new Request(`${SITE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(403);
    expect(calledSupabase()).toBe(0);
  });

  it.each(ROUTES)("%s refuses a form content type even same-origin", async (path, handler, body) => {
    const response = await handler(
      new Request(`${SITE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: SITE,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(403);
    expect(calledSupabase()).toBe(0);
  });

  it.each(ROUTES)("%s serves the same-origin request it exists for", async (path, handler, body) => {
    // Positive control, and not a formality: a same-origin check written
    // slightly too strictly refuses the application itself, which is a defect
    // that only shows up in the browser.
    const response = await handler(
      new Request(`${SITE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBeLessThan(400);
  });
});

/* ── 6. what a failure tells the caller ────────────────────────────────────── */

describe("a server-side failure does not narrate the database", () => {
  const DB_TEXT =
    'duplicate key value violates unique constraint "organizations_pkey" ' +
    "DETAIL: Key (id)=(2f1c...) already exists.";

  it("does not return Postgres text from /api/companies", async () => {
    supabase.rpc.mockRejectedValue(new Error(DB_TEXT));
    const response = await companiesRoute(
      new Request(`${SITE}/api/companies`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE },
        body: JSON.stringify({ legalName: "PT Bocor" }),
      }),
    );
    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(500);
    expect(body.error).not.toContain("organizations_pkey");
    expect(body.error).not.toContain("DETAIL");
    expect(body.error).not.toContain("constraint");
  });

  it("does not return Postgres text from /api/auth/signin", async () => {
    supabase.rows.mockImplementation(() => {
      throw new Error(DB_TEXT);
    });
    const response = await signinRoute(
      new Request(`${SITE}/api/auth/signin`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE },
        body: JSON.stringify({ email: "hr@nusantara.co.id", password: "correct-horse" }),
      }),
    );
    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(500);
    expect(body.error).not.toContain("organizations_pkey");
    expect(body.error).not.toContain("DETAIL");
  });
});

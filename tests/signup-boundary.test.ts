/**
 * The boundary between a stranger's HTTP request and the database.
 *
 * Four properties, each stated as a property rather than as an example, and
 * each asserted on what the handler *did* rather than on what it contains:
 *
 *   1. **A route that needs a session does not serve without one.** Refused
 *      before the body is even looked at, and before anything could reach the
 *      database.
 *   2. **No input reaches the database without passing its Zod schema.** The
 *      fake client records every call, so "the schema ran" is proved by the
 *      database call not happening, not by a `parse` appearing in the source.
 *   3. **The required set is exactly one field, and the optional set is
 *      exactly three.** A required field turned optional, or the reverse,
 *      fails here.
 *   4. **The time-zone set is closed at three, in both walls.** The schema and
 *      the check constraint in the migration have to name the same three, so a
 *      fourth added to either alone is a failure.
 *
 * The Supabase client is replaced wholesale. That is what makes this a test of
 * the boundary rather than of Supabase: a database call is observable as a
 * recorded call, and its absence is observable too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INDONESIAN_TIME_ZONES,
  zoneLabel,
} from "@/components/shell/timezone";
import {
  COMPANY_TIME_ZONE_IDS,
  COMPANY_TIME_ZONES,
  DEFAULT_COMPANY_TIME_ZONE,
} from "@/lib/domain/timezones";
import { companyRegistrationSchema } from "@/lib/validation/company";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  rpc: vi.fn(),
  /** What the `organizations` read returns. Empty until a test says otherwise. */
  rows: vi.fn(),
}));

vi.mock("@/lib/supabase/route", () => ({
  createRouteSupabaseClient: async () => ({
    auth: {
      getUser: supabase.getUser,
      signUp: supabase.signUp,
      signInWithPassword: supabase.signInWithPassword,
    },
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            returns: async () => ({ data: supabase.rows(), error: null }),
          }),
        }),
      }),
    }),
    rpc: supabase.rpc,
  }),
}));

/**
 * The same fake, reached through the Server Component factory. The shell's
 * layout is the other half of the session gate: a screen behind it must not
 * render for a caller with no session.
 */
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: supabase.getUser },
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            returns: async () => ({ data: supabase.rows(), error: null }),
          }),
        }),
      }),
    }),
  }),
}));

/**
 * `redirect()` throws by design in Next, which is exactly what makes it
 * observable here: the layout either returns an element or it does not return
 * at all, and the destination rides along in the message.
 */
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
  useSelectedLayoutSegment: () => null,
}));

/** The shell is a browser component; this suite only cares that it got props. */
vi.mock("@/components/shell/app-shell-route", () => ({
  AppShellRoute: (props: unknown) => props,
}));

/** Likewise the two forms: what matters here is whether they are offered. */
vi.mock("@/components/company/company-registration-form", () => ({
  CompanyRegistrationForm: () => null,
}));
vi.mock("@/components/auth/signin-form", () => ({
  SigninForm: () => null,
}));

const { POST: registerCompanyRoute } = await import("@/app/api/companies/route");
const { POST: signupRoute } = await import("@/app/api/auth/signup/route");
const { POST: signinRoute } = await import("@/app/api/auth/signin/route");

const SIGNED_IN = {
  data: { user: { id: "00000000-0000-4000-8000-0000000000ff" } },
  error: null,
};
const SIGNED_OUT = { data: { user: null }, error: null };

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const VALID_COMPANY = {
  legalName: "PT Nusantara Rasa",
  npwp: "01.234.567.8-901.000",
  nppBpjsTk: "AB1234567",
  bpjsKesCode: "KES-99",
  timeZone: "Asia/Makassar",
};

type ApiBody = { error?: string; fields?: Record<string, string>; rateLimited?: boolean };

const bodyOf = async (response: Response) => (await response.json()) as ApiBody;

beforeEach(() => {
  supabase.getUser.mockReset();
  supabase.signUp.mockReset();
  supabase.signInWithPassword.mockReset();
  supabase.rpc.mockReset();
  supabase.getUser.mockResolvedValue(SIGNED_IN);
  supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  supabase.rpc.mockResolvedValue({
    data: { organization_id: "org", company_id: "co", created: true },
    error: null,
  });
  supabase.rows.mockReset();
  supabase.rows.mockReturnValue([]);
});

/* ── 1. the session gate ───────────────────────────────────────────────────── */

describe("a route that needs a session does not serve without one", () => {
  it.each([
    ["no user at all", SIGNED_OUT],
    ["an auth error", { data: { user: null }, error: { message: "jwt expired" } }],
    ["a null data envelope", { data: null, error: null }],
  ])("refuses POST /api/companies with %s", async (_label, session) => {
    supabase.getUser.mockResolvedValue(session);

    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", VALID_COMPANY),
    );

    expect(response.status).toBe(401);
    expect(
      supabase.rpc,
      "an unauthenticated request reached the database",
    ).not.toHaveBeenCalled();
  });

  it("refuses before it looks at the body, so a malformed one is still a 401", async () => {
    // Order matters. Validating first would turn "not signed in" into "your
    // legal name is required", which tells an anonymous caller which fields
    // exist and buries the real reason.
    supabase.getUser.mockResolvedValue(SIGNED_OUT);
    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", "}{ not json"),
    );
    expect(response.status).toBe(401);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("serves a signed-in caller", async () => {
    // Positive control: a gate that refuses everyone is not a stricter gate.
    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", VALID_COMPANY),
    );
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

/* ── 2. nothing reaches the database unvalidated ───────────────────────────── */

describe("no input reaches the database without passing its schema", () => {
  const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
    ["a missing legal name", { ...VALID_COMPANY, legalName: undefined }],
    ["a blank legal name", { ...VALID_COMPANY, legalName: "" }],
    ["a whitespace-only legal name", { ...VALID_COMPANY, legalName: "   " }],
    ["a legal name that is not a string", { ...VALID_COMPANY, legalName: 42 }],
    ["a legal name past 200 characters", { ...VALID_COMPANY, legalName: "P".repeat(201) }],
    ["a time zone outside the four", { ...VALID_COMPANY, timeZone: "Asia/Bangkok" }],
    ["a time zone that shares WIB's offset but is not Indonesian", { ...VALID_COMPANY, timeZone: "Asia/Ho_Chi_Minh" }],
    ["an unrecognised key riding along", { ...VALID_COMPANY, plan: "payroll" }],
    ["an organization id the caller chose", { ...VALID_COMPANY, organizationId: "someone-else" }],
    ["an NPWP that is not a string", { ...VALID_COMPANY, npwp: { toString: "no" } }],
    ["a body that is an array", [VALID_COMPANY]],
    ["a body that is a bare string", "just a string"],
    ["a body that is not JSON at all", "}{"],
  ];

  it.each(REJECTED)("refuses %s and calls nothing", async (_label, body) => {
    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", body),
    );
    expect(response.status).toBe(400);
    expect(
      supabase.rpc,
      "an unvalidated value was handed to the database",
    ).not.toHaveBeenCalled();
  });

  it("names the field that was wrong so the form can show it inline", async () => {
    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", { ...VALID_COMPANY, legalName: "  " }),
    );
    const body = await bodyOf(response);
    expect(body.fields?.legalName).toMatch(/legal name/i);
  });

  it("hands the database exactly what the schema produced, not what was posted", async () => {
    await registerCompanyRoute(
      post("http://localhost:3000/api/companies", {
        legalName: "  PT Rapi Sekali  ",
        npwp: "   ",
        nppBpjsTk: "",
        // Absent entirely, which is a third way of saying "not provided".
        timeZone: "Asia/Jayapura",
      }),
    );

    expect(supabase.rpc).toHaveBeenCalledWith("register_company", {
      p_legal_name: "PT Rapi Sekali",
      p_npwp: null,
      p_npp_bpjs_tk: null,
      p_bpjs_kes_code: null,
      p_timezone: "Asia/Jayapura",
    });
  });

  it("defaults the time zone rather than leaving it to the database", async () => {
    await registerCompanyRoute(
      post("http://localhost:3000/api/companies", { legalName: "PT Tanpa Zona" }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "register_company",
      expect.objectContaining({ p_timezone: DEFAULT_COMPANY_TIME_ZONE }),
    );
  });

  it("reports a resumed registration as 200 and a new one as 201", async () => {
    supabase.rpc.mockResolvedValue({
      data: { organization_id: "org", company_id: "co", created: false },
      error: null,
    });
    const response = await registerCompanyRoute(
      post("http://localhost:3000/api/companies", VALID_COMPANY),
    );
    expect(response.status).toBe(200);
  });
});

/* ── 3. required and optional are exactly these ────────────────────────────── */

describe("the required set is exactly the legal name", () => {
  /** The contract, spelled out so a change to it is a change to this table. */
  const FIELDS: ReadonlyArray<readonly [string, "required" | "optional"]> = [
    ["legalName", "required"],
    ["npwp", "optional"],
    ["nppBpjsTk", "optional"],
    ["bpjsKesCode", "optional"],
    ["timeZone", "optional"],
  ];

  it.each(FIELDS)("%s is %s", (field, requirement) => {
    const body: Record<string, unknown> = { ...VALID_COMPANY };
    delete body[field];
    const parsed = companyRegistrationSchema.safeParse(body);
    expect(
      parsed.success,
      requirement === "required"
        ? `${field} became optional`
        : `${field} became required`,
    ).toBe(requirement === "optional");
  });

  it.each(["npwp", "nppBpjsTk", "bpjsKesCode"])(
    "stores a blank %s as null rather than as an empty string",
    (field) => {
      const parsed = companyRegistrationSchema.parse({
        ...VALID_COMPANY,
        [field]: "   ",
      });
      expect(parsed[field as "npwp"]).toBeNull();
    },
  );

  it("covers every field the schema declares", () => {
    // Without this the table above could silently stop describing the schema:
    // a new field would be unlisted, untested, and could be required or
    // optional at random.
    const declared = Object.keys(companyRegistrationSchema.parse(VALID_COMPANY)).sort();
    expect(declared).toEqual(FIELDS.map(([name]) => name).sort());
  });
});

/* ── 4. the time-zone set is closed, in both walls ─────────────────────────── */

describe("the time zone set is closed at four identifiers, not three zones", () => {
  const MIGRATION = readFileSync(
    resolve(ROOT, "supabase/migrations/20260827120000_signup_register_company.sql"),
    "utf8",
  );

  it("holds all four identifiers, west to east", () => {
    // Four, not three. Indonesia's three legal zones span four IANA
    // identifiers, and `Asia/Pontianak` -- West Kalimantan, WIB -- is the one
    // that gets dropped. It was dropped here once, and the effect was that a
    // Pontianak company could not register at all.
    expect(COMPANY_TIME_ZONE_IDS).toEqual([
      "Asia/Jakarta",
      "Asia/Pontianak",
      "Asia/Makassar",
      "Asia/Jayapura",
    ]);
  });

  it("covers each of the three legal zones at least once", () => {
    // The count that the identifier list is a spelling *of*. Stated separately
    // so "four identifiers" and "three zones" cannot silently become the same
    // number again.
    expect(new Set(COMPANY_TIME_ZONES.map((zone) => zone.zone))).toEqual(
      new Set(["WIB", "WITA", "WIT"]),
    );
  });

  it("gives the two WIB identifiers different labels in the form", () => {
    // Two options reading "WIB (UTC+7)" with nothing to tell them apart is a
    // select a user cannot answer correctly.
    const wib = COMPANY_TIME_ZONES.filter((zone) => zone.zone === "WIB");
    expect(wib).toHaveLength(2);
    expect(wib[0].region).not.toBe(wib[1].region);
  });

  describe("the regions match the IANA groupings", () => {
    // The labels are the only thing a user reads. A wrong one sends them to
    // the wrong row, which is how the option added *for* Pontianak became
    // unreachable by Pontianak: the first draft listed "West & Central
    // Kalimantan" against `Asia/Jakarta`, where neither province belongs.
    //
    // Both are UTC+7 with no DST, so this is a misled user rather than a wrong
    // payslip — which is exactly why nothing else would ever have caught it.
    const regionOf = (id: string) =>
      COMPANY_TIME_ZONES.find((zone) => zone.id === id)?.region ?? "";

    it("keeps Kalimantan off the Java/Sumatra row entirely", () => {
      expect(regionOf("Asia/Jakarta")).not.toMatch(/kalimantan|borneo/i);
    });

    it("puts West and Central Kalimantan on Asia/Pontianak", () => {
      // IANA: "Borneo (west, central)".
      expect(regionOf("Asia/Pontianak")).toMatch(/west/i);
      expect(regionOf("Asia/Pontianak")).toMatch(/central/i);
    });

    it("puts the eastern Kalimantan provinces and Nusa Tenggara on Asia/Makassar", () => {
      // IANA: "Borneo (east, south); Sulawesi; Bali; Nusa Tenggara".
      const makassar = regionOf("Asia/Makassar");
      expect(makassar).toMatch(/east/i);
      expect(makassar).toMatch(/south/i);
      expect(makassar).toMatch(/nusa tenggara/i);
      expect(makassar).toMatch(/sulawesi/i);
      expect(makassar).not.toMatch(/\bwest kalimantan\b/i);
    });

    it("names Maluku and Papua on Asia/Jayapura", () => {
      expect(regionOf("Asia/Jayapura")).toMatch(/maluku/i);
      expect(regionOf("Asia/Jayapura")).toMatch(/papua/i);
    });

    it("gives every identifier a region and repeats none of them", () => {
      const regions = COMPANY_TIME_ZONES.map((zone) => zone.region);
      for (const region of regions) expect(region.trim().length).toBeGreaterThan(0);
      expect(new Set(regions).size).toBe(regions.length);
    });
  });

  it.each(COMPANY_TIME_ZONE_IDS)("accepts %s", (timeZone) => {
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, timeZone }).success,
    ).toBe(true);
  });

  it.each([
    "Asia/Bangkok",
    "Asia/Singapore",
    "Asia/Ho_Chi_Minh",
    "UTC",
    "Europe/London",
    // The zone *name*, which is not an IANA identifier and cannot be handed to
    // `Intl.DateTimeFormat`.
    "WIB",
    "",
    "asia/jakarta",
  ])("refuses %s", (timeZone) => {
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, timeZone }).success,
      `${timeZone} was accepted`,
    ).toBe(false);
  });

  it("offers only identifiers the header knows how to label", () => {
    // The drift that caused the bug this test now guards. `zoneLabel` echoes an
    // unrecognised identifier back rather than throwing, so a company stored
    // with one the shell cannot label renders "Asia/Pontianak" where every
    // other tenant sees "WIB" -- silently, and only for that tenant. The two
    // lists were written a story apart and disagreed; asserting equality is
    // what stops the next one disagreeing too.
    expect([...COMPANY_TIME_ZONE_IDS].sort()).toEqual(
      [...INDONESIAN_TIME_ZONES].sort(),
    );
    for (const id of COMPANY_TIME_ZONE_IDS) {
      expect(zoneLabel(id), `${id} has no zone name in the shell`).not.toBe(id);
    }
  });

  it("gives the database the same length bounds the schema carries", () => {
    // Two walls that disagree are one wall plus a false sense of the other. A
    // value the form refuses and the table accepts is reachable by anyone who
    // skips the form -- `insert into companies … repeat('X', 500000)` stored
    // half a megabyte before the constraint existed. A value the form accepts
    // and the table refuses is a customer who cannot register and a 500 nobody
    // can explain.
    const hardening = readFileSync(
      resolve(ROOT, "supabase/migrations/20260827140000_tighten_write_surface.sql"),
      "utf8",
    );
    for (const [column, limit] of [
      ["legal_name", 200],
      ["npwp", 32],
      ["npp_bpjs_tk", 32],
      ["bpjs_kes_code", 32],
    ] as const) {
      expect(
        hardening,
        `the migration sets no ${limit}-character bound on ${column}`,
      ).toMatch(new RegExp(`${column}[^<]*<=\\s*${limit}`));
    }
    // And the schema's own bounds are those numbers, read from the schema
    // rather than restated: a schema loosened to 500 with the constraint left
    // at 200 fails here.
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, legalName: "N".repeat(200) }).success,
    ).toBe(true);
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, legalName: "N".repeat(201) }).success,
    ).toBe(false);
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, npwp: "9".repeat(32) }).success,
    ).toBe(true);
    expect(
      companyRegistrationSchema.safeParse({ ...VALID_COMPANY, npwp: "9".repeat(33) }).success,
    ).toBe(false);
  });

  it("names the same four in the check constraint, so neither wall can drift", () => {
    // Two walls only help if they agree. A fourth zone added to the schema
    // alone would be refused by the database at runtime; added to the
    // constraint alone it would be unreachable. Either way it fails here.
    const constraint = /companies_timezone_check[\s\S]*?check \(timezone in \(([^)]*)\)\)/.exec(
      MIGRATION,
    );
    expect(constraint, "the time zone check constraint is not in the migration").not.toBeNull();
    const listed = Array.from(constraint![1].matchAll(/'([^']+)'/g), (match) => match[1]);
    expect(listed).toEqual([...COMPANY_TIME_ZONE_IDS]);
  });
});

/* ── signup ────────────────────────────────────────────────────────────────── */

describe("signup validates before it creates anything", () => {
  it.each([
    ["a missing email", { password: "correct-horse" }],
    ["an email that is not an address", { email: "nope", password: "correct-horse" }],
    ["a missing password", { email: "hr@nusantara.co.id" }],
    ["a password under 8 characters", { email: "hr@nusantara.co.id", password: "short" }],
    ["an extra field", { email: "hr@nusantara.co.id", password: "correct-horse", role: "admin" }],
    ["a body that is not JSON", "}{"],
  ])("refuses %s without calling Supabase", async (_label, body) => {
    const response = await signupRoute(post("http://localhost:3000/api/auth/signup", body));
    expect(response.status).toBe(400);
    expect(supabase.signUp).not.toHaveBeenCalled();
  });

  it("creates the account and points the confirmation link back at this origin", async () => {
    const response = await signupRoute(
      post("http://localhost:3000/api/auth/signup", {
        email: "  hr@nusantara.co.id ",
        password: "correct-horse",
      }),
    );

    expect(response.status).toBe(202);
    expect(supabase.signUp).toHaveBeenCalledTimes(1);
    const call = supabase.signUp.mock.calls[0][0] as {
      email: string;
      options: { emailRedirectTo: string };
    };
    expect(call.email, "the address was not trimmed before it was registered").toBe(
      "hr@nusantara.co.id",
    );
    expect(call.options.emailRedirectTo).toContain("http://localhost:3000/auth/callback");
  });

  it("builds that link from the forwarded host when the proxy in front is ours", async () => {
    // A confirmation link built from the internal host is a link that goes
    // nowhere, and it is only ever wrong in the deployed environment. The host
    // is honoured *because it is configured* -- an unverified one is refused,
    // which is asserted in tests/request-surface.test.ts.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.aira.id");
    await signupRoute(
      post(
        "http://internal.local/api/auth/signup",
        { email: "hr@nusantara.co.id", password: "correct-horse" },
        { "x-forwarded-host": "app.aira.id", "x-forwarded-proto": "https" },
      ),
    );
    const call = supabase.signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } };
    expect(call.options.emailRedirectTo).toContain("https://app.aira.id/auth/callback");
  });

  it("says nothing about a session, and nothing about mail it cannot see", async () => {
    // Confirmation is on, so a response implying a session would be a lie the
    // very next request exposes.
    //
    // It must not assert that mail was *sent*, either. Supabase returns this
    // same shape for an address that is already registered and confirmed, and
    // in that case deliberately sends nothing -- the indistinguishability is
    // what stops this endpoint being an account-existence oracle. So the
    // response says what the user should do, not what the server did.
    const response = await signupRoute(
      post("http://localhost:3000/api/auth/signup", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["checkInbox", "email"]);
    expect(body, "the response asserts mail was sent").not.toHaveProperty("emailSent");
  });

  it.each([
    ["the stable error code", { code: "over_email_send_rate_limit", message: "rate limited", status: 429 }],
    ["the status alone", { message: "too many requests", status: 429 }],
  ])("tells the user about the email budget when Supabase refuses, via %s", async (_label, error) => {
    supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error });

    const response = await signupRoute(
      post("http://localhost:3000/api/auth/signup", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(429);
    expect(body.rateLimited).toBe(true);
    // The message has to name the real constraint -- two an hour, across the
    // whole product -- rather than reading as "signup failed". A user told the
    // truth waits; a user told it failed retries and burns the same budget.
    expect(body.error).toMatch(/two/i);
    expect(body.error).toMatch(/hour/i);
    expect(body.error).not.toMatch(/signup failed/i);
  });

  it("does not dress an ordinary failure up as a rate limit", async () => {
    supabase.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "database is down", status: 500 },
    });
    const response = await signupRoute(
      post("http://localhost:3000/api/auth/signup", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );
    expect(response.status).toBe(500);
    expect((await bodyOf(response)).rateLimited).toBeUndefined();
  });
});

/* ── the shell is behind the same gate ─────────────────────────────────────── */

describe("the screens behind the shell need a session too", () => {
  const loadLayout = async () => {
    const layoutModule = await import("@/app/(app)/layout");
    return layoutModule.default as (props: {
      children: unknown;
    }) => Promise<unknown>;
  };

  it("does not render for a caller with no session", async () => {
    supabase.getUser.mockResolvedValue(SIGNED_OUT);
    const AppLayout = await loadLayout();
    // Not "renders an empty shell" and not "renders the signup screen inside
    // the shell": it does not return at all.
    // `/signin`, not `/signup`. Sending a returning user to signup lands them
    // on "check your email" waiting for a mail that is never sent, because
    // signup for an existing address deliberately sends nothing — the exact
    // lockout the sign-in route was added to end.
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/signin");
  });

  it("renders the real legal name, time zone and plan for an owner", async () => {
    // The acceptance criterion, at the seam where the fixture used to be. The
    // shell itself is measured in the browser project; what is proved here is
    // that what reaches it comes from the database.
    supabase.rows.mockReturnValue([
      {
        id: "org-1",
        plan: "core",
        companies: [
          { id: "co-1", legal_name: "PT Sejahtera Abadi", timezone: "Asia/Jayapura" },
        ],
      },
    ]);

    const AppLayout = await loadLayout();
    const rendered = (await AppLayout({ children: null })) as {
      props: { company: Record<string, unknown> };
    };

    expect(rendered.props.company).toMatchObject({
      legalName: "PT Sejahtera Abadi",
      timeZone: "Asia/Jayapura",
      planLabel: "Core plan",
    });
  });

  it("says there is no company yet rather than borrowing a fixture's name", async () => {
    // The window between confirming an email and submitting the registration
    // form is real, and the header still has to render something.
    const AppLayout = await loadLayout();
    const rendered = (await AppLayout({ children: null })) as {
      props: { company: Record<string, unknown> };
    };
    expect(rendered.props.company).toMatchObject({
      legalName: "No company yet",
      branchCount: 0,
    });
    expect(rendered.props.company.legalName).not.toBe("PT Nusantara Rasa");
  });
});

/* ── nothing offers a write that would silently do nothing ─────────────────── */

describe("the registration screen is not offered to a tenant that has one", () => {
  const loadPage = async () => {
    const pageModule = await import("@/app/(app)/company/new/page");
    return pageModule.default as () => Promise<unknown>;
  };

  it("sends an owner who already has a company to the dashboard", async () => {
    // `companies_tenant`'s USING requires `id = tenant_id()`, and an owner with
    // no tenant claim does not satisfy it -- so an update from this session
    // affects zero rows and raises nothing at all. A form that appears to edit
    // and silently does not is worse than no form, which is why this redirects
    // rather than pre-filling.
    supabase.rows.mockReturnValue([
      {
        id: "org-1",
        plan: "free",
        companies: [
          { id: "co-1", legal_name: "PT Sudah Ada", timezone: "Asia/Jakarta" },
        ],
      },
    ]);

    const Page = await loadPage();
    await expect(Page()).rejects.toThrow("REDIRECT:/");
  });

  it("still offers it to an owner who has none", async () => {
    // Positive control. A screen that always redirects is not a safer screen.
    const Page = await loadPage();
    await expect(Page()).resolves.toBeTruthy();
  });
});

/* ── getting back in ───────────────────────────────────────────────────────── */

describe("a confirmed account can obtain a session again", () => {
  /**
   * The property, and the reason it needs its own route.
   *
   * Every screen behind the shell redirects a caller with no session to an
   * auth screen. If the only auth screen is signup, that redirect is a dead
   * end for anyone who already has an account: Supabase answers `signUp` for a
   * known address with a deliberately indistinguishable response carrying **no
   * session**, precisely so the endpoint cannot be used to enumerate accounts.
   * So the product would be usable exactly once per browser.
   */
  it("cannot get one from signup, which is why signin has to exist", async () => {
    // Not a hypothetical. This is the shape Supabase returns for an address
    // that is already registered and confirmed.
    supabase.signUp.mockResolvedValue({
      data: { user: { id: "obfuscated" }, session: null },
      error: null,
    });

    const response = await signupRoute(
      post("http://localhost:3000/api/auth/signup", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.session, "signup handed back a session").toBeUndefined();
  });

  it("gets one from signin, and is told where to land", async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "00000000-0000-4000-8000-0000000000ff" },
        session: { access_token: "at" },
      },
      error: null,
    });
    supabase.rows.mockReturnValue([
      {
        id: "org-1",
        plan: "core",
        companies: [
          { id: "co-1", legal_name: "PT Sejahtera Abadi", timezone: "Asia/Pontianak" },
        ],
      },
    ]);

    const response = await signinRoute(
      post("http://localhost:3000/api/auth/signin", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as { next?: string }).next).toBe("/");
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: "hr@nusantara.co.id",
      password: "correct-horse",
    });
  });

  it("lands a half-registered user back on the registration form", async () => {
    // The resume story, end to end: sign up, fail the company insert, close
    // the browser, come back. Landing on the dashboard would show a shell with
    // no company and no way to fix it.
    supabase.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u" }, session: { access_token: "at" } },
      error: null,
    });
    supabase.rows.mockReturnValue([]);

    const response = await signinRoute(
      post("http://localhost:3000/api/auth/signin", {
        email: "hr@nusantara.co.id",
        password: "correct-horse",
      }),
    );
    expect(((await response.json()) as { next?: string }).next).toBe("/company/new");
  });

  it.each([
    ["a missing email", { password: "correct-horse" }],
    ["an email that is not an address", { email: "nope", password: "correct-horse" }],
    ["a missing password", { email: "hr@nusantara.co.id" }],
    ["an empty password", { email: "hr@nusantara.co.id", password: "" }],
    ["an extra field", { email: "a@b.co", password: "x", redirectTo: "//evil.example" }],
    ["a body that is not JSON", "}{"],
  ])("refuses %s without asking Supabase", async (_label, body) => {
    const response = await signinRoute(post("http://localhost:3000/api/auth/signin", body));
    expect(response.status).toBe(400);
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not apply the signup password floor to an existing account", async () => {
    // A length rule on signin locks out anyone whose password predates the
    // rule. The floor belongs at account creation, where it changes something.
    const { signinSchema } = await import("@/lib/validation/auth");
    expect(signinSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
  });

  it("says the same thing for a wrong password as for an unknown address", async () => {
    // Two different messages here is an account-existence oracle, reachable by
    // anyone, at signup-form speed.
    const messages = new Set<string>();
    for (const message of ["Invalid login credentials", "Email not confirmed"]) {
      supabase.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message, status: 400, code: "invalid_credentials" },
      });
      const response = await signinRoute(
        post("http://localhost:3000/api/auth/signin", {
          email: "hr@nusantara.co.id",
          password: "wrong-horse",
        }),
      );
      expect(response.status).toBe(401);
      messages.add(((await response.json()) as { error?: string }).error ?? "");
    }
    expect(messages.size, "signin distinguishes its failures for the caller").toBe(1);
  });
});

describe("the sign-in screen", () => {
  const loadPage = async () => {
    const pageModule = await import("@/app/(auth)/signin/page");
    return pageModule.default as () => Promise<unknown>;
  };

  it("is offered to a caller with no session", async () => {
    supabase.getUser.mockResolvedValue(SIGNED_OUT);
    const Page = await loadPage();
    await expect(Page()).resolves.toBeTruthy();
  });

  it("is offered to a caller whose cookies no longer resolve to a user", async () => {
    // The case that makes gating the *handler* on a session wrong. This caller
    // holds auth cookies and has no usable session; they must reach the form.
    supabase.getUser.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        status: 400,
        code: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
      },
    });
    const Page = await loadPage();
    await expect(Page()).resolves.toBeTruthy();
  });

  it("is not offered to a caller who already has one", async () => {
    const Page = await loadPage();
    await expect(Page()).rejects.toThrow("REDIRECT:/");
  });
});

describe("a broken auth server is not a sign-out", () => {
  /**
   * `if (error) return null` used to be the whole of `currentUser`, which
   * turned "Supabase did not answer" into "you are not logged in" on the
   * hottest path in the product. The visible symptom of that is a loop: every
   * signed-in user bounced to `/signin`, whose page redirects them back the
   * moment the blip ends, and nothing anywhere says the auth server was down.
   */
  const loadLayout = async () => {
    const layoutModule = await import("@/app/(app)/layout");
    return layoutModule.default as (props: { children: unknown }) => Promise<unknown>;
  };

  it.each([
    ["a gateway failure", { name: "AuthRetryableFetchError", status: 503, message: "upstream" }],
    ["a network error with no status at all", { name: "TypeError", message: "fetch failed" }],
    ["an unrecognised server error", { name: "AuthApiError", status: 500, message: "boom" }],
  ])("does not render %s as a signed-out visitor", async (_label, error) => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error });
    const AppLayout = await loadLayout();

    // Not a redirect. The request fails, an error boundary says so, and the
    // user's session is left intact for the retry.
    await expect(AppLayout({ children: null })).rejects.not.toThrow("REDIRECT:/signin");
  });

  it.each([
    ["a missing session", { name: "AuthSessionMissingError", status: 400, message: "none" }],
    ["an expired refresh token", { name: "AuthApiError", status: 400, code: "refresh_token_not_found", message: "gone" }],
    ["a rejected token", { name: "AuthApiError", status: 401, message: "invalid claim" }],
  ])("still treats %s as signed out", async (_label, error) => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error });
    const AppLayout = await loadLayout();
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/signin");
  });
});

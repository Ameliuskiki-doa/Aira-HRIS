/**
 * The harness checking itself, with no database.
 *
 * Several of the properties this gate owes are properties of the *harness*
 * rather than of the schema: the non-empty fixture assertion, the detection of
 * an unwrapped claim call, the detection of an unconditioned policy, and the
 * qualified-name keying of the exemption lookup. All of them are pure
 * functions, so all of them can be tested directly -- which is what stops any
 * of them from being quietly weakened.
 *
 * It runs in the **`unit`** project on purpose. An earlier version sat in
 * `tests/isolation/`, where it needed Docker to run at all and therefore never
 * ran during `npm test` — the harness's own guarantees were the only ones
 * gated behind a container they did not need.
 */
import { describe, expect, it } from "vitest";

import {
  EXEMPTIONS,
  qualify,
  referencesClaim,
  unwrappedClaimCalls,
  waivedFor,
} from "./isolation/support/catalog";
import { assertTenantPurity, fixtureFor, FIXTURES } from "./isolation/support/fixtures";

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000b001";

describe("assertTenantPurity", () => {
  it("rejects an empty result before it says anything about purity", () => {
    // The case this whole harness turns on: RLS enabled with no policy returns
    // zero rows, which is byte-identical to a fixture that never seeded.
    expect(() => assertTenantPurity([], "tenant_id", A, "probe")).toThrow(/fixture is empty/);
  });

  it("rejects a foreign row", () => {
    expect(() =>
      assertTenantPurity([{ tenant_id: A }, { tenant_id: B }], "tenant_id", A, "probe"),
    ).toThrow(/LEAK/);
  });

  it("accepts a non-empty, pure result", () => {
    expect(() => assertTenantPurity([{ tenant_id: A }], "tenant_id", A, "probe")).not.toThrow();
  });
});

describe("unwrappedClaimCalls", () => {
  // The literal strings pg_get_expr renders, copied from a live catalog.
  const WRAPPED = "(id = ( SELECT tenant_id() AS tenant_id))";
  const WRAPPED_QUALIFIED = "(id = ( SELECT public.tenant_id() AS tenant_id))";
  const UNWRAPPED = "(tenant_id = tenant_id())";

  it("passes the wrapped form, qualified or not", () => {
    // pg_get_expr drops the `public.` prefix whenever public is on the
    // rendering session's search_path, so both spellings have to pass.
    expect(unwrappedClaimCalls(WRAPPED, ["tenant_id"])).toEqual([]);
    expect(unwrappedClaimCalls(WRAPPED_QUALIFIED, ["tenant_id"])).toEqual([]);
  });

  it("catches the unwrapped form, which isolates correctly and costs ~7.4x", () => {
    expect(unwrappedClaimCalls(UNWRAPPED, ["tenant_id"])).toEqual(["tenant_id"]);
  });

  it("does not mistake a tenant_id column reference for a call", () => {
    expect(unwrappedClaimCalls("(tenant_id = ( SELECT tenant_id() AS tenant_id))", ["tenant_id"])).toEqual([]);
  });

  it("catches a second unwrapped call once the first is wrapped", () => {
    // Stripping the wrapped occurrence must not blind the check to what is
    // left, which is how a half-fixed policy would slip through.
    expect(
      unwrappedClaimCalls("(( SELECT tenant_id() AS tenant_id) = a and tenant_id() = b)", ["tenant_id"]),
    ).toEqual(["tenant_id"]);
  });

  it("checks every discovered claim function, not just tenant_id", () => {
    expect(unwrappedClaimCalls("(owner_user_id = auth_user_id())", ["tenant_id", "auth_user_id"])).toEqual([
      "auth_user_id",
    ]);
  });

  it("says nothing about a null expression", () => {
    expect(unwrappedClaimCalls(null, ["tenant_id"])).toEqual([]);
  });
});

describe("referencesClaim", () => {
  const claims = ["tenant_id", "auth_user_id"];

  it("rejects the unconditioned policy that passed every other check", () => {
    // `to anon using (true)`: policy present, no unwrapped call, tenant_id
    // column present, index present, fixture present — and both tenants' rows.
    expect(referencesClaim("true", claims)).toBe(false);
  });

  it("rejects the spellings a denylist would have to guess", () => {
    // Stated positively for exactly this reason: `true` was only the shortest
    // way to write it.
    for (const open of ["(1 = 1)", "(id IS NOT NULL)", "(NOT false)", "('t'::boolean)"]) {
      expect(referencesClaim(open, claims), `${open} was accepted as conditioned`).toBe(false);
    }
  });

  it("accepts an expression that asks who is asking", () => {
    expect(referencesClaim("(id = ( SELECT tenant_id() AS tenant_id))", claims)).toBe(true);
    expect(referencesClaim("(owner_user_id = ( SELECT public.auth_user_id() AS auth_user_id))", claims)).toBe(true);
  });

  it("accepts a claim call nested inside an EXISTS", () => {
    // The shape of the companies insert policy.
    expect(
      referencesClaim(
        "(EXISTS ( SELECT 1 FROM organizations o WHERE ((o.id = organization_id) AND (o.owner_user_id = ( SELECT auth_user_id() AS auth_user_id)))))",
        claims,
      ),
    ).toBe(true);
  });

  it("says nothing about a null expression", () => {
    expect(referencesClaim(null, claims)).toBe(false);
  });
});

describe("exemptions and fixtures are keyed on the qualified name", () => {
  it("does not let another schema inherit a public exemption", () => {
    // `hr.companies` is a different relation from `public.companies` and must
    // earn its own exemption.
    expect(waivedFor("public", "companies").has("tenant_id_column")).toBe(true);
    expect(waivedFor("hr", "companies").has("tenant_id_column")).toBe(false);
    expect(waivedFor("public", "stat_ptkp").has("tenant_id_column")).toBe(true);
    expect(waivedFor("hr", "stat_ptkp").has("tenant_id_column")).toBe(false);
  });

  it("does not let another schema inherit a public fixture", () => {
    expect(fixtureFor("public", "companies")).toBeDefined();
    expect(fixtureFor("hr", "companies")).toBeUndefined();
  });

  it("declares every exemption against a schema", () => {
    for (const exemption of EXEMPTIONS) {
      expect(exemption.schema.length, `${exemption.id} names no schema`).toBeGreaterThan(0);
    }
  });

  it("qualifies names the same way everywhere", () => {
    expect(qualify("public", "companies")).toBe("public.companies");
    expect(new Set(FIXTURES.map((f) => qualify(f.schema, f.table))).size).toBe(FIXTURES.length);
  });
});

describe("the isolation column override is not a free lever", () => {
  it("is only claimed by relations the exemption list covers", () => {
    // Mirrors the live assertion in catalog-sweep, which can only check the
    // relations that exist. This one checks the registry itself, so a fixture
    // added ahead of its table is caught too.
    for (const fixture of FIXTURES) {
      if (fixture.isolationColumn === "tenant_id") continue;
      expect(
        waivedFor(fixture.schema, fixture.table).has("tenant_id_column"),
        `${qualify(fixture.schema, fixture.table)} declares isolationColumn "${fixture.isolationColumn}" ` +
          `without an above-the-boundary exemption`,
      ).toBe(true);
    }
  });
});

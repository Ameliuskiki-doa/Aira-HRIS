/**
 * Two tenants, and what "isolated" means for each relation.
 *
 * The registry is the half of the harness that a later story cannot forget.
 * `catalog-sweep.test.ts` asserts that every relation discovered in `public`
 * has an entry here, so adding `employees` in Story 1.8 without seeding two
 * tenants' worth of rows fails the build. Without that link the purity suite
 * would simply not mention the new table and stay green -- the exact vacuous
 * pass this harness exists to prevent.
 *
 * Keyed on the **qualified** name throughout. A bare-name key would let
 * `hr.employees` silently inherit whatever `public.employees` declared.
 */
import type { Client } from "pg";

import { qualify } from "./catalog";
import type { Principal } from "./substrate";

/** Fixed ids, so a failure message names a value that can be grepped. */
export const TENANT_A = "00000000-0000-4000-8000-00000000a001";
export const TENANT_B = "00000000-0000-4000-8000-00000000b001";

export const PRINCIPAL_A: Principal = {
  userId: "00000000-0000-4000-8000-00000000a002",
  tenantId: TENANT_A,
};
export const PRINCIPAL_B: Principal = {
  userId: "00000000-0000-4000-8000-00000000b002",
  tenantId: TENANT_B,
};

/**
 * A user who has just signed up: a valid `sub`, and no tenant, because the
 * tenant does not exist yet. This is the principal Story 1.5 hands to "create
 * a company", and the one an earlier version of the migration locked out.
 */
export const PRINCIPAL_FRESH: Principal = {
  userId: "00000000-0000-4000-8000-00000000c002",
  tenantId: null,
};

export const ORG_A = "00000000-0000-4000-8000-00000000a003";
export const ORG_B = "00000000-0000-4000-8000-00000000b003";

export type TableFixture = {
  schema: string;
  table: string;
  /**
   * The column a visible row must match. `tenant_id` for every ordinary
   * table; the two relations at the boundary key on something else, which is
   * exactly what their exemption is about -- and the sweep refuses a
   * non-`tenant_id` value from any relation that is not so exempted.
   */
  isolationColumn: string;
  /** The value that column must hold for rows this principal may see. */
  expected: (principal: Principal) => string;
  /** Rows for both tenants. Written as admin; order is dependency order. */
  seed: (client: Client) => Promise<void>;
};

export const FIXTURES: readonly TableFixture[] = [
  {
    schema: "public",
    table: "organizations",
    // Above the tenant boundary, so there is no tenant to key on. Ownership is
    // the key, and the policy says so.
    isolationColumn: "owner_user_id",
    expected: (principal) => principal.userId,
    seed: async (client) => {
      await client.query(
        `insert into public.organizations (id, name, owner_user_id, plan)
         values ($1, 'Grup Sejahtera', $2, 'core'),
                ($3, 'Grup Makmur',    $4, 'core')`,
        [ORG_A, PRINCIPAL_A.userId, ORG_B, PRINCIPAL_B.userId],
      );
    },
  },
  {
    schema: "public",
    table: "companies",
    // companies.id IS the tenant_id.
    isolationColumn: "id",
    expected: (principal) => principal.tenantId ?? "",
    seed: async (client) => {
      await client.query(
        `insert into public.companies (id, organization_id, legal_name, timezone)
         values ($1, $2, 'PT Sejahtera Abadi', 'Asia/Jakarta'),
                ($3, $4, 'PT Makmur Jaya',     'Asia/Makassar')`,
        [TENANT_A, ORG_A, TENANT_B, ORG_B],
      );
    },
  },
];

export const fixtureFor = (schema: string, table: string) =>
  FIXTURES.find((fixture) => qualify(fixture.schema, fixture.table) === qualify(schema, table));

/**
 * The assertion every isolation test goes through, and the reason it is a
 * function rather than two inline `expect` calls.
 *
 * The non-empty check comes **first**, and is not decoration. A table with RLS
 * enabled and no policy returns zero rows -- byte-identical to a fixture that
 * failed to seed. Asserting only "no foreign rows" passes in both cases, and
 * one of them is a table with no protection at all. Reproduced on 2026-08-27:
 * the RLS-missing table reported `visible=2 foreign=1 << LEAK` only after rows
 * existed; before that it passed vacuously.
 *
 * `tests/isolation-guards.test.ts` calls this with an empty array and requires
 * it to throw, so the ordering cannot be quietly dropped -- and that suite runs
 * in the `unit` project, so it needs no database and fires on every `npm test`.
 */
export function assertTenantPurity(
  rows: Array<Record<string, unknown>>,
  column: string,
  expected: string,
  label: string,
): void {
  if (rows.length === 0) {
    throw new Error(
      `${label}: the fixture is empty, so "no foreign rows" proves nothing. ` +
        `A table with RLS enabled and no policy returns exactly this. Seed it, or fix the policy.`,
    );
  }
  const foreign = rows.filter((row) => String(row[column]) !== expected);
  if (foreign.length > 0) {
    throw new Error(
      `${label}: LEAK -- ${foreign.length} of ${rows.length} visible rows carry a ${column} ` +
        `other than ${expected}: ${foreign.map((row) => String(row[column])).join(", ")}`,
    );
  }
}

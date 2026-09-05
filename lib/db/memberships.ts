import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The membership reads and the one membership write, in one place.
 *
 * Both go through `public.switch_company()`, and that is not a shortcut. The
 * `memberships` table grants `authenticated` SELECT and nothing else, and its
 * policy is keyed on the ACTIVE tenant — so a plain query returns only the
 * company the caller is already in, which is precisely the one company a
 * switcher does not need to be told about. The RPC is `security definer` for
 * that reason and is scoped to the caller's own rows by construction: every
 * statement in it filters on the JWT subject, and no argument names a user.
 *
 * Called with no company it lists; called with one it switches and then lists.
 * Two names here, one function there, because "which companies are mine" and
 * "make this one active" are the same privileged question and splitting them
 * would have meant a third `security definer` function for no new capability.
 *
 * Like `lib/db/companies.ts`, both take the client rather than building one,
 * and every call runs under the caller's own JWT. There is no elevated client
 * in this repository (CLAUDE.md rule 5).
 */

/** One company the signed-in user may act in. */
export type MembershipCompany = {
  readonly companyId: string;
  readonly legalName: string;
  readonly timeZone: string;
  /**
   * `organizations.plan`, for the plan line under the brand mark.
   *
   * It comes through the RPC rather than through `organizations` because
   * `organizations_owner` makes that row readable to the OWNER only -- so an
   * invited member holding a perfectly good tenant claim could not read the
   * plan of the company they are standing in.
   */
  readonly plan: string;
  /** The caller's role in THIS company, which differs between companies. */
  readonly role: string;
  /** Null for an external accountant, and null for everyone until Story 1.8. */
  readonly employeeId: string | null;
  /** ISO 8601, or null for a company never acted in. */
  readonly lastActiveAt: string | null;
};

/**
 * What `public.switch_company()` answers with.
 *
 * The list is ordered exactly as the access token hook orders memberships, so
 * `companies[0]` is the company the next token will carry. That is what lets
 * the switcher mark the current company without a second source of truth, and
 * an isolation test asserts the two orderings agree.
 */
export type MembershipList = {
  /** False when the call only listed. */
  readonly switched: boolean;
  readonly companies: readonly MembershipCompany[];
};

type SwitchCompanyRow = {
  switched: boolean;
  companies: Array<{
    company_id: string;
    legal_name: string;
    timezone: string;
    plan: string;
    role: string;
    employee_id: string | null;
    last_active_at: string | null;
  }> | null;
};

/**
 * The function returns `jsonb`, so PostgREST answers with the object itself
 * rather than a row set. There are no generated database types in this repo
 * yet, so the shape is asserted once, here, next to the SQL that produces it.
 */
async function callSwitchCompany(
  client: SupabaseClient,
  companyId: string | null,
): Promise<MembershipList> {
  const { data, error } = await client.rpc("switch_company", {
    p_company_id: companyId,
  });

  if (error) throw error;

  const row = data as SwitchCompanyRow | null;
  if (!row) throw new Error("switch_company returned nothing");

  return {
    switched: row.switched === true,
    companies: (row.companies ?? []).map((entry) => ({
      companyId: entry.company_id,
      legalName: entry.legal_name,
      timeZone: entry.timezone,
      plan: entry.plan,
      role: entry.role,
      employeeId: entry.employee_id,
      lastActiveAt: entry.last_active_at,
    })),
  };
}

/** Every company the caller holds an ACTIVE membership in. Writes nothing. */
export const listMembershipCompanies = (client: SupabaseClient): Promise<MembershipList> =>
  callSwitchCompany(client, null);

/**
 * Makes `companyId` the caller's active company.
 *
 * Refused — not silently ignored — when the caller holds no active membership
 * there. A switch that quietly does nothing leaves the session on the old
 * tenant while the screen says it moved, which is the one outcome a session
 * change must never have. The refusal arrives as Postgres `42501`.
 *
 * This only moves `last_active_at`. The token is reissued separately, by the
 * route handler, because a Server Component render cannot persist a cookie.
 */
export const switchCompany = (
  client: SupabaseClient,
  companyId: string,
): Promise<MembershipList> => callSwitchCompany(client, companyId);

/** Postgres' "insufficient privilege", which is how a refused switch arrives. */
export const SWITCH_REFUSED_CODE = "42501";

/** Whether a thrown value is the database refusing the switch. */
export const isSwitchRefused = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { code?: unknown }).code === SWITCH_REFUSED_CODE;

import { redirect } from "next/navigation";
import { cache } from "react";

import { getOwnedCompany, type OwnedCompany } from "@/lib/db/companies";
import {
  listMembershipCompanies,
  type MembershipCompany,
} from "@/lib/db/memberships";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Who is asking, and what they own — resolved once per request.
 *
 * `cache()` is React's per-request memo, not a cross-request cache. The layout
 * and the page inside it both need the company, and without this they would
 * ask Supabase twice for the same row on every render. Nothing here is shared
 * between requests, which is what makes memoising a *tenant's* row safe.
 */

/** Where a caller with no session is sent. */
export const SIGN_IN_PATH = "/signin";

/**
 * Auth-server answers that mean "this caller is not signed in".
 *
 * Everything else means the question could not be answered, which is a
 * different fact and must not be rendered as a sign-out.
 */
const NOT_SIGNED_IN_STATUSES = new Set([400, 401, 403]);

const meansSignedOut = (error: { status?: number; name?: string; code?: string }): boolean => {
  if (error.name === "AuthSessionMissingError") return true;
  if (error.code === "session_not_found" || error.code === "refresh_token_not_found") return true;
  return typeof error.status === "number" && NOT_SIGNED_IN_STATUSES.has(error.status);
};

/**
 * The authenticated user, or null.
 *
 * `getUser()` rather than `getSession()`: the session comes from a cookie the
 * browser controls, and only `getUser()` asks the auth server whether the
 * token is genuine. Reading identity from an unverified cookie is how an
 * authorisation decision ends up trusting its own input.
 *
 * **A transient failure is not a sign-out**, and the two used to be the same
 * line of code. `if (error) return null` turns "Supabase did not answer" into
 * "you are not logged in" on the hottest path in the product: a five-second
 * blip would bounce every signed-in user to the sign-in screen, where their
 * still-valid cookies would then redirect them back, and the only visible
 * symptom is a loop. So an answer that means *not signed in* returns null, and
 * anything else is rethrown — a 500 and an error boundary say "we are broken",
 * which is true, instead of "you are signed out", which is not.
 */
export const currentUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (meansSignedOut(error as { status?: number; name?: string; code?: string })) {
      return null;
    }
    throw error;
  }

  return data.user ?? null;
});

/**
 * The user, or a redirect to sign-in. Every screen behind the shell needs one.
 *
 * `/signin`, not `/signup`. Sending a returning user to signup is the exact
 * lockout the sign-in route was added to end: they would land on "check your
 * email" waiting for a mail that will never come, because signup for an
 * address that already exists deliberately sends nothing. Someone with no
 * account at all reaches signup from the link on that screen.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}

/**
 * The company this user owns, or null before registration.
 *
 * Null is a state the product genuinely has — between clicking the
 * confirmation link and submitting the registration form — not an error.
 */
export const currentCompany = cache(async (): Promise<OwnedCompany | null> => {
  const user = await currentUser();
  if (!user) return null;
  const supabase = await createServerSupabaseClient();
  return getOwnedCompany(supabase);
});

/**
 * The tenant context the access token carries.
 *
 * These three values are put into `app_metadata` by the Custom Access Token
 * Hook and are the whole reason authorization never queries `memberships` on a
 * request path (AD-25, NFR-15). Every RLS policy in the schema reads
 * `tenant_id` out of exactly this claim set; what is read here is the same
 * fact, for the one purpose the database cannot serve — putting a role on the
 * screen.
 *
 * `getClaims()`, not `getUser()`, and the difference is not cosmetic.
 * `getUser()` returns the auth server's *user record*, whose `app_metadata` is
 * whatever is stored on the row — it does not contain the hook's output,
 * because the hook writes into the token and nowhere else. Only the token
 * carries `tenant_id`, `role` and `employee_id`, and `getClaims()` is the call
 * that verifies and decodes it.
 *
 * Null everywhere is the honest answer for a session with no active
 * membership, and it is a state the product genuinely has: signup creates an
 * organization and a company, and nothing yet creates the founding membership,
 * so a freshly registered owner holds no tenant claim at all. Everything below
 * this line renders around that rather than pretending otherwise.
 */
export type TenantClaims = {
  /** `companies.id`. Null when no active membership resolved. */
  readonly tenantId: string | null;
  /** One of the six membership roles, or null. */
  readonly role: string | null;
  /** `employees.id`, null for an external accountant — and null until 1.8. */
  readonly employeeId: string | null;
};

const NO_CLAIMS: TenantClaims = { tenantId: null, role: null, employeeId: null };

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const currentClaims = cache(async (): Promise<TenantClaims> => {
  const user = await currentUser();
  if (!user) return NO_CLAIMS;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();

  // Same rule as `currentUser`: an answer that means "not signed in" is a
  // fact, and anything else is a failure that must not be rendered as one.
  // Failing closed here means no role on screen, never a role invented from a
  // stale value.
  if (error) {
    if (meansSignedOut(error as { status?: number; name?: string; code?: string })) {
      return NO_CLAIMS;
    }
    throw error;
  }

  const appMetadata = (data?.claims?.app_metadata ?? {}) as Record<string, unknown>;
  return {
    tenantId: asString(appMetadata.tenant_id),
    role: asString(appMetadata.role),
    employeeId: asString(appMetadata.employee_id),
  };
});

/**
 * The companies this user may act in, for the header's switcher.
 *
 * Goes through `public.switch_company()` rather than reading `memberships`,
 * because the list spans tenants by definition and the table's policy is keyed
 * on the active one. See `lib/db/memberships.ts`.
 *
 * An empty list is not an error — it is what every account looks like until a
 * membership exists for it — so the switcher renders the plain single-company
 * label rather than an empty menu.
 */
export const currentMembershipCompanies = cache(
  async (): Promise<readonly MembershipCompany[]> => {
    const user = await currentUser();
    if (!user) return [];
    const supabase = await createServerSupabaseClient();
    const { companies } = await listMembershipCompanies(supabase);
    return companies;
  },
);

/**
 * The company the session is actually acting in, resolved membership-first.
 *
 * This is where Story 1.5's `getOwnedCompany()` was supposed to be replaced,
 * and replacing it outright would have been wrong in both directions:
 *
 *   * keyed on OWNERSHIP alone (what shipped in 1.5), an invited member who
 *     holds a real `tenant_id` and owns nothing sees "No company yet" — and
 *     Epic 2's invitation flow is the story that creates them;
 *   * keyed on MEMBERSHIP alone, every account registered before the founding
 *     membership existed loses its header, because those accounts genuinely
 *     have no membership row until someone re-runs registration for them.
 *
 * So it is membership-first with an ownership fallback, and the fallback is a
 * dated thing rather than a permanent belt-and-braces. It stops being reachable
 * once every account has a founding membership; `source` says which path
 * answered so that "no account still resolves by ownership" is a question the
 * data can be asked rather than assumed.
 *
 * **The claim decides, not the list's order.** `companies[0]` is what the NEXT
 * token will carry; `claims.tenantId` is what THIS one carries, and it is the
 * value every row rendered below the header was filtered by. Picking the first
 * entry would put one company's name over another company's data for exactly
 * as long as a token outlives a switch.
 */
export type ActiveCompany = {
  readonly id: string;
  readonly legalName: string;
  readonly timeZone: string;
  readonly plan: string;
  /** Which path resolved it. `ownership` is the pre-membership fallback. */
  readonly source: "membership" | "ownership";
};

export const currentActiveCompany = cache(async (): Promise<ActiveCompany | null> => {
  const [claims, companies] = await Promise.all([
    currentClaims(),
    currentMembershipCompanies(),
  ]);

  const active = claims.tenantId
    ? companies.find((company) => company.companyId === claims.tenantId)
    : undefined;

  if (active) {
    return {
      id: active.companyId,
      legalName: active.legalName,
      timeZone: active.timeZone,
      plan: active.plan,
      source: "membership",
    };
  }

  // The fallback. Keyed on organization ownership, which is the only principal
  // that existed before this story — see `lib/db/companies.ts`.
  const owned = await currentCompany();
  if (!owned) return null;
  return {
    id: owned.id,
    legalName: owned.legalName,
    timeZone: owned.timeZone,
    plan: owned.plan,
    source: "ownership",
  };
});

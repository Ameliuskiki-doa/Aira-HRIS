import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompanyRegistrationInput } from "@/lib/validation/company";

/**
 * The only SQL the signup flow issues, and the only place it is written.
 *
 * Both functions take the client rather than building one. `lib/db` stays
 * free of `next/headers` that way, which is what lets the same query be
 * reached later from the worker, and it is also what makes the route handlers
 * testable without a network: the caller decides what a "client" is.
 *
 * Every read here runs under the caller's own JWT. There is no elevated client
 * in this repository (CLAUDE.md rule 5), so what these return is exactly what
 * RLS says the caller may see -- no post-filtering, and nothing to forget.
 */

/** The company row the shell renders, plus the plan that names the sidebar. */
export type OwnedCompany = {
  readonly id: string;
  readonly legalName: string;
  readonly timeZone: string;
  /** `organizations.plan` -- one of `free`, `core`, `payroll`. */
  readonly plan: string;
  readonly organizationId: string;
};

type OrganizationRow = {
  id: string;
  plan: string;
  companies: Array<{ id: string; legal_name: string; timezone: string }>;
};

/**
 * The company this user owns, or null before they have registered one.
 *
 * Keyed on organization ownership because that is the only principal that
 * exists today: a freshly confirmed user holds a `sub` and no tenant claim,
 * and `companies_visible_to_org_owner` is the policy written for exactly this
 * moment. Story 1.6 replaces ownership with membership, and this function is
 * where that change lands.
 *
 * Returns the first company of the first organization. One legal entity per
 * tenant and one organization per owner is the shape signup creates; the
 * ordering is stated so a second of either -- which the schema permits and
 * Story 1.6 will make reachable -- resolves the same way every time rather
 * than however Postgres happened to return the rows.
 */
export async function getOwnedCompany(
  client: SupabaseClient,
): Promise<OwnedCompany | null> {
  const { data, error } = await client
    .from("organizations")
    .select("id, plan, companies(id, legal_name, timezone)")
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<OrganizationRow[]>();

  if (error) throw error;

  const organization = data?.[0];
  const company = organization?.companies?.[0];
  if (!organization || !company) return null;

  return {
    id: company.id,
    legalName: company.legal_name,
    timeZone: company.timezone,
    plan: organization.plan,
    organizationId: organization.id,
  };
}

/** What `public.register_company()` answers with. */
export type RegistrationResult = {
  readonly organizationId: string;
  readonly companyId: string;
  /**
   * The name the company is *stored* under, which is not always the name that
   * was submitted. Two tabs registering at once serialise on the RPC's
   * advisory lock: the loser resumes the winner's registration and its own
   * input is discarded. Measured -- five concurrent losers each got
   * `created: false` and a 200 while their `legal_name` vanished. Returning
   * the stored name is what lets the screen say which company exists instead
   * of implying the submitted one does.
   */
  readonly legalName: string;
  /** False when the call resumed a registration that already existed. */
  readonly created: boolean;
};

type RegisterCompanyRow = {
  organization_id: string;
  company_id: string;
  legal_name: string;
  created: boolean;
};

/**
 * Creates the organization and its first company in one transaction.
 *
 * An RPC, not two inserts. PostgREST runs a function in a single transaction,
 * so a failed company insert takes the organization with it; two sequential
 * inserts leave a billing account stranded that nothing will ever clean up,
 * and `owner_user_id` has no unique constraint to stop the retry adding
 * another. The function is `security invoker`, so RLS still adjudicates every
 * row it writes -- see the migration for why that is the whole point.
 */
export async function registerCompany(
  client: SupabaseClient,
  input: CompanyRegistrationInput,
): Promise<RegistrationResult> {
  const { data, error } = await client.rpc("register_company", {
    p_legal_name: input.legalName,
    p_npwp: input.npwp,
    p_npp_bpjs_tk: input.nppBpjsTk,
    p_bpjs_kes_code: input.bpjsKesCode,
    p_timezone: input.timeZone,
  });

  if (error) throw error;

  // The function returns `jsonb`, so PostgREST answers with the object itself
  // rather than a row set. There are no generated database types in this repo
  // yet, so the shape is asserted here -- one place, next to the SQL that
  // produces it.
  const row = data as RegisterCompanyRow | null;
  if (!row) throw new Error("register_company returned nothing");

  return {
    organizationId: row.organization_id,
    companyId: row.company_id,
    legalName: row.legal_name,
    created: row.created,
  };
}

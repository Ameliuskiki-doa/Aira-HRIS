import { NextResponse } from "next/server";

import { logFailure, readJson, serverError, unauthorized } from "@/lib/api/boundary";
import { registerCompany } from "@/lib/db/companies";
import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { companyRegistrationSchema } from "@/lib/validation/company";

/**
 * Register a company, under the caller's own session and nothing else.
 *
 * The order of the two gates is the point. The session is checked **first**,
 * so a request with no session is refused before its body is even looked at
 * and before anything could reach the database; the schema is checked second,
 * so no unvalidated value is ever handed to `registerCompany`.
 *
 * The write itself is one RPC and therefore one transaction: a failure part
 * way through leaves nothing behind, and a retry resumes the registration
 * instead of creating a second organization. See `lib/db/companies.ts`.
 *
 * THEN THE TOKEN IS REISSUED, and that is not an optimisation.
 *
 * `register_company()` creates the caller's founding membership, which takes
 * them from belonging to no tenant to belonging to one. The tenant lives in
 * the ACCESS TOKEN -- the hook reads `memberships` at issuance and writes
 * `app_metadata.tenant_id` -- so the membership existing in the database
 * changes nothing about the session holding the old token. Without a reissue
 * the caller carries empty claims until the 15-minute TTL expires, and for
 * those fifteen minutes every tenant-scoped query returns nothing.
 *
 * It was shipped without one, and the failure was invisible for a reason worth
 * recording: the confirmation token is issued BEFORE the membership exists
 * (`/company/new` is where registration happens), so the first token of every
 * account is legitimately claimless; `UserBlock` omits a null role rather than
 * inventing one; and `currentActiveCompany()` falls back to organization
 * ownership, so the company name renders anyway. Three correct behaviours
 * combined to make a session that does not know its own tenant look exactly
 * like one that does. From Story 1.8 the symptom becomes a new user seeing an
 * empty employee list that heals itself in fifteen minutes -- which is close
 * to unreportable.
 *
 * The general rule, which `tests/tenant-context-reissue.test.ts` enforces:
 * **any route handler that changes which tenant the caller belongs to must
 * reissue the token before returning.** A route handler is the only place in
 * the App Router that both runs a mutation and may write a cookie.
 */
export async function POST(request: Request) {
  const supabase = await createRouteSupabaseClient();

  // `getUser()`, not `getSession()`. The session is read from a cookie the
  // browser controls; `getUser()` asks the auth server whether the token is
  // genuine, which is the difference between authentication and a claim.
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) {
    return unauthorized("Sign in before registering a company.");
  }

  const parsed = await readJson(request, companyRegistrationSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await registerCompany(supabase, parsed.data);

    // The reissue. `refreshSession()` exchanges the refresh token, which
    // re-runs the access token hook -- and the hook now finds the founding
    // membership this request just created. The route client's `setAll` does
    // not swallow, so the new cookies land on this response.
    //
    // Unconditional, including when `created` is false. A resumed registration
    // still calls `create_founding_membership()`, which is idempotent and
    // repairs an account whose company predates memberships -- so the resumed
    // path is exactly the one where a claim is most likely to be missing.
    //
    // A FAILED REISSUE IS A FAILED REGISTRATION. The rows are committed by
    // now and the next natural refresh would pick them up, but the caller is
    // still holding a token with no tenant in it. Answering 201 would send
    // them to a dashboard that cannot see their own company, so this fails
    // closed and the form keeps them where they are.
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      logFailure("api/companies:refreshSession", refreshError);
      return serverError();
    }

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (cause) {
    // The cause goes to the log, never to the caller. `cause.message` here is
    // Postgres and PostgREST text -- constraint names, column names, the shape
    // of the schema -- and this endpoint is reachable by anyone with an
    // account.
    // The cause goes to the log, never to the caller. `cause.message` here is
    // Postgres and PostgREST text -- constraint names, column names, the shape
    // of the schema -- and this endpoint is reachable by anyone with an
    // account.
    logFailure("api/companies:registerCompany", cause);
    return serverError();
  }
}

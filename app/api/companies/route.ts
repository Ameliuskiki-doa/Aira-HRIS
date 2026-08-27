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

import { NextResponse } from "next/server";

import {
  forbidden,
  logFailure,
  readJson,
  serverError,
  unauthorized,
} from "@/lib/api/boundary";
import { isSwitchRefused, switchCompany } from "@/lib/db/memberships";
import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { companySwitchSchema } from "@/lib/validation/membership";

/**
 * Switch the active company — which is a session change, not a filter.
 *
 * Three steps, and the order of the first two is the same one every mutation
 * in this repo uses: the session is checked **first**, so a request with no
 * session is refused before its body is read; the schema is checked second, so
 * no unvalidated value reaches the database.
 *
 * The third step is what makes this route exist at all. `switch_company()`
 * moves `last_active_at`, and nothing else — the tenant claim lives in the
 * access token, so until a NEW token is issued the session is still acting in
 * the old company. **A Server Component render cannot persist a cookie** (Next
 * forbids writing one once rendering has begun, which is why
 * `lib/supabase/server.ts` swallows `setAll`), so a refresh triggered from a
 * render is computed and thrown away. A route handler can write, and this is
 * the only place in the switch path that can. `lib/supabase/proxy.ts` refreshes
 * only on expiry, so it does not race this explicit call.
 *
 * FAILING THE REISSUE IS A FAILED SWITCH, and is reported as one. The database
 * write has already happened at that point and the next natural refresh would
 * pick it up — but the caller is still holding the old tenant, so answering
 * "done" would put the previous company's data on a screen labelled with the
 * new company's name. Fail closed; the client stays where it is and says so.
 */
export async function POST(request: Request) {
  const supabase = await createRouteSupabaseClient();

  // `getUser()`, not `getSession()`. The session is read from a cookie the
  // browser controls; `getUser()` asks the auth server whether the token is
  // genuine, which is the difference between authentication and a claim.
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) {
    return unauthorized("Sign in before switching company.");
  }

  const parsed = await readJson(request, companySwitchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await switchCompany(supabase, parsed.data.companyId);
  } catch (cause) {
    // The database refuses a company the caller holds no active membership in,
    // and it refuses rather than reporting zero rows so that this branch
    // exists at all. It is a 403 and not a 500: the request was well formed
    // and the answer is no.
    if (isSwitchRefused(cause)) {
      logFailure("api/memberships/switch:refused", cause);
      return forbidden("You do not have access to that company.");
    }
    // The cause goes to the log, never to the caller: `cause.message` here is
    // Postgres and PostgREST text — constraint names, column names, the shape
    // of the schema — and this endpoint is reachable by anyone with an account.
    logFailure("api/memberships/switch:switchCompany", cause);
    return serverError();
  }

  // The reissue. `refreshSession()` exchanges the refresh token, which is what
  // re-invokes the access token hook — and the hook now resolves the
  // membership whose `last_active_at` was just moved. The route client's
  // `setAll` does not swallow, so the new cookies land on this response.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    logFailure("api/memberships/switch:refreshSession", refreshError);
    return serverError();
  }

  // Where the client must go next, decided here rather than in the component.
  // Returning to the dashboard root is not cosmetic: a deep link into the
  // previous company must not survive a session change, and the surest way to
  // guarantee that is to not be on it any more.
  return NextResponse.json({ redirectTo: "/" }, { status: 200 });
}

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Keeps the session alive across a 15-minute access token (AD-9).
 *
 * `proxy.ts`, not `middleware.ts`. Next 16 deprecated the `middleware` file
 * convention and renamed it to `proxy` — `next build` prints the notice and
 * offers a codemod. Nothing about the behaviour changed; the file name and the
 * exported function name did. Written directly rather than run through the
 * codemod, because the file is fifteen lines and the codemod would also have
 * had to be reviewed.
 *
 * The whole reason it exists is in `lib/supabase/proxy.ts`: a Server Component
 * render cannot persist a refreshed token, so without a pass that can, a user
 * is signed out mid-form. This is the only place in the App Router that both
 * runs before every render and may write cookies.
 *
 * It refreshes and nothing else. Authorization stays in
 * `app/(app)/layout.tsx`, next to the route that knows what it needs.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files.
     *
     * Stated as one negative lookahead rather than a list of routes to
     * include: an include-list silently stops covering a route added later,
     * and the failure mode of *that* is a page whose session quietly stops
     * refreshing. Cheaper to exclude the things that were never going to
     * carry a cookie worth refreshing.
     *
     * `_next/static` and `_next/image` are the framework's own asset routes;
     * `favicon.ico` and the image extensions are ours.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};

import { AppShellRoute } from "@/components/shell/app-shell-route";
import {
  PENDING_SHELL_COMPANY,
  shellCompanyFor,
  shellUserFor,
} from "@/components/shell/fixtures";
import {
  currentActiveCompany,
  currentClaims,
  currentMembershipCompanies,
  requireUser,
} from "@/lib/auth/session";

/**
 * The application shell as a route-group layout.
 *
 * `(app)` adds no segment to any URL, so `app/(app)/page.tsx` is still `/`.
 * The group exists so that routes which must *not* wear the shell — signup and
 * the confirmation callback — can sit in a sibling group.
 *
 * Everything under this layout requires a session. That is stated once, here,
 * rather than per page: a route that forgets the check is the failure mode
 * worth designing out, and there is no screen in this group that means
 * anything without a tenant behind it.
 *
 * Three reads, all under the caller's own JWT and all memoised per request by
 * `cache()`, so the layout and the page inside it see one consistent answer:
 *
 *   the claims     `app_metadata` — the tenant and role the token carries
 *   the companies  `switch_company()`, the switcher's list
 *   the company    the entry matching the tenant CLAIM, falling back to
 *                  organization ownership for accounts registered before the
 *                  founding membership existed. See `currentActiveCompany`.
 *
 * The user's role comes from the token and NOT from a query. That is the
 * point of putting it in claims: authorization never reads `memberships` on a
 * request path (AD-25, NFR-15), and a screen that queried the table to render
 * a role would quietly reintroduce the lookup the claim exists to remove.
 *
 * Between confirming an email and submitting the registration form there is
 * genuinely no company, and the shell says so rather than borrowing a
 * placeholder name.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [company, claims, companies] = await Promise.all([
    currentActiveCompany(),
    currentClaims(),
    currentMembershipCompanies(),
  ]);

  return (
    <AppShellRoute
      company={
        company
          ? shellCompanyFor(company, companies.length)
          : PENDING_SHELL_COMPANY
      }
      user={shellUserFor({
        // Null until Story 1.8 creates `employees`; the branch that consumes a
        // real name is written in `shellUserFor` and is unreachable until then.
        fullName: null,
        // `auth.users.email` is optional in Supabase's type and never absent
        // here: signup is by email (AD-7) and there is no other way in.
        email: user.email ?? "",
        role: claims.role,
      })}
      companies={companies.map((membership) => ({
        companyId: membership.companyId,
        legalName: membership.legalName,
      }))}
      activeCompanyId={claims.tenantId}
    >
      {children}
    </AppShellRoute>
  );
}

import { AppShellRoute } from "@/components/shell/app-shell-route";
import {
  PENDING_SHELL_COMPANY,
  shellCompanyFor,
} from "@/components/shell/fixtures";
import { currentCompany, requireUser } from "@/lib/auth/session";

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
 * The company is read here and passed down, so the header renders the real
 * legal name and the real timezone. Between confirming an email and submitting
 * the registration form there is genuinely no company, and the shell says so
 * rather than borrowing a placeholder name.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  const company = await currentCompany();

  return (
    <AppShellRoute
      company={company ? shellCompanyFor(company) : PENDING_SHELL_COMPANY}
    >
      {children}
    </AppShellRoute>
  );
}

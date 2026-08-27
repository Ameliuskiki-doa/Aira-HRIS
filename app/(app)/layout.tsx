import { AppShellRoute } from "@/components/shell/app-shell-route";

/**
 * The application shell as a route-group layout.
 *
 * `(app)` adds no segment to any URL, so `app/(app)/page.tsx` is still `/`.
 * The group exists so that routes which must *not* wear the shell — sign-up
 * and the tenant-resolution error state, both later stories — can sit in a
 * sibling group without unwinding anything built here.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShellRoute>{children}</AppShellRoute>;
}

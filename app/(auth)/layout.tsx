import type { ReactNode } from "react";

import { Brand } from "@/components/shell/brand";

/**
 * The frame for the screens that exist *before* a tenant does.
 *
 * `(auth)` adds no segment to any URL, so `/signup` is still `/signup`. The
 * group exists so signup can sit outside the application shell — the shell
 * renders a company switcher and a plan line, and at this point in the flow
 * there is no company and no plan to render.
 *
 * `Brand` is reused rather than reinvented, with the plan line saying what is
 * true here: nothing has been chosen yet.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="auth-shell"
      className="text-dense flex min-h-svh flex-1 flex-col items-center justify-center gap-6 px-5 py-10"
    >
      <Brand planLabel="Get started" variant="drawer" />
      <main
        id="main-content"
        className="bg-card border-border w-full max-w-100 rounded-xl border p-6 shadow-sm"
      >
        {children}
      </main>
    </div>
  );
}

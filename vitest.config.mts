import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/** `ROOT` keeps its trailing slash; an alias target must not have one. */
const ROOT_NO_SLASH = ROOT.replace(/\/$/, "");

/**
 * Suites whose disappearance must not read as success. A renamed or deleted
 * boundary suite would otherwise leave `npm test` green while nothing checks
 * that lib/domain is still pure.
 */
export const REQUIRED_SUITES = [
  "tests/boundary.test.ts",
  "tests/theme.test.ts",
  // The DOM harness. Two files, and both have to be here. The smoke suite is
  // the only thing that exercises a real browser; the registration suite is
  // the only thing that notices if the browser project is unregistered, and it
  // runs in `unit`, so deleting either one has to be as loud as deleting a
  // boundary suite — including under `--project unit`.
  "tests/browser/harness.test.tsx",
  "tests/harness-registration.test.ts",
  // The application shell (Story 1.3). It is the only thing that measures the
  // responsive bands, the focus trap, the theme writer and the accessible
  // names of the icon-only controls; losing it silently would leave the whole
  // frame unverified.
  "tests/browser/shell.test.tsx",
  // The tenant isolation harness (Story 1.4). docs/07 calls this the most
  // important test in the codebase, and it is the one suite `npm test` does
  // not run -- so nothing else would notice it vanishing. Listing it here
  // makes deleting any part of it fail every Vitest invocation, `npm test`
  // included, not just the isolation project nobody runs locally.
  "tests/isolation/catalog-sweep.test.ts",
  "tests/isolation/tenant-purity.test.ts",
  // Signup's only write (Story 1.5). The only thing that forces the company
  // insert to fail and then proves no organization survived it, and the only
  // thing that proves a retry resumes instead of creating a second one.
  // Neither property is visible to the sweep or to the purity suite.
  "tests/isolation/signup-rpc.test.ts",
  // The access token hook (Story 1.6). The hook runs on every sign-in AND
  // every refresh, has two seconds, and gets no retry — so a raise in it is
  // not a bad row, it is every signed-in user evicted within the token TTL.
  // This is the only thing that proves it is total, that it re-validates
  // `is_active`, that it STRIPS an inbound tenant_id rather than passing it
  // through, and that nothing but supabase_auth_admin may execute it.
  "tests/isolation/access-token-hook.test.ts",
  // The founding membership (Story 1.6, added on the owner's decision). The
  // only thing that proves a fresh signup now produces a tenant a session can
  // enter -- asserted as a BEFORE and an AFTER, so it cannot pass against a
  // product where signup had always been complete -- and the only thing that
  // proves the third `security definer` function cannot be aimed at a company
  // the caller does not own, while `memberships` keeps zero write surface.
  "tests/isolation/founding-membership.test.ts",
  // The membership write surface and company switching (Story 1.6). The only
  // thing that proves no request path can write `tenant_id`, write `role`, or
  // move a colleague's `last_active_at` — each proved by attempting it, and
  // each measured as REFUSED rather than as zero rows.
  "tests/isolation/membership-switching.test.ts",
  // What a request may write, asked as an attacker rather than as the
  // application (Story 1.5 hardening). The only thing that proves the paid
  // tier is not self-service and that the Zod length bounds are also the
  // database's. Both holes were reproduced against a live container.
  "tests/isolation/write-surface.test.ts",
  // The signup boundary (Story 1.5), in `unit` because it needs no database:
  // the session gate, the Zod gate, and the closed time-zone set. Losing it
  // would leave every route handler in the product unguarded and green.
  "tests/signup-boundary.test.ts",
  // The company-switch boundary (Story 1.6), in `unit` because it needs no
  // database. The only thing that proves the token is reissued as part of the
  // switch rather than after it, that a refusal is a 403 and not a 500, and
  // that no Postgres text reaches a caller on the one endpoint that changes
  // which tenant a session acts in.
  "tests/switch-company-boundary.test.ts",
  // The elevated-key prohibition (Story 1.5). CLAUDE.md rule 5 had no
  // machinery at all before this suite -- recorded in deferred-work as the
  // invariant that got none while core purity got sixty denials.
  "tests/supabase-clients.test.ts",
  // The front door (Story 1.5 hardening). Redirect safety, host trust,
  // cross-site intent, and what a failure tells the caller. Every case in it
  // was a reproduced defect that needed no malformed body, no invalid schema
  // and no missing session -- which is why the suites built around those three
  // were green and blind.
  "tests/request-surface.test.ts",
  // The session refresh (Story 1.5). The only thing that proves an expired
  // access token leaves the proxy pass refreshed *and persisted* -- the half a
  // Server Component render structurally cannot do. With a 900s TTL (AD-9) its
  // absence is a user thrown out mid-form, and a middleware that refreshed
  // nothing would look identical from the outside.
  "tests/session-refresh.test.ts",
  // The two halves of the harness that need no database, and therefore run in
  // `unit` on every `npm test`: the guard that notices the isolation *project*
  // being unregistered or dropped from CI, and the pure functions the sweep's
  // detections are built out of.
  "tests/isolation-registration.test.ts",
  "tests/isolation-guards.test.ts",
];

for (const suite of REQUIRED_SUITES) {
  if (!existsSync(new URL(suite, import.meta.url))) {
    throw new Error(
      `Required test suite is missing: ${suite}. ` +
        `If it moved, update REQUIRED_SUITES in vitest.config.mts deliberately.`,
    );
  }
}

export default defineConfig({
  test: {
    // An empty suite list is not a failure on its own; the REQUIRED_SUITES
    // check above is what makes a vanished suite fail.
    passWithNoTests: true,
    projects: [
      {
        root: ROOT,
        // Route handlers and the modules under them import through the `@/`
        // alias, like the rest of the application. Without this the unit
        // project cannot import the code it is meant to be testing, and the
        // alternative -- relative imports in `app/` alone -- would make the
        // shipped code differ from every other file in the repo.
        resolve: {
          alias: { "@": ROOT_NO_SLASH },
        },
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          // `tests/browser/**` is excluded by path, not left to the .ts/.tsx
          // extension difference. Without it a future `tests/browser/x.test.ts`
          // is collected here and runs against no DOM at all — passing or
          // failing for reasons that have nothing to do with the code.
          exclude: [
            "tests/isolation/**",
            "tests/browser/**",
            "node_modules/**",
            ".next/**",
          ],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
      {
        root: ROOT,
        // The Node projects never needed this: they import by relative path.
        // A component pulled in from `components/ui` imports `@/lib/utils`, so
        // the browser project has to resolve the tsconfig alias itself.
        resolve: {
          alias: { "@": ROOT_NO_SLASH },
        },
        // On a cold Vite cache the browser project discovers these mid-run,
        // re-optimises, and reloads the page under the running test — which
        // Vitest reports as a failed import, not a retry. Naming them up front
        // is the difference between a green first CI run and a flake.
        optimizeDeps: {
          include: [
            "react",
            "react/jsx-dev-runtime",
            "react/jsx-runtime",
            "react-dom",
            "react-dom/client",
            "@testing-library/react",
            "@base-ui/react/dialog",
            "@base-ui/react/button",
            // Added with the shell. Each of these is a separate entry point of
            // @base-ui/react, and Vite optimises entry points independently:
            // discovering one mid-run does not just reload the page, it hands
            // the newly optimised chunk its own copy of React and every hook
            // inside it throws "Invalid hook call". Measured, not guessed.
            "@base-ui/react/avatar",
            "@base-ui/react/drawer",
            // The company switcher's panel (Story 1.6).
            "@base-ui/react/menu",
            "@base-ui/react/separator",
            "@base-ui/react/tooltip",
            // The shell's icons and its links.
            "@phosphor-icons/react/ssr",
            "next/link",
            // The shell suite renders the route adapter against the real
            // `useSelectedLayoutSegment`, which means the real router context.
            "next/navigation",
            "next/dist/shared/lib/app-router-context.shared-runtime",
            "class-variance-authority",
            "clsx",
            "lucide-react",
            "tailwind-merge",
          ],
        },
        test: {
          name: "chromium",
          // `.tsx` only, and `unit` also excludes this directory by path, so
          // the two collections cannot overlap in either direction.
          include: ["tests/browser/**/*.test.tsx"],
          // Not the Node projects' 300s. That number was chosen for suites that
          // compile CSS; here it only means a browser that fails to launch
          // burns five minutes of a twenty-minute CI job before saying so. The
          // hook budget stays larger because it covers the cold-start launch on
          // a loaded runner; the tests themselves are milliseconds.
          testTimeout: 20_000,
          hookTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            // Vitest 4: `provider: "playwright"` as a string throws. The
            // provider is a factory from a separate package.
            provider: playwright({
              // The state the shell's motion criteria will be asserted against,
              // pinned once here so no later suite has to remember it. Note it
              // is a media-feature only: nothing in `app/globals.css` or
              // tw-animate-css branches on `prefers-reduced-motion` today, so
              // it does not currently shorten any animation. What makes the
              // Esc-close assertion robust is waiting for the popup to leave
              // the DOM, not a guess about how long the exit takes.
              contextOptions: { reducedMotion: "reduce" },
            }),
            // Nothing here is a visual test, and a failure screenshot is just
            // an artifact to clean up in CI.
            screenshotFailures: false,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        root: ROOT,
        test: {
          name: "isolation",
          // Needs a Postgres 17 to talk to, so it stays out of the default
          // `npm test` run. `npm run db:isolation:up` brings one up locally;
          // CI uses a `services: postgres` container. Either way the setup
          // below drops, migrates and seeds it, so the two substrates are
          // entered through exactly one code path.
          include: ["tests/isolation/**/*.test.ts"],
          globalSetup: ["tests/isolation/globalSetup.ts"],
          // ONE FILE AT A TIME. Every suite in this project talks to the same
          // database, and several of them write to it -- `write-surface`
          // registers and deletes a company, `membership-switching` seeds and
          // deletes membership rows. Run in parallel, those writes land inside
          // another file's read: `tenant-purity` counts rows as the admin,
          // then counts what a tenant can see, and an insert between the two
          // makes `visible < total` false. Reproduced as exactly that failure
          // on `memberships`, and the same race was latent on `companies`
          // before it. The project takes about two seconds; there is nothing
          // to buy by racing it.
          fileParallelism: false,
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});

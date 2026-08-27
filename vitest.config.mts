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
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});

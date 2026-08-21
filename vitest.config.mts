import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Suites whose disappearance must not read as success. A renamed or deleted
 * boundary suite would otherwise leave `npm test` green while nothing checks
 * that lib/domain is still pure.
 */
const REQUIRED_SUITES = ["tests/boundary.test.ts", "tests/theme.test.ts"];

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
          exclude: ["tests/isolation/**", "node_modules/**", ".next/**"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
      {
        root: ROOT,
        test: {
          name: "isolation",
          // Story 1.4 fills this in; it needs a local Supabase stack, so it
          // stays out of the default `npm test` run.
          include: ["tests/isolation/**/*.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});

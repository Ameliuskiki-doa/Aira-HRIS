import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import {
  boundaryConfigs,
  FIXTURE_IGNORES,
  LINTING_FIXTURES,
} from "./eslint.boundary.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Planning artifacts and tooling that carry no application source.
    "_bmad/**",
    "_bmad-output/**",
    // Boundary-test fixtures. They exist only while tests/boundary.test.ts is
    // running, and are deliberately full of violations — a run killed
    // mid-test must not be able to break the next lint.
    ...(LINTING_FIXTURES ? [] : FIXTURE_IGNORES),
  ]),
  // AD-2 — core purity. See eslint.boundary.mjs.
  ...boundaryConfigs,
]);

export default eslintConfig;

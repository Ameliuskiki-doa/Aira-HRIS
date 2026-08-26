# Deferred Work

Findings surfaced by review that are real but not caused by, or not in scope for, the story that surfaced them.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: Nothing anywhere enforces the `service_role` prohibition, and no lint rule keeps `lib/db` out of `app/` or `app/` out of `worker/`.
  evidence: Verified by grep — zero occurrences of `service_role` in any lint rule, CI step or test, and zero cross-layer file globs beyond `lib/domain`. CLAUDE.md rule 5 and AD-16 make this the invariant whose violation is a cross-tenant leak. Story 1.1 built 60 denials and 70 tests for core purity while the higher-stakes invariant has none. A reviewer put it as: the invariant that got machinery is not the one that ends the business.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `npm run test:isolation` exits 0 over an empty directory, with no vanished-suite guard.
  evidence: `REQUIRED_SUITES` in `vitest.config.mts` protects only `tests/boundary.test.ts`. docs/07 calls tenant isolation "the most important test in the codebase". Story 1.4 owns the suite and must extend the guard when it lands.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: docs/07 specifies the isolation suite at `tests/isolation.test.ts`; the scaffold created `tests/isolation/**` and excludes it from CI.
  evidence: Doc and tree disagree from day one. Recorded only in README and a Vitest comment, not in the document the project treats as the contract.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `app/page.tsx` ships the create-next-app template — English copy and Vercel marketing links under `<html lang="id">`.
  evidence: CLAUDE.md's definition of done requires Indonesian user-facing strings. The spec's Never list scoped UI work to Stories 1.2–1.3, so this is deliberate deferral rather than an oversight, but it is user-facing English shipping today.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `AD-*` identifiers are cited throughout the code but resolve to nothing a code reader can reach.
  evidence: `.env.example` cites AD-4/16/20 and `eslint.boundary.mjs` cites AD-2; no `AD-` identifier appears under `docs/`. The spine lives in `_bmad-output/planning-artifacts/`, which CLAUDE.md's "Where things are" map does not list.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `next.config.ts` is the untouched placeholder — no security headers, no CSP, no `poweredByHeader: false`, no `images.remotePatterns` for the R2 origin.
  evidence: A multi-tenant payroll product storing NIK, salary and attendance photos ships with framework defaults.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: One root tsconfig with DOM lib and `jsx: react-jsx` also governs `worker/`, and `target` is the starter's ES2017.
  evidence: A long-lived Node worker is typechecked with browser types; `window`/`document` type-resolve inside `lib/domain`, where only lint stops them. No `worker` script exists in package.json either.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: No formatter, no format gate, no `.editorconfig`.
  evidence: A tree that deliberately mixes generated starter files with hand-written ones is exactly where formatting drift starts, and a scaffold commit is the cheapest moment to fix it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: CI runs the full job twice for a push to a branch with an open PR, and lints the tree twice per job.
  evidence: `on: push` and `on: pull_request` carry no branch filters and there is no `concurrency` cancel; `npm test` spawns a second full-tree `npm run lint` inside the boundary suite.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: Every CI build depends on network access to Google Fonts via `next/font/google` (Geist).
  evidence: A build-time external dependency that will fail closed on a network blip, never explicitly decided.

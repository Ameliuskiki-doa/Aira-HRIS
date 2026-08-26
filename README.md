# Aira-HRIS

Multi-tenant HRIS + simple payroll SaaS for Indonesian SMBs. Read `CLAUDE.md`
before changing anything; the non-negotiable rules live there and the planning
contract lives in `docs/`.

## Requirements

- Node.js >= 22.12 (the pg-boss floor; see `engines` in `package.json`)
- npm (one lockfile, `package-lock.json`)

## Getting started

```bash
npm ci
npm run dev
```

## Checks

| Command | What it does |
|---|---|
| `npm run lint` | ESLint over the whole tree, including the `lib/domain` purity boundary |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm test` | Vitest, database-free suites only |
| `npm run test:isolation` | Vitest, `tests/isolation/**` — needs a local Supabase stack; not wired up yet |
| `npm run build` | Production build; this is what catches malformed CSS |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, `npm test` and build on
every push and pull request. `npm run test:isolation` is not in CI yet — Story
1.4 adds the stack and the gate.

## Layout

```text
app/                    Next.js App Router; route handlers will live in app/api
app/globals.css         the only stylesheet so far — starter Tailwind setup
public/                 static assets served at the site root
lib/domain/             pure core — no I/O, no framework, lint-enforced (empty)
lib/db/                 the only place SQL will live (empty)
worker/jobs/            pg-boss job handlers (empty)
styles/                 reserved for the vendored design tokens and the
                        --ui-* layer; Story 1.2 fills it (empty)
supabase/migrations/    forward-only; each table migration carries its own RLS (empty)
tests/golden/           payroll fixtures, no database (empty)
tests/isolation/        tenant isolation suite; Story 1.4 fills it (empty)
tests/boundary.test.ts  proves the lib/domain purity boundary is enforced
eslint.boundary.mjs     the boundary itself, as data both ESLint and the suite read
```

`lib/` sits at the repository root on purpose — there is no `src/`.

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
| `npm run test:isolation` | Vitest, `tests/isolation/**` — the tenant isolation gate; starts a local Postgres 17 first |
| `npm run build` | Production build; this is what catches malformed CSS |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, `npm test` and build on
every push and pull request, and runs the isolation gate alongside them in a
second job with a `postgres:17` service container. Both jobs are blocking.

### The isolation gate

`npm run test:isolation` needs a Postgres 17 and nothing else. It starts one in
Docker for you (`aira-isolation-db`, port 54329), drops the schema, applies
every migration with the pinned Supabase CLI, seeds two tenants, then sweeps
the catalog and asserts what a request can actually see:

```bash
npm run test:isolation      # brings the database up, then runs the suite
npm run db:isolation:down   # remove the container when you are done
```

Point `ISOLATION_DATABASE_URL` at a Postgres you already have to skip Docker —
that is exactly what CI does. The URL needs `?sslmode=disable`; Supabase CLI
2.116 negotiates TLS by default and fails against a stock container.

The property it enforces is not a checklist: **no surface in `public` may
return a row belonging to another tenant, by any means.** So it sweeps views,
materialized views and foreign tables as well as tables, and checks
`security definer` functions and policy roles — three leak surfaces that
satisfy "RLS enabled, policy present" and still return everything. See
`docs/07-conventions-and-testing.md` for the rules per relation kind.

The substrate is bare Postgres, **not** `supabase start`: 31s cold against
541s, 161MB against ~8.5GB across twelve containers, and every criterion the
suite checks is a catalog or SQL fact. The trade is that bare Postgres grants
more than Supabase does, so a migration green here can still fail to apply to
the real project — recorded in
`_bmad-output/implementation-artifacts/deferred-work.md`, mitigated by keeping
migrations portable (nothing outside `public`, role creation guarded).

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
supabase/migrations/    forward-only; each table migration carries its own RLS
tests/golden/           payroll fixtures, no database (empty)
tests/isolation/        the tenant isolation gate — catalog sweep + purity
tests/isolation-registration.test.ts
                        runs in `unit`; fails if the gate stops being run
tests/isolation-guards.test.ts
                        runs in `unit`; the gate's own pure functions, no database
scripts/isolation-db.mjs  the Postgres 17 the gate runs against
tests/boundary.test.ts  proves the lib/domain purity boundary is enforced
eslint.boundary.mjs     the boundary itself, as data both ESLint and the suite read
```

`lib/` sits at the repository root on purpose — there is no `src/`.

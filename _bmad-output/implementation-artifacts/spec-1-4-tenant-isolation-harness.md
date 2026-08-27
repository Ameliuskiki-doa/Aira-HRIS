---
title: 'Story 1.4 — Tenant isolation harness'
type: 'feature'
created: '2026-08-27'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/data-model.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing stops a cross-tenant leak. `supabase/migrations/` is empty, `tests/isolation/` holds a `.gitkeep`, and no workflow step runs the isolation project — so the rule the whole product rests on is enforced by nobody. A leak found by a client ends the business; a leak found by CI costs a morning.

**Approach:** The first migration, and the blocking gate that proves it. RLS enabled, forced, policy and `tenant_id`-leading index in the same file that creates each table, plus a catalog sweep that discovers tables rather than trusting a list — running against a bare Postgres container in CI, on every push.

## Boundaries & Constraints

**Always:** RLS `enable` **and** `force`, a policy, and a `tenant_id`-leading index in the *same migration* that creates a table. Policies wrap the claim as `(select public.tenant_id())`. The sweep discovers tables from the catalog, never a hand-maintained list. Every isolation assertion proves its fixture is non-empty **first**. Migrations are forward-only.

**Ask First:** Any change to the `unit` or `chromium` Vitest projects. Any new allowlisted exemption beyond the three named below. Any use of `service_role`, anywhere.

**Never:** No `service_role` in any path. No cross-tenant bypass role. No `supabase start` in CI. No employee, payroll or attendance tables — this story creates `organizations` and `companies` only. No application code, no UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Read as tenant A | fixtures for two tenants | only A's rows, and the fixture is proven non-empty before that is claimed | N/A |
| Write across tenants | A inserts a row carrying B's `tenant_id` | rejected by the policy | error, not a silent no-op |
| No claim set | no `request.jwt.claims` | zero rows | fails closed |
| Table without RLS | added to `public` | sweep reports it; CI fails | must not pass vacuously on an empty table |
| RLS on, no policy | added to `public` | sweep reports it — a purity test cannot, because it returns zero rows and looks like an empty fixture | N/A |
| Unwrapped policy | `using (tenant_id = public.tenant_id())` | sweep reports it — it isolates correctly, so only the catalog sees it | N/A |
| Missing leading index | index whose first column is not `tenant_id` | sweep reports it | N/A |
| Above the boundary | `organizations`, `companies` | exempt from the `tenant_id` **column** rule only; still require RLS, force, and a policy | N/A |

</frozen-after-approval>

## Code Map

Measured on 2026-08-27 in a scratch container. Every number was run.

- **Substrate: bare `postgres:17`, not `supabase start`.** Cold 31s vs 541s; warm 0.66s vs 27s; 161MB compressed vs ~8.5GB across 12 containers; a full drop→migrate→sweep cycle 2.22s vs 15–26s. All five acceptance criteria are catalog and SQL facts, and bare Postgres proved every one — including role-tier isolation inside a tenant. `ltree`, `pgcrypto`, `btree_gist`, `pg_trgm` and `gen_random_uuid()` are all in the stock image.
- **`supabase migration up --db-url` runs against bare Postgres** — measured 1.31s, and it writes `supabase_migrations.schema_migrations`, so it is the real runner rather than a `psql -f` approximation. **Requires `?sslmode=disable`** or CLI 2.116 fails with a TLS error.
- **`public.tenant_id()`, not `auth.`.** `create function auth.tenant_id()` **fails** under `supabase db reset`: `permission denied for schema auth (SQLSTATE 42501)` — migrations run as `postgres`, `has_schema_privilege('postgres','auth','CREATE')` is false, the schema is owned by `supabase_admin`. Reproduced twice; the same DDL applies cleanly in `public`. Every project document was repointed on 2026-08-27.
- **Bare Postgres is *more permissive* than Supabase.** A migration green on the gate can still fail on the real project — the defect above is exactly that. So keep migrations portable: creating `authenticated`/`anon` fails on Supabase with `role already exists`, and must be guarded with `do $$ … $$`.
- **`set local role authenticated` is required.** A superuser bypasses RLS *even with FORCE*. Verified over TCP with a non-superuser login role (`authenticator` → `set local role authenticated`, `usesuper=f`). Tenant context is `set local request.jwt.claims = '{"app_metadata":{"tenant_id":"…"}}'` inside the transaction.
- **The `(select …)` rule holds, measured.** 500k rows, 375k matching: wrapped 30.5–37.1ms, unwrapped 229.9–234.0ms — **~7.4×**, identical buffers, pure CPU. Plans show why: `Filter: (tenant_id = (InitPlan 1).col1)` versus the whole `current_setting(...)` expression inlined per row. **But it is scan-shaped only** — on a selective index lookup both fold into the Index Cond and the unwrapped form was marginally *faster* (0.040ms vs 0.139ms). Record that nuance; do not restate the 10–100× claim.
- **Unwrapped policies are detectable.** `pg_policies.qual` renders `(tenant_id = ( SELECT public.tenant_id() AS tenant_id))` against `(tenant_id = public.tenant_id())`. Strip the wrapped literal, then flag any remaining bare call. Applies to `polqual` and `polwithcheck` alike.
- **Three findings the sweep catches and a purity test cannot**, each reproduced: an unwrapped policy still isolates correctly (`foreign=0`); RLS-with-no-policy returns zero rows, **indistinguishable from an empty fixture**; and a table with RLS missing passes vacuously until rows exist — it only reported `visible=2 foreign=1 << LEAK` after inserts. This is the empirical case for the non-empty fixture assertion.
- `vitest.config.mts:148` -- the `isolation` project exists, includes `tests/isolation/**/*.test.ts`, and is excluded from `npm test` by design. `tests/isolation/` holds only `.gitkeep`.
- `.github/workflows/ci.yml` -- **runs no isolation step at all.** `npm test` is `--project unit --project chromium`. The acceptance criterion "CI fails when a table is added without a policy" is currently unmet, and closing it is this story's whole point.
- `supabase/migrations/` -- empty. No `supabase/config.toml` exists yet; the CLI is not installed.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- add the Supabase CLI as a pinned devDependency so the local and CI versions cannot differ
- [ ] `supabase/migrations/` -- the first migration: `public.tenant_id()` as a `stable` function reading `app_metadata` from `request.jwt.claims`; `organizations` and `companies`; RLS enabled, forced, policy and index in the same file. Portable to both substrates — guard role creation with `do $$ … $$`
- [ ] test substrate -- a documented way to bring up `postgres:17`, apply migrations with `supabase migration up --db-url`, and tear down; usable identically by a developer and by CI
- [ ] `tests/isolation/` -- the suite. **It must fail if any single one of these is removed:** RLS `enable`, RLS `force`, a policy, the `(select …)` wrapping, a `tenant_id`-leading index, the non-empty fixture assertion, an exemption's justification, or the suite's own registration. That property, not a list of cases, is the requirement. Prove the fixture is non-empty **before** asserting purity, because RLS-with-no-policy is otherwise indistinguishable from an empty result
- [ ] `.github/workflows/ci.yml` -- a `services: postgres` container and a step that runs the isolation project. Without this the story's central criterion is unmet
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- record that the gate cannot see Supabase-specific permission failures, since bare Postgres is the more permissive substrate

**Acceptance Criteria:**
- Given a table added to `public` with no policy, when CI runs, then the build fails — verified by actually adding one, watching it fail, and removing it.
- Given a policy written without the `(select …)` wrapping, when the sweep runs, then it is reported, even though that policy isolates correctly.
- Given an empty table with RLS missing, when the suite runs, then it is still reported — a vacuous pass is a failure of the gate.
- Given `organizations` and `companies`, when the sweep runs, then they are exempt from the `tenant_id` column rule and still required to carry RLS, force, and a policy.
- Given the four existing gates, when they run, then lint, typecheck, the unit and browser projects, and build all still exit zero.

## Design Notes

**Why bare Postgres, stated as a trade rather than a win.** It is ~20× cheaper in CI and proves every criterion. What it cannot prove is that a migration will apply to Supabase, because it grants more than Supabase does — and this story exists because exactly that gap hid a broken `create function auth.tenant_id()` in two architecture documents for a week. The mitigation is portability discipline in the migration, plus the deferred-work entry; the residual risk is real and is recorded rather than argued away.

**`public.tenant_id()` is reachable as a PostgREST RPC**, and `EXECUTE` cannot be revoked from `authenticated` because policy expressions evaluate as the calling role. It returns only the caller's own claim, which the caller already holds in its JWT. Nothing leaks; the surface is stated here so nobody has to rediscover it.

## Verification

**Commands:**
- `npx vitest run --project isolation` -- expected: exits zero against a freshly migrated database
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` -- expected: all exit zero

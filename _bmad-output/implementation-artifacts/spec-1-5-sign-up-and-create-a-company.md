---
title: 'Story 1.5 — Sign up by email and create a company'
type: 'feature'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e6aa29d098e47e923e9f9f5328d13078a26649ee'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/data-model.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The database can hold a tenant and the shell can render one, but nothing can create one. There is no signup, no auth client, and no path from a stranger with an email address to a company row of their own — which is the entire self-serve premise.

**Approach:** Email signup through Supabase auth, then a company registration form that creates `organizations` and `companies` **in one transaction**, under the caller's own session. Confirmation is on, so the flow is two screens with a callback between them, not one.

## Boundaries & Constraints

**Always:** Zod validation at every route-handler boundary. The caller's own session, and nothing else, carries the write. Money-free story — no payroll paths touched. User-facing copy English; `NPWP`, `NPP BPJS`, `BPJS Kesehatan` keep their Indonesian names. Timezone defaults to `Asia/Jakarta` and accepts only the three Indonesian zones.

**Ask First:** Any `security definer` function. Any new secret in `.env.local`. Any change to `supabase/migrations/20260827000000_*.sql`, which is already applied to the live project — a correction is a **new** migration, never an edit. Any change to the isolation gate's exemption lists.

**Never:** No `service_role` client, in any file, under any name. No Server Actions — mutations are route handlers (AD-15). No `memberships` table and no tenant claim in the JWT; both are Story 1.6. No disabling email confirmation to make testing easier.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Signup | valid email + password | `auth.users` row; user told to check their email | no session yet — do not pretend otherwise |
| Confirm | link clicked | code exchanged for a session; user lands on company registration | expired or reused link → a stated error, not a blank screen |
| Create company | authenticated, no tenant claim | `organizations` + `companies` in **one transaction** | second insert fails → both roll back, no orphan org |
| Retry after failure | user already owns an organization | resumes rather than creating a second | `owner_user_id` has no unique constraint — do not rely on one |
| Legal name | empty or whitespace | rejected at the boundary by Zod | field-level message |
| Optional identifiers | NPWP / NPP BPJS / BPJS Kes blank | accepted, stored null | N/A |
| Timezone | not one of the three Indonesian zones | rejected | N/A |
| Rate limit | 3rd signup email within an hour | Supabase refuses; the user is told what happened | must not read as "signup failed" |
| Unauthenticated | company form reached with no session | redirected to signup | N/A |
| Post-signup company read | owner, no tenant claim | company is **readable** | an update silently affects 0 rows — do not offer one |

</frozen-after-approval>

## Code Map

Measured 2026-08-27 against the live project and a local `postgres:17` carrying the same schema.

- **Atomicity needs a transaction, not `security definer`.** PostgREST runs an RPC in one transaction, so a **`security invoker`** plpgsql function gives full atomicity and passes the isolation gate untouched: verified `prosecdef=f`, sweep reports zero offenders, and a deliberately failing second insert rolled back with **0 orphan organizations**. No exemption, no database password. Do **not** spend the `SECURITY_DEFINER_EXEMPTIONS` slot the gate's comment reserves for Story 1.6's token hook.
- **Two sequential PostgREST inserts is the trap.** Both succeed under a `sub`-only claim, but when the second fails the `organizations` row survives, readable and writable by its owner, and `owner_user_id` carries **no unique constraint** — a retrying user accumulates orphans. Measured: `orphan orgs visible | 1`.
- **A route handler with a pooled transaction also works** but needs a Supavisor URI containing the database password, which is not in the repo. The user's JWT cannot be carried into a pooled connection — it is not a database credential; the handler would have to verify it against JWKS and re-assert `set local role authenticated` plus `set_config('request.jwt.claims', …, true)`. Rejected as needing a new secret for no gain over the RPC.
- **Auth packages:** `@supabase/ssr@0.12.5` with `@supabase/supabase-js@2.112.4` install clean against Next 16.3.2 / React 19.2.8, zero peer warnings, `next build` green. The documented `getAll`/`setAll` cookie shape still matches Next 16's async `cookies()` — **with one addition the Supabase docs omit: `setAll` must be wrapped in try/catch**, because setting a cookie during a Server Component render throws.
- **Env name mismatch:** `.env.local` defines `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `.env.example` still declares `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Reconcile on the publishable name — that is what Supabase issues now.
- **Confirmation is ON and the mail budget is two per hour, project-wide** (`mailer_autoconfirm: false`, `rate_limit_email_sent: 2`, `smtp_host: null`). A pre-confirmation user has a row and **no session**, so the company cannot be created until the link is clicked. Only one ordering is possible under RLS: signup → check mail → callback exchanges the code → company form. `site_url` is `http://localhost:3000`, so confirmation links work locally and nowhere else yet.
- **`jwt_exp` was 3600 and is now 900**, matching AD-9. Changed on the owner's instruction 2026-08-27.
- `supabase/migrations/20260827000000_*.sql` -- **already applied to the live project.** `companies_create_under_owned_org` is the insert path; `companies_visible_to_org_owner` is the readback half, and PostgREST asks for a readback by default. Verified: an owner with **no tenant claim** can read their company. The same session **cannot update it** — `companies_tenant`'s USING requires `id = tenant_id()`, so an update silently affects **0 rows** with no error.
- `components/shell/fixtures.ts` -- after this story `legalName`, `timeZone` and `planLabel` can be real. `planLabel` comes from `organizations.plan` ∈ `free|core|payroll`; the fixture's `"Business Plan"` is not a valid value. `membershipCount` and the user's name and role must stay fixtures — there is no `memberships` table until 1.6, and `auth.users` carries an email, not a name. `branchCount` is 0, which the switcher already drops.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- add `@supabase/ssr` and `@supabase/supabase-js` at the versions above; no other new dependency
- [ ] `.env.example` -- reconcile on `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; keep the `service_role` warning verbatim
- [ ] `lib/supabase/` -- browser, server and route-handler clients. `setAll` wrapped in try/catch. **No client may be constructed from a service key**; make that structurally impossible, not merely absent
- [ ] `supabase/migrations/` -- a **new** migration (never an edit to the applied one) adding the `security invoker` signup RPC that creates the organization and the company in one transaction, and a resume rule so a retry does not create a second organization
- [ ] `app/(auth)/` -- signup screen, a "check your email" state that names the two-per-hour limit honestly, and the callback that exchanges the code for a session
- [ ] `app/(app)/` company registration -- the form: legal name required; NPWP, NPP BPJS, BPJS Kesehatan optional; timezone defaulting to `Asia/Jakarta` and accepting only the three Indonesian zones
- [ ] `app/api/` -- route handlers with Zod at the boundary. Not Server Actions
- [ ] `components/shell/fixtures.ts` -- take `legalName`, `timeZone` and `planLabel` from the real company for a signed-in owner; leave the rest fixture and say so in a comment
- [ ] tests -- **the suite must fail if any single one of these stops holding:** the RPC is not atomic (a failing second insert leaves an organization behind), a retry creates a second organization, any input reaches the database without passing its Zod schema, any client is constructed from a service key, a required field becomes optional or an optional one required, a timezone outside the three is accepted, or a route that needs a session serves without one. State it as that property; assert on observed behaviour, not on the presence of a call

**Acceptance Criteria:**
- Given a signup whose second insert fails, when the transaction ends, then `organizations` holds no row for that user — verified by forcing the failure, not by reading the code.
- Given a confirmed user who already owns an organization, when they retry registration, then they resume rather than acquiring a second one.
- Given an owner with no tenant claim, when the shell renders, then the company's real legal name and timezone appear and nothing offers an edit that would silently affect zero rows.
- Given `grep -rn "service_role" app lib components`, when it runs, then it finds nothing but the prohibition itself.
- Given all five gates, when they run, then lint, typecheck, the unit and browser projects, the isolation project, and build all exit zero.

## Spec Change Log

**2026-08-27 — patch round, no loopback.**
*Trigger:* three reviewers, one adversarial against the auth surface with container access. Four security defects were reproduced, not argued. An **open redirect** on the email-confirmation path: `safeRedirectPath` refused `//evil.example` and honoured `/\evil.example`, `/\/`, `/\t/` and `/\n//`, all of which `new URL()` resolves off-origin because WHATWG treats `\` as `/` and strips tab, LF and CR before parsing. **`x-forwarded-host` trusted unconditionally**, and that header builds `emailRedirectTo` — so a forged header mails a confirmation link carrying the PKCE code to an attacker's host. **No CSRF defence**: `readJson` never inspected `Content-Type`, so a cross-site `enctype="text/plain"` form could force a victim into the attacker's tenant. And **self-service billing**: `update organizations set plan='payroll'` returned `UPDATE 1`, letting a customer hand themselves the paid tier.
*Root cause:* the test task stated a property, but an **inside-out** one. It named atomicity, retry, Zod, the service key, the field rules and session gating — what must be true — and never named what must be impossible. A suite can be complete against that property and blind to the front door. This is the same mistake as Stories 1.1, 1.3 and 1.4 in a fourth shape.
*Why no revert:* the adversarial pass confirmed the core genuinely holds — cross-owner registration impossible, the advisory lock serialising six concurrent sessions into one organization, the credential guard surviving nineteen probes including a `role` nested in `app_metadata` and a Cyrillic homoglyph, the proxy matcher covering all seventeen routes, `getSession()` used nowhere, and Zod parsing before use in every handler. The defects were at the edges and fixed additively.
*Amended:* the property is now stated from the outside — **no request may cause a redirect off-origin, a mail to an unverified host, a state change without same-origin intent, or a write the database itself would not permit.**
*KEEP:* the credential allowlist that requires a key to prove it is publishable rather than naming what to reject — it refuses formats Supabase has not minted yet. The nullary client factories, which leave no parameter to smuggle a key through. The sign-in route deliberately *not* gated on an existing session, and its single failure message for every cause. `crossSiteRefusal` living inside `readJson` so a fourth handler cannot forget it. And `serverError()` taking no argument at all, which makes leaking a raw database message unavailable rather than merely discouraged.

## Design Notes

**Why the RPC and not a route-handler transaction.** Both are atomic. The RPC needs no new secret; the pooled path needs the database password and a dedicated `FORCE ROW LEVEL SECURITY` role, and it would have to verify the JWT itself and re-assert the claim — more moving parts, each one a place to get authorization wrong. The RPC runs as the caller, so RLS still adjudicates every row it writes.

**The rate limit is a real constraint, not a nuisance.** Two confirmation emails per hour across the whole project means testing this flow is slow and a demo can fail in front of someone. It is recorded rather than designed around, and the "check your email" screen should say what is true.

## Verification

**Commands:**
- `npm run lint` · `npm run typecheck` · `npm test` · `npx vitest run --project isolation` · `npm run build` -- expected: all exit zero
- `grep -rn "service_role" app lib components` -- expected: no match

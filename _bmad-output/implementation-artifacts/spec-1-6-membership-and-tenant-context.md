---
title: 'Story 1.6 — Membership, roles, and tenant context in the token'
type: 'feature'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '25c7cf5950bd853e83a2ea63163aecb904c2d753'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/data-model.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every RLS policy in the product reads `app_metadata.tenant_id`, and nothing has ever put it there. `public.tenant_id()` returns null for every session that exists today, so every tenant policy evaluates to "see nothing" — the isolation the database enforces is currently enforcing emptiness. `memberships` does not exist, so there is no answer to which company a session is acting in.

**Approach:** The `memberships` table, and the Custom Access Token Hook that reads it and injects `tenant_id`, `role` and `employee_id` into the token. Plus company switching, which is a session change: update the active membership, reissue the token, land on the dashboard root.

## Boundaries & Constraints

**Always:** `memberships` satisfies the isolation gate like any other table — `tenant_id`, RLS enabled and forced, a policy naming a claim function, a leading index, a fixture. The hook re-validates that the membership is active **before** injecting. Switching writes `last_active_at` for the caller and nobody else.

**Ask First:** Enabling the hook on the live project — it is a Management API write, and enabling it before the function exists breaks every login. Any third `security definer` function. Any fourth entry in `EXEMPTIONS`. Any change to the two applied migrations.

**Never:** No Postgres enum for `role` — `text` plus a check constraint. No `tenant_id` written anywhere a user can reach it. No `user_metadata`, for anything. No employee data — `employees` is Story 1.8.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Token issued | user with one active membership | `app_metadata` carries `tenant_id`, `role`, `employee_id` | N/A |
| Two memberships | both active | the one with greatest `last_active_at`, tie-broken by `created_at` | deterministic, never arbitrary |
| Deactivated | `is_active = false` on all | **no** `tenant_id` injected, and any inbound one is stripped | fails closed |
| Newest deactivated | newest inactive, older active | falls back to the older active one | N/A |
| Unknown user | no membership rows | no claims injected | N/A |
| Malformed event | `user_id` not a uuid | the hook must not raise — a raise is a failed login **and a failed refresh** | guard the cast |
| Switch company | user picks the other company | `last_active_at` updated, new token carries the new `tenant_id`, navigation returns to the dashboard root | a deep link from the previous company must not survive |
| Switch someone else's | user targets a tenant-mate's row | refused | measured as refused, not as zero rows |
| Role escalation | user updates their own `role` | refused by privilege, not by policy | N/A |
| After switching | any tenant query | rows from one company only | N/A |

</frozen-after-approval>

## Code Map

Measured 2026-08-27 in the container and read-only against the live project.

- **The hook fails closed, confirmed in GoTrue's source.** Every hook failure returns before `SignJWT`; there is no fallback to default claims. A raise, a missing `claims` key, or a schema violation is a 500. Timeout is a hard **2 s**, and there are **no retries**. The hook runs on sign-in **and on `token_refresh`** — so a broken hook does not merely block new logins, it evicts every signed-in user within the 15-minute TTL. Guard the `user_id` cast: `select custom_access_token_hook('{"user_id":"not-a-uuid"}')` raises `22P02` today.
- **Supabase's recommended form cannot work here, measured.** The docs prefer *no* `security definer` plus grants to `supabase_auth_admin`. Against `force row level security` that returns **zero rows**: `supabase_auth_admin` is `rolbypassrls = false` on the live project. Four forms tested — invoker `{"n":0}`; invoker plus an open policy `{"n":2}`; definer owned by a BYPASSRLS role, correct; definer owned by a non-BYPASSRLS role `{}`. **`security definer` owned by `postgres` is the only form that works**, and it becomes the first `SECURITY_DEFINER_EXEMPTIONS` entry — which is what that list was reserved for.
- **The pinned assertion that must change**, `tests/isolation/catalog-sweep.test.ts:307-312`: `it("has no security definer exemptions yet", () => { expect(SECURITY_DEFINER_EXEMPTIONS).toEqual([]); });`. An entry is `{ name: <bare proname>, justification: <over 80 chars> }`.
- **Hook contract:** `(event jsonb) returns jsonb`, invoked as `select "public"."custom_access_token_hook"(?)`. Input carries `user_id`, `claims`, `authentication_method`. Output must carry `claims`, and GoTrue validates it against a schema requiring `aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous` — so merge into the event's claims, never construct a fresh object. Grants: `usage` on the schema and `execute` on the function to `supabase_auth_admin`; `execute` revoked from `authenticated`, `anon`, `public`.
- **Enabling it is a project write, and order matters.** `hook_custom_access_token_enabled` is `false` and `hook_custom_access_token_uri` is `null` today; the URI value is `pg-functions://postgres/public/custom_access_token_hook`. Enabling before the function exists breaks every login. Create, test, then ask.
- **The hook is directly unit-testable.** Called with a hand-made event in the container it returned `"app_metadata": {"role":"hr_manager","tenant_id":"…","employee_id":null}`. The tie-break was proven by flipping `created_at` with `last_active_at` held equal; the deactivated case returned `{"sub":"x","app_metadata":{}}` and **stripped** an inbound `tenant_id`, which is the half that matters.
- **No foreign key to `auth.users` is possible** — the container has no `auth` schema (`3F000`). Story 1.4 already made this call: `organizations.owner_user_id` carries no FK. Same for `memberships.user_id`, with a comment saying why.
- **`company_id` → `tenant_id`.** `data-model.md` names the column `company_id`; the gate requires `tenant_id`. Rename it — do not carry both.
- **A hole found while probing:** with `memberships_tenant` as `FOR ALL` plus `grant update (last_active_at)`, a user updated a **tenant-mate's** `last_active_at` — enough to move which company a colleague lands in on their next refresh. Column grants held the important line (`set role='admin'` → `permission denied`), but this one passed. Scope the update to the caller's own row.
- **Switching goes through a second `security definer` RPC** — the owner's decision, taken over widening `memberships` or stuffing the company list into the token. Keeping the table single-tenant means the purity assertion and the sweep apply to it unchanged, with no fourth `EXEMPTIONS` entry. The function reads and writes **only the caller's own rows**; that narrowness is its justification.
- `refreshSession()` -- verified present at runtime in `@supabase/supabase-js` 2.112.4. `lib/supabase/proxy.ts` refreshes only on expiry, so it does not race an explicit call; `lib/auth/session.ts` memoises per request via `cache()`, so one render sees one claim set. Returning to the dashboard root on switch is what makes that safe.
- `components/shell/fixtures.ts` -- `membershipCount` and `role` become real (`role` is already in the token, so no query). **The display name resolves to the email in this story.** The owner chose `employees.full_name` with an email fallback, and `employees` arrives in Story 1.8 — so build the fallback now and expect the first branch to be unreachable until then. Say so where a reader will find it. `branchCount` stays a fixture until 1.7.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/` -- a new migration: `memberships` with `unique (user_id, company_id)`, `tenant_id`, nullable `employee_id`, `is_active`, `last_active_at`, and `role` as `text` + check over the six roles; RLS enabled and forced, policy, leading index, all in the same file
- [ ] the hook -- `custom_access_token_hook(event jsonb) returns jsonb`, `security definer` owned by `postgres`, `search_path=''`, grants exactly as above. Merge into the event's claims. **Total on every input** — an unparseable `user_id` returns the event unchanged rather than raising
- [ ] the switch RPC -- `security definer`, reads and writes only the caller's own membership rows; used both to list companies and to switch
- [ ] `tests/isolation/` -- register `memberships` in the fixture registry and add the two `SECURITY_DEFINER_EXEMPTIONS` entries with justifications; change the pinned empty assertion
- [ ] hook tests -- call the function directly with synthetic events. **The suite must fail if the hook stops being total, stops re-validating `is_active`, stops stripping an inbound `tenant_id`, resolves the active membership by anything other than greatest `last_active_at` tie-broken by `created_at`, or lets any caller other than `supabase_auth_admin` execute it**
- [ ] switching -- the header control, the reissue, and the return to the dashboard root
- [ ] `components/shell/` -- `membershipCount` and `role` from real data; the display name falls back to the email with the `employees` branch written and marked unreachable until 1.8
- [ ] a test that no request path can write `tenant_id`, `role`, or another user's `last_active_at` — stated as that property, and proven by attempting each

**Acceptance Criteria:**
- Given a user whose only membership is deactivated, when a token is issued, then it carries no `tenant_id` and any inbound one is stripped — verified by passing one in.
- Given two active memberships with equal `last_active_at`, when a token is issued, then `created_at` decides, and the same input always gives the same answer.
- Given a user who switches company, when the next query runs, then it returns rows from the new company only and a deep link to the previous one does not resolve.
- Given a tenant-mate's membership row, when a user attempts to write its `last_active_at`, then the attempt is refused — not silently zero rows.
- Given all five gates, when they run, then lint, typecheck, both Node projects, the browser project, the isolation project and build all exit zero.

## Spec Change Log

**2026-08-27 — one gap closed by owner decision, no loopback.**
*Trigger:* the implementation was correct and incomplete in a way the spec never named. `memberships`, the hook and switching were all built and verified, but **nothing created the founding membership** — `register_company()` stopped at the company, so a founder signed up, owned a company, and had no membership in it. The hook was right and had no rows to read; every new tenant would have seen an empty product.
*Root cause:* this spec's matrix described what a token must carry for a user **who has a membership**, and never asked where the first one comes from. The implementer stopped and surfaced it rather than inventing a mechanism, which was the right call.
*Decision:* the owner chose a third narrow `security definer` function over widening `register_company` or granting `memberships` an insert. That keeps two properties that were measured, not assumed: `register_company` stays `security invoker` so the organization and company inserts are still adjudicated by RLS, and `memberships` keeps **zero** write privilege for `authenticated` — `has_table_privilege` reads false for insert, update and delete.
*Verified end to end:* the hook returned `{}` for a fresh user and `{"role":"admin","tenant_id":"…","employee_id":null}` after registration, with `tenant_id` equal to the returned `company_id`. Three attacks refused: founding a membership in a company you do not own, calling as `anon`, and writing `memberships` directly.
*KEEP:* the hook's totality and its unconditional strip of an inbound `tenant_id`, both of which survive a forged claim. The founding call sitting **unconditionally** inside `register_company` rather than in its create-branch, which makes re-registration the repair path for accounts that predate memberships. `currentActiveCompany()` resolving by claim with an ownership fallback — the implementer rejected both options offered and was right: repointing alone blanks existing accounts, leaving it alone blanks every invited member Epic 2 creates.

## Design Notes

**Why `security definer` here is not a retreat from the rule.** The gate forbids it by default because such a function bypasses RLS. Both functions here must: the hook runs as Supabase's auth role during token issuance, before any claim exists to be adjudicated by, and the switch RPC has to read a row in a company the caller is not currently in. What makes them safe is not the tag but the narrowness — each reads only rows keyed to one `user_id`, and that is what the justification has to say and the tests have to prove.

**The hook is the single point of failure for the whole product.** It runs on every sign-in and every refresh, has two seconds, and gets no retry. Totality is not defensive style here; it is the difference between a bad row and an outage.

## Verification

**Commands:**
- `npm run lint` · `npm run typecheck` · `npm test` · `npx vitest run --project isolation` · `npm run build` -- expected: all exit zero
- `grep -rn "service_role" app lib components` -- expected: no match

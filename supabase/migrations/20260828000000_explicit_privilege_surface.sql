-- Story 1.6, second hardening pass -- the privileges a request role actually
-- holds, stated rather than inherited.
--
-- WHAT WENT WRONG, and it is a whole class rather than one bug.
--
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated` in `public`, from both `postgres` and `supabase_admin`. So
-- every table these migrations create is BORN fully writable by both request
-- roles, and a `grant select ... to authenticated` afterwards adds nothing it
-- did not already have. Measured on the live project:
--
--   public.memberships relacl:  anon = arwdDxtm | authenticated = arwdDxtm
--
-- `memberships` was designed with NO write surface -- that is the whole reason
-- the founding membership goes through a `security definer` function instead
-- of a grant -- and in production it shipped with all of it. RLS held (INSERT
-- refused by policy, UPDATE and DELETE matched zero rows) so nothing leaked,
-- but the property the earlier migration claims in its own comments is false
-- there: a write answers ZERO ROWS, not `permission denied`, and the comment
-- says in as many words why that distinction matters -- "an attacker reads
-- that as 'not yet'".
--
-- `REVOKE ... FROM public` DOES NOT REMOVE AN EXPLICIT ROLE GRANT. The default
-- ACL grants `anon` explicitly, so the `revoke execute ... from public` in
-- 20260827120000 and 20260827160000 left `register_company()`,
-- `switch_company()` and `create_founding_membership()` callable by `anon` on
-- the live project. All three fail closed internally on a null claim, so this
-- was not exploitable -- but it is not what those files claim.
--
-- WHY THE GATE DID NOT CATCH IT, which is the part that matters. A bare
-- `postgres:17` container has NO default ACLs at all, so the identical
-- migration produces the intended narrow grants there and a wide-open table on
-- Supabase. The substrate was LOOSER in production than in CI -- the opposite
-- direction from the `auth`-schema problem in Story 1.4, where the container
-- was the permissive one. Two fixes went in alongside this file:
--   * `tests/isolation/globalSetup.ts` now installs the same default ACLs in
--     the container before migrating, so this reproduces locally;
--   * `catalog-sweep.test.ts` now asserts the EXACT privilege set held by
--     `anon` and `authenticated` on every discovered relation against a
--     declared intent, and fails a relation that declares none.
--
-- A THIRD FINDING, present on BOTH substrates and missed by everything until
-- the privilege assertion existed: `authenticated` still holds table-level
-- DELETE on `organizations`. 20260827000000 granted `select, insert, update,
-- delete`; 20260827140000 revoked `insert, update` and re-granted them at
-- column level, and never mentioned DELETE. So a request path can delete a
-- billing account it owns -- blocked by the foreign key once a company exists,
-- and reachable for an organization created and abandoned before one does.
-- Not claimed as intended anywhere. It is revoked below.
--
-- Forward-only and additive in the only sense that matters: this file creates
-- nothing and grants nothing that was not already meant to be granted. It
-- narrows. It does not edit the four applied files.
--
-- Re-runnable: `revoke`, `grant` and `alter default privileges` all are.

-- --------------------------------------------------------------------------
-- Default privileges -- so a future table is not born exposed
-- --------------------------------------------------------------------------
--
-- `ALTER DEFAULT PRIVILEGES` with no `FOR ROLE` targets the role running the
-- statement, which is the role these migrations run as (`postgres`, on both
-- substrates). That is the one that matters: a default ACL is keyed on the
-- role that CREATES the object, so every table our migrations create takes
-- `postgres`'s defaults and never `supabase_admin`'s.
--
-- **`supabase_admin`'s defaults are deliberately NOT touched, because they
-- cannot be.** Changing another role's default privileges requires membership
-- in that role, and `postgres` is not a member of `supabase_admin` on a
-- Supabase project. Writing the statement anyway would either fail the
-- migration or -- wrapped in an exception handler -- silently do nothing while
-- looking like protection. It does not need touching: nothing in this
-- repository creates an object as `supabase_admin`.
--
-- **This is a project-wide behaviour change and worth knowing about.** After
-- this, a table created in `public` by `postgres` -- including one created
-- through the Supabase dashboard -- is NOT automatically readable or writable
-- by `anon` and `authenticated`. It has to say so. That is the intended
-- outcome (CLAUDE.md rules 1 and 2 make every new table a deliberate act), and
-- it is the only thing that makes the container and the live project agree
-- about a table nobody remembered to grant.
--
-- It does NOT retroact. Tables that already exist keep the ACL they were born
-- with, which is why every one of them is reset explicitly below.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- --------------------------------------------------------------------------
-- The three tables, reset and re-granted
-- --------------------------------------------------------------------------
--
-- `revoke all ... from anon, authenticated` first, every time, and then grant
-- back. Measured: `REVOKE ALL ON TABLE` removes column-level grants as well as
-- table-level ones, so this is a genuine reset and not a partial one -- which
-- is what lets each block below be read as the complete truth about that table
-- rather than as a diff against whatever came before it.
--
-- `anon` gets nothing, anywhere. It holds no tenant claim by definition, so
-- nothing it can reach is defensible, and the sweep already asserts that no
-- relation is selectable by it. This is the same rule stated as a privilege
-- instead of as an assertion.

-- organizations -- above the tenant boundary, keyed on ownership.
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
-- `name` and `owner_user_id` only. `plan` is absent and that is the point of
-- 20260827140000: billing sets the tier, a request path does not.
-- `id` and `created_at` are absent too -- a caller choosing a primary key can
-- squat on an id another tenant is about to be given, and one choosing
-- `created_at` rewrites the tie-break `register_company`'s resume orders by.
grant insert (name, owner_user_id) on public.organizations to authenticated;
grant update (name, owner_user_id) on public.organizations to authenticated;
-- No DELETE. It was granted in 20260827000000 and never claimed since; see the
-- third finding at the top of this file. Deleting a billing account is an
-- offboarding decision, not a request a form can make.

-- companies -- the tenant boundary itself.
revoke all on public.companies from anon, authenticated;
-- Table-level, not column-level, and deliberately unchanged in that respect:
-- `companies_tenant` and `companies_create_under_owned_org` are what adjudicate
-- these writes, and the isolation suite proves it by asserting that a company
-- carrying another tenant's id is refused BY POLICY. Narrowing `id` out of the
-- INSERT grant would make that test pass for a privilege reason instead and
-- stop testing the policy at all. Recorded as a real question in
-- deferred-work rather than changed in a hardening pass.
grant select, insert, update on public.companies to authenticated;
-- No DELETE. `companies.id` is the tenant id every other table's rows hang
-- off; deleting it orphans the tenant's entire dataset.

-- memberships -- which company a session acts in, and as what.
revoke all on public.memberships from anon, authenticated;
-- SELECT and nothing else, which is the property the whole design rests on.
-- The only write paths are `switch_company()` and
-- `create_founding_membership()`, both scoped to the caller's own rows by
-- construction. With a write grant present, a refusal comes from a policy and
-- reports zero rows; without one it comes from privilege and says so.
grant select on public.memberships to authenticated;

-- --------------------------------------------------------------------------
-- The functions -- `revoke from public` was not enough
-- --------------------------------------------------------------------------
--
-- Each of these already carried `revoke execute ... from public`, which is
-- correct and insufficient: the default ACL grants `anon` EXPLICITLY, and
-- revoking from PUBLIC does not remove an explicit role grant. Named
-- explicitly here.
--
-- All three fail closed on a null claim, so `anon` reaching them was never
-- exploitable. It is revoked because a write endpoint callable by `anon` is
-- not something to leave standing on the strength of an internal check --
-- which is the reason 20260827120000 gave for the revoke it wrote.

revoke execute on function public.register_company(text, text, text, text, text) from anon;
revoke execute on function public.switch_company(uuid) from anon;
revoke execute on function public.create_founding_membership(uuid) from anon;

-- The hook. Already revoked from public, anon and authenticated in
-- 20260827160000; restated so this file is the complete statement of who may
-- call what, and because the same default-ACL mechanism applies to it.
-- `supabase_auth_admin` is untouched -- it is the only caller, and removing its
-- grant is every login in the product failing.
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;

-- `public.tenant_id()` and `public.auth_user_id()` keep their grant to `anon`,
-- and that is deliberate rather than an omission. Policy expressions are
-- evaluated as the CALLING role, so an anonymous request evaluating a policy
-- must be able to execute them. Both return only the caller's own claim -- a
-- value the caller already holds -- so the exposure is nil. 20260827000000
-- says the same thing at more length.

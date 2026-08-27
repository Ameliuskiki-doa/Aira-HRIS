-- Story 1.6 -- membership, roles, and the tenant context the whole product
-- has been reading and nothing has ever written.
--
-- Every RLS policy in this schema reads `app_metadata.tenant_id` through
-- `public.tenant_id()`. Nothing puts it there. So today that function returns
-- null for every session that exists, every tenant policy evaluates to "see
-- nothing", and the isolation the database enforces is enforcing emptiness.
-- This file is what ends that: a `memberships` table, and a Custom Access
-- Token Hook that reads it and injects the claim.
--
-- A NEW migration. 20260827000000 and 20260827120000 are applied to the live
-- project, and a correction to an applied file is a new file, never an edit.
-- 20260827140000 set that precedent; this one only adds.
--
-- What it adds:
--   1. `memberships` -- with RLS enabled and forced, a policy, a
--      tenant_id-leading index and no write surface at all, in this same file;
--   2. `public.custom_access_token_hook(jsonb)` -- the hook GoTrue calls on
--      every sign-in and every refresh;
--   3. `public.switch_company(uuid)` -- the only thing that may write a
--      membership row, and only the caller's own.
--
-- Portability. Applied to two substrates: a bare `postgres:17` container (the
-- CI gate) and a real Supabase project. Supabase already owns
-- `supabase_auth_admin`; the container has never heard of it, so the role is
-- guarded exactly as `anon` and `authenticated` were in 20260827000000.
-- Nothing is created outside `public`.
--
-- Re-runnable. `create or replace`, `grant`/`revoke` and the guarded `create
-- role` already are; the table and its policy are guarded on the catalog for
-- the same reason 20260827120000 guards its constraints -- the ledger-repair
-- runbook in deferred-work.md ends in a `supabase db push`.

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------
--
-- The role GoTrue connects as. It exists on every Supabase project and on no
-- bare container, and the hook's grants are meaningless without it. NOLOGIN
-- here: on the container nothing ever connects as it, it exists only so that
-- `grant execute ... to supabase_auth_admin` resolves and so the isolation
-- suite can ask `has_function_privilege` about it and get a real answer.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- memberships -- which companies a person may act in, and as what
-- --------------------------------------------------------------------------
--
-- Many-to-many from day one. One person sits in several companies routinely
-- (group HR, directors, an outsourcing vendor's payroll clerk), and converting
-- a unique `employees.user_id` into a join table after production data exists
-- is the migration nobody wants to run.
--
-- `tenant_id`, not `company_id`. `data-model.md` names this column
-- `company_id`; the isolation gate requires `tenant_id` on every table and
-- keys its index rule on it. They are the same value -- `tenant_id` IS
-- `companies.id` -- so carrying both names would be two spellings of one fact.
-- Renamed here, once, and the unique key is `(user_id, tenant_id)`.
--
-- No foreign key on `user_id`. It references `auth.users.id`, and the CI
-- substrate is a bare Postgres container with no `auth` schema at all
-- (`3F000`). Story 1.4 already took this decision for
-- `organizations.owner_user_id`; the constraint would be unportable rather
-- than merely absent. Same for `employee_id`, which additionally has no table
-- to point at until Story 1.8.

do $$
begin
  if to_regclass('public.memberships') is null then
    create table public.memberships (
      id             uuid primary key default gen_random_uuid(),
      -- References the tenant boundary row itself, which is the one foreign
      -- key here that CAN exist: `companies` lives in `public`.
      tenant_id      uuid not null references public.companies (id),
      -- auth.users.id. See the note above on why there is no FK.
      user_id        uuid not null,
      -- Null for an external accountant, and null for everybody until Story
      -- 1.8 creates `employees`. Carried in the token so role-aware policies
      -- never have to join back to it.
      employee_id    uuid,
      role           text not null,
      is_active      boolean not null default true,
      -- WHERE THE ACTIVE COMPANY LIVES. The hook picks the active membership
      -- by greatest `last_active_at`; switching company is an update to this
      -- column and nothing else. Null means "never acted in this company",
      -- which sorts last.
      last_active_at timestamptz,
      created_at     timestamptz not null default now(),
      -- `text` plus a check, never a Postgres enum: adding a value to an enum
      -- is a DDL migration that cannot run inside a transaction with other
      -- DDL on older servers, and removing one is not possible at all.
      -- The set is fixed and NOT tenant-customisable (AD-33). `owner` is
      -- deliberately absent -- it is not a membership role, it lives above the
      -- tenant boundary on `organizations.owner_user_id`.
      constraint memberships_role_check check (
        role in ('admin', 'hr_manager', 'hr_staff', 'supervisor', 'staff', 'accountant')
      ),
      constraint memberships_user_tenant_unique unique (user_id, tenant_id)
    );
  end if;
end
$$;

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- One policy, SELECT only, and the absence of the other three is the design.
--
-- A membership row decides which company a person lands in and what they are
-- allowed to see there. Nothing a request can reach may write one:
--
--   * `tenant_id` -- a writable tenant key is the tenant boundary handing out
--     its own keys;
--   * `role` -- a writable role is self-service privilege escalation, and it
--     has to be refused by PRIVILEGE rather than by policy, because a policy
--     that filters an UPDATE reports zero rows and an attacker reads that as
--     "not yet";
--   * `last_active_at` -- writable, it moves which company a COLLEAGUE lands
--     in on their next refresh. Measured: with this policy written `for all`
--     plus `grant update (last_active_at)`, a user updated a tenant-mate's
--     row and it was reported as a successful write.
--
-- So `authenticated` holds SELECT and nothing else, and the single write path
-- is `public.switch_company()` below, which is scoped to the caller's own
-- rows by construction. `tests/isolation/membership-switching.test.ts` proves
-- each of the three refusals by attempting it.
--
-- The read stays strictly tenant-scoped -- a user does NOT see their own
-- memberships in other companies through this table. That is what keeps the
-- purity assertion and the catalog sweep applying to `memberships` unchanged,
-- and it is why the company list for the switcher comes from the RPC instead
-- of from a widened policy.
--
-- Wrapped as `(select public.tenant_id())`, not bare: without the subquery
-- Postgres re-evaluates the claim once per row (~7.4x on a tenant-wide scan,
-- measured in Story 1.4).
do $$
begin
  if not exists (
    select 1 from pg_policy
     where polname = 'memberships_tenant'
       and polrelid = 'public.memberships'::regclass
  ) then
    create policy memberships_tenant on public.memberships
      for select
      to authenticated
      using (tenant_id = (select public.tenant_id()));
  end if;
end
$$;

-- The access path the policy takes. The unique constraint's index leads with
-- `user_id` -- which is the path the HOOK takes, and is why the hook's lookup
-- is an index scan -- so the tenant path needs its own.
create index if not exists memberships_tenant_id_idx
  on public.memberships (tenant_id, user_id);

-- SELECT and nothing else. No INSERT, no UPDATE, no DELETE, for any request
-- role, ever. See the policy note above.
grant select on public.memberships to authenticated;

comment on table public.memberships is
  'Which companies a person may act in and as what. Read-only to every request '
  'role: the only write path is public.switch_company(), which touches the '
  'caller''s own rows only. tenant_id and role are not writable from a request '
  'path at all -- by privilege, not by policy.';

comment on column public.memberships.last_active_at is
  'The active company. The access token hook resolves the active membership by '
  'greatest last_active_at, tie-broken by created_at then id. Switching company '
  'writes this column and nothing else.';

comment on column public.memberships.employee_id is
  'Null for an external accountant, and null for everyone until Story 1.8 '
  'creates `employees`. No foreign key: the CI substrate has no employees table '
  'yet, and this value is carried in the token so policies never join to it.';

-- --------------------------------------------------------------------------
-- The Custom Access Token Hook
-- --------------------------------------------------------------------------
--
-- THE SINGLE POINT OF FAILURE FOR THE WHOLE PRODUCT. Read this before editing
-- anything below it.
--
-- GoTrue calls this on every sign-in AND on every `token_refresh`. Confirmed
-- in GoTrue's source: every hook failure returns before `SignJWT` and there is
-- no fallback to default claims, the timeout is a hard 2 seconds, and there
-- are no retries. So a raise here is not "a bad row" -- it is a failed login
-- *and* a failed refresh, which evicts every signed-in user within the
-- 15-minute token TTL. Totality is the requirement, not a style.
--
-- TOTAL ON EVERY INPUT. Four shapes reach it and none may raise:
--   1. `event` that is not a JSON object                -> returned unchanged
--   2. no `claims` key, or a `claims` that is not an object -> unchanged
--   3. `user_id` that is not a UUID -- `select custom_access_token_hook(
--      '{"user_id":"not-a-uuid"}')` raised 22P02 before the regex guard
--   4. no membership row at all                         -> no claims injected
-- The guard is a regex, not an EXCEPTION block: an EXCEPTION block opens a
-- subtransaction on every call, and this function is on the hottest path in
-- the product. Same technique as `public.tenant_id()`.
--
-- MERGE INTO THE EVENT'S CLAIMS, NEVER BUILD A FRESH OBJECT. GoTrue validates
-- the returned `claims` against a schema requiring `aud, exp, iat, sub, email,
-- phone, role, aal, session_id, is_anonymous`. A constructed object drops all
-- of them and the login fails schema validation.
--
-- STRIPPING IS THE HALF THAT MATTERS. `tenant_id`, `role` and `employee_id`
-- are removed from the inbound `app_metadata` FIRST, unconditionally, and only
-- then re-added if an active membership resolves. A deactivated user whose
-- previous token carried a tenant must come back with none -- and a hook that
-- only ever adds would happily pass the old claim straight through.
--
-- WHY `security definer`, when the isolation gate forbids it by default.
-- The gate's rule exists because a definer function skips the caller's
-- policies. This one must: it runs as `supabase_auth_admin` during token
-- issuance, before any claim exists for a policy to adjudicate by. Supabase's
-- documented alternative -- security invoker plus grants to
-- `supabase_auth_admin` -- was measured against this schema and returns ZERO
-- ROWS, because `memberships` has `force row level security` and
-- `supabase_auth_admin` is `rolbypassrls = false` on the live project. Four
-- forms were tested; `security definer` owned by `postgres` is the only one
-- that works. What makes it safe is not the tag but the narrowness: it reads
-- one table, filtered to one `user_id`, and returns claims rather than rows.
-- It is the first entry in `SECURITY_DEFINER_EXEMPTIONS`.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims       jsonb;
  v_app_metadata jsonb;
  v_raw_user_id  text;
  v_user_id      uuid;
  v_tenant_id    uuid;
  v_role         text;
  v_employee_id  uuid;
begin
  -- Totality, gate 1: the event.
  if event is null or jsonb_typeof(event) <> 'object' then
    return event;
  end if;

  -- Totality, gate 2: the claims. Without a claims object there is nothing to
  -- merge into, and inventing one would fail GoTrue's schema anyway.
  v_claims := event -> 'claims';
  if v_claims is null or jsonb_typeof(v_claims) <> 'object' then
    return event;
  end if;

  v_app_metadata := v_claims -> 'app_metadata';
  if v_app_metadata is null or jsonb_typeof(v_app_metadata) <> 'object' then
    v_app_metadata := '{}'::jsonb;
  end if;

  -- Strip first, unconditionally. Every path below either re-adds all three
  -- or adds none, so an inbound tenant_id cannot survive a deactivation.
  v_app_metadata := v_app_metadata - 'tenant_id' - 'role' - 'employee_id';

  -- Totality, gate 3: the cast. The same regex `public.tenant_id()` uses.
  v_raw_user_id := event ->> 'user_id';
  if v_raw_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_user_id := v_raw_user_id::uuid;
  end if;

  if v_user_id is not null then
    -- `is_active` is re-validated HERE, at issuance, rather than trusted from
    -- whatever was true when the row was written. Deactivation takes effect on
    -- the next refresh, which with a 15-minute TTL is the agreed staleness
    -- bound (AD-9).
    --
    -- The ordering is the contract, and it is duplicated in
    -- `public.switch_company()` on purpose so the list the switcher renders
    -- leads with the company this function would choose. A test asserts the
    -- two agree.
    --   * greatest `last_active_at` -- the company you last acted in;
    --   * `nulls last` -- a membership never acted in loses to one that was;
    --   * `created_at` ascending -- ties go to the membership held longest,
    --     which for a founder is their original company;
    --   * `id` ascending -- so that even a duplicated `created_at` gives the
    --     same answer every time. "Deterministic" has to mean total.
    select m.tenant_id, m.role, m.employee_id
      into v_tenant_id, v_role, v_employee_id
      from public.memberships m
     where m.user_id = v_user_id
       and m.is_active
     order by m.last_active_at desc nulls last, m.created_at asc, m.id asc
     limit 1;

    if v_tenant_id is not null then
      v_app_metadata := v_app_metadata || jsonb_build_object(
        'tenant_id',   v_tenant_id,
        'role',        v_role,
        -- Deliberately a JSON null rather than an omitted key when there is no
        -- employee: "this membership has no employee record" and "this token
        -- predates employee ids" are different facts, and only one of them is
        -- true.
        'employee_id', v_employee_id
      );
    end if;
  end if;

  return jsonb_set(event, '{claims,app_metadata}', v_app_metadata, true);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Custom Access Token Hook. Injects app_metadata.tenant_id, role and '
  'employee_id from the caller''s active membership, re-validating is_active at '
  'issuance and stripping any inbound values first so a deactivated user fails '
  'closed. TOTAL: it returns the event unchanged rather than raising on any '
  'malformed input, because GoTrue treats a raise as a failed login AND a failed '
  'refresh, with a 2s timeout and no retries.';

-- Owner is the privilege. `security definer` executes as the function's owner,
-- and only an owner that can read past `force row level security` returns
-- rows -- measured: a definer owned by a non-BYPASSRLS role returned `{}`.
-- Migrations run as `postgres` on both substrates, so this is a no-op that
-- states the requirement rather than leaving it to inference.
alter function public.custom_access_token_hook(jsonb) owner to postgres;

-- Exactly one caller. EXECUTE is granted to PUBLIC by default, which would let
-- any authenticated caller mint themselves a claim set -- harmless in itself
-- (the function returns jsonb, it does not sign anything) but it is a
-- privileged read of another user's membership if `user_id` is chosen freely.
-- Revoked from everything, granted to the one role GoTrue connects as.
revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- --------------------------------------------------------------------------
-- switch_company -- the only write, and the only cross-tenant read
-- --------------------------------------------------------------------------
--
-- Two jobs, one function, and that is deliberate rather than lazy: listing the
-- companies a user belongs to and switching between them are the same
-- privileged question ("which membership rows are yours?"), and splitting them
-- would mean a third `security definer` function for no additional capability.
--
--   switch_company()            -> list only
--   switch_company(<company>)   -> switch, then list
--
-- WHY IT MUST BE `security definer`. The company list spans tenants by
-- definition -- that is what a switcher is -- and `memberships_tenant` is
-- keyed on the ACTIVE tenant, so an invoker-rights read returns only the
-- company the user is already in. The alternatives were weighed and rejected:
-- widening the policy to `user_id = auth_user_id()` would make `memberships`
-- multi-tenant to a single caller and take it out from under the purity
-- assertion; stuffing the company list into the token would make every claim
-- set grow with the user's memberships and go stale on the wrong schedule.
--
-- WHAT MAKES IT SAFE is the same thing that makes the hook safe: narrowness.
-- Every statement in it is filtered on `m.user_id = v_user`, and `v_user`
-- comes from the caller's own JWT and cannot be passed in. There is no
-- argument that widens what it reads or writes.

create or replace function public.switch_company(p_company_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user      uuid;
  v_switched  boolean := false;
  v_companies jsonb;
begin
  v_user := public.auth_user_id();

  -- Fails closed rather than reading somebody's rows. The claim function
  -- returns null for an absent, empty, malformed or non-UUID claim, so this
  -- one branch covers every unauthenticated shape.
  if v_user is null then
    raise exception 'switch_company requires an authenticated caller'
      using errcode = '28000';
  end if;

  if p_company_id is not null then
    -- `m.user_id = v_user` is the whole security model of this statement.
    -- A tenant-mate's row is not addressable from here: there is no argument
    -- that names a user.
    update public.memberships m
       set last_active_at = now()
     where m.user_id = v_user
       and m.tenant_id = p_company_id
       and m.is_active;

    -- REFUSED, not silently zero rows. A switch that quietly does nothing
    -- leaves the caller on the old tenant while the UI says it moved, which
    -- is the one outcome a session change must never have.
    if not found then
      raise exception 'no active membership in company %', p_company_id
        using errcode = '42501';
    end if;

    v_switched := true;
  end if;

  -- Ordered exactly as `custom_access_token_hook` orders, so the first entry
  -- is the company the next token will carry. That is what lets the switcher
  -- mark the current company without a second source of truth.
  --
  -- `plan` is joined in, and that is a deliberate widening of what this
  -- function exposes. Without it the shell cannot render its header from a
  -- membership at all: `organizations.plan` names the plan line under the
  -- brand mark, and `organizations_owner` makes that row readable to the OWNER
  -- only -- so an invited member would hold a perfectly good tenant claim and
  -- still see "No company yet". The value is the plan of a company the caller
  -- is already a member of, it is on screen for them anyway, and it is
  -- reachable here for exactly the same rows as everything else: their own.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'company_id',     c.id,
               'legal_name',     c.legal_name,
               'timezone',       c.timezone,
               'plan',           o.plan,
               'role',           m.role,
               'employee_id',    m.employee_id,
               'last_active_at', m.last_active_at
             )
             order by m.last_active_at desc nulls last, m.created_at asc, m.id asc
           ),
           '[]'::jsonb
         )
    into v_companies
    from public.memberships m
    join public.companies c on c.id = m.tenant_id
    join public.organizations o on o.id = c.organization_id
   where m.user_id = v_user
     and m.is_active;

  return jsonb_build_object('switched', v_switched, 'companies', v_companies);
end;
$$;

comment on function public.switch_company(uuid) is
  'Lists the companies the caller holds an active membership in, and -- when '
  'given one -- makes it the active company by writing last_active_at. Reads '
  'and writes the caller''s own membership rows ONLY: every statement is '
  'filtered on the JWT subject and no argument names a user. security definer '
  'because the company list spans tenants by definition, which the tenant-keyed '
  'policy on memberships cannot express.';

alter function public.switch_company(uuid) owner to postgres;

revoke execute on function public.switch_company(uuid) from public;
grant execute on function public.switch_company(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- create_founding_membership -- the one row that makes a tenant reachable
-- --------------------------------------------------------------------------
--
-- Everything above this line worked and had nothing to work on. `memberships`
-- grants `authenticated` no write at all -- deliberately, because `tenant_id`
-- and `role` decide what the token carries and neither may be chosen by a
-- request path -- so signup created an organization and a company and left the
-- owner with no membership, no `tenant_id` in their token, and therefore every
-- tenant policy in the schema still evaluating to "see nothing" for them.
--
-- This closes that, and the shape is the narrowest one that does:
--
--   * `register_company` STAYS `security invoker`. The organization and the
--     company are still adjudicated by `organizations_owner` and
--     `companies_create_under_owned_org` exactly as they were. That safety net
--     is worth more than one fewer function.
--   * `memberships` KEEPS ZERO WRITE SURFACE. Nothing is granted to
--     `authenticated` here; `update public.memberships ...` as a request role
--     still answers `permission denied for table memberships`, and a test pins
--     it. The privilege lives in this function's owner, not in a grant.
--   * The function does ONE privileged thing. It takes a company and nothing
--     else -- there is no argument naming a user, so "create a membership for
--     somebody else" is not a call that can be written.
--
-- BEING `security definer` MEANS RLS WILL NOT CHECK OWNERSHIP FOR US. That is
-- the whole hazard of the tag and it is why the `exists` below is not
-- decoration: without it, any authenticated caller could hand this function
-- any company id and be made an admin of it. The check is the same fact
-- `companies_create_under_owned_org` asserts -- an organization this caller
-- owns -- restated where a definer can see it.
--
-- IDEMPOTENT, matching how `register_company` already resumes. A second call
-- returns the existing membership rather than raising or duplicating, so a
-- double-submitted signup, a retried registration, and an owner registered
-- BEFORE this migration existed all converge on one row. That last case is the
-- reason the call site below is unconditional rather than inside the
-- "company was just created" branch: calling `register_company` again is now
-- the repair path for an account that predates memberships.

create or replace function public.create_founding_membership(p_company_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user       uuid;
  v_membership uuid;
begin
  v_user := public.auth_user_id();

  -- From the JWT subject, never from an argument. There is no parameter that
  -- names a user, which is what makes "create a membership for a colleague"
  -- unexpressible rather than merely refused.
  if v_user is null then
    raise exception 'create_founding_membership requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- The check RLS would have made, made explicitly because `security definer`
  -- skips it. Ownership, not membership: this is the FOUNDING membership, so
  -- the caller cannot already be a member, and the only thing that can
  -- possibly authorise it is that they own the billing account the company
  -- hangs off.
  if not exists (
    select 1
      from public.companies c
      join public.organizations o on o.id = c.organization_id
     where c.id = p_company_id
       and o.owner_user_id = v_user
  ) then
    raise exception 'cannot create a founding membership in a company you do not own'
      using errcode = '42501';
  end if;

  -- Resume rather than duplicate. `unique (user_id, tenant_id)` would refuse
  -- the second insert anyway; returning the existing row instead makes a retry
  -- a no-op rather than an error the caller has to distinguish from a real one.
  select m.id
    into v_membership
    from public.memberships m
   where m.user_id = v_user
     and m.tenant_id = p_company_id;

  if v_membership is not null then
    return v_membership;
  end if;

  -- `admin`, and null `employee_id`. The person who registers the company is
  -- its administrator; `owner` is deliberately not a membership role, it lives
  -- above the tenant boundary. There are no employees until Story 1.8, so
  -- there is nothing to point at.
  --
  -- `last_active_at` is set: they are about to act in it, and the hook orders
  -- by this column. `on conflict do nothing` covers the concurrent case the
  -- select above cannot -- two tabs whose selects both miss.
  insert into public.memberships (
    tenant_id, user_id, role, employee_id, is_active, last_active_at
  )
  values (p_company_id, v_user, 'admin', null, true, now())
  on conflict (user_id, tenant_id) do nothing
  returning id into v_membership;

  if v_membership is null then
    select m.id
      into v_membership
      from public.memberships m
     where m.user_id = v_user
       and m.tenant_id = p_company_id;
  end if;

  return v_membership;
end;
$$;

comment on function public.create_founding_membership(uuid) is
  'Creates the admin membership for the caller in a company they own, once. '
  'The only write path into memberships other than switch_company, and the only '
  'thing in the schema that may write tenant_id or role at all. security definer '
  'because memberships grants no write to any request role by design; the '
  'ownership check against organizations.owner_user_id is explicit precisely '
  'because security definer skips the policy that would otherwise make it. '
  'Takes no user argument, so it cannot be aimed at anybody else. Idempotent.';

alter function public.create_founding_membership(uuid) owner to postgres;

revoke execute on function public.create_founding_membership(uuid) from public;
revoke execute on function public.create_founding_membership(uuid) from anon;
-- Granted to `authenticated` because `register_company` is `security invoker`:
-- it runs as the caller, so the caller is the role whose EXECUTE privilege is
-- checked when it calls this. Direct callability through PostgREST follows,
-- and is safe for the reasons above -- the user comes from the JWT and the
-- company must be one they own. Both are proved by attempting them in
-- tests/isolation/founding-membership.test.ts.
grant execute on function public.create_founding_membership(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- register_company -- unchanged, except that it now finishes the job
-- --------------------------------------------------------------------------
--
-- Replaced rather than edited: 20260827120000 is applied to the live project,
-- and a correction to an applied file is a new file. This is the same function
-- with one statement added, and it is still `security invoker`.
--
-- Everything in the original body is preserved verbatim -- the advisory lock,
-- the two-step resume, the stored-name return -- because all of it is still
-- load-bearing and the reasoning for each is in 20260827120000. Read that file
-- for the why; this one only adds the last line of the story.

create or replace function public.register_company(
  p_legal_name    text,
  p_npwp          text default null,
  p_npp_bpjs_tk   text default null,
  p_bpjs_kes_code text default null,
  p_timezone      text default 'Asia/Jakarta'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_org     uuid;
  v_company uuid;
  v_legal_name text;
  v_created boolean := false;
begin
  v_owner := public.auth_user_id();

  if v_owner is null then
    raise exception 'register_company requires an authenticated caller'
      using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text, 0)
  );

  select o.id
    into v_org
    from public.organizations o
   where o.owner_user_id = v_owner
   order by o.created_at, o.id
   limit 1;

  if v_org is null then
    insert into public.organizations (name, owner_user_id)
    values (btrim(p_legal_name), v_owner)
    returning id into v_org;
  end if;

  select c.id, c.legal_name
    into v_company, v_legal_name
    from public.companies c
   where c.organization_id = v_org
   order by c.created_at, c.id
   limit 1;

  if v_company is null then
    insert into public.companies (
      organization_id, legal_name, npwp, npp_bpjs_tk, bpjs_kes_code, timezone
    )
    values (
      v_org,
      btrim(p_legal_name),
      nullif(btrim(p_npwp), ''),
      nullif(btrim(p_npp_bpjs_tk), ''),
      nullif(btrim(p_bpjs_kes_code), ''),
      coalesce(nullif(btrim(p_timezone), ''), 'Asia/Jakarta')
    )
    returning id, legal_name into v_company, v_legal_name;
    v_created := true;
  end if;

  -- THE LINE THIS MIGRATION EXISTS TO ADD.
  --
  -- Unconditional, not inside the branch above, and idempotent on the other
  -- side -- so it creates the membership for a company registered a moment ago
  -- and equally for one registered before memberships existed. Same
  -- transaction as the two inserts, so the registration stays atomic in all
  -- three of its parts: a failure here takes the company and the organization
  -- with it rather than leaving a tenant nobody can enter.
  perform public.create_founding_membership(v_company);

  return jsonb_build_object(
    'organization_id', v_org,
    'company_id',      v_company,
    'legal_name',      v_legal_name,
    'created',         v_created
  );
end;
$$;

comment on function public.register_company(text, text, text, text, text) is
  'Signup''s only write: creates an organization, its first company, and the '
  'caller''s founding admin membership in one transaction, under the caller''s '
  'own RLS. Resumes an existing registration rather than creating a second '
  'organization, and completes a registration that predates memberships. '
  'security invoker by design -- the atomicity comes from the transaction, not '
  'from a privilege, and only the membership insert is privileged, in a '
  'separate function that takes no user argument.';

revoke execute on function public.register_company(text, text, text, text, text) from public;
grant execute on function public.register_company(text, text, text, text, text) to authenticated;

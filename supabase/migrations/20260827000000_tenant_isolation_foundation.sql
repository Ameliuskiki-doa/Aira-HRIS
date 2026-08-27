-- Story 1.4 -- the tenant boundary, and the first two tables above it.
--
-- This is the first migration in the repo, so it also establishes the pattern
-- every later one copies: a table is created, RLS is enabled *and* forced, a
-- policy is written, and the tenant_id-leading index is added -- all in this
-- same file. tests/isolation/ sweeps the catalog for anything that skipped a
-- step, so a table added without them fails CI rather than leaking.
--
-- Portability note. This file is applied to two different substrates: a bare
-- `postgres:17` container (the CI gate) and a real Supabase project. Supabase
-- is the *stricter* of the two -- it already owns `anon`/`authenticated` and
-- denies CREATE on `auth` to the migration role -- so everything that could
-- collide there is guarded here, and nothing is created outside `public`.
--
-- Version floor: **Postgres 16**. The claim functions below use the `IS JSON`
-- predicate to fail closed on a malformed claim without a plpgsql EXCEPTION
-- block, because an EXCEPTION block opens a subtransaction and subtransactions
-- are forbidden inside parallel workers -- which would make `parallel safe`
-- a runtime error rather than an optimisation. `IS JSON` is 16+; provision the
-- Supabase project on 16 or later.

-- --------------------------------------------------------------------------
-- Extensions
-- --------------------------------------------------------------------------

-- Consumed first by `departments.path` in Story 1.7. Created here because the
-- department tree is queried with an ltree operator on every approval-routing
-- request, and adding an extension later is a second migration for no reason.
create extension if not exists ltree;

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------
--
-- Supabase ships both of these; a bare container has neither. `create role`
-- has no `if not exists`, hence the guard. Both are NOLOGIN: they are the
-- roles a request *switches into*, never roles anything connects as.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

-- --------------------------------------------------------------------------
-- The tenant claim
-- --------------------------------------------------------------------------
--
-- `public.tenant_id()`, not `auth.tenant_id()`. Creating a function in `auth`
-- fails under `supabase db reset` with "permission denied for schema auth":
-- migrations run as `postgres`, and `auth` is owned by `supabase_admin`. This
-- was measured, twice, and every project document was repointed on 2026-08-27.
--
-- `app_metadata`, never `user_metadata` -- the latter is writable by the user
-- whose rows it would then be gating (CLAUDE.md rule 4).
--
-- **Fails closed on every malformed input, not just on the absent one.** Four
-- states reach this function and all four must return null rather than raise,
-- because a policy that raises turns an anonymous read into a 500 instead of
-- an empty set:
--
--   1. GUC never set               -> current_setting(..., true) is null
--   2. GUC set to '' -- **the likely anonymous path**, because PostgREST
--      *clears* request.* GUCs to the empty string on a pooled connection
--      rather than unsetting them  -> nullif() catches it
--   3. GUC set to a non-JSON string -> `IS JSON OBJECT` is false
--   4. tenant_id present but not a UUID -> the regex rejects it before the cast
--
-- States 2 and 4 both raised `22P02 invalid input syntax` in an earlier
-- version of this file, and neither was reachable by the isolation suite,
-- which only ever tested state 1. Both now have cases in tests/isolation/.
--
-- `parallel safe` is load-bearing, not decoration: a parallel-unsafe function
-- anywhere in a plan disables parallel query for the entire statement, which
-- is exactly the tenant-wide sequential scan the `(select ...)` wrapping rule
-- exists to make cheap. `current_setting` is itself `proparallel = s`, so
-- there is nothing here that has to be unsafe. No EXCEPTION block, for the
-- same reason -- see the version note at the top of the file.
--
-- Reachable as a PostgREST RPC by any authenticated caller, and EXECUTE cannot
-- be revoked from `authenticated` because policy expressions are evaluated as
-- the calling role. It returns only the caller's own claim -- a value the
-- caller already holds in its JWT -- so the exposure is nil. Stated here so it
-- does not have to be rediscovered.
create or replace function public.tenant_id()
returns uuid
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
           when candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             then candidate::uuid
         end
  from (
    select case
             when raw is json object
               then (raw::jsonb -> 'app_metadata' ->> 'tenant_id')
           end as candidate
    from (select nullif(current_setting('request.jwt.claims', true), '') as raw) as source
  ) as parsed
$$;

comment on function public.tenant_id() is
  'The active tenant (= companies.id) from app_metadata in the request JWT. '
  'Returns null for an absent, empty, malformed or non-UUID claim, so policies '
  'fail closed instead of raising. Always call it wrapped: (select public.tenant_id()).';

-- The caller's own auth.users id. `organizations` sits above the tenant
-- boundary, so it cannot be keyed on a tenant; it is keyed on ownership, and
-- this is where ownership comes from. Same four failure states, same handling.
create or replace function public.auth_user_id()
returns uuid
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
           when candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             then candidate::uuid
         end
  from (
    select case
             when raw is json object
               then (raw::jsonb ->> 'sub')
           end as candidate
    from (select nullif(current_setting('request.jwt.claims', true), '') as raw) as source
  ) as parsed
$$;

comment on function public.auth_user_id() is
  'The subject of the request JWT (auth.users.id). Null for an absent, empty, '
  'malformed or non-UUID claim. Always call it wrapped: (select public.auth_user_id()).';

grant execute on function public.tenant_id() to anon, authenticated;
grant execute on function public.auth_user_id() to anon, authenticated;

-- --------------------------------------------------------------------------
-- organizations -- above the tenant boundary
-- --------------------------------------------------------------------------
--
-- The billing account. One organization owns one or more companies; the
-- relation is 1:1 for a single-PT client and invisible to them, but inserting
-- a layer above an existing hierarchy once production data exists is the
-- expensive migration, so it is built now.
--
-- It carries no `tenant_id` column, and cannot: it is the thing tenants hang
-- off. That is one of the three allowlisted exemptions in tests/isolation/,
-- and it exempts the *column* only -- RLS, force and a policy are still
-- required and are below.

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null,
  plan          text not null default 'free',
  created_at    timestamptz not null default now(),
  constraint organizations_plan_check check (plan in ('free', 'core', 'payroll'))
);

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

-- Keyed on ownership, because there is no tenant to key on. The wrapping is
-- not cosmetic: without the subquery Postgres re-evaluates the claim per row.
create policy organizations_owner on public.organizations
  for all
  to authenticated
  using (owner_user_id = (select public.auth_user_id()))
  with check (owner_user_id = (select public.auth_user_id()));

-- The access path the policy itself takes. `tenant_id` does not exist on this
-- table, so the leading column is the ownership key instead.
create index organizations_owner_user_id_idx
  on public.organizations (owner_user_id, id);

grant select, insert, update, delete on public.organizations to authenticated;

comment on table public.organizations is
  'Billing account. Above the tenant boundary: no tenant_id column by design, '
  'access keyed on owner_user_id. Allowlisted in tests/isolation/.';

-- --------------------------------------------------------------------------
-- companies -- the tenant boundary itself
-- --------------------------------------------------------------------------
--
-- One legal entity (PT) per tenant. `companies.id` IS the `tenant_id` every
-- other table carries, which is why this table has no `tenant_id` column of
-- its own: it would be a copy of its own primary key.

create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  legal_name      text not null,
  npwp            text,
  npp_bpjs_tk     text,
  bpjs_kes_code   text,
  address         text,
  -- WIB / WITA / WIT. The day boundary for attendance and payroll is resolved
  -- in this zone, never in the server's.
  timezone        text not null default 'Asia/Jakarta',
  created_at      timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.companies force row level security;

-- `id` is the tenant id, so this is the tenant policy -- the same shape every
-- later table gets, spelled against the column that happens to be the key.
--
-- The WITH CHECK carries a second clause the USING does not. Without it a
-- tenant could re-point `organization_id` at somebody else's billing account:
-- the row would still be its own (`id = tenant_id()`), so the tenant rule
-- alone says yes. The `exists` is evaluated under `organizations`' own RLS as
-- the invoker, so it resolves to "an organization this caller owns".
create policy companies_tenant on public.companies
  for all
  to authenticated
  using (id = (select public.tenant_id()))
  with check (
    id = (select public.tenant_id())
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.owner_user_id = (select public.auth_user_id())
    )
  );

-- The signup path, and the reason it needs its own policy.
--
-- A user who has just signed up holds a `sub` and no `tenant_id`: the tenant
-- does not exist yet, because *this insert is what creates it*. The policy
-- above demands `id = tenant_id()`, which no fresh signup can satisfy, so
-- without this one `companies` would be a table nothing can write to and
-- Story 1.5 ("sign up by email and create a company") would have no path at
-- all. Keyed on the same ownership fact as `organizations`: you may create a
-- company under an organization you own, and nowhere else.
create policy companies_create_under_owned_org on public.companies
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.owner_user_id = (select public.auth_user_id())
    )
  );

-- The readback half of the signup path, and a genuinely separate rule.
--
-- The INSERT above is permitted, and it still failed -- because `RETURNING`
-- (and PostgREST's default `Prefer: return=representation`) requires the new
-- row to be visible under a SELECT policy, and a fresh signup holds no tenant
-- claim. Reproduced: without RETURNING the insert succeeds; with it, the same
-- statement raises "new row violates row-level security policy". Story 1.5
-- needs that id to mint the token that carries the tenant claim, so a table
-- it can write and not read is no more usable than one it cannot write.
--
-- Deliberately wider than the active tenant claim, and this is the decision
-- worth reading twice: an organization owner may read every company under an
-- organization they own, including ones that are not their active tenant.
-- That is required, not incidental -- the company switcher has to render the
-- legal name and branch count of companies the user is *not* currently in, so
-- `companies` cannot be gated on the active claim alone. The tenant boundary
-- for tenant *data* (employees, payroll, attendance) stays absolute; this row
-- is the boundary itself, and its owner sits above it.
--
-- Story 1.6 widens the key from "organizations you own" to "companies you hold
-- an active membership in", which is the same shape with memberships in place
-- of ownership.
create policy companies_visible_to_org_owner on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.owner_user_id = (select public.auth_user_id())
    )
  );

create index companies_organization_id_idx
  on public.companies (organization_id, id);

-- No DELETE. `companies.id` is the tenant id every other table's rows hang
-- off, so deleting this row orphans the tenant's entire dataset behind a
-- foreign key that no longer resolves. Offboarding is a deliberate,
-- audit-logged flow, not a DELETE a request path can reach.
--
-- Note for Story 1.6: the WITH CHECK above makes UPDATE an owner-only
-- operation, because `owner_user_id` is the only principal that exists today.
-- When membership roles arrive, the ownership clause becomes "an organization
-- reachable by this membership" and this comment goes away.
grant select, insert, update on public.companies to authenticated;

comment on table public.companies is
  'Legal entity. companies.id IS the tenant_id used by every other table, so '
  'there is no tenant_id column here. Allowlisted in tests/isolation/.';

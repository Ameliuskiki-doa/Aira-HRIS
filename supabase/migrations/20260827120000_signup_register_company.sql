-- Story 1.5 -- the one write that turns a stranger with an email address into
-- a tenant.
--
-- A NEW migration, deliberately. 20260827000000_tenant_isolation_foundation.sql
-- is already applied to the live project; a correction there is a new file,
-- never an edit, so this one only adds.
--
-- What it adds:
--   1. two check constraints on `companies`, because the day boundary and the
--      name on a payslip are invariants rather than form validation;
--   2. `public.register_company()`, a **security invoker** plpgsql function
--      that creates the organization and the company in ONE transaction and
--      resumes instead of duplicating when it is called twice.
--
-- Why a function and not two inserts from a route handler.
--
-- PostgREST runs an RPC inside a single transaction, so a plpgsql function
-- gives full atomicity with no extra machinery. Two sequential PostgREST
-- inserts do not: both succeed under a `sub`-only claim, but when the second
-- fails the `organizations` row survives -- readable and writable by its
-- owner, with no unique constraint on `owner_user_id` to stop the next retry
-- adding another. Measured on 2026-08-27: `orphan orgs visible | 1`.
--
-- Why `security invoker` and not `security definer`.
--
-- `security definer` would bypass the caller's policies by construction, and
-- tests/isolation/ refuses one without an allowlist entry -- correctly, since
-- that is a proven leak surface. None is needed: the function runs as the
-- caller, so `organizations_owner` and `companies_create_under_owned_org`
-- adjudicate every row it writes, exactly as they would for a direct insert.
-- The atomicity comes from the transaction, not from the privilege.
--
-- Portability: nothing is created outside `public`, and nothing here needs a
-- privilege the migration role lacks on a real Supabase project.
--
-- **Re-runnable.** `create or replace function` and `grant`/`revoke` already
-- are; `alter table ... add constraint` is not -- Postgres has no
-- `if not exists` for it and raises 42710 on a second application, which would
-- take a whole `supabase db push` down with it. That is not hypothetical here:
-- the live migration ledger disagrees with this directory (see
-- deferred-work.md), and the runbook for reconciling it ends in a push. Each
-- constraint is therefore guarded on `pg_constraint`.

-- --------------------------------------------------------------------------
-- companies -- invariants that must survive every code path
-- --------------------------------------------------------------------------
--
-- Zod rejects both of these at the route-handler boundary. These constraints
-- exist because a boundary check protects the one path it sits on, and this
-- table is also written by an RPC, by a future import, and by whatever Story
-- 1.6 adds. An invariant that must hold on every path lives in the database.

-- Indonesia has **three legal time zones spread over four IANA identifiers**,
-- and `companies.timezone` is the day boundary every attendance record and
-- payroll period is resolved in. A value outside the set silently shifts a
-- clock-in across midnight and moves a day's work into the wrong period.
--
-- `Asia/Pontianak` is the fourth identifier and the one that gets forgotten:
-- West Kalimantan, WIB, same offset as Jakarta and a distinct zone in the IANA
-- database. An earlier draft of this file listed three identifiers, which meant
-- a Pontianak company could not register at all -- the insert raised 23514 and
-- there was no other value it could honestly have chosen.
-- `components/shell/timezone.ts` has carried a comment naming exactly this trap
-- since Story 1.3; it is repeated here because this constraint is where the
-- mistake becomes unrecoverable for a tenant.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'companies_timezone_check'
       and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_timezone_check
      check (timezone in ('Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura'));
  end if;
end
$$;

-- `not null` already forbids the absent name; this forbids the blank one.
-- `legal_name` is what prints on a payslip, so '   ' is not a legal entity.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'companies_legal_name_not_blank'
       and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_legal_name_not_blank
      check (btrim(legal_name) <> '');
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- register_company -- signup's only write
-- --------------------------------------------------------------------------
--
-- Returns jsonb rather than a composite so one PostgREST call yields one
-- object: `{organization_id, company_id, created}`. `created` is false when
-- the call resumed an existing registration, which is what the caller needs to
-- decide between "welcome" and "you already have one".
--
-- The resume rule is a lookup, not a constraint. `organizations.owner_user_id`
-- carries no unique index -- one person owning several billing accounts is a
-- shape the data model allows -- so "do not create a second" cannot be
-- delegated to the database as a violation. It is a select-then-insert, and
-- the advisory lock below is what makes that safe under a double-submit.
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

  -- Fails closed rather than inserting a row owned by nobody. The claim
  -- function returns null for an absent, empty, malformed or non-UUID claim,
  -- so this one branch covers every unauthenticated shape. RLS would refuse
  -- the insert anyway; saying so explicitly turns a policy violation into a
  -- message the route handler can map to 401.
  if v_owner is null then
    raise exception 'register_company requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- Serialises concurrent registrations by the same owner, and only by the
  -- same owner. Two tabs, or a double-tapped submit button, otherwise both
  -- read "no organization" before either inserts and the user ends up with
  -- two. Transaction-scoped, so it is released with the statement whatever
  -- happens next.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text, 0)
  );

  -- Resume, step one: the billing account. Read under the caller's own
  -- policies, so "an organization this user owns" is the only thing findable.
  select o.id
    into v_org
    from public.organizations o
   where o.owner_user_id = v_owner
   order by o.created_at, o.id
   limit 1;

  if v_org is null then
    -- The organization is the billing account and is invisible to a
    -- single-PT client, so it takes the company's name rather than asking
    -- for a second one nobody would understand the purpose of.
    -- `plan` is deliberately not named. The column carries a default of
    -- 'free' and `authenticated` holds no INSERT privilege on it, so the tier
    -- is not something a caller can choose -- not through this function and
    -- not through PostgREST either. See 20260827140000_tighten_write_surface.
    insert into public.organizations (name, owner_user_id)
    values (btrim(p_legal_name), v_owner)
    returning id into v_org;
  end if;

  -- Resume, step two: the company. A retry after a failed second insert finds
  -- the organization above and no company here, and completes the half-made
  -- registration instead of starting a new one.
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
      -- Blank and absent are the same fact, and both store as null. An empty
      -- string would print on a tax form as if it were an NPWP.
      nullif(btrim(p_npwp), ''),
      nullif(btrim(p_npp_bpjs_tk), ''),
      nullif(btrim(p_bpjs_kes_code), ''),
      coalesce(nullif(btrim(p_timezone), ''), 'Asia/Jakarta')
    )
    returning id, legal_name into v_company, v_legal_name;
    v_created := true;
  end if;

  -- `legal_name` is the *stored* one, which is not always the one that was
  -- passed in. Two tabs submitting at once serialise on the advisory lock
  -- above: the loser resumes the winner's registration, and without this it
  -- would be told `created:false` with no way to know its own input was
  -- discarded -- so the screen would say "done" about a name that is not
  -- there. Returning the stored name lets the caller say which company exists.
  return jsonb_build_object(
    'organization_id', v_org,
    'company_id',      v_company,
    'legal_name',      v_legal_name,
    'created',         v_created
  );
end;
$$;

comment on function public.register_company(text, text, text, text, text) is
  'Signup''s only write: creates an organization and its first company in one '
  'transaction, under the caller''s own RLS. Resumes an existing registration '
  'rather than creating a second organization. security invoker by design -- '
  'the atomicity comes from the transaction, not from a privilege.';

-- EXECUTE is granted to PUBLIC by default, which includes `anon`. Revoked
-- first, then granted to the one role that can possibly succeed: the function
-- fails closed without a claim, but a callable-by-anon write endpoint is not
-- something to leave standing on the strength of an internal check.
revoke execute on function public.register_company(text, text, text, text, text) from public;
grant execute on function public.register_company(text, text, text, text, text) to authenticated;

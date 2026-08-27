-- Story 1.5, hardening pass -- the write surface a request actually has.
--
-- The application is not the only caller. PostgREST exposes every table the
-- `authenticated` role has been granted, and `public.register_company()` is
-- callable directly with the user's own JWT, so a bound that lives only in a
-- Zod schema binds only the callers who use the form. Two families of hole
-- were reproduced against a live container before this file existed:
--
--   1. **The paid tier was self-service.** `organizations_owner` is `FOR ALL`
--      and UPDATE was granted on the whole table, so
--      `update organizations set plan = 'payroll' where owner_user_id = <self>`
--      returned `UPDATE 1`. No policy was ever going to catch it: the row
--      genuinely is the caller's own. The row is theirs; the column is not.
--      INSERT was the same story from the other side -- the WITH CHECK only
--      ever asked who owned the row, so `insert ... plan = 'payroll'` worked.
--
--   2. **`text` has no length.** `insert into companies (legal_name)
--      values (repeat('X', 500000))` stored half a megabyte, and so did the
--      RPC. `not null` says nothing about size.
--
-- Forward-only and additive: this file grants nothing new and creates no
-- table. It narrows privileges granted by 20260827000000 and adds constraints.
-- It does not edit that file, which is applied to the live project.
--
-- Re-runnable, like its predecessor. `revoke`/`grant` are idempotent by
-- nature; each constraint is guarded on `pg_constraint`, because
-- `alter table ... add constraint` raises 42710 on a second application and
-- the ledger-repair runbook in deferred-work.md ends in `supabase db push`.

-- --------------------------------------------------------------------------
-- organizations -- the plan is ours, not the tenant's
-- --------------------------------------------------------------------------
--
-- Column-level privilege rather than a trigger or a policy clause, because
-- this is a privilege question and not a row question. RLS decides *which
-- rows* a caller may touch; it has no vocabulary for "this row, but not that
-- column". A trigger would work and would run on every write to say something
-- the grant system can say once, statically, and that `\dp` will show.
--
-- CLAUDE.md rule 9 in its general form: what the tenant pays for is ours to
-- set, exactly as the statutory rates are. Billing changes plans; a request
-- path does not.

revoke insert, update on public.organizations from authenticated;

-- `name` and `owner_user_id` only.
--
-- `plan` is absent, which is the point of the file. `id` and `created_at` are
-- absent too, and deliberately: letting a caller choose a primary key invites
-- squatting on an id another tenant is about to be given, and letting one
-- choose `created_at` rewrites the tie-break that `register_company`'s resume
-- lookup orders by.
--
-- `owner_user_id` IS granted, and that is safe rather than an oversight: the
-- `organizations_owner` policy's WITH CHECK pins it to `auth_user_id()`, so a
-- caller can only ever write their own id into it. They cannot give an
-- organization away and they cannot take one. The grant exists so that the
-- ordinary "update a row's own key to itself" write that the isolation suite
-- performs on every relation still resolves to a policy decision rather than
-- to a privilege error.
grant insert (name, owner_user_id) on public.organizations to authenticated;
grant update (name, owner_user_id) on public.organizations to authenticated;

comment on column public.organizations.plan is
  'free|core|payroll. Set by billing, never by a request path: `authenticated` '
  'holds no INSERT or UPDATE privilege on this column. A customer upgrading '
  'themselves was reproduced as `UPDATE 1` before that grant was narrowed.';

-- --------------------------------------------------------------------------
-- length -- the same bounds the Zod schemas carry
-- --------------------------------------------------------------------------
--
-- The numbers are `lib/validation/company.ts`'s numbers, and a test asserts
-- the two agree. Two walls that disagree are one wall plus a false sense of
-- the other: a value the form refuses and the table accepts is reachable by
-- anyone who skips the form, and a value the form accepts and the table
-- refuses is a customer who cannot register and a 500 nobody can explain.
--
-- Stated as `char_length`, not `varchar(n)`. A type change rewrites the table
-- and is a different migration to run against a large one later; a check
-- constraint is validated once and is cheap to widen.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'companies_legal_name_length'
       and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_legal_name_length
      check (char_length(legal_name) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'companies_identifier_length'
       and conrelid = 'public.companies'::regclass
  ) then
    -- One constraint over the three optional identifiers rather than three.
    -- They share a bound and a reason, and a single name is what a failing
    -- write reports -- which is more useful than knowing which of three.
    alter table public.companies
      add constraint companies_identifier_length
      check (
        char_length(coalesce(npwp, '')) <= 32
        and char_length(coalesce(npp_bpjs_tk, '')) <= 32
        and char_length(coalesce(bpjs_kes_code, '')) <= 32
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'companies_address_length'
       and conrelid = 'public.companies'::regclass
  ) then
    -- Not writable from any screen yet. Bounded now anyway: the column is
    -- granted, so it is writable through PostgREST today, and a column that
    -- gains a form later would gain it without anyone rechecking this file.
    alter table public.companies
      add constraint companies_address_length
      check (char_length(coalesce(address, '')) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'organizations_name_length'
       and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_name_length
      check (char_length(name) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'organizations_name_not_blank'
       and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_name_not_blank
      check (btrim(name) <> '');
  end if;
end
$$;

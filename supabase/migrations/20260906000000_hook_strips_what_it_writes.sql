-- Make the access token hook strip exactly the claims it writes.
--
-- Forward-only correction of `custom_access_token_hook` from
-- 20260827160000_memberships_and_tenant_context.sql. Nothing else changes: same
-- signature, same owner, same grants, same ordering, same totality gates.
--
-- WHAT WAS WRONG. The strip was a list:
--
--     v_app_metadata := v_app_metadata - 'tenant_id' - 'role' - 'employee_id';
--
-- and the comment above it stated the property correctly -- "an inbound
-- tenant_id cannot survive a deactivation". The two agreed on the day they were
-- written and would part company the first time a fourth claim was added. A
-- claim the hook writes but does not strip is passed straight through from the
-- inbound event, so a deactivated or switched user keeps it by refreshing, for
-- as long as they keep refreshing.
--
-- It was not exploitable and is not being fixed as an exposure: `app_metadata`
-- is not user-writable (CLAUDE.md rule 4), so nothing can be injected from
-- outside. It is a hazard that arms itself the moment the claim set grows --
-- and Story 1.7 introduces branches, which is the obvious fourth claim.
--
-- WHAT CHANGES. The object the hook writes is now built FIRST, unconditionally,
-- with every owned key present -- null-valued when there is no membership --
-- and the strip is derived from that object's own keys:
--
--     v_app_metadata := v_app_metadata - array(select jsonb_object_keys(v_owned));
--
-- So "the claims this hook owns" is stated once, in the one place a reader
-- would look for it. Adding a fourth key to `jsonb_build_object` extends the
-- strip in the same edit, and forgetting to is no longer possible rather than
-- merely unlikely. `tests/isolation/access-token-hook.test.ts` asserts the
-- relationship as a property: it takes the keys the hook injects for a user WITH
-- a membership, feeds all of them back in for a user WITHOUT one, and requires
-- that none survives -- so the test grows with the claim set too.
--
-- Behaviour is otherwise identical, and the existing suite pins that: strip on
-- deactivation, strip for a user with no membership row, `user_metadata` left
-- alone, the four malformed-event gates, and the ordering contract shared with
-- `switch_company()`.

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
  v_owned        jsonb;
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
  end if;

  -- THE CLAIM SET, stated once. Built whether or not a membership was found,
  -- because its KEYS are the strip list and the strip must happen on every
  -- path -- especially the path where no membership was found, which is
  -- exactly the deactivated user whose old claims must not survive.
  --
  -- `employee_id` is deliberately a JSON null rather than an omitted key when
  -- there is no employee: "this membership has no employee record" and "this
  -- token predates employee ids" are different facts, and only one of them is
  -- true.
  v_owned := jsonb_build_object(
    'tenant_id',   v_tenant_id,
    'role',        v_role,
    'employee_id', v_employee_id
  );

  -- Strip what we own, derived from what we write. Unconditional.
  v_app_metadata := v_app_metadata - array(select jsonb_object_keys(v_owned));

  -- Re-add only on the membership path. `v_tenant_id is not null` is the same
  -- condition as before; what changed is that the strip no longer depends on
  -- anyone remembering to keep a second list in step with this object.
  if v_tenant_id is not null then
    v_app_metadata := v_app_metadata || v_owned;
  end if;

  return jsonb_set(event, '{claims,app_metadata}', v_app_metadata, true);
end;
$$;

alter function public.custom_access_token_hook(jsonb) owner to postgres;

revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Custom Access Token Hook. Injects app_metadata.tenant_id, role and '
  'employee_id from the caller''s active membership, re-validating is_active at '
  'issuance. Strips every claim it owns first, derived from the object it '
  'writes rather than from a second list, so a deactivated user fails closed '
  'and a claim added later cannot be forgotten. TOTAL: it returns the event '
  'unchanged rather than raising on any malformed shape, because GoTrue returns '
  'before signing on a hook failure.';

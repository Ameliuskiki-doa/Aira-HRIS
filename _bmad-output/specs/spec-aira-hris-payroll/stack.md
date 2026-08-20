# Stack and Platform

Companion to `SPEC.md`. Platform choices, the multi-tenancy mechanism, and the cost controls that make the unit economics in `commercial-model.md` hold.

## Layers

| Layer | Choice |
|---|---|
| Frontend + API | Next.js (App Router) on Vercel |
| Database + Auth | Supabase (Postgres, RLS, Auth) |
| Attendance photos | Cloudflare R2 — **not** Supabase Storage (egress cost) |
| Background jobs | Separate worker (Railway / Fly) — **not** Vercel functions |
| Mobile | PWA first; native later if needed |

## Multi-tenancy: pooled, shared schema

One Postgres database. One schema. `tenant_id` on every table. RLS is the isolation boundary.

Rejected alternatives:

| Model | Why not |
|---|---|
| Database per tenant | Supabase bills compute per project. 300 clients = 300× compute. |
| Schema per tenant | Every migration becomes a 300-iteration loop that can fail midway. Catalog bloat, slow `pg_dump`. Isolation is illusory anyway — an app-layer bug can still select the wrong schema. |

**`tenant_id` = `company_id`** — one legal entity (PT). Not a group, not a branch. NPWP, NPP BPJS, PKWT contracts and 1721-A1 all attach to a legal entity.

## RLS patterns

Claim extraction, wrapped in a STABLE function:

```sql
create function auth.tenant_id() returns uuid
language sql stable as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json
      -> 'app_metadata' ->> 'tenant_id', ''
  )::uuid
$$;
```

Policy — **note the subquery**:

```sql
alter table attendances enable row level security;
alter table attendances force row level security;

create policy tenant_isolation on attendances
  using (tenant_id = (select auth.tenant_id()))
  with check (tenant_id = (select auth.tenant_id()));
```

Without `(select ...)` the function runs once per row. On a multi-million-row attendance table this is a 10–100× difference and is the single most likely cause of an unnecessary compute tier upgrade.

`tenant_id` lives in `app_metadata`, never `user_metadata` — `user_metadata` is user-writable.

Indexes must lead with `tenant_id`, otherwise they are unusable once RLS adds its predicate:

```sql
create index on attendances (tenant_id, employee_id, work_date);
create index on payroll_items (tenant_id, payroll_run_id);
```

### Cross-company access

Group HR needs several companies. **Do not create a bypass role.** Grant via explicit `memberships` rows, one per company, and resolve through a view:

```sql
create view user_companies as
  select company_id from memberships
  where user_id = (select auth.uid());

create policy company_access on employees
  using (company_id in (select company_id from user_companies));
```

The JWT carries **one active company at a time.** Switching companies reissues the token. No query ever returns blended cross-company rows — aggregate reporting goes through a separate path.

### Workers and RLS

Background jobs are where cross-tenant leaks actually happen, because `service_role` bypasses RLS entirely.

Workers use a dedicated role with `FORCE ROW LEVEL SECURITY`, and set tenant context at the start of each transaction:

```sql
begin;
set local request.jwt.claims = '{"app_metadata":{"tenant_id":"<uuid>"}}';
-- work here; a forgotten WHERE clause is now caught by the database
commit;
```

## Compute and query discipline

Supabase Pro does not scale to zero — the instance is paid 24/7. HRIS traffic is extremely spiky (07:30–08:30 clock-in, payroll dates), so you pay peak capacity all day. **Query efficiency is directly a cost question.**

- **Materialized views for all aggregate reporting.** Monthly attendance recaps, overtime reports, supervisor analytics. Refresh nightly, incremental for the current day. Live aggregate queries are what force the Small → Medium → Large upgrade path.
- **Partition `attendances` by month** (`PARTITION BY RANGE (work_date)`), not by tenant. Monthly partitions make archival a `DETACH PARTITION`.
- **Connection pooling via Supavisor transaction mode.** Never direct connections from serverless.
- **`statement_timeout` per role.** One tenant running an annual report must not freeze everyone else.
- **Queue payroll runs with a concurrency limit.** Ten tenants calculating payroll simultaneously on the 25th will saturate the instance.

## Background jobs

Payroll calculation for a few thousand employees is a batch job, not request-response. Vercel functions and Supabase Edge Functions both time out.

Run a dedicated worker (Railway / Fly, ~USD 10–40/month) consuming a job queue. Jobs: payroll calculation, payslip PDF generation, report materialisation, photo thumbnail generation, scheduled archival.

Every job must be **idempotent and keyed**, so a retry cannot double-post.

## Storage

Attendance photos go to **Cloudflare R2**, not Supabase Storage. R2 egress is free; Supabase storage egress is billed per GB above the included allowance and is the one meter that can run away.

- Client-side compression before upload — target 60–80 KB, not the 3 MB the camera produces
- Thumbnail (10–15 KB) generated once at upload; list views serve thumbnails only
- Path prefix `{tenant_id}/{employee_id}/{date}.jpg`
- Access only via short-TTL signed URLs. **No public buckets, ever.**
- Retention: archive or delete photos older than 6 months (30 days on free tier)
- **Never route uploads through a Next.js handler** — client → R2 via signed URL
- **Do not use Vercel Image Optimization for attendance photos.** It bills per source image, and attendance photos are always unique so they never hit cache.

## Cost controls

- **Spend Management with hard pause**, not just alerts. Vercel bandwidth incidents have produced four- and five-figure bills from crawlers and DDoS. At Rp60jt/month revenue this is existential.
- **WAF / bot controls** on any route serving media.
- **Minimise Vercel deploying seats.** Viewers are free.
- **No log drains** until genuinely needed (USD 60/month each plus per-event).
- **Avoid Supabase Realtime.** Concurrent connections are billed and HRIS does not need it. Poll every 30s.
- **One production project.** Staging on free tier. Branches only while in use.

## Data residency

Supabase has no Indonesia region; nearest is Singapore. Acceptable for SMB.

If a client demands local residency, that is a **separate paid tier** — a self-hosted Supabase instance on a local provider with the identical schema, fed by a `tenant_id`-filtered dump. It is not a migration and not the default.

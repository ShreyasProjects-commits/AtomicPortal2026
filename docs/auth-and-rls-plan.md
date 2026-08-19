# FitPortal — Auth & Row Level Security Plan

Status: DRAFT. Auth method is not yet decided in the codebase — this document
proposes an approach and lists the RLS policies needed once it's confirmed.

## 1. What's already in place

From `supabase/schema.sql`:

- Every table has RLS turned on: `items`, `containers`, `orders`, `order_items`,
  `order_containers`, `order_results`.
- **Edge Functions use the service role key** and bypass RLS for import, optimise,
  and read APIs (`orders`, `order-result`). The browser calls Edge Functions, not
  Postgres directly.
- No RLS policies exist yet for client-side Supabase access. Until auth + policies
  are added, **do not expose the anon key for direct table reads in production**.
- `profiles` table is in the ERD but not yet in `schema.sql` — add with auth work.

## 2. Open decision: login method

Not specified anywhere in the repo. Supabase Auth supports several options
out of the box:

| Option | Setup effort | Notes |
|---|---|---|
| Email + password | Low | Simplest, no external app registration needed |
| Google OAuth | Medium | Needs a Google Cloud OAuth client ID/secret, redirect URL config in Supabase dashboard |
| Magic link (passwordless email) | Low | Good UX, no password to manage, but adds email-deliverability dependency |

Since Thomax staff are likely using company Google accounts, Google OAuth may
be the natural fit for an internal ops tool, but that's a guess on my part,
not something confirmed anywhere in the project files. This needs a decision
from the team (and possibly the client), since it affects:

- Whether `profiles` rows get created via a trigger on `auth.users` insert, or
  manually on first login
- Whether you need a Google Cloud OAuth app registered before Sprint 2
- Onboarding flow — can staff self-register, or does a supervisor have to
  create accounts?

**Recommendation:** decide this before writing RLS policies, since the
account-creation flow (self-signup vs invite-only) affects how `profiles.role`
gets set on first login. A sane default for an internal ops tool: new users
land as `viewer` by default, and only an existing supervisor (or a manual DB
edit early on) can promote someone to `supervisor`.

## 3. Proposed RLS policies

Based on the role model already in the ERD (viewer = read-only,
supervisor = can also run the optimiser). These are a starting point — write
and test them in a Supabase branch/staging project before applying to prod.

### `profiles`
- SELECT: a user can read their own profile row (`id = auth.uid()`).
- UPDATE: none from the client for `role` — role changes should go through a
  supervisor-only path or an admin action, not a self-service update, or any
  user could promote themselves.

### `containers`
- SELECT: any authenticated user (viewers included) can read active containers.
- INSERT/UPDATE: any authenticated user can save/reuse boxes, per the ERD note
  "PROFILES ||--o{ CONTAINERS : saves" — doesn't look role-gated based on the
  diagram, but confirm this with the team since it's not explicit anywhere.

### `orders`
- SELECT: any authenticated user can view orders (matches "all users can view
  submitted orders" on the homepage copy).
- INSERT: any authenticated user can create a draft order.
- UPDATE (status changes to `solved`/`failed`): should only happen via the
  Edge Function using the service role key, not directly from the client.

### `order_items`
- Inherit access from the parent order — same read/write pattern.

### `order_results`
- SELECT: any authenticated user (viewers included).
- INSERT/UPDATE: service role only (written by the Edge Function after
  FitSolver responds), never directly from the client.

### The `supervisor`-only action
Running the optimiser isn't actually an RLS-table concern — it's enforced
inside the `POST /optimize` Edge Function, which checks `role == supervisor`
before forwarding to FitSolver (this is already noted in the architecture
diagram and stubbed as a TODO in `supabase/functions/optimize/index.js`).
RLS won't stop a viewer from calling that endpoint; the function code has to.

## 4. Still missing / needs a decision

- [ ] Login method: email/password, Google OAuth, or magic link
- [ ] Self-signup vs invite-only account creation
- [ ] How a user's role gets upgraded from viewer to supervisor
- [ ] Whether `containers` writes are open to all authenticated users or
      restricted somehow
- [ ] Actual policy SQL — the above is written in plain English and needs to
      be translated into `create policy` statements and tested

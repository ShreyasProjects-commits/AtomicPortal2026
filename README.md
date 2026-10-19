# AtomicPortal2026 — FitPortal

Warehouse portal for **Project Perfect Fit** (Thomax / COMP4050). Browse imported
packing orders and open 3D views in FitVisualizer. FitPortal owns import, storage,
and API access — not the solver or renderer.

## Quick start (local)

**Terminal 1 — Supabase** (requires Docker):

```bash
supabase start
supabase db reset
supabase functions serve import-csv orders order-result optimize
```

**Terminal 2 — Frontend:**

```bash
npx serve .
```

Open `http://localhost:3000/orders.html`, upload `samples/orders-import.csv`, then
open an order and click **View in 3D**.

Configure URLs in `src/config.js` or via `window.FITPORTAL_API_BASE` /
`window.FITVISUALIZER_URL` script tags.

## Running the tests

Automated backend tests live in `tests/`. They need **Node 22 or newer** and nothing
else (no install step, no Supabase, no network):

```bash
npm test
```

They also run automatically on GitHub for every push and pull request
(`.github/workflows/tests.yml`) — check the **Actions** tab for the result.

**What is covered**

| File | Covers |
|---|---|
| `tests/csv.test.mjs` | CSV parsing/validation and the sample import files |
| `tests/solver.test.mjs` | Translation to/from the solver (units, quantities, placements, utilisation, failures) and saving results |
| `tests/config.test.mjs` | Frontend URL/format helpers and the 3D axis conversion |
| `tests/shared.test.mjs` | CORS, UUID check, server-side auth (`requireRole`) and shared order loaders |
| `tests/orders.test.mjs` | `/orders`: list, detail, manual create (incl. auto `ORD-` references), complete |
| `tests/optimize.test.mjs` | `/optimize`: access rules, re-run from DB, payload mode, solver failures |
| `tests/import-csv.test.mjs` | `/import-csv`: uploads, duplicates, `?replace=true`, per-order failures |
| `tests/assign-worker.test.mjs` | `/assign-worker`: assign, auto-assign, roles, enable/disable |
| `tests/worker-stats.test.mjs` | `/worker-stats`: worker and admin statistics |
| `tests/catalog.test.mjs` | `/catalog` |
| `tests/order-result.test.mjs` | `/order-result` |


## Docs

| Doc | Purpose |
|---|---|
| `docs/end-to-end-architecture.md` | **Share with divisions** — full process, touchpoints, action items |
| `docs/database-schema.md` | Table relationships, field definitions, JSONB shapes |
| `docs/import-contract.md` | CSV / future Thomax import format |
| `docs/api-contract.md` | Shared FitSolver / FitVisualizer JSON schema |
| `docs/api-endpoints.md` | Full API surface (+ implementation status) |
| `docs/integration-requirements.md` | What we need from sibling teams |
| `docs/auth-and-rls-plan.md` | Auth + RLS (planned) |

## Stack

Vanilla HTML/CSS/JS · Supabase (Postgres + Edge Functions) · Vercel (frontend deploy)

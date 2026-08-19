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

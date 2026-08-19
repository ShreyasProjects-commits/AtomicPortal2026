# Integration Requirements — FitSolver & FitVisualizer

Status: partially implemented. FitPortal handoff pattern is **decided**; sibling URLs still needed.

## What FitPortal implements today

| Integration | Status |
|---|---|
| FitSolver via `POST /optimize` | ✅ Edge Function forwards JSON; mock if `FITSOLVER_URL` unset |
| Import pipeline | ✅ `POST /import-csv` → DB → optimise → `order_results` |
| Order list / detail | ✅ `GET /orders`, `GET /orders?id=` |
| FitVisualizer data API | ✅ `GET /order-result?id=` returns `api-contract.md` shape |
| FitVisualizer UI handoff | ✅ `visualize.html` iframe + `{FITVISUALIZER_URL}?orderId=` |
| Auth between services | ❌ No API keys yet |
| Supabase RLS for direct DB read | ❌ Edge Functions use service role; RLS policies pending |

From `.env.example`:

```
FITSOLVER_URL=https://fitsolver.example.com/optimize
FITVISUALIZER_URL=https://fitvisualizer.example.com/view
```

## FitVisualizer — agreed handoff (pending their confirmation)

1. FitPortal opens **`{FITVISUALIZER_URL}?orderId={uuid}`** (embedded in `visualize.html` or direct link).
2. FitVisualizer loads packing JSON from **`GET {SUPABASE_URL}/functions/v1/order-result?id={uuid}`**.
3. Response matches `docs/api-contract.md` (`packedContainers`, `unpackedItems`).

FitVisualizer does **not** need direct Postgres access if they use `/order-result`.

### Still need from FitVisualizer

- [ ] Dev/staging/prod viewer URL (replace placeholder)
- [ ] Confirm they accept `orderId` query param
- [ ] Confirm they will call `/order-result` (or prefer Supabase direct read + RLS)
- [ ] iframe embedding allowed? (CORS / X-Frame-Options)
- [ ] Auth header required on `/order-result` in production?

## Information needed from FitSolver

- [ ] **Real base URL** for `/optimize` (dev, staging, prod)
- [ ] **Port** if not 443/80
- [ ] **Auth** — API key, bearer token, or shared secret?
- [ ] **Timeout / SLA** — hard timeout before FitPortal marks order `failed`
- [ ] **Error response shape** for unsolvable vs malformed requests
- [ ] Answers in `docs/api-contract.md` (rotation, container selection, origin)

## Suggested next step

Michael (Correspondent): send FitVisualizer team the `/order-result` URL and sample
response; send FitSolver team the import → optimise flow and `api-contract.md`.

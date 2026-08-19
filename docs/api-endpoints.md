# FitPortal — API Endpoints

> Supabase Edge Functions base: `{SUPABASE_URL}/functions/v1`
> Auth endpoints are **planned** — see `docs/auth-and-rls-plan.md`.
> All dimensions in **cm**, all weights in **kg**.

---

## Implementation status (Sprint 2)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /orders` | ✅ | List all orders |
| `GET /orders?id=` | ✅ | Order detail + items + containers + result |
| `GET /order-result?id=` | ✅ | api-contract shape for FitVisualizer |
| `POST /import-csv` | ✅ | CSV upload — see `docs/import-contract.md` |
| `POST /optimize` | ✅ | FitSolver proxy; `{ orderId }` only to re-run |
| `POST /auth/login` | ⏳ | Planned |
| `POST /orders` (create from UI) | ❌ | Out of scope — orders imported |
| Items/containers CRUD | ⏳ | Planned for catalogue management |

---

## Orders (implemented)

### List all orders
`GET /orders`

Response:
```json
[
  {
    "id": "uuid",
    "external_ref": "ORD-1042",
    "status": "solved",
    "created_at": "2026-08-19T00:00:00Z",
    "updated_at": "2026-08-19T00:05:00Z"
  }
]
```

### Get a specific order
`GET /orders?id={uuid}`

Response:
```json
{
  "id": "uuid",
  "external_ref": "ORD-1042",
  "status": "solved",
  "created_at": "2026-08-19T00:00:00Z",
  "updated_at": "2026-08-19T00:05:00Z",
  "items": [
    {
      "id": "uuid",
      "name": "Widget box",
      "length_cm": 20,
      "width_cm": 15,
      "height_cm": 10,
      "weight_kg": 2.5,
      "quantity": 4
    }
  ],
  "containers": [
    {
      "id": "uuid",
      "name": "Standard carton",
      "length_cm": 60,
      "width_cm": 40,
      "height_cm": 40,
      "max_weight_kg": 30
    }
  ],
  "result": {
    "packed_containers": [],
    "unpacked_items": [],
    "created_at": "2026-08-19T00:05:00Z"
  }
}
```

---

## Import (implemented)

### Import orders from CSV
`POST /import-csv`

- Body: raw CSV (`text/csv`) or `multipart/form-data` field `file`
- Query: `?replace=true` to overwrite existing `external_ref`
- See `docs/import-contract.md`

Response:
```json
{
  "imported": [
    { "id": "uuid", "external_ref": "ORD-1042", "status": "solved" }
  ]
}
```

---

## Results (implemented)

### Get packing result (FitVisualizer)
`GET /order-result?id={uuid}`

Returns `docs/api-contract.md` response shape:

```json
{
  "orderId": "uuid",
  "external_ref": "ORD-1042",
  "status": "solved",
  "packedContainers": [],
  "unpackedItems": [],
  "created_at": "2026-08-19T00:05:00Z"
}
```

---

## Optimiser (implemented)

### Run / re-run the optimiser
`POST /optimize`

Full payload (api-contract shape) **or** re-run existing order:

```json
{ "orderId": "uuid" }
```

Persists to `order_results` and sets `orders.status` to `solved` or `failed`.

Response: same as `docs/api-contract.md`.

---

## Auth (planned)

### Login
`POST /auth/login`

Request:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "access_token": "...",
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

### Logout
`POST /auth/logout` — `204 No Content`

### Get current user's profile
`GET /profile`

---

## Catalogue (planned)

Items and containers CRUD endpoints remain as originally specified for back-office
catalogue management. Not used by the warehouse order queue UI.

---

## Error Responses

```json
{
  "error": "error_code",
  "message": "Human readable description"
}
```

Common codes:
- `not_found` — order or result missing
- `invalid_csv` / `duplicate_order` — import errors
- `solver_unreachable` / `solver_error` — FitSolver failures
- `unauthorized` / `forbidden` — when auth is added

# FitPortal — Database Schema Reference

> Source of truth: `supabase/schema.sql`  
> Units: **centimetres (cm)** for dimensions, **kilograms (kg)** for weight.  
> Auth tables (`auth.users`) are managed by Supabase — not defined in this repo.

---

## 1. Relationship overview

FitPortal stores **catalogue rows** (items, containers), **orders** imported from Thomax,
**links** between orders and their line items / cartons, and **solver output** as JSON.

```mermaid
erDiagram
    AUTH_USERS ||--o| ORDERS : "created_by (optional)"
    ORDERS ||--o{ ORDER_ITEMS : contains
    ITEMS ||--o{ ORDER_ITEMS : referenced_by
    ORDERS ||--o{ ORDER_CONTAINERS : uses
    CONTAINERS ||--o{ ORDER_CONTAINERS : referenced_by
    ORDERS ||--o| ORDER_RESULTS : produces

    AUTH_USERS {
        uuid id PK "Supabase managed"
    }

    ORDERS {
        uuid id PK
        text external_ref UK "Business order ref e.g. ORD-1042"
        text status "draft | submitted | solved | failed"
        uuid created_by FK "nullable until auth wired"
        timestamptz created_at
        timestamptz updated_at
    }

    ITEMS {
        uuid id PK
        text name
        numeric length_cm
        numeric width_cm
        numeric height_cm
        numeric weight_kg
        timestamptz created_at
    }

    CONTAINERS {
        uuid id PK
        text name
        numeric length_cm
        numeric width_cm
        numeric height_cm
        numeric max_weight_kg
        timestamptz created_at
    }

    ORDER_ITEMS {
        uuid order_id PK_FK
        uuid item_id PK_FK
        integer quantity
    }

    ORDER_CONTAINERS {
        uuid order_id PK_FK
        uuid container_id PK_FK
    }

    ORDER_RESULTS {
        uuid order_id PK_FK
        jsonb packed_containers
        jsonb unpacked_items
        timestamptz created_at
    }
```

### Cardinality summary

| From | To | Relationship | Meaning |
|---|---|---|---|
| `orders` | `order_items` | 1 : N | One order has many line items |
| `items` | `order_items` | 1 : N | One catalogue item can appear on many orders |
| `orders` | `order_containers` | 1 : N | One order can use many cartons |
| `containers` | `order_containers` | 1 : N | One carton type can be reused across orders |
| `orders` | `order_results` | 1 : 0..1 | At most one packing result per order |
| `auth.users` | `orders` | 1 : N | Optional — who imported/owns the order (auth TBD) |

### Delete behaviour

- Deleting an **`orders`** row **cascades** to `order_items`, `order_containers`, and `order_results`.
- Deleting an **`items`** or **`containers`** row is **restricted** if still referenced by junction tables (default Postgres FK behaviour).

---

## 2. Order status lifecycle

`orders.status` tracks the **optimisation pipeline**, not physical warehouse packing.

| Status | Set by | Meaning |
|---|---|---|
| `draft` | Import (initial insert) | Order saved; not yet sent to FitSolver |
| `submitted` | Edge Function before optimise call | Optimiser run in progress |
| `solved` | Edge Function after successful result | Packing plan stored in `order_results` — **View in 3D** enabled |
| `failed` | Edge Function on solver error | FitSolver unreachable or returned an error |

Typical flow:

```
import-csv  →  draft  →  submitted  →  solved
                              └────────→  failed
```

Re-run: `POST /optimize` with `{ "orderId": "<uuid>" }` resets to `submitted`, then `solved` or `failed`.

---

## 3. Table reference

### `items`

Catalogue of packable products. Rows are created during **CSV import** (one row per distinct item on an order). May later be reused as a shared catalogue.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `name` | `text` | NO | — | Display name (e.g. "Widget box") |
| `length_cm` | `numeric` | NO | — | Length in cm; must be > 0 |
| `width_cm` | `numeric` | NO | — | Width in cm; must be > 0 |
| `height_cm` | `numeric` | NO | — | Height in cm; must be > 0 |
| `weight_kg` | `numeric` | NO | — | Item weight in kg; must be ≥ 0 |
| `created_at` | `timestamptz` | NO | `now()` | Row creation time |

**Constraints:** `length_cm`, `width_cm`, `height_cm` > 0; `weight_kg` ≥ 0.

---

### `containers`

Catalogue of carton / container types available for packing.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `name` | `text` | NO | — | Display name (e.g. "Standard carton") |
| `length_cm` | `numeric` | NO | — | Internal length in cm; must be > 0 |
| `width_cm` | `numeric` | NO | — | Internal width in cm; must be > 0 |
| `height_cm` | `numeric` | NO | — | Internal height in cm; must be > 0 |
| `max_weight_kg` | `numeric` | NO | — | Maximum load capacity in kg; must be > 0 |
| `created_at` | `timestamptz` | NO | `now()` | Row creation time |

**Note:** ERD (`Diagrams/erd-final.mermaid`) also lists `box_weight_kg`, `created_by`, and `is_active` for saved/reusable boxes — **not yet in `schema.sql`**.

---

### `orders`

Header row for an imported packing job. Linked to Thomax via `external_ref`.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key; passed to FitVisualizer as `orderId` |
| `external_ref` | `text` | YES | — | Business reference from Thomax (e.g. `ORD-1042`); unique when set |
| `status` | `text` | NO | `'draft'` | Optimisation state — see §2 |
| `created_by` | `uuid` | YES | — | FK → `auth.users(id)`; populated when auth is wired |
| `created_at` | `timestamptz` | NO | `now()` | When the order was imported |
| `updated_at` | `timestamptz` | NO | `now()` | Last status change or result write |

**Constraints:** `status` ∈ `draft`, `submitted`, `solved`, `failed`.  
**Index:** unique partial index on `external_ref` where not null.

---

### `order_items`

Junction table: which **items** (and how many) belong to an **order**.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `order_id` | `uuid` | NO | — | FK → `orders(id)` ON DELETE CASCADE |
| `item_id` | `uuid` | NO | — | FK → `items(id)` |
| `quantity` | `integer` | NO | — | Number of this item to pack; must be > 0 |

**Primary key:** (`order_id`, `item_id`) — same item appears once per order with a quantity.

**Note:** ERD embeds item dimensions inline on `order_items`; implemented schema **normalises** through `items`.

---

### `order_containers`

Junction table: which **containers** are available for an **order** to pack into.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `order_id` | `uuid` | NO | — | FK → `orders(id)` ON DELETE CASCADE |
| `container_id` | `uuid` | NO | — | FK → `containers(id)` |

**Primary key:** (`order_id`, `container_id`).

FitSolver receives the linked containers when the Edge Function builds the `/optimize` payload.

---

### `order_results`

Stores FitSolver output **as JSON** (matches `docs/api-contract.md`). One row per order.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `order_id` | `uuid` | NO | — | PK + FK → `orders(id)` ON DELETE CASCADE |
| `packed_containers` | `jsonb` | NO | — | Array of packed cartons with placements (see §4) |
| `unpacked_items` | `jsonb` | NO | `'[]'` | Items that could not be packed (unhappy path) |
| `created_at` | `timestamptz` | NO | `now()` | When the result was stored |

**Note:** ERD includes `computation_ms` for SLA tracking — **not yet in `schema.sql`**.

Exposed to FitVisualizer via `GET /order-result?id=<order_id>` in api-contract shape.

---

## 4. JSONB structures (`order_results`)

### `packed_containers`

Array of containers with item placements inside them.

```json
[
  {
    "containerId": "uuid-of-container-row",
    "placements": [
      {
        "itemId": "uuid-of-item-row",
        "position": { "x": 0, "y": 0, "z": 0, "unit": "cm" },
        "rotation": { "x": 0, "y": 0, "z": 0 }
      }
    ],
    "utilisation": 0.82
  }
]
```

| Field | Description |
|---|---|
| `containerId` | References `containers.id` |
| `placements[].itemId` | References `items.id` |
| `position` | Item origin corner inside container (cm) |
| `rotation` | Degrees about each axis |
| `utilisation` | Fraction of container volume used (0..1) |

### `unpacked_items`

Items FitSolver could not place in any container.

```json
[
  { "itemId": "uuid", "reason": "no_container_fits" }
]
```

Warehouse UI surfaces a warning when this array is non-empty.

---

## 5. How import maps to tables

CSV upload (`POST /import-csv`) for each `order_ref`:

1. **`orders`** — insert row (`external_ref`, `status = draft`)
2. **`items`** + **`order_items`** — one item row per CSV item line + junction with `quantity`
3. **`containers`** + **`order_containers`** — one container row per CSV container line + junction
4. Edge Function calls FitSolver → **`order_results`** upsert + **`orders.status`** → `solved` or `failed`

See `docs/import-contract.md` for CSV column definitions.

---

## 6. Planned tables (not in `schema.sql` yet)

From `Diagrams/erd-final.mermaid` and `docs/auth-and-rls-plan.md`:

### `profiles` (planned)

| Column | Description |
|---|---|
| `id` | PK, FK → `auth.users(id)` |
| `role` | `viewer` or `supervisor` |
| `display_name` | Staff display name |
| `created_at` | Profile creation time |

Will enable RLS (viewers read orders; supervisors re-run optimiser).

### ERD-only fields (future)

| Table | Field | Purpose |
|---|---|---|
| `containers` | `box_weight_kg` | Empty carton weight |
| `containers` | `created_by` | Who saved reusable box |
| `containers` | `is_active` | Soft-delete / archive |
| `order_results` | `computation_ms` | FitSolver runtime vs 60s SLA |

---

## 7. Row Level Security (RLS)

All application tables have **RLS enabled** with **no policies yet** (default deny for direct client access).

| Access path | How it works today |
|---|---|
| Browser → Edge Functions | Service role inside functions bypasses RLS |
| FitVisualizer → `/order-result` | No direct DB access required |
| Future authenticated client | Policies per `docs/auth-and-rls-plan.md` |

---

## 8. Related documentation

| Doc | Topic |
|---|---|
| `supabase/schema.sql` | Executable DDL |
| `Diagrams/erd-final.mermaid` | Target ERD (includes planned fields) |
| `docs/import-contract.md` | CSV → table mapping |
| `docs/api-contract.md` | JSON shape stored in `order_results` |
| `docs/api-endpoints.md` | HTTP API over these tables |
| `docs/auth-and-rls-plan.md` | Future `profiles` + policies |

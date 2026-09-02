# Integration API Contract (DRAFT — needs cross-team sign-off)

> **Shared with FitSolver and FitVisualizer. Do not change unilaterally.**
> Changes require sign-off from both sibling teams.
> All dimensions in **cm**, all weights in **kg** — units are explicit and required.

This is the **canonical JSON shape** for packing data between divisions.
FitPortal Edge Functions translate to/from this shape when talking to FitSolver
or FitVisualizer.

**Not the same as** `GET /orders?id=` in `docs/api-endpoints.md` — that endpoint
uses flat DB field names (`length_cm`, etc.) for the FitPortal warehouse UI only.

---

## Flow

```
Thomax  →  POST /import-csv  →  FitPortal Edge Function
FitPortal Edge Function  →  POST {FITSOLVER_URL}  →  FitSolver
FitPortal Edge Function  ←  packedContainers + unpackedItems  ←  FitSolver
FitPortal  →  persists to order_results

Warehouse worker  →  FitPortal order list  →  View in 3D
FitVisualizer  →  GET /order-result?id=  →  render
```

---

## FitSolver — request (`POST /optimize` payload)

FitPortal sends this JSON to **FitSolver's URL** (not to FitVisualizer).

```json
{
  "orderId": "uuid",
  "items": [
    {
      "id": "uuid",
      "name": "Widget box",
      "dimensions": { "length": 20, "width": 15, "height": 10, "unit": "cm" },
      "weight": { "value": 2.5, "unit": "kg" },
      "quantity": 4
    }
  ],
  "containers": [
    {
      "id": "uuid",
      "name": "Standard carton",
      "dimensions": { "length": 60, "width": 40, "height": 40, "unit": "cm" },
      "maxWeight": { "value": 30, "unit": "kg" }
    }
  ]
}
```

### Container selection (agreed)

- FitPortal provides the **list of available carton sizes** for the order.
- **FitSolver picks** which container(s) to use and how to pack items.
- FitSolver returns `containerId` on each entry in `packedContainers[]`.

---

## FitSolver — response

Same shape is stored in `order_results` and returned to FitVisualizer via `/order-result`.

```json
{
  "orderId": "uuid",
  "packedContainers": [
    {
      "containerId": "uuid",
      "placements": [
        {
          "itemId": "uuid",
          "position": { "x": 0, "y": 0, "z": 0, "unit": "cm" },
          "rotation": { "x": 0, "y": 0, "z": 0 }
        }
      ],
      "utilisation": 0.82
    }
  ],
  "unpackedItems": [
    { "itemId": "uuid", "reason": "no_container_fits" }
  ]
}
```

---

## FitVisualizer — `GET /order-result?id={uuid}`

FitVisualizer fetches **one document** containing placements **and** the item/container
catalogue needed to draw 3D boxes. Join placements to catalogue rows by `itemId` /
`containerId`.

```json
{
  "orderId": "uuid",
  "external_ref": "ORD-1042",
  "status": "solved",
  "items": [
    {
      "id": "uuid",
      "name": "Widget box",
      "dimensions": { "length": 20, "width": 15, "height": 10, "unit": "cm" },
      "weight": { "value": 2.5, "unit": "kg" },
      "quantity": 4
    }
  ],
  "containers": [
    {
      "id": "uuid",
      "name": "Standard carton",
      "dimensions": { "length": 60, "width": 40, "height": 40, "unit": "cm" },
      "maxWeight": { "value": 30, "unit": "kg" }
    }
  ],
  "packedContainers": [ "..." ],
  "unpackedItems": [],
  "created_at": "2026-08-19T00:05:00Z"
}
```

**Rendering:** look up each `placement.itemId` in `items[]` for box size; look up each
`packedContainers[].containerId` in `containers[]` for outer carton size.

---

## Rules / edge cases

- **Multiple items:** `items[]` is an array — one entry per distinct item type on the order.
  `placements[]` has one entry per **physical instance** placed (quantity &gt; 1 → multiple placements with the same `itemId`).
- **Unhappy path is mandatory:** any item that fits no container MUST appear in
  `unpackedItems` with a `reason`. Never silently drop items.
- `position` is the item's origin corner inside the container (cm).
- `rotation` is in degrees about each axis (draft — confirm with FitVisualizer).
- `utilisation` is 0..1 (fraction of container volume used).

---

## Open questions (confirm in integration meeting)

- [ ] Rotation representation — degrees per axis, or discrete orientation index?
- [ ] Coordinate origin convention (which corner of the container is `0,0,0`)?
- [ ] Error response shape for a malformed or unsolvable FitSolver request?

---

## Change control

| Change type | Who must agree |
|---|---|
| New optional field | FitPortal + affected sibling |
| Required field added/removed | All three divisions |
| Unit change (cm/kg) | All three divisions |

# for testing Solver website
curl -X POST https://atomic-solver.onrender.com/api/solve \ -H "Content-Type: application/json" \   -d '{    "orderId": "test-1",    "items": [{"id":"i1","name":"Widget box","dimensions":{"length":20,"width":15,"height":10,"unit":"cm"},"weight":{"value":2.5,"unit":"kg"},"quantity":4}],    "containers": [{"id":"c1","name":"Standard carton","dimensions":{"length":60,"width":40,"height":40,"unit":"cm"},"maxWeight":{"value":30,"unit":"kg"}}]  }'

curl -g -X POST https://atomic-solver.onrender.com/api/solve -H "Content-Type: application/json" --data-binary "@payload.json"
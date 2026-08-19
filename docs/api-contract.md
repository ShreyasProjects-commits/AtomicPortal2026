# `/optimize` API Contract (DRAFT — needs cross-team sign-off)

> **Shared with FitSolver and FitVisualizer. Do not change unilaterally.**
> Changes require sign-off from both sibling teams (they build against this).
> All dimensions in **cm**, all weights in **kg** — units are explicit and required.

## Flow

```
Thomax business page  →  POST /import-csv  →  FitPortal Edge Function
FitPortal Edge Function  →  POST /optimize  →  FitSolver
FitPortal Edge Function  ←  packedContainers + unpackedItems  ←  FitSolver
FitPortal  →  persists to order_results

Warehouse worker  →  FitPortal order list  →  View in 3D
FitVisualizer  →  GET /order-result?id=  →  render (or reads Supabase directly)
```

## Request — `POST /optimize`

```json
{
  "orderId": "ord_123",
  "items": [
    {
      "id": "item_1",
      "name": "Widget box",
      "dimensions": { "length": 20, "width": 15, "height": 10, "unit": "cm" },
      "weight": { "value": 2.5, "unit": "kg" },
      "quantity": 4
    }
  ],
  "containers": [
    {
      "id": "cont_1",
      "name": "Standard carton",
      "dimensions": { "length": 60, "width": 40, "height": 40, "unit": "cm" },
      "maxWeight": { "value": 30, "unit": "kg" }
    }
  ]
}
```

## Response

```json
{
  "orderId": "ord_123",
  "packedContainers": [
    {
      "containerId": "cont_1",
      "placements": [
        {
          "itemId": "item_1",
          "position": { "x": 0, "y": 0, "z": 0, "unit": "cm" },
          "rotation": { "x": 0, "y": 0, "z": 0 }
        }
      ],
      "utilisation": 0.82
    }
  ],
  "unpackedItems": [
    { "itemId": "item_9", "reason": "no_container_fits" }
  ]
}
```

## Rules / edge cases

- **Unhappy path is mandatory:** any item that fits no container MUST appear in
  `unpackedItems` with a `reason`. Never silently drop items.
- `position` is the item's origin corner inside the container (cm).
- `rotation` is in degrees about each axis.
- `utilisation` is 0..1 (fraction of container volume used).

## Open questions for FitSolver / FitVisualizer

- [ ] Rotation representation — degrees per axis, or discrete orientation index?
- [ ] Does FitSolver choose containers, or does FitPortal pre-assign?
- [ ] Coordinate origin convention (which corner is `0,0,0`)?
- [ ] Error response shape for a malformed request?

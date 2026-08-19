# Order Import Contract (CSV — interim for testing)

> Target: Thomax business order page will push JSON via API later.
> Until then, use CSV upload on the Orders page for demo and QA.

## Endpoint

`POST /functions/v1/import-csv`

- **Content-Type:** `text/csv` or `multipart/form-data` (field name: `file`)
- **Response:** `{ "imported": [{ "id", "external_ref", "status" }] }`

On success each order is saved, sent to FitSolver (or mock solver if `FITSOLVER_URL` is unset),
and the result is stored in `order_results`.

## CSV columns

| Column | Required | Description |
|---|---|---|
| `record_type` | yes | `item` or `container` |
| `order_ref` | yes | Business reference (e.g. `ORD-1042`) — groups rows into one order |
| `item_name` | item rows | Product name |
| `length_cm` | item/container | Length in cm |
| `width_cm` | item/container | Width in cm |
| `height_cm` | item/container | Height in cm |
| `weight_kg` | item rows | Item weight in kg |
| `quantity` | item rows | Count (default 1) |
| `container_name` | container rows | Carton name |
| `max_weight_kg` | container rows | Max load in kg |

## Example

See `samples/orders-import.csv`.

```csv
record_type,order_ref,item_name,length_cm,width_cm,height_cm,weight_kg,quantity,container_name,max_weight_kg
item,ORD-1042,Widget box,20,15,10,2.5,4,,
container,ORD-1042,,60,40,40,,,Standard carton,30
item,ORD-1043,Gadget,10,8,5,0.5,2,,
container,ORD-1043,,50,40,30,,,Medium carton,25
```

## Rules

- One CSV may contain **multiple orders** (different `order_ref` values).
- Each order needs **at least one item and one container** row.
- Re-importing the same `order_ref` returns `409` unless `?replace=true` is passed.
- Units are always **cm** and **kg** (matches `docs/api-contract.md`).

## Future (Thomax API)

```json
{
  "external_ref": "ORD-1042",
  "items": [{ "name": "...", "length_cm": 20, "width_cm": 15, "height_cm": 10, "weight_kg": 2.5, "quantity": 4 }],
  "containers": [{ "name": "...", "length_cm": 60, "width_cm": 40, "height_cm": 40, "max_weight_kg": 30 }]
}
```

Same shape as CSV rows, posted as JSON to a future `POST /import/order` Edge Function.

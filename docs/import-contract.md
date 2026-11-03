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

## Two-file import (FitSolver boxes + items files)

Orders → **Import box challenge**: select **both files at once**. One is a boxes file and
one is an items file, each **JSON** (array of objects) or **CSV** with the same column
names. The two files are combined into **one order**; which file is which is detected from
the columns. Sent as `multipart/form-data` to `POST /import-csv` with the fields `files`
(twice) and optional `order_ref`; `?replace=true` works as for the single CSV.

| File | Columns | Optional |
|---|---|---|
| Boxes | `Reference`, `Width`, `Length`, `Depth`, `MaxWeight` | `Active` |
| Items | `ItemReference` (or `ItemCode`), `Width`, `Length`, `Depth`, `Weight` | |

- Sizes are **millimetres** (converted to cm); weights are kg. Column names are not
  case-sensitive.
- `Length`, `Width` and `Depth` become `length_cm`, `width_cm` and `height_cm`.
- Each items row is one physical item (quantity 1).
- Boxes with `"Active": false` are skipped; an active box with no `MaxWeight` is rejected.
- `MaximumBoxes` (stock limit) and `BoxWeight` (empty box weight) may be present in the
  boxes file but are **ignored for now**: they are not stored and not sent to the solver,
  so the solver treats every box type as unlimited.
- `order_ref` is used when given; otherwise the next `ORD-` number is assigned.
- Blank rows, and rows of only commas (common in spreadsheet exports), are ignored in both
  this import and the single CSV import.
- Errors return `400 invalid_files` with a message naming the file and row/column.

## Future (Thomax API)

```json
{
  "external_ref": "ORD-1042",
  "items": [{ "name": "...", "length_cm": 20, "width_cm": 15, "height_cm": 10, "weight_kg": 2.5, "quantity": 4 }],
  "containers": [{ "name": "...", "length_cm": 60, "width_cm": 40, "height_cm": 40, "max_weight_kg": 30 }]
}
```

Same shape as CSV rows, posted as JSON to a future `POST /import/order` Edge Function.

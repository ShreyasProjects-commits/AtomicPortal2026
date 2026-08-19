# FitPortal — API Endpoints

> All endpoints are served via Supabase Edge Functions or Supabase Auth.
> Supervisor-only endpoints require the user's role to be `supervisor` in the `profiles` table.
> All dimensions in **cm**, all weights in **kg**.

---

## Auth

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

---

### Logout
`POST /auth/logout`

Response: `No Content`

---

## Profile

### Get current user's profile
`GET /profile`

Response:
```json
{
  "id": "uuid",
  "role": "supervisor",
  "display_name": "Shreyas",
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

## Orders

### Create a new order
`POST /orders` — *Supervisor only*

Request:
```json
{
  "items": [
    {
      "name": "Widget box",
      "length_cm": 20,
      "width_cm": 15,
      "height_cm": 10,
      "weight_kg": 2.5,
      "quantity": 4
    }
  ],
  "container_ids": ["uuid-1", "uuid-2"]
}
```

Response:
```json
{
  "id": "uuid",
  "status": "draft",
  "created_by": "uuid",
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

### List all orders
`GET /orders`

Response:
```json
[
  {
    "id": "uuid",
    "status": "solved",
    "created_by": "uuid",
    "created_at": "2026-08-19T00:00:00Z"
  }
]
```

---

### Get a specific order
`GET /orders/:id`

Response:
```json
{
  "id": "uuid",
  "status": "solved",
  "items": [...],
  "containers": [...],
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

### Delete a draft order
`DELETE /orders/:id` — *Supervisor only*

Response: `204 No Content`

---

## Optimiser

### Run the optimiser on an order
`POST /orders/:id/optimize` — *Supervisor only*

Sends the order to FitSolver and stores the result. Order status changes from `submitted` to `solved` or `failed`.

Response:
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

## Results

### Get packing result for an order
`GET /orders/:id/result`

Response:
```json
{
  "order_id": "uuid",
  "packed_containers": [...],
  "unpacked_items": [...],
  "computation_ms": 1240,
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

## Items

### Add an item
`POST /items`

Request:
```json
{
  "name": "Widget box",
  "length_cm": 20,
  "width_cm": 15,
  "height_cm": 10,
  "weight_kg": 2.5
}
```

Response:
```json
{
  "id": "uuid",
  "name": "Widget box",
  "length_cm": 20,
  "width_cm": 15,
  "height_cm": 10,
  "weight_kg": 2.5,
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

### List all items
`GET /items`

Response:
```json
[
  {
    "id": "uuid",
    "name": "Widget box",
    "length_cm": 20,
    "width_cm": 15,
    "height_cm": 10,
    "weight_kg": 2.5,
    "created_at": "2026-08-19T00:00:00Z"
  }
]
```

---

### Delete an item
`DELETE /items/:id`

Response: `204 No Content`

---

## Containers

### Save a new container
`POST /containers`

Request:
```json
{
  "name": "Standard carton",
  "length_cm": 60,
  "width_cm": 40,
  "height_cm": 40,
  "max_weight_kg": 30
}
```

Response:
```json
{
  "id": "uuid",
  "name": "Standard carton",
  "length_cm": 60,
  "width_cm": 40,
  "height_cm": 40,
  "max_weight_kg": 30,
  "created_at": "2026-08-19T00:00:00Z"
}
```

---

### List all containers
`GET /containers`

Response:
```json
[
  {
    "id": "uuid",
    "name": "Standard carton",
    "length_cm": 60,
    "width_cm": 40,
    "height_cm": 40,
    "max_weight_kg": 30,
    "created_at": "2026-08-19T00:00:00Z"
  }
]
```

---

### Delete a container
`DELETE /containers/:id`

Response: `204 No Content`

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "error_code",
  "message": "Human readable description"
}
```

Common error codes:
- `unauthorized` — not logged in
- `forbidden` — logged in but not a supervisor
- `not_found` — resource doesn't exist
- `invalid_request` — missing or invalid fields
- `solver_unreachable` — FitSolver could not be contacted
- `solver_error` — FitSolver returned an error

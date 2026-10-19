import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadHandler, newDb, call, uuid, envVars, ADMIN_ID, WORKER_ID, WORKER2_ID } from "./helpers/harness.mjs";

const handler = await loadHandler("order-result");

const ORDER_ID = uuid(101);
const ITEM_ID = uuid(201);
const CONTAINER_ID = uuid(301);

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin" });
  db.addUser("worker-token", { id: WORKER_ID });
  db.addUser("worker2-token", { id: WORKER2_ID });
  db.seed("orders", [
    { id: ORDER_ID, external_ref: "ORD-1050", status: "solved", assigned_worker_id: WORKER_ID },
  ]);
  db.seed("order_items", [
    {
      order_id: ORDER_ID,
      quantity: 2,
      items: { id: ITEM_ID, name: "Widget", length_cm: 20, width_cm: 15, height_cm: 10, weight_kg: 2.5 },
    },
  ]);
  db.seed("order_containers", [
    {
      order_id: ORDER_ID,
      containers: { id: CONTAINER_ID, name: "Carton", length_cm: 60, width_cm: 40, height_cm: 40, max_weight_kg: 30 },
    },
  ]);
});

const seedResult = (extra = {}) =>
  db.seed("order_results", [
    {
      order_id: ORDER_ID,
      packed_containers: [{ containerId: CONTAINER_ID, placements: [{ itemId: ITEM_ID }] }],
      unpacked_items: [{ itemId: uuid(202), reason: "no_container_fits" }],
      created_at: "2026-10-17T07:00:00.000Z",
      ...extra,
    },
  ]);

const get = (query = "", token = "admin-token") =>
  call(handler, { method: "GET", token, url: `http://localhost/order-result${query}` });

describe("order-result: access", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("POST returns 405", async () => {
    assert.equal((await call(handler, { method: "POST", body: {} })).status, 405);
  });

  test("requires a signed-in user: no token -> 401", async () => {
    seedResult();
    const res = await get(`?id=${ORDER_ID}`, null);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("an invalid token -> 401", async () => {
    seedResult();
    assert.equal((await get(`?id=${ORDER_ID}`, "nonsense")).status, 401);
  });

  test("a disabled account -> 403 account_disabled", async () => {
    seedResult();
    db.tables.profiles.find((p) => p.id === WORKER_ID).active = false;
    const res = await get(`?id=${ORDER_ID}`, "worker-token");
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "account_disabled");
  });

  test("an admin can read any order", async () => {
    seedResult();
    assert.equal((await get(`?id=${ORDER_ID}`, "admin-token")).status, 200);
  });

  test("a worker can read an order assigned to them", async () => {
    seedResult();
    assert.equal((await get(`?id=${ORDER_ID}`, "worker-token")).status, 200);
  });

  test("a worker gets 404 (not 403) for an order assigned to someone else", async () => {
    seedResult();
    const res = await get(`?id=${ORDER_ID}`, "worker2-token");
    assert.equal(res.status, 404);
    assert.equal((await res.json()).message, "Order not found");
  });

  test("a worker gets 404 for an unassigned order", async () => {
    seedResult();
    db.tables.orders[0].assigned_worker_id = null;
    assert.equal((await get(`?id=${ORDER_ID}`, "worker-token")).status, 404);
  });
});

describe("order-result: request validation", () => {
  test("a missing id -> 400", async () => {
    const res = await get();
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_request");
  });

  test("a non-UUID id -> 400", async () => {
    assert.equal((await get("?id=not-a-uuid")).status, 400);
  });

  test("an unknown order -> 404", async () => {
    const res = await get(`?id=${uuid(999)}`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).message, "Order not found");
  });

  test("an order with no packing result yet -> 404", async () => {
    const res = await get(`?id=${ORDER_ID}`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).message, "No packing result for this order yet");
  });
});

describe("order-result: response", () => {
  test("returns the packing result with items, containers and order details", async () => {
    seedResult();
    const res = await get(`?id=${ORDER_ID}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.orderId, ORDER_ID);
    assert.equal(body.packedContainers[0].containerId, CONTAINER_ID);
    assert.equal(body.unpackedItems[0].reason, "no_container_fits");
    assert.equal(body.external_ref, "ORD-1050");
    assert.equal(body.status, "solved");
    assert.equal(body.created_at, "2026-10-17T07:00:00.000Z");
  });

  test("items and containers use the shared contract shape", async () => {
    seedResult();
    const body = await (await get(`?id=${ORDER_ID}`)).json();
    assert.deepEqual(body.items[0], {
      id: ITEM_ID,
      name: "Widget",
      dimensions: { length: 20, width: 15, height: 10, unit: "cm" },
      weight: { value: 2.5, unit: "kg" },
      quantity: 2,
    });
    assert.deepEqual(body.containers[0].maxWeight, { value: 30, unit: "kg" });
  });

  test("null arrays in the saved result come back as empty arrays", async () => {
    seedResult({ packed_containers: null, unpacked_items: null });
    const body = await (await get(`?id=${ORDER_ID}`)).json();
    assert.deepEqual(body.packedContainers, []);
    assert.deepEqual(body.unpackedItems, []);
  });

  test("includes CORS headers", async () => {
    seedResult();
    const res = await get(`?id=${ORDER_ID}`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

describe("order-result: failures", () => {
  test("a missing service key -> 500 supabase_not_configured", async () => {
    const saved = envVars.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete envVars.SUPABASE_SERVICE_ROLE_KEY;
      const res = await get(`?id=${ORDER_ID}`);
      assert.equal(res.status, 500);
      assert.equal((await res.json()).error, "supabase_not_configured");
    } finally {
      envVars.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });

  test("a database error loading the order -> 500", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get(`?id=${ORDER_ID}`);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "database_error");
  });

  test("a database error loading the result -> 500", async () => {
    db.fail("order_results", "select", { message: "db down" });
    assert.equal((await get(`?id=${ORDER_ID}`)).status, 500);
  });

  test("a database error loading items/containers -> 500", async () => {
    seedResult();
    db.fail("order_items", "select", { message: "db down" });
    const res = await get(`?id=${ORDER_ID}`);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "database_error");
  });
});

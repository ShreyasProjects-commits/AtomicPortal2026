import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadHandler,
  newDb,
  call,
  uuid,
  ADMIN_ID,
  WORKER_ID,
  WORKER2_ID,
} from "./helpers/harness.mjs";

const handler = await loadHandler("orders");

const ORDER_A = uuid(101); // solved, assigned to WORKER
const ORDER_B = uuid(102); // draft, assigned to WORKER2
const ORDER_C = uuid(103); // draft, unassigned
const ITEM_ID = uuid(201);
const CONTAINER_ID = uuid(301);

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin", first_name: "Ada", last_name: "Admin" });
  db.addUser("worker-token", { id: WORKER_ID, first_name: "Wes", last_name: "Worker" });
  db.addUser("worker2-token", { id: WORKER2_ID, first_name: "Wendy", last_name: "Worker" });
  db.seed("orders", [
    {
      id: ORDER_A,
      external_ref: "REF-A",
      status: "solved",
      assigned_worker_id: WORKER_ID,
      completed_at: null,
      created_at: "2026-10-01T00:00:00.000Z",
    },
    {
      id: ORDER_B,
      external_ref: "REF-B",
      status: "draft",
      assigned_worker_id: WORKER2_ID,
      completed_at: null,
      created_at: "2026-10-02T00:00:00.000Z",
    },
    {
      id: ORDER_C,
      external_ref: "REF-C",
      status: "draft",
      assigned_worker_id: null,
      completed_at: null,
      created_at: "2026-10-03T00:00:00.000Z",
    },
  ]);
});

const get = (token, path = "") =>
  call(handler, { method: "GET", token, url: `http://localhost/orders${path}` });
const post = (token, body) =>
  call(handler, { method: "POST", token, body, url: "http://localhost/orders" });

const validOrder = (extra = {}) => ({
  items: [{ itemId: ITEM_ID, quantity: 2 }],
  containers: [{ containerId: CONTAINER_ID }],
  ...extra,
});

describe("orders: access and CORS", () => {
  test("OPTIONS works without a token", async () => {
    const res = await call(handler, { method: "OPTIONS" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });

  test("a request with no token is rejected with 401", async () => {
    const res = await get(undefined);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("an unsupported method returns 405 (after auth)", async () => {
    const res = await call(handler, { method: "PUT", token: "admin-token" });
    assert.equal(res.status, 405);
    assert.equal((await res.json()).error, "method_not_allowed");
  });

  test("an unsupported method without a token still returns 401", async () => {
    const res = await call(handler, { method: "DELETE" });
    assert.equal(res.status, 401);
  });
});

describe("orders: GET list", () => {
  test("an admin sees every order, newest first", async () => {
    const res = await get("admin-token");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.map((o) => o.id),
      [ORDER_C, ORDER_B, ORDER_A],
    );
  });

  test("a worker only sees orders assigned to them", async () => {
    const body = await (await get("worker-token")).json();
    assert.deepEqual(
      body.map((o) => o.id),
      [ORDER_A],
    );
  });

  test("a worker with no assigned orders gets an empty list", async () => {
    db.addUser("idle-token", { id: uuid(4) });
    const body = await (await get("idle-token")).json();
    assert.deepEqual(body, []);
  });

  test("a database error returns 500 database_error", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get("admin-token");
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "database_error");
    assert.equal(body.message, "db down");
  });
});

describe("orders: GET one", () => {
  beforeEach(() => {
    db.seed("order_items", [
      {
        order_id: ORDER_A,
        quantity: 4,
        items: { id: ITEM_ID, name: "Widget", length_cm: 20, width_cm: 15, height_cm: 10, weight_kg: 2.5 },
      },
    ]);
    db.seed("order_containers", [
      {
        order_id: ORDER_A,
        containers: { id: CONTAINER_ID, name: "Carton", length_cm: 60, width_cm: 40, height_cm: 40, max_weight_kg: 30 },
      },
    ]);
  });

  test("a non-UUID id returns 400 invalid_request", async () => {
    const res = await get("admin-token", "?id=not-a-uuid");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_request");
  });

  test("an unknown order returns 404", async () => {
    const res = await get("admin-token", `?id=${uuid(999)}`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test("a worker gets 404 (not 403) for an order assigned to someone else", async () => {
    const res = await get("worker-token", `?id=${ORDER_B}`);
    assert.equal(res.status, 404);
  });

  test("a worker can open their own order", async () => {
    const res = await get("worker-token", `?id=${ORDER_A}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, ORDER_A);
  });

  test("an admin gets the order with items (quantity merged), containers and a null result", async () => {
    const body = await (await get("admin-token", `?id=${ORDER_A}`)).json();
    assert.equal(body.external_ref, "REF-A");
    assert.equal(body.items[0].name, "Widget");
    assert.equal(body.items[0].quantity, 4);
    assert.equal(body.containers[0].name, "Carton");
    assert.equal(body.result, null);
  });

  test("the saved packing result is included when it exists", async () => {
    db.seed("order_results", [
      {
        order_id: ORDER_A,
        packed_containers: [{ containerId: CONTAINER_ID, placements: [] }],
        unpacked_items: [],
        created_at: "2026-10-01T01:00:00.000Z",
      },
    ]);
    const body = await (await get("admin-token", `?id=${ORDER_A}`)).json();
    assert.equal(body.result.packed_containers[0].containerId, CONTAINER_ID);
  });

  test("a database error returns 500", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get("admin-token", `?id=${ORDER_A}`);
    assert.equal(res.status, 500);
  });
});

describe("orders: POST create", () => {
  test("invalid JSON returns 400 invalid_json", async () => {
    const res = await call(handler, {
      method: "POST",
      token: "admin-token",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_json");
  });

  test("a worker cannot create orders (403)", async () => {
    const res = await post("worker-token", validOrder());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "forbidden");
  });

  test("an empty body is rejected", async () => {
    assert.equal((await post("admin-token", {})).status, 400);
  });

  test("items without containers (and vice versa) are rejected", async () => {
    assert.equal((await post("admin-token", { items: validOrder().items })).status, 400);
    assert.equal((await post("admin-token", { containers: validOrder().containers })).status, 400);
  });

  test("a bad itemId or quantity is rejected", async () => {
    for (const items of [
      [{ itemId: "nope", quantity: 1 }],
      [{ quantity: 1 }],
      [{ itemId: ITEM_ID, quantity: 0 }],
      [{ itemId: ITEM_ID, quantity: -3 }],
      [{ itemId: ITEM_ID, quantity: "abc" }],
    ]) {
      const res = await post("admin-token", validOrder({ items }));
      assert.equal(res.status, 400, JSON.stringify(items));
    }
  });

  test("a bad containerId is rejected", async () => {
    const res = await post("admin-token", validOrder({ containers: [{ containerId: "nope" }] }));
    assert.equal(res.status, 400);
  });

  test("a typed reference is trimmed and used; order starts as draft", async () => {
    const res = await post("admin-token", validOrder({ external_ref: "  ORD-777  " }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.external_ref, "ORD-777");
    assert.equal(body.status, "draft");
    assert.ok(db.tables.orders.some((o) => o.id === body.id));
  });

  test("items and containers are attached to the new order", async () => {
    const body = await (await post("admin-token", validOrder({ external_ref: "ORD-778" }))).json();
    const attachedItem = db.tables.order_items.find((r) => r.order_id === body.id);
    assert.equal(attachedItem.item_id, ITEM_ID);
    assert.equal(attachedItem.quantity, 2);
    assert.equal(db.tables.order_containers.find((r) => r.order_id === body.id).container_id, CONTAINER_ID);
  });

  test("a duplicate reference returns 409 duplicate_ref", async () => {
    const res = await post("admin-token", validOrder({ external_ref: "REF-A" }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "duplicate_ref");
  });

  describe("auto-generated references", () => {
    beforeEach(() => {
      db.tables.orders = [];
    });

    test("a blank reference starts at ORD-1001 when there are no ORD- orders", async () => {
      const body = await (await post("admin-token", validOrder({ external_ref: "" }))).json();
      assert.equal(body.external_ref, "ORD-1001");
    });

    test("a missing reference is auto-generated too", async () => {
      const body = await (await post("admin-token", validOrder())).json();
      assert.equal(body.external_ref, "ORD-1001");
    });

    test("continues after the highest existing ORD- number and ignores other refs", async () => {
      db.seed("orders", [
        { id: uuid(1), external_ref: "ORD-1044" },
        { id: uuid(2), external_ref: "ORD-1053" },
        { id: uuid(3), external_ref: "ORD-xyz" },
        { id: uuid(4), external_ref: "ABC-9999" },
        { id: uuid(5), external_ref: null },
      ]);
      const body = await (await post("admin-token", validOrder())).json();
      assert.equal(body.external_ref, "ORD-1054");
    });

    test("never goes below ORD-1001 even if existing numbers are small", async () => {
      db.seed("orders", [{ id: uuid(1), external_ref: "ORD-0500" }]);
      const body = await (await post("admin-token", validOrder())).json();
      assert.equal(body.external_ref, "ORD-1001");
    });

    test("two auto-created orders get different references", async () => {
      const a = await (await post("admin-token", validOrder())).json();
      const b = await (await post("admin-token", validOrder())).json();
      assert.equal(a.external_ref, "ORD-1001");
      assert.equal(b.external_ref, "ORD-1002");
    });

    test("retries when an auto reference collides, then succeeds", async () => {
      db.fail("orders", "insert", { code: "23505", message: "duplicate" }, 2);
      const res = await post("admin-token", validOrder());
      assert.equal(res.status, 201);
      assert.equal(db.log.filter((l) => l.table === "orders" && l.op === "insert").length, 3);
    });

    test("gives up after 5 collisions with a 500", async () => {
      db.fail("orders", "insert", { code: "23505", message: "duplicate" });
      const res = await post("admin-token", validOrder());
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, "database_error");
      assert.match(body.message, /Could not allocate an order reference/);
      assert.equal(db.log.filter((l) => l.table === "orders" && l.op === "insert").length, 5);
    });
  });

  test("a non-duplicate insert error returns 500 with the database message", async () => {
    db.fail("orders", "insert", { code: "XX000", message: "disk full" });
    const res = await post("admin-token", validOrder({ external_ref: "ORD-900" }));
    assert.equal(res.status, 500);
    assert.equal((await res.json()).message, "disk full");
  });

  test("if attaching items fails the new order is rolled back", async () => {
    db.fail("order_items", "insert", { message: "bad item" });
    const before = db.tables.orders.length;
    const res = await post("admin-token", validOrder({ external_ref: "ORD-901" }));
    assert.equal(res.status, 500);
    assert.match((await res.json()).message, /Failed to attach items/);
    assert.equal(db.tables.orders.length, before);
  });

  test("if attaching containers fails the new order is rolled back", async () => {
    db.fail("order_containers", "insert", { message: "bad container" });
    const before = db.tables.orders.length;
    const res = await post("admin-token", validOrder({ external_ref: "ORD-902" }));
    assert.equal(res.status, 500);
    assert.match((await res.json()).message, /Failed to attach containers/);
    assert.equal(db.tables.orders.length, before);
  });

  test(
    "an item or container id that doesn't exist is a client error, not a 500",
    { todo: "RISK: a foreign-key failure surfaces as 500 database_error instead of a 400/404" },
    async () => {
      db.fail("order_items", "insert", { code: "23503", message: "violates foreign key" });
      const res = await post("admin-token", validOrder({ external_ref: "ORD-903" }));
      assert.ok(res.status >= 400 && res.status < 500);
    },
  );
});

describe("orders: POST complete", () => {
  const complete = (token, orderId) => post(token, { action: "complete", orderId });

  test("a missing or non-UUID orderId returns 400", async () => {
    assert.equal((await post("worker-token", { action: "complete" })).status, 400);
    assert.equal((await complete("worker-token", "nope")).status, 400);
  });

  test("an unknown order returns 404", async () => {
    assert.equal((await complete("admin-token", uuid(999))).status, 404);
  });

  test("a worker gets 404 for an order assigned to someone else", async () => {
    db.tables.orders.find((o) => o.id === ORDER_B).status = "solved";
    assert.equal((await complete("worker-token", ORDER_B)).status, 404);
  });

  test("an order that isn't solved yet returns 409 not_ready", async () => {
    const res = await complete("admin-token", ORDER_C);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "not_ready");
  });

  test("the assigned worker can complete a solved order", async () => {
    const res = await complete("worker-token", ORDER_A);
    assert.equal(res.status, 200);
    const stored = db.tables.orders.find((o) => o.id === ORDER_A);
    assert.equal(stored.completed_by, WORKER_ID);
    assert.ok(!Number.isNaN(Date.parse(stored.completed_at)));
  });

  test("an admin can complete any solved order", async () => {
    const res = await complete("admin-token", ORDER_A);
    assert.equal(res.status, 200);
    assert.equal(db.tables.orders.find((o) => o.id === ORDER_A).completed_by, ADMIN_ID);
  });

  test("completing twice returns 409 already_completed", async () => {
    await complete("worker-token", ORDER_A);
    const res = await complete("worker-token", ORDER_A);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "already_completed");
  });

  test("a database error while loading returns 500", async () => {
    db.fail("orders", "select", { message: "db down" });
    assert.equal((await complete("admin-token", ORDER_A)).status, 500);
  });

  test("a database error while saving returns 500", async () => {
    db.fail("orders", "update", { message: "write failed" });
    assert.equal((await complete("admin-token", ORDER_A)).status, 500);
  });
});

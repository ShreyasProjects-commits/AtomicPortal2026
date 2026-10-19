import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadHandler,
  newDb,
  call,
  uuid,
  stubFetch,
  restoreFetch,
  fetchCalls,
  solverOk,
  solverHttpError,
  ADMIN_ID,
  WORKER_ID,
} from "./helpers/harness.mjs";

const handler = await loadHandler("optimize");

const ORDER_ID = uuid(101);
const ITEM_ID = uuid(201);
const CONTAINER_ID = uuid(301);

const solverPlacements = {
  placements: [
    {
      itemCode: `${ITEM_ID}__1`,
      boxReference: CONTAINER_ID,
      boxInstance: 1,
      position: { x: 0, y: 0, z: 0 },
      placedDimension: { width: 150, length: 200, depth: 100 },
    },
    {
      itemCode: `${ITEM_ID}__2`,
      boxReference: CONTAINER_ID,
      boxInstance: 1,
      position: { x: 150, y: 0, z: 0 },
      placedDimension: { width: 150, length: 200, depth: 100 },
    },
  ],
  unplacedItems: [],
};

const fullPayload = () => ({
  items: [
    {
      id: ITEM_ID,
      name: "Widget",
      dimensions: { length: 20, width: 15, height: 10, unit: "cm" },
      weight: { value: 2.5, unit: "kg" },
      quantity: 2,
    },
  ],
  containers: [
    {
      id: CONTAINER_ID,
      name: "Carton",
      dimensions: { length: 60, width: 40, height: 40, unit: "cm" },
      maxWeight: { value: 30, unit: "kg" },
    },
  ],
});

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin" });
  db.addUser("worker-token", { id: WORKER_ID });
  db.seed("orders", [{ id: ORDER_ID, external_ref: "REF-1", status: "draft" }]);
  db.seed("order_items", [
    {
      order_id: ORDER_ID,
      quantity: 2,
      items: {
        id: ITEM_ID,
        name: "Widget",
        length_cm: 20,
        width_cm: 15,
        height_cm: 10,
        weight_kg: 2.5,
        is_fragile: false,
        dangerous_goods_class: null,
      },
    },
  ]);
  db.seed("order_containers", [
    {
      order_id: ORDER_ID,
      containers: {
        id: CONTAINER_ID,
        name: "Carton",
        length_cm: 60,
        width_cm: 40,
        height_cm: 40,
        max_weight_kg: 30,
      },
    },
  ]);
  stubFetch(() => solverOk(solverPlacements));
});
afterEach(() => restoreFetch());

const optimize = (token, body) =>
  call(handler, { method: "POST", token, body, url: "http://localhost/optimize" });
const orderStatus = () => db.tables.orders.find((o) => o.id === ORDER_ID).status;
const statusUpdates = () =>
  db.log.filter((l) => l.table === "orders" && l.op === "update").map((l) => l.patch.status);

describe("optimize: access", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("GET returns 405 (checked before auth)", async () => {
    const res = await call(handler, { method: "GET" });
    assert.equal(res.status, 405);
  });

  test("no token -> 401", async () => {
    assert.equal((await optimize(undefined, {})).status, 401);
  });

  test("a worker -> 403 forbidden", async () => {
    const res = await optimize("worker-token", { orderId: ORDER_ID });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "forbidden");
    assert.equal(fetchCalls.length, 0, "the solver must not be called");
  });

  test("invalid JSON -> 400 invalid_json", async () => {
    const res = await call(handler, {
      method: "POST",
      token: "admin-token",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_json");
  });
});

describe("optimize: input validation", () => {
  test("no items/containers and no orderId -> 400 items_and_containers_required", async () => {
    const res = await optimize("admin-token", {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "items_and_containers_required");
  });

  test("a non-UUID orderId without a payload is also rejected", async () => {
    const res = await optimize("admin-token", { orderId: "not-a-uuid" });
    assert.equal(res.status, 400);
  });

  test("an unknown orderId -> 404 not_found", async () => {
    const res = await optimize("admin-token", { orderId: uuid(999) });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test("an order with no items -> 400 and the status is not changed", async () => {
    db.tables.order_items = [];
    const res = await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, "order_missing_items_or_containers");
    assert.equal(orderStatus(), "draft");
    assert.equal(fetchCalls.length, 0);
  });
});

describe("optimize: re-running an order from the database", () => {
  test("loads the order, runs the solver, saves the result and marks it solved", async () => {
    const res = await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.orderId, ORDER_ID);
    assert.equal(result.packedContainers.length, 1);
    assert.equal(result.packedContainers[0].placements.length, 2);
    assert.equal(result.packedContainers[0].placements[0].itemId, ITEM_ID);

    assert.equal(orderStatus(), "solved");
    assert.deepEqual(statusUpdates(), ["submitted", "solved"]);
    const saved = db.tables.order_results.find((r) => r.order_id === ORDER_ID);
    assert.equal(saved.packed_containers.length, 1);
    assert.equal(fetchCalls.length, 1);
  });

  test("sends the order's items and containers to the solver in solver format", async () => {
    await optimize("admin-token", { orderId: ORDER_ID });
    const sent = fetchCalls[0].body;
    assert.equal(sent.items.length, 2, "quantity 2 -> two physical items");
    assert.equal(sent.boxTypes[0].Reference, CONTAINER_ID);
    assert.equal(sent.boxTypes[0].Width, 400);
  });

  test("re-running replaces the previous saved result", async () => {
    await optimize("admin-token", { orderId: ORDER_ID });
    await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(db.tables.order_results.filter((r) => r.order_id === ORDER_ID).length, 1);
  });
});

describe("optimize: payload supplied in the request", () => {
  test("a full payload with an orderId is solved and saved", async () => {
    const res = await optimize("admin-token", { orderId: ORDER_ID, ...fullPayload() });
    assert.equal(res.status, 200);
    assert.equal(orderStatus(), "solved");
    assert.deepEqual(statusUpdates(), ["submitted", "solved"]);
  });

  test("a full payload without an orderId returns a result and writes nothing", async () => {
    const res = await optimize("admin-token", fullPayload());
    assert.equal(res.status, 200);
    assert.equal(db.writes().length, 0);
  });

  test("a non-UUID orderId with a payload is solved but not saved", async () => {
    const res = await optimize("admin-token", { orderId: "not-a-uuid", ...fullPayload() });
    assert.equal(res.status, 200);
    assert.equal(db.writes().length, 0);
  });
});

describe("optimize: solver failures", () => {
  test("solver unreachable -> 502 solver_unreachable, order marked failed", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const res = await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "solver_unreachable");
    assert.equal(orderStatus(), "failed");
    assert.equal(db.table("order_results").length, 0);
  });

  test("solver HTTP error -> 502 solver_error, order marked failed", async () => {
    stubFetch(() => solverHttpError());
    const res = await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "solver_error");
    assert.equal(orderStatus(), "failed");
  });

  test("solver returning an {error} body -> 502 solver_error, order marked failed", async () => {
    stubFetch(() => solverOk({ error: "bad input", details: "..." }));
    const res = await optimize("admin-token", { orderId: ORDER_ID });
    assert.equal(res.status, 502);
    assert.equal(orderStatus(), "failed");
    assert.deepEqual(statusUpdates(), ["submitted", "failed"]);
  });

  test("a solver failure without an orderId returns 502 and writes nothing", async () => {
    stubFetch(() => solverHttpError());
    const res = await optimize("admin-token", fullPayload());
    assert.equal(res.status, 502);
    assert.equal(db.writes().length, 0);
  });
});

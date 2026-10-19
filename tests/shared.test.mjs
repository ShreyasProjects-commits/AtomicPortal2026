import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { envVars, newDb, uuid, ADMIN_ID, WORKER_ID } from "./helpers/harness.mjs";

const { handleCors, json, errorResponse } = await import("../supabase/functions/_shared/cors.js");
const { UUID_RE, getServiceClient } = await import("../supabase/functions/_shared/supabase.js");
const { requireRole } = await import("../supabase/functions/_shared/authz.js");
const sharedOrders = await import("../supabase/functions/_shared/orders.js");

describe("cors.js", () => {
  test("OPTIONS preflight returns 200 'ok' with CORS headers", async () => {
    const res = handleCors(new Request("http://x/", { method: "OPTIONS" }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-headers"), /authorization/);
  });

  test("other methods return null so the handler continues", () => {
    assert.equal(handleCors(new Request("http://x/", { method: "GET" })), null);
    assert.equal(handleCors(new Request("http://x/", { method: "POST", body: "{}" })), null);
  });

  test("json() defaults to 200 with JSON content type and CORS header", async () => {
    const res = json({ a: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await res.json(), { a: 1 });
  });

  test("json() accepts a custom status", () => {
    assert.equal(json({}, 201).status, 201);
  });

  test("errorResponse() defaults to 400 with {error, message}", async () => {
    const res = errorResponse("bad_thing", "It broke");
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_thing", message: "It broke" });
    assert.equal(errorResponse("x", "y", 404).status, 404);
  });
});

describe("UUID_RE", () => {
  test("accepts valid UUIDs in lower and upper case", () => {
    assert.ok(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000"));
    assert.ok(UUID_RE.test("123E4567-E89B-12D3-A456-426614174000"));
    assert.ok(UUID_RE.test(crypto.randomUUID()));
  });

  test("rejects malformed values", () => {
    for (const bad of [
      "",
      "abc",
      "123e4567-e89b-12d3-a456-42661417400",
      "123e4567-e89b-12d3-a456-4266141740000",
      "123e4567-e89b-12d3-a456-42661417400g",
      " 123e4567-e89b-12d3-a456-426614174000",
    ]) {
      assert.equal(UUID_RE.test(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test("only accepts UUID versions 1-5 and RFC variants (documented limit)", () => {
    assert.equal(UUID_RE.test("123e4567-e89b-62d3-a456-426614174000"), false); // version 6
    assert.equal(UUID_RE.test("123e4567-e89b-72d3-a456-426614174000"), false); // version 7
    assert.equal(UUID_RE.test("123e4567-e89b-12d3-c456-426614174000"), false); // bad variant
  });
});

describe("getServiceClient", () => {
  beforeEach(() => newDb());

  test("returns a client when the Supabase env vars are set", () => {
    assert.ok(getServiceClient());
  });

  test("throws supabase_not_configured when the URL or key is missing", () => {
    const saved = { ...envVars };
    try {
      delete envVars.SUPABASE_URL;
      assert.throws(() => getServiceClient(), /supabase_not_configured/);
      envVars.SUPABASE_URL = saved.SUPABASE_URL;
      delete envVars.SUPABASE_SERVICE_ROLE_KEY;
      assert.throws(() => getServiceClient(), /supabase_not_configured/);
    } finally {
      Object.assign(envVars, saved);
    }
  });
});

describe("requireRole (server-side auth)", () => {
  let db;
  const reqWith = (headerValue) =>
    new Request("http://localhost/x", {
      headers: headerValue === undefined ? {} : { authorization: headerValue },
    });

  beforeEach(() => {
    db = newDb();
    db.addUser("admin-token", { id: ADMIN_ID, role: "admin" });
    db.addUser("worker-token", { id: WORKER_ID, role: "warehouse_worker" });
  });

  test("no Authorization header -> 401 unauthorized", async () => {
    const r = await requireRole(reqWith(undefined), ["admin"]);
    assert.equal(r.status, 401);
    assert.equal(r.error, "unauthorized");
    assert.equal(r.message, "Missing bearer token");
  });

  test("an empty bearer token is rejected", async () => {
    const r = await requireRole(reqWith("Bearer "), ["admin"]);
    assert.equal(r.status, 401);
  });

  test("the Bearer prefix is case-insensitive", async () => {
    const r = await requireRole(reqWith("bearer admin-token"), ["admin"]);
    assert.equal(r.error, undefined);
    assert.equal(r.user.id, ADMIN_ID);
  });

  test("an invalid or expired token -> 401", async () => {
    const r = await requireRole(reqWith("Bearer nonsense"), ["admin"]);
    assert.equal(r.status, 401);
    assert.equal(r.message, "Invalid or expired session");
  });

  test("a valid user with no profile row -> 403 no_profile", async () => {
    db.addUser("ghost-token", { id: uuid(50), hasProfile: false });
    const r = await requireRole(reqWith("Bearer ghost-token"), null);
    assert.equal(r.status, 403);
    assert.equal(r.error, "no_profile");
  });

  test("a disabled account -> 403 account_disabled", async () => {
    db.addUser("off-token", { id: uuid(51), active: false });
    const r = await requireRole(reqWith("Bearer off-token"), null);
    assert.equal(r.status, 403);
    assert.equal(r.error, "account_disabled");
  });

  test("a missing/null active flag is treated as active", async () => {
    db.addUser("null-token", { id: uuid(52), active: null });
    const r = await requireRole(reqWith("Bearer null-token"), null);
    assert.equal(r.error, undefined);
  });

  test("a role outside the allowed list -> 403 forbidden", async () => {
    const r = await requireRole(reqWith("Bearer worker-token"), ["admin"]);
    assert.equal(r.status, 403);
    assert.equal(r.error, "forbidden");
  });

  test("null allowed roles lets any signed-in role through", async () => {
    const r = await requireRole(reqWith("Bearer worker-token"), null);
    assert.equal(r.error, undefined);
    assert.equal(r.profile.role, "warehouse_worker");
  });

  test("success returns user, profile and a service client", async () => {
    const r = await requireRole(reqWith("Bearer admin-token"), ["admin"]);
    assert.equal(r.user.id, ADMIN_ID);
    assert.equal(r.profile.role, "admin");
    assert.ok(r.supabase);
  });

  test("a missing service key -> 500 supabase_not_configured", async () => {
    const saved = envVars.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete envVars.SUPABASE_SERVICE_ROLE_KEY;
      const r = await requireRole(reqWith("Bearer admin-token"), ["admin"]);
      assert.equal(r.status, 500);
      assert.equal(r.error, "supabase_not_configured");
    } finally {
      envVars.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });

  test(
    "a database failure while loading the profile is a server error, not a permissions error",
    { todo: "RISK: a failed profile lookup is reported as 403 no_profile, hiding a real outage" },
    async () => {
      db.fail("profiles", "select", { message: "connection lost" });
      const r = await requireRole(reqWith("Bearer admin-token"), ["admin"]);
      assert.equal(r.status, 500);
    },
  );
});

describe("_shared/orders.js", () => {
  let db;
  const ORDER = uuid(70);
  const item = {
    id: uuid(71),
    name: "Widget",
    length_cm: "20",
    width_cm: "15",
    height_cm: "10",
    weight_kg: "2.5",
    is_fragile: false,
    dangerous_goods_class: null,
  };
  const container = {
    id: uuid(72),
    name: "Carton",
    length_cm: 60,
    width_cm: 40,
    height_cm: 40,
    max_weight_kg: 30,
  };

  beforeEach(() => {
    db = newDb();
    db.seed("orders", [{ id: ORDER, external_ref: "REF-1", status: "draft" }]);
    db.seed("order_items", [{ order_id: ORDER, quantity: 3, items: item }]);
    db.seed("order_containers", [{ order_id: ORDER, containers: container }]);
  });

  test("toContractDimensions coerces numeric strings and adds the unit", () => {
    assert.deepEqual(
      sharedOrders.toContractDimensions({ length_cm: "20", width_cm: "15", height_cm: "10" }),
      { length: 20, width: 15, height: 10, unit: "cm" },
    );
  });

  test("toContractItem defaults quantity to 1", () => {
    const out = sharedOrders.toContractItem(item);
    assert.equal(out.quantity, 1);
    assert.deepEqual(out.weight, { value: 2.5, unit: "kg" });
    assert.equal(sharedOrders.toContractItem({ ...item, quantity: 4 }).quantity, 4);
  });

  test("toContractContainer builds dimensions and maxWeight", () => {
    const out = sharedOrders.toContractContainer(container);
    assert.deepEqual(out.maxWeight, { value: 30, unit: "kg" });
    assert.deepEqual(out.dimensions, { length: 60, width: 40, height: 40, unit: "cm" });
  });

  test("toApiContractResult maps DB columns and defaults missing arrays", () => {
    assert.equal(sharedOrders.toApiContractResult("o1", null), null);
    assert.deepEqual(sharedOrders.toApiContractResult("o1", {}), {
      orderId: "o1",
      packedContainers: [],
      unpackedItems: [],
    });
    assert.deepEqual(
      sharedOrders.toApiContractResult("o1", {
        packed_containers: [{ containerId: "c" }],
        unpacked_items: [{ itemId: "i" }],
      }),
      { orderId: "o1", packedContainers: [{ containerId: "c" }], unpackedItems: [{ itemId: "i" }] },
    );
  });

  test("loadOrderCatalog returns items (with quantity) and containers in contract shape", async () => {
    const catalog = await sharedOrders.loadOrderCatalog(db.client, ORDER);
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.items[0].quantity, 3);
    assert.equal(catalog.items[0].dimensions.length, 20);
    assert.equal(catalog.containers[0].name, "Carton");
  });

  test("loadOrderCatalog passes database errors up", async () => {
    db.fail("order_containers", "select", { message: "db down" });
    await assert.rejects(sharedOrders.loadOrderCatalog(db.client, ORDER), { message: "db down" });
  });

  test("loadOrderForOptimize builds a solver payload from the DB", async () => {
    const payload = await sharedOrders.loadOrderForOptimize(db.client, ORDER);
    assert.equal(payload.orderId, ORDER);
    assert.equal(payload.items[0].quantity, 3);
    assert.equal(payload.containers[0].maxWeight.value, 30);
  });

  test("loadOrderForOptimize throws not_found for an unknown order", async () => {
    await assert.rejects(sharedOrders.loadOrderForOptimize(db.client, uuid(999)), {
      message: "not_found",
    });
  });

  test("loadOrderForOptimize rejects an order with no items or no containers", async () => {
    db.tables.order_items = [];
    await assert.rejects(sharedOrders.loadOrderForOptimize(db.client, ORDER), {
      message: "order_missing_items_or_containers",
    });
  });
});

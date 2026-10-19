import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadHandler, newDb, call, uuid, ADMIN_ID, WORKER_ID } from "./helpers/harness.mjs";

const handler = await loadHandler("catalog");

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin" });
  db.addUser("worker-token", { id: WORKER_ID });
});

const get = (token) => call(handler, { method: "GET", token, url: "http://localhost/catalog" });

describe("catalog", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("POST returns 405", async () => {
    assert.equal((await call(handler, { method: "POST", token: "admin-token", body: {} })).status, 405);
  });

  test("no token -> 401", async () => {
    assert.equal((await get(undefined)).status, 401);
  });

  test("a worker -> 403 forbidden", async () => {
    const res = await get("worker-token");
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "forbidden");
  });

  test("an admin gets items and containers sorted by name", async () => {
    db.seed("items", [
      { id: uuid(1), name: "Zebra toy", length_cm: 10, width_cm: 5, height_cm: 5, weight_kg: 1 },
      { id: uuid(2), name: "Apple box", length_cm: 20, width_cm: 15, height_cm: 10, weight_kg: 2 },
    ]);
    db.seed("containers", [
      { id: uuid(3), name: "Large carton", length_cm: 60, width_cm: 40, height_cm: 40, max_weight_kg: 30 },
      { id: uuid(4), name: "Small carton", length_cm: 30, width_cm: 20, height_cm: 20, max_weight_kg: 10 },
    ]);
    const res = await get("admin-token");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.name), ["Apple box", "Zebra toy"]);
    assert.deepEqual(body.containers.map((c) => c.name), ["Large carton", "Small carton"]);
  });

  test("an empty catalog returns empty lists", async () => {
    const body = await (await get("admin-token")).json();
    assert.deepEqual(body, { items: [], containers: [] });
  });

  test("a database error loading items returns 500 with its message", async () => {
    db.fail("items", "select", { message: "items down" });
    const res = await get("admin-token");
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "database_error");
    assert.equal(body.message, "items down");
  });

  test("a database error loading containers returns 500", async () => {
    db.fail("containers", "select", { message: "containers down" });
    const res = await get("admin-token");
    assert.equal(res.status, 500);
    assert.equal((await res.json()).message, "containers down");
  });
});

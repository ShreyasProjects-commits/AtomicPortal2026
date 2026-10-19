import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadHandler, newDb, call, uuid, ADMIN_ID, WORKER_ID, WORKER2_ID } from "./helpers/harness.mjs";

const handler = await loadHandler("worker-stats");

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin", first_name: "Ada", last_name: "Admin" });
  db.addUser("worker-token", { id: WORKER_ID, first_name: "Bob", last_name: "Builder" });
  db.addUser("worker2-token", { id: WORKER2_ID, first_name: "Carol", last_name: "Packer", active: false });
});

const get = (token, query = "") =>
  call(handler, { method: "GET", token, url: `http://localhost/worker-stats${query}` });

let n = 100;
const order = (extra) => ({ id: uuid(n++), status: "solved", assigned_worker_id: null, completed_at: null, ...extra });

describe("worker-stats: access", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("POST returns 405 (checked before auth)", async () => {
    assert.equal((await call(handler, { method: "POST", body: {} })).status, 405);
  });

  test("no token -> 401", async () => {
    assert.equal((await get(undefined)).status, 401);
  });

  test("?scope=admin as a worker -> 403 forbidden", async () => {
    const res = await get("worker-token", "?scope=admin");
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "forbidden");
  });
});

describe("worker-stats: a user's own stats", () => {
  test("counts assigned, open, completed and failed orders and distinct days worked", async () => {
    db.seed("orders", [
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-16T01:00:00.000Z" }), // 16th, midday Sydney
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-16T05:00:00.000Z" }), // same Sydney day
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-17T05:00:00.000Z" }), // 17th
      order({ assigned_worker_id: WORKER_ID, status: "draft" }),
      order({ assigned_worker_id: WORKER_ID, status: "failed" }),
      order({ assigned_worker_id: WORKER2_ID, completed_at: "2026-10-18T05:00:00.000Z" }), // not Bob's
    ]);
    const res = await get("worker-token");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      assigned_count: 5,
      open_count: 2,
      completed_count: 3,
      failed_count: 1,
      days_worked: 2,
      days_worked_dates: ["2026-10-16", "2026-10-17"],
    });
  });

  test("a user with no orders gets zeros and an empty date list", async () => {
    const body = await (await get("worker-token")).json();
    assert.deepEqual(body, {
      assigned_count: 0,
      open_count: 0,
      completed_count: 0,
      failed_count: 0,
      days_worked: 0,
      days_worked_dates: [],
    });
  });

  test("dates come back sorted oldest first", async () => {
    db.seed("orders", [
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-20T05:00:00.000Z" }),
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-05T05:00:00.000Z" }),
    ]);
    const body = await (await get("worker-token")).json();
    assert.deepEqual(body.days_worked_dates, ["2026-10-05", "2026-10-20"]);
  });

  test("an admin without a scope gets their own (personal) stats", async () => {
    db.seed("orders", [order({ assigned_worker_id: WORKER_ID })]);
    const body = await (await get("admin-token")).json();
    assert.equal(body.assigned_count, 0);
  });

  test("a database error returns 500 database_error", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get("worker-token");
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "database_error");
  });

  test("days worked follow the Sydney calendar day, not UTC", async () => {
    db.seed("orders", [
      // 21:00Z on the 16th is 08:00 on the 17th in Sydney (daylight saving)
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-16T21:00:00.000Z" }),
      // 12:00Z on the 17th is 23:00 on the 17th in Sydney: same day as the order above
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-17T12:00:00.000Z" }),
    ]);
    const body = await (await get("worker-token")).json();
    assert.equal(body.days_worked, 1);
    assert.deepEqual(body.days_worked_dates, ["2026-10-17"]);
  });

  test("just after midnight Sydney time counts as the next day", async () => {
    db.seed("orders", [
      // 12:30Z on the 17th is 23:30 Sydney; 13:30Z is 00:30 on the 18th
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-17T12:30:00.000Z" }),
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-17T13:30:00.000Z" }),
    ]);
    const body = await (await get("worker-token")).json();
    assert.deepEqual(body.days_worked_dates, ["2026-10-17", "2026-10-18"]);
  });

  test("the admin summary uses the same local-day rule", async () => {
    db.seed("orders", [
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-16T21:00:00.000Z" }),
      order({ assigned_worker_id: WORKER_ID, completed_at: "2026-10-17T12:00:00.000Z" }),
    ]);
    const { workers } = await (await get("admin-token", "?scope=admin")).json();
    assert.equal(workers.find((w) => w.id === WORKER_ID).days_worked, 1);
  });
});

describe("worker-stats: ?scope=admin", () => {
  beforeEach(() => {
    db.seed("orders", [
      order({ status: "draft" }),
      order({ status: "submitted", assigned_worker_id: WORKER_ID }),
      order({ status: "solved", assigned_worker_id: WORKER_ID, completed_at: "2026-10-16T01:00:00.000Z" }),
      order({ status: "solved", assigned_worker_id: WORKER2_ID, completed_at: "2026-10-17T01:00:00.000Z" }),
      order({ status: "failed", assigned_worker_id: WORKER2_ID }),
    ]);
  });

  test("returns totals by status, unassigned and completed counts", async () => {
    const res = await get("admin-token", "?scope=admin");
    assert.equal(res.status, 200);
    const { totals } = await res.json();
    assert.deepEqual(totals, {
      total_orders: 5,
      by_status: { draft: 1, submitted: 1, solved: 2, failed: 1 },
      unassigned_count: 1,
      completed_count: 2,
      total_workers: 2,
    });
  });

  test("lists only warehouse workers, each with their own counts", async () => {
    const { workers } = await (await get("admin-token", "?scope=admin")).json();
    assert.equal(workers.length, 2, "the admin account is not listed");
    const bob = workers.find((w) => w.id === WORKER_ID);
    assert.deepEqual(
      [bob.first_name, bob.assigned_count, bob.open_count, bob.completed_count, bob.days_worked],
      ["Bob", 2, 1, 1, 1],
    );
    const carol = workers.find((w) => w.id === WORKER2_ID);
    assert.deepEqual(
      [carol.active, carol.assigned_count, carol.open_count, carol.completed_count],
      [false, 2, 1, 1],
    );
  });

  test("with no orders everything is zero", async () => {
    db.tables.orders = [];
    const { totals, workers } = await (await get("admin-token", "?scope=admin")).json();
    assert.equal(totals.total_orders, 0);
    assert.equal(totals.unassigned_count, 0);
    assert.ok(workers.every((w) => w.assigned_count === 0));
  });

  test("with no workers the table is empty", async () => {
    db.tables.profiles = db.tables.profiles.filter((p) => p.role === "admin");
    const { totals, workers } = await (await get("admin-token", "?scope=admin")).json();
    assert.equal(totals.total_workers, 0);
    assert.deepEqual(workers, []);
  });

  test("a database error loading orders returns 500", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get("admin-token", "?scope=admin");
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "database_error");
  });
});

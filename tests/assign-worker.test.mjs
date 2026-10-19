import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadHandler, newDb, call, uuid, ADMIN_ID, WORKER_ID, WORKER2_ID } from "./helpers/harness.mjs";

const handler = await loadHandler("assign-worker");

const INACTIVE_ID = uuid(4);
const ORDER_1 = uuid(101); // open, assigned to WORKER
const ORDER_2 = uuid(102); // completed, assigned to WORKER (must not count as open)
const ORDER_3 = uuid(103); // open, assigned to WORKER2
const FREE_1 = uuid(111); // unassigned
const FREE_2 = uuid(112);
const FREE_3 = uuid(113);

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin", first_name: "Alice", last_name: "Admin" });
  db.addUser("worker-token", { id: WORKER_ID, first_name: "Bob", last_name: "Builder" });
  db.addUser("worker2-token", { id: WORKER2_ID, first_name: "Carol", last_name: "Packer" });
  db.addUser("inactive-token", { id: INACTIVE_ID, first_name: "Dave", last_name: "Away", active: false });
  db.seed("orders", [
    { id: ORDER_1, external_ref: "REF-1", status: "solved", assigned_worker_id: WORKER_ID, completed_at: null },
    { id: ORDER_2, external_ref: "REF-2", status: "solved", assigned_worker_id: WORKER_ID, completed_at: "2026-10-01T00:00:00Z" },
    { id: ORDER_3, external_ref: "REF-3", status: "draft", assigned_worker_id: WORKER2_ID, completed_at: null },
    { id: FREE_1, external_ref: "REF-F1", status: "draft", assigned_worker_id: null, completed_at: null },
    { id: FREE_2, external_ref: "REF-F2", status: "draft", assigned_worker_id: null, completed_at: null },
    { id: FREE_3, external_ref: "REF-F3", status: "draft", assigned_worker_id: null, completed_at: null },
  ]);
});

const get = (token) => call(handler, { method: "GET", token });
const act = (token, body) => call(handler, { method: "POST", token, body });
const orderRow = (id) => db.tables.orders.find((o) => o.id === id);
const profileRow = (id) => db.tables.profiles.find((p) => p.id === id);

describe("assign-worker: access", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("no token -> 401", async () => {
    assert.equal((await get(undefined)).status, 401);
  });

  test("a worker -> 403 on both GET and POST", async () => {
    assert.equal((await get("worker-token")).status, 403);
    assert.equal((await act("worker-token", { action: "assign", orderId: FREE_1, workerId: WORKER_ID })).status, 403);
    assert.equal(orderRow(FREE_1).assigned_worker_id, null);
  });

  test("an unsupported method -> 405", async () => {
    assert.equal((await call(handler, { method: "DELETE", token: "admin-token" })).status, 405);
  });

  test("invalid JSON -> 400", async () => {
    const res = await call(handler, {
      method: "POST",
      token: "admin-token",
      body: "{bad",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_json");
  });

  test("a missing or unknown action -> 400", async () => {
    assert.equal((await act("admin-token", {})).status, 400);
    assert.equal((await act("admin-token", { action: "explode" })).status, 400);
  });
});

describe("assign-worker: GET list", () => {
  test("lists profiles ordered by first name with their open order counts", async () => {
    const res = await get("admin-token");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.map((p) => [p.first_name, p.open_order_count]),
      [
        ["Alice", 0],
        ["Bob", 1], // ORDER_1 open; ORDER_2 is completed so it doesn't count
        ["Carol", 1],
        ["Dave", 0],
      ],
    );
    assert.ok(body.every((p) => "role" in p && "active" in p));
  });

  test("a database error loading orders -> 500", async () => {
    db.fail("orders", "select", { message: "db down" });
    const res = await get("admin-token");
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "database_error");
  });
});

describe("assign-worker: assign", () => {
  test("a missing or non-UUID orderId -> 400", async () => {
    assert.equal((await act("admin-token", { action: "assign", workerId: WORKER_ID })).status, 400);
    assert.equal((await act("admin-token", { action: "assign", orderId: "nope", workerId: WORKER_ID })).status, 400);
  });

  test("a non-UUID workerId -> 400", async () => {
    const res = await act("admin-token", { action: "assign", orderId: FREE_1, workerId: "nope" });
    assert.equal(res.status, 400);
  });

  test("an unknown workerId -> 400", async () => {
    const res = await act("admin-token", { action: "assign", orderId: FREE_1, workerId: uuid(999) });
    assert.equal(res.status, 400);
  });

  test("an admin account can't be assigned orders", async () => {
    const res = await act("admin-token", { action: "assign", orderId: FREE_1, workerId: ADMIN_ID });
    assert.equal(res.status, 400);
    assert.equal(orderRow(FREE_1).assigned_worker_id, null);
  });

  test("assigns an order to a worker", async () => {
    const res = await act("admin-token", { action: "assign", orderId: FREE_1, workerId: WORKER_ID });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).assigned_worker_id, WORKER_ID);
    assert.equal(orderRow(FREE_1).assigned_worker_id, WORKER_ID);
  });

  test("workerId null unassigns the order", async () => {
    const res = await act("admin-token", { action: "assign", orderId: ORDER_1, workerId: null });
    assert.equal(res.status, 200);
    assert.equal(orderRow(ORDER_1).assigned_worker_id, null);
  });

  test("a missing workerId also unassigns", async () => {
    const res = await act("admin-token", { action: "assign", orderId: ORDER_1 });
    assert.equal(res.status, 200);
    assert.equal(orderRow(ORDER_1).assigned_worker_id, null);
  });

  test("an unknown order -> 404", async () => {
    const res = await act("admin-token", { action: "assign", orderId: uuid(999), workerId: WORKER_ID });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test(
    "an inactive worker can't be assigned an order",
    { todo: "BUG: the error message says 'active' but only the role is checked, so a disabled worker can be assigned" },
    async () => {
      const res = await act("admin-token", { action: "assign", orderId: FREE_1, workerId: INACTIVE_ID });
      assert.equal(res.status, 400);
    },
  );
});

describe("assign-worker: auto assign", () => {
  test("no active workers -> 409 no_workers", async () => {
    profileRow(WORKER_ID).active = false;
    profileRow(WORKER2_ID).active = false;
    const res = await act("admin-token", { action: "auto" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "no_workers");
  });

  test("nothing unassigned -> an empty assigned list", async () => {
    for (const id of [FREE_1, FREE_2, FREE_3]) orderRow(id).assigned_worker_id = WORKER2_ID;
    const res = await act("admin-token", { action: "auto" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { assigned: [] });
  });

  test("gives each order to the least-loaded active worker; a tie goes to the first in the list", async () => {
    // Open orders: Bob = 3 (ORDER_1 + 2 extra), Carol = 1 (ORDER_3). Dave is inactive.
    db.seed("orders", [
      { id: uuid(120), assigned_worker_id: WORKER_ID, completed_at: null },
      { id: uuid(121), assigned_worker_id: WORKER_ID, completed_at: null },
    ]);
    const res = await act("admin-token", { action: "auto" });
    assert.equal(res.status, 200);
    const { assigned } = await res.json();
    assert.deepEqual(
      assigned.map((a) => [a.orderId, a.workerId]),
      [
        [FREE_1, WORKER2_ID], // Carol 1 -> 2
        [FREE_2, WORKER2_ID], // Carol 2 -> 3
        [FREE_3, WORKER_ID], // Bob 3 = Carol 3, tie -> first in list (Bob)
      ],
    );
    for (const a of assigned) {
      assert.equal(orderRow(a.orderId).assigned_worker_id, a.workerId, "saved to the database");
    }
  });

  test("never assigns to an inactive worker", async () => {
    const { assigned } = await (await act("admin-token", { action: "auto" })).json();
    assert.ok(assigned.length > 0);
    assert.ok(assigned.every((a) => a.workerId !== INACTIVE_ID));
  });

  test("spreads a batch evenly rather than piling on one worker", async () => {
    // Bob = 1 open, Carol = 1 open, three free orders -> a 2 / 1 split.
    const { assigned } = await (await act("admin-token", { action: "auto" })).json();
    assert.equal(assigned.length, 3);
    const perWorker = {};
    for (const a of assigned) perWorker[a.workerId] = (perWorker[a.workerId] ?? 0) + 1;
    assert.deepEqual(Object.values(perWorker).sort((a, b) => a - b), [1, 2]);
  });

  test("a worker with more open orders gets fewer new ones", async () => {
    // Make Bob busy: 3 extra open orders (total 4), Carol stays at 1.
    db.seed("orders", [
      { id: uuid(121), assigned_worker_id: WORKER_ID, completed_at: null },
      { id: uuid(122), assigned_worker_id: WORKER_ID, completed_at: null },
      { id: uuid(123), assigned_worker_id: WORKER_ID, completed_at: null },
    ]);
    const { assigned } = await (await act("admin-token", { action: "auto" })).json();
    assert.ok(assigned.every((a) => a.workerId === WORKER2_ID));
  });

  test("orderIds limits which orders are assigned", async () => {
    const { assigned } = await (await act("admin-token", { action: "auto", orderIds: [FREE_2] })).json();
    assert.deepEqual(assigned.map((a) => a.orderId), [FREE_2]);
    assert.equal(orderRow(FREE_1).assigned_worker_id, null);
    assert.equal(orderRow(FREE_3).assigned_worker_id, null);
  });

  test("an invalid id inside orderIds -> 400", async () => {
    const res = await act("admin-token", { action: "auto", orderIds: [FREE_1, "nope"] });
    assert.equal(res.status, 400);
  });

  test("orderIds that are already assigned are skipped", async () => {
    const { assigned } = await (await act("admin-token", { action: "auto", orderIds: [ORDER_1] })).json();
    assert.deepEqual(assigned, []);
  });

  test("a failure while saving returns 207 with the error", async () => {
    db.fail("orders", "update", { message: "write failed" });
    const res = await act("admin-token", { action: "auto" });
    assert.equal(res.status, 207);
    const body = await res.json();
    assert.equal(body.error, "write failed");
    assert.deepEqual(body.assigned, []);
  });
});

describe("assign-worker: set_role", () => {
  test("a missing or invalid userId -> 400", async () => {
    assert.equal((await act("admin-token", { action: "set_role", role: "admin" })).status, 400);
    assert.equal((await act("admin-token", { action: "set_role", userId: "nope", role: "admin" })).status, 400);
  });

  test("an invalid role -> 400", async () => {
    const res = await act("admin-token", { action: "set_role", userId: WORKER_ID, role: "boss" });
    assert.equal(res.status, 400);
  });

  test("an admin can't demote their own account", async () => {
    const res = await act("admin-token", { action: "set_role", userId: ADMIN_ID, role: "warehouse_worker" });
    assert.equal(res.status, 400);
    assert.equal(profileRow(ADMIN_ID).role, "admin");
  });

  test("setting your own role to admin is allowed (no change)", async () => {
    const res = await act("admin-token", { action: "set_role", userId: ADMIN_ID, role: "admin" });
    assert.equal(res.status, 200);
  });

  test("an unknown user -> 404", async () => {
    const res = await act("admin-token", { action: "set_role", userId: uuid(999), role: "admin" });
    assert.equal(res.status, 404);
  });

  test("promotes a worker to admin", async () => {
    const res = await act("admin-token", { action: "set_role", userId: WORKER_ID, role: "admin" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).role, "admin");
    assert.equal(profileRow(WORKER_ID).role, "admin");
  });

  test("demotes another admin to worker", async () => {
    profileRow(WORKER_ID).role = "admin";
    const res = await act("admin-token", { action: "set_role", userId: WORKER_ID, role: "warehouse_worker" });
    assert.equal(res.status, 200);
    assert.equal(profileRow(WORKER_ID).role, "warehouse_worker");
  });
});

describe("assign-worker: set_active", () => {
  test("a missing or invalid userId -> 400", async () => {
    assert.equal((await act("admin-token", { action: "set_active", active: false })).status, 400);
    assert.equal((await act("admin-token", { action: "set_active", userId: "nope", active: false })).status, 400);
  });

  test("active must be a real boolean", async () => {
    for (const active of ["false", 0, null, undefined]) {
      const res = await act("admin-token", { action: "set_active", userId: WORKER_ID, active });
      assert.equal(res.status, 400, String(active));
    }
  });

  test("an admin can't disable their own account", async () => {
    const res = await act("admin-token", { action: "set_active", userId: ADMIN_ID, active: false });
    assert.equal(res.status, 400);
    assert.equal(profileRow(ADMIN_ID).active, true);
  });

  test("an unknown user -> 404", async () => {
    const res = await act("admin-token", { action: "set_active", userId: uuid(999), active: false });
    assert.equal(res.status, 404);
  });

  test("disables and re-enables a worker", async () => {
    let res = await act("admin-token", { action: "set_active", userId: WORKER_ID, active: false });
    assert.equal(res.status, 200);
    assert.equal(profileRow(WORKER_ID).active, false);
    res = await act("admin-token", { action: "set_active", userId: WORKER_ID, active: true });
    assert.equal(profileRow(WORKER_ID).active, true);
  });

  test("a disabled worker is then locked out of the API", async () => {
    await act("admin-token", { action: "set_active", userId: WORKER_ID, active: false });
    const res = await call(handler, { method: "GET", token: "worker-token" });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "account_disabled");
  });
});

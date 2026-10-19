import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const handler = await loadHandler("import-csv");

const HEADER =
  "record_type,order_ref,item_name,length_cm,width_cm,height_cm,weight_kg,quantity,container_name,max_weight_kg";
const orderRows = (ref) =>
  `item,${ref},Widget,20,15,10,2.5,2,,\ncontainer,${ref},,60,40,40,,,Carton,30`;
const csv = (...refs) => [HEADER, ...refs.map(orderRows)].join("\n");

let db;
beforeEach(() => {
  db = newDb();
  db.addUser("admin-token", { id: ADMIN_ID, role: "admin" });
  db.addUser("worker-token", { id: WORKER_ID });
  stubFetch(() => solverOk());
});
afterEach(() => restoreFetch());

const upload = (body, { token = "admin-token", query = "" } = {}) =>
  call(handler, {
    method: "POST",
    token,
    body,
    url: `http://localhost/import-csv${query}`,
    headers: typeof body === "string" ? { "content-type": "text/csv" } : {},
  });
const orders = () => db.table("orders");
const byRef = (ref) => orders().find((o) => o.external_ref === ref);

describe("import-csv: access", () => {
  test("OPTIONS works without a token", async () => {
    assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
  });

  test("GET returns 405", async () => {
    assert.equal((await call(handler, { method: "GET" })).status, 405);
  });

  test("no token -> 401", async () => {
    assert.equal((await upload(csv("ORD-9001"), { token: null })).status, 401);
    assert.equal(orders().length, 0);
  });

  test("a worker -> 403 and nothing is imported", async () => {
    const res = await upload(csv("ORD-9001"), { token: "worker-token" });
    assert.equal(res.status, 403);
    assert.equal(orders().length, 0);
  });
});

describe("import-csv: request body", () => {
  test("an empty or whitespace-only body -> 400", async () => {
    for (const body of ["", "   \n  "]) {
      const res = await upload(body);
      assert.equal(res.status, 400);
      assert.match((await res.json()).message, /empty/);
    }
  });

  test("multipart without a file field -> 400", async () => {
    const form = new FormData();
    form.set("note", "hello");
    const res = await upload(form);
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /file field/);
  });

  test("multipart where 'file' is plain text rather than a file -> 400", async () => {
    const form = new FormData();
    form.set("file", "just text");
    assert.equal((await upload(form)).status, 400);
  });

  test("a multipart file upload is accepted", async () => {
    const form = new FormData();
    form.set("file", new Blob([csv("ORD-9001")], { type: "text/csv" }), "orders.csv");
    const res = await upload(form);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).imported[0].external_ref, "ORD-9001");
  });

  test("an invalid CSV -> 400 invalid_csv naming the line", async () => {
    const res = await upload(`${HEADER}\nbox,ORD-1,Widget,1,1,1,1,1,,`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_csv");
    assert.match(body.message, /line 2/);
    assert.equal(orders().length, 0);
  });

  test("a header-only CSV -> 400 invalid_csv", async () => {
    const res = await upload(HEADER);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_csv");
  });
});

describe("import-csv: importing orders", () => {
  test("imports each order, solves it and reports it as solved", async () => {
    const res = await upload(csv("ORD-9001", "ORD-9002"));
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.deepEqual(
      imported.map((i) => [i.external_ref, i.status]),
      [
        ["ORD-9001", "solved"],
        ["ORD-9002", "solved"],
      ],
    );
    assert.equal(byRef("ORD-9001").status, "solved");
    assert.equal(db.table("order_results").length, 2);
    assert.equal(fetchCalls.length, 2, "one solver call per order");
  });

  test("creates the items, containers and links for the order", async () => {
    await upload(csv("ORD-9001"));
    const orderId = byRef("ORD-9001").id;
    assert.equal(db.table("items").length, 1);
    assert.equal(db.table("containers").length, 1);
    assert.equal(db.table("order_items").find((r) => r.order_id === orderId).quantity, 2);
    assert.equal(db.table("order_containers").filter((r) => r.order_id === orderId).length, 1);
  });

  test("imports the real samples/order-import-2.csv (10 orders)", async () => {
    const text = readFileSync(new URL("../samples/order-import-2.csv", import.meta.url), "utf8");
    const { imported } = await (await upload(text)).json();
    assert.equal(imported.length, 10);
    assert.ok(imported.every((i) => i.status === "solved"));
    assert.equal(orders().length, 10);
  });

  test("an order with items but no container is reported as failed and not saved", async () => {
    const res = await upload(`${HEADER}\nitem,ORD-9001,Widget,20,15,10,2.5,2,,`);
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.equal(imported[0].status, "failed");
    assert.match(imported[0].error, /at least one item and one container/);
    assert.equal(orders().length, 0);
  });
});

describe("import-csv: duplicates and replace", () => {
  beforeEach(() => {
    db.seed("orders", [{ id: uuid(500), external_ref: "ORD-9001", status: "solved" }]);
  });

  test("an existing reference -> 409 duplicate_order", async () => {
    const res = await upload(csv("ORD-9001"));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "duplicate_order");
    assert.match(body.message, /ORD-9001/);
    assert.equal(orders().length, 1);
  });

  test("?replace=true deletes the old order and imports a fresh one", async () => {
    const res = await upload(csv("ORD-9001"), { query: "?replace=true" });
    assert.equal(res.status, 200);
    assert.equal(orders().some((o) => o.id === uuid(500)), false);
    assert.equal(orders().filter((o) => o.external_ref === "ORD-9001").length, 1);
  });

  test("only ?replace=true (not other values) triggers a replace", async () => {
    const res = await upload(csv("ORD-9001"), { query: "?replace=yes" });
    assert.equal(res.status, 409);
  });

  test(
    "a duplicate later in the file doesn't leave earlier orders half-imported",
    { todo: "RISK: the 409 is returned after earlier orders in the same file were already created" },
    async () => {
      const res = await upload(csv("ORD-9002", "ORD-9001"));
      assert.equal(res.status, 409);
      assert.equal(byRef("ORD-9002"), undefined);
    },
  );
});

describe("import-csv: solver problems", () => {
  test("a solver failure marks that order failed but the request still succeeds", async () => {
    stubFetch(() => solverHttpError());
    const res = await upload(csv("ORD-9001"));
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.equal(imported[0].status, "failed");
    assert.equal(imported[0].error, "solver_error");
    assert.equal(byRef("ORD-9001").status, "failed");
  });

  test("an unreachable solver is reported as solver_unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { imported } = await (await upload(csv("ORD-9001"))).json();
    assert.equal(imported[0].error, "solver_unreachable");
  });

  test("one order failing doesn't stop the rest of the file", async () => {
    stubFetch((_url, _init, n) => (n === 1 ? solverHttpError() : solverOk()));
    const { imported } = await (await upload(csv("ORD-9001", "ORD-9002"))).json();
    assert.deepEqual(
      imported.map((i) => i.status),
      ["failed", "solved"],
    );
  });
});

describe("import-csv: database problems", () => {
  test("a failure creating the order is reported for that order only", async () => {
    db.fail("orders", "insert", { code: "XX000", message: "disk full" });
    const res = await upload(csv("ORD-9001"));
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.equal(imported[0].status, "failed");
    assert.equal(imported[0].error, "disk full");
  });

  test(
    "a failure saving an order's items is reported instead of ignored",
    { todo: "RISK: errors from the order_items / order_containers inserts are ignored" },
    async () => {
      db.fail("order_items", "insert", { message: "bad item" });
      const { imported } = await (await upload(csv("ORD-9001"))).json();
      assert.equal(imported[0].status, "failed");
    },
  );
});

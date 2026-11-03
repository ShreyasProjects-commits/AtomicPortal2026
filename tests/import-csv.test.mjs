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

  test("a duplicate later in the file doesn't leave earlier orders half-imported", async () => {
    const res = await upload(csv("ORD-9002", "ORD-9001"));
    assert.equal(res.status, 409);
    assert.equal(byRef("ORD-9002"), undefined);
    assert.equal(orders().length, 1, "only the original order exists");
    assert.equal(fetchCalls.length, 0, "the solver was never called");
  });

  test("with ?replace=true every order in the file is re-imported", async () => {
    db.seed("orders", [{ id: uuid(501), external_ref: "ORD-9002", status: "solved" }]);
    const res = await upload(csv("ORD-9001", "ORD-9002"), { query: "?replace=true" });
    assert.equal(res.status, 200);
    assert.equal(orders().some((o) => o.id === uuid(500) || o.id === uuid(501)), false);
    assert.equal(orders().length, 2);
  });
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

describe("import-csv: blank rows in a single CSV", () => {
  test("rows of only commas (typical spreadsheet export) are ignored", async () => {
    const text = `${csv("ORD-9001")}\n,,,,,,,,,\n,,,,,,,,,\n`;
    const res = await upload(text);
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.deepEqual(imported.map((i) => i.status), ["solved"]);
  });

  test("a comma-only row before the header is ignored too", async () => {
    const res = await upload(`,,,,,,,,,\n${csv("ORD-9001")}\n`);
    assert.equal(res.status, 200);
  });

  test("a CSV of only comma rows is rejected as having no data", async () => {
    const res = await upload(",,,,\n,,,,\n");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_csv");
  });

  test("a single-CSV import sends no MaximumBoxes/BoxWeight to the solver", async () => {
    await upload(csv("ORD-9001"));
    const [box] = fetchCalls[0].body.boxTypes;
    assert.equal("MaximumBoxes" in box, false);
    assert.equal("BoxWeight" in box, false);
  });
});

describe("import-csv: two files (boxes + items) become one order", () => {
  const BOXES = [
    { Reference: "P200", Width: 440, Length: 275, Depth: 165, MaxWeight: 10, BoxWeight: 0.5, Active: true, MaximumBoxes: 2 },
    { Reference: "P500", Width: 525, Length: 365, Depth: 310, MaxWeight: 20, BoxWeight: 0.9, Active: true, MaximumBoxes: 1 },
    { Reference: "OLD", Width: 1000, Length: 1000, Depth: 1000, Active: false },
  ];
  const ITEMS = [
    { ItemCode: "ITM-014", ItemReference: "U3", Width: 108, Length: 108, Depth: 137, Weight: 0.1 },
    { ItemCode: "ITM-013", ItemReference: "S6", Width: 140, Length: 140, Depth: 75, Weight: 0.1 },
  ];
  const toCsv = (rows) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return [cols.join(","), ...rows.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");
  };

  const twoFiles = ({ boxes = JSON.stringify(BOXES), items = JSON.stringify(ITEMS), ref } = {}) => {
    const form = new FormData();
    form.append("files", new Blob([boxes], { type: "application/json" }), "boxesChallenge.json");
    form.append("files", new Blob([items], { type: "application/json" }), "itemsChallenge.json");
    if (ref !== undefined) form.append("order_ref", ref);
    return form;
  };

  test("creates ONE order from the two files and solves it", async () => {
    const res = await upload(twoFiles({ ref: "CHALLENGE-1" }));
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.equal(imported.length, 1);
    assert.deepEqual([imported[0].external_ref, imported[0].status], ["CHALLENGE-1", "solved"]);

    assert.equal(orders().length, 1);
    assert.equal(db.table("items").length, 2);
    assert.equal(db.table("order_items").length, 2);
    assert.ok(db.table("order_items").every((r) => r.quantity === 1));
    assert.equal(db.table("order_containers").length, 2, "the inactive box is skipped");
    assert.equal(fetchCalls.length, 1, "one solver call for the whole order");
  });

  test("stores sizes in cm and doesn't store the box limit fields", async () => {
    await upload(twoFiles({ ref: "CHALLENGE-1" }));
    const containers = db.table("containers");
    assert.deepEqual(
      containers.map((c) => [c.name, c.length_cm, c.width_cm, c.height_cm, c.max_weight_kg]),
      [
        ["P200", 27.5, 44, 16.5, 10],
        ["P500", 36.5, 52.5, 31, 20],
      ],
    );
    assert.ok(containers.every((c) => !("max_boxes" in c) && !("box_weight_kg" in c)));
    const u3 = db.table("items").find((i) => i.name === "U3");
    assert.deepEqual([u3.length_cm, u3.width_cm, u3.height_cm, u3.weight_kg], [10.8, 10.8, 13.7, 0.1]);
  });

  test("sends the boxes to the solver without MaximumBoxes or BoxWeight (ignored for now)", async () => {
    await upload(twoFiles({ ref: "CHALLENGE-1" }));
    const { boxTypes, items } = fetchCalls[0].body;
    assert.deepEqual(
      boxTypes.map((b) => b.MaxWeight),
      [10, 20],
    );
    assert.ok(boxTypes.every((b) => !("MaximumBoxes" in b) && !("BoxWeight" in b)));
    assert.equal(boxTypes[0].Width, 440, "cm converted back to the solver's mm");
    assert.equal(items.length, 2);
    assert.equal(items[0].Depth, 137);
  });

  test("the order of the two files doesn't matter", async () => {
    const form = new FormData();
    form.append("files", new Blob([JSON.stringify(ITEMS)]), "itemsChallenge.json");
    form.append("files", new Blob([JSON.stringify(BOXES)]), "boxesChallenge.json");
    form.append("order_ref", "CHALLENGE-2");
    const res = await upload(form);
    assert.equal(res.status, 200);
    assert.equal(db.table("items").length, 2);
  });

  test("CSV files work as well as JSON", async () => {
    const res = await upload(twoFiles({ boxes: toCsv(BOXES), items: toCsv(ITEMS), ref: "CHALLENGE-3" }));
    assert.equal(res.status, 200);
    assert.equal(db.table("containers").length, 2);
  });

  test("blank and comma-only rows inside the files are ignored", async () => {
    const res = await upload(
      twoFiles({
        boxes: `${toCsv(BOXES)}\n,,,,,,,,\n`,
        items: `${toCsv(ITEMS)}\n,,,,,,\n,,,,,,\n`,
        ref: "CHALLENGE-4",
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(db.table("items").length, 2);
  });

  describe("order reference", () => {
    test("a typed reference is used (and trimmed)", async () => {
      const { imported } = await (await upload(twoFiles({ ref: "  MY-REF  " }))).json();
      assert.equal(imported[0].external_ref, "MY-REF");
    });

    test("no reference -> ORD-1001 when there are no ORD- orders", async () => {
      const { imported } = await (await upload(twoFiles())).json();
      assert.equal(imported[0].external_ref, "ORD-1001");
    });

    test("no reference -> the next number after the highest existing ORD- order", async () => {
      db.seed("orders", [
        { id: uuid(700), external_ref: "ORD-1053", status: "solved" },
        { id: uuid(701), external_ref: "ORD-1044", status: "solved" },
        { id: uuid(702), external_ref: "MY-REF", status: "solved" },
      ]);
      const { imported } = await (await upload(twoFiles())).json();
      assert.equal(imported[0].external_ref, "ORD-1054");
    });

    test("a blank or spaces-only reference counts as no reference", async () => {
      const { imported } = await (await upload(twoFiles({ ref: "   " }))).json();
      assert.equal(imported[0].external_ref, "ORD-1001");
    });

    test("two uploads without a reference get consecutive numbers", async () => {
      const a = await (await upload(twoFiles())).json();
      const b = await (await upload(twoFiles())).json();
      assert.deepEqual([a.imported[0].external_ref, b.imported[0].external_ref], ["ORD-1001", "ORD-1002"]);
    });

    test("a reference over 100 characters is rejected", async () => {
      const res = await upload(twoFiles({ ref: "x".repeat(101) }));
      assert.equal(res.status, 400);
      assert.match((await res.json()).message, /too long/);
      assert.equal(orders().length, 0);
    });
  });

  describe("duplicates", () => {
    beforeEach(() => {
      db.seed("orders", [{ id: uuid(500), external_ref: "CHALLENGE-1", status: "solved" }]);
    });

    test("an existing reference -> 409 and nothing new is created", async () => {
      const res = await upload(twoFiles({ ref: "CHALLENGE-1" }));
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error, "duplicate_order");
      assert.equal(orders().length, 1);
      assert.equal(fetchCalls.length, 0);
    });

    test("?replace=true replaces it", async () => {
      const res = await upload(twoFiles({ ref: "CHALLENGE-1" }), { query: "?replace=true" });
      assert.equal(res.status, 200);
      assert.equal(orders().some((o) => o.id === uuid(500)), false);
      assert.equal(orders().filter((o) => o.external_ref === "CHALLENGE-1").length, 1);
    });
  });

  describe("bad uploads", () => {
    const expectInvalid = async (form, pattern) => {
      const res = await upload(form);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "invalid_files");
      assert.match(body.message, pattern);
      assert.equal(orders().length, 0, "nothing was created");
      assert.equal(fetchCalls.length, 0, "the solver was not called");
    };

    test("only one file", async () => {
      const form = new FormData();
      form.append("files", new Blob([JSON.stringify(BOXES)]), "boxesChallenge.json");
      await expectInvalid(form, /exactly two files/);
    });

    test("three files", async () => {
      const form = twoFiles();
      form.append("files", new Blob([JSON.stringify(ITEMS)]), "again.json");
      await expectInvalid(form, /exactly two files/);
    });

    test("two boxes files", async () => {
      await expectInvalid(twoFiles({ items: JSON.stringify(BOXES) }), /2 boxes file\(s\) and 0 items file\(s\)/);
    });

    test("a file with the wrong columns names the file and what it found", async () => {
      await expectInvalid(
        twoFiles({ items: "record_type,order_ref\nitem,ORD-1" }),
        /itemsChallenge\.json: can't tell whether this is a boxes or an items file[\s\S]*Found: record_type, order_ref/,
      );
    });

    test("an active box with no MaxWeight", async () => {
      const boxes = JSON.stringify([{ Reference: "P1", Width: 100, Length: 100, Depth: 100, MaxWeight: "" }]);
      await expectInvalid(twoFiles({ boxes }), /box "P1" has no MaxWeight/);
    });

    test("invalid JSON", async () => {
      await expectInvalid(twoFiles({ boxes: "[{" }), /boxesChallenge\.json is not valid JSON/);
    });

    test("an empty file", async () => {
      await expectInvalid(twoFiles({ items: "   " }), /itemsChallenge\.json is empty/);
    });
  });

  test("only admins can upload (a worker gets 403 and nothing is created)", async () => {
    const res = await upload(twoFiles({ ref: "CHALLENGE-1" }), { token: "worker-token" });
    assert.equal(res.status, 403);
    assert.equal(orders().length, 0);
  });

  test("no token -> 401", async () => {
    assert.equal((await upload(twoFiles(), { token: null })).status, 401);
  });

  test("a solver failure marks the order failed but the request succeeds", async () => {
    stubFetch(() => solverHttpError());
    const res = await upload(twoFiles({ ref: "CHALLENGE-1" }));
    assert.equal(res.status, 200);
    const { imported } = await res.json();
    assert.deepEqual([imported[0].status, imported[0].error], ["failed", "solver_error"]);
    assert.equal(byRef("CHALLENGE-1").status, "failed");
  });

  test("a boxes file with unusable MaximumBoxes/BoxWeight values still imports", async () => {
    const boxes = JSON.stringify(
      BOXES.map((b) => ({ ...b, MaximumBoxes: "many", BoxWeight: "heavy" })),
    );
    const res = await upload(twoFiles({ boxes, ref: "CHALLENGE-1" }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).imported[0].status, "solved");
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

  test("a failure saving an order's items is reported and the order is cleaned up", async () => {
    db.fail("order_items", "insert", { message: "bad item" });
    const { imported } = await (await upload(csv("ORD-9001"))).json();
    assert.equal(imported[0].status, "failed");
    assert.equal(imported[0].error, "bad item");
    assert.equal(byRef("ORD-9001"), undefined, "no empty order left behind");
    assert.equal(fetchCalls.length, 0, "the solver was never called");
  });

  test("a failure saving an order's containers is reported and the order is cleaned up", async () => {
    db.fail("order_containers", "insert", { message: "bad container" });
    const { imported } = await (await upload(csv("ORD-9001"))).json();
    assert.equal(imported[0].status, "failed");
    assert.equal(imported[0].error, "bad container");
    assert.equal(byRef("ORD-9001"), undefined);
  });

  test("a failure in one order doesn't stop the next one importing", async () => {
    db.fail("order_items", "insert", { message: "bad item" }, 1);
    const { imported } = await (await upload(csv("ORD-9001", "ORD-9002"))).json();
    assert.deepEqual(
      imported.map((i) => i.status),
      ["failed", "solved"],
    );
  });
});

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// solver.js reads Deno.env at import time; stub it (no FITSOLVER_URL set, so the
// built-in default URL is used) and keep every network call faked.
globalThis.Deno = { env: { get: () => undefined } };
const { toOptimizePayload, runOptimize, persistOptimizeResult, markOrderFailed } = await import(
  "../supabase/functions/_shared/solver.js"
);

const DEFAULT_SOLVER_URL = "https://atomic-solver.onrender.com/api/solve";

const realFetch = globalThis.fetch;
let fetchCalls;
let nextResponse;

function stubFetch(handler) {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  };
}
const okJson = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  nextResponse = { placements: [], unplacedItems: [] };
  stubFetch(() => okJson(nextResponse));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const makePayload = (overrides = {}) => ({
  orderId: "order-1",
  items: [
    {
      id: "item-1",
      name: "Widget",
      dimensions: { length: 20, width: 15, height: 10, unit: "cm" },
      weight: { value: 2.5, unit: "kg" },
      quantity: 2,
    },
  ],
  containers: [
    {
      id: "c-1",
      name: "Standard carton",
      dimensions: { length: 60, width: 40, height: 40, unit: "cm" },
      maxWeight: { value: 30, unit: "kg" },
    },
  ],
  ...overrides,
});

describe("toOptimizePayload", () => {
  test("converts DB rows (numeric strings) into the canonical payload", () => {
    const payload = toOptimizePayload(
      "order-1",
      [
        {
          id: "i1",
          name: "Widget",
          length_cm: "20",
          width_cm: "15",
          height_cm: "10",
          weight_kg: "2.5",
          quantity: 3,
        },
      ],
      [{ id: "c1", name: "Box", length_cm: "60", width_cm: "40", height_cm: "40", max_weight_kg: "30" }],
    );
    assert.equal(payload.orderId, "order-1");
    assert.deepEqual(payload.items[0].dimensions, { length: 20, width: 15, height: 10, unit: "cm" });
    assert.deepEqual(payload.items[0].weight, { value: 2.5, unit: "kg" });
    assert.equal(payload.items[0].quantity, 3);
    assert.deepEqual(payload.containers[0].maxWeight, { value: 30, unit: "kg" });
  });

  test("defaults fragile to false and dangerous goods class to null", () => {
    const { items } = toOptimizePayload(
      "o",
      [{ id: "i", name: "n", length_cm: 1, width_cm: 1, height_cm: 1, weight_kg: 1, quantity: 1 }],
      [],
    );
    assert.equal(items[0].isFragile, false);
    assert.equal(items[0].dangerousGoodsClass, null);
  });

  test("passes fragile and dangerous goods through", () => {
    const { items } = toOptimizePayload(
      "o",
      [
        {
          id: "i",
          name: "n",
          length_cm: 1,
          width_cm: 1,
          height_cm: 1,
          weight_kg: 1,
          quantity: 1,
          is_fragile: true,
          dangerous_goods_class: "3",
        },
      ],
      [],
    );
    assert.equal(items[0].isFragile, true);
    assert.equal(items[0].dangerousGoodsClass, "3");
  });
});

describe("runOptimize: request sent to the solver", () => {
  test("POSTs JSON to the default solver URL", async () => {
    await runOptimize(makePayload());
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, DEFAULT_SOLVER_URL);
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.headers["content-type"], "application/json");
  });

  test("converts cm to mm and maps height to the solver's Depth", async () => {
    await runOptimize(makePayload());
    const { boxTypes } = fetchCalls[0].body;
    assert.deepEqual(boxTypes, [
      { Reference: "c-1", Width: 400, Length: 600, Depth: 400, MaxWeight: 30 },
    ]);
  });

  test("expands quantity into one solver item per physical item", async () => {
    await runOptimize(makePayload());
    const { items } = fetchCalls[0].body;
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => i.ItemCode),
      ["item-1__1", "item-1__2"],
    );
    assert.deepEqual(items[0], {
      ItemCode: "item-1__1",
      ItemReference: "Widget",
      Width: 150,
      Length: 200,
      Depth: 100,
      Weight: 2.5,
    });
  });

  test("a quantity of 1 keeps the plain item id as ItemCode", async () => {
    const payload = makePayload();
    payload.items[0].quantity = 1;
    await runOptimize(payload);
    assert.deepEqual(
      fetchCalls[0].body.items.map((i) => i.ItemCode),
      ["item-1"],
    );
  });

  test("a missing quantity counts as 1", async () => {
    const payload = makePayload();
    delete payload.items[0].quantity;
    await runOptimize(payload);
    assert.equal(fetchCalls[0].body.items.length, 1);
  });

  test("sends fragile and dangerous-goods flags only when set", async () => {
    const payload = makePayload();
    payload.items[0].quantity = 1;
    payload.items.push({
      id: "item-2",
      name: "Acid",
      dimensions: { length: 5, width: 5, height: 5, unit: "cm" },
      weight: { value: 1, unit: "kg" },
      quantity: 1,
      isFragile: true,
      dangerousGoodsClass: 3,
    });
    await runOptimize(payload);
    const [plain, flagged] = fetchCalls[0].body.items;
    assert.equal("IsFragile" in plain, false);
    assert.equal("IsDangerousGoods" in plain, false);
    assert.equal(flagged.IsFragile, true);
    assert.equal(flagged.IsDangerousGoods, true);
    assert.equal(flagged.DangerousGoodsClass, "3");
  });

  test("does not send orderId or quantity (the solver has no such fields)", async () => {
    await runOptimize(makePayload());
    assert.equal("orderId" in fetchCalls[0].body, false);
    assert.equal("quantity" in fetchCalls[0].body.items[0], false);
  });
});

describe("runOptimize: result translated back", () => {
  const placement = (itemCode, x, instance = 1) => ({
    itemCode,
    boxReference: "c-1",
    boxInstance: instance,
    position: { x, y: 0, z: 0 },
    placedDimension: { width: 150, length: 200, depth: 100 },
  });

  test("maps placements back to our ids, in cm, with size and utilisation", async () => {
    nextResponse = {
      placements: [placement("item-1__1", 0), placement("item-1__2", 150)],
      unplacedItems: [],
    };
    const result = await runOptimize(makePayload());

    assert.equal(result.orderId, "order-1");
    assert.equal(result.packedContainers.length, 1);
    const box = result.packedContainers[0];
    assert.equal(box.containerId, "c-1");
    assert.equal(box.boxInstance, 1);
    assert.deepEqual(
      box.placements.map((p) => p.itemId),
      ["item-1", "item-1"],
    );
    assert.deepEqual(box.placements[1].position, { x: 15, y: 0, z: 0, unit: "cm" });
    assert.deepEqual(box.placements[0].size, { width: 15, length: 20, height: 10, unit: "cm" });
    assert.deepEqual(box.placements[0].rotation, { x: 0, y: 0, z: 0 });
    // 2 x (150*200*100) placed in a 400*600*400 box
    assert.equal(box.utilisation, 0.0625);
    assert.deepEqual(result.unpackedItems, []);
  });

  test("splits placements into separate containers per box instance", async () => {
    nextResponse = {
      placements: [placement("item-1__1", 0, 1), placement("item-1__2", 0, 2)],
      unplacedItems: [],
    };
    const result = await runOptimize(makePayload());
    assert.equal(result.packedContainers.length, 2);
    assert.deepEqual(
      result.packedContainers.map((b) => b.boxInstance),
      [1, 2],
    );
  });

  test("caps utilisation at 1", async () => {
    nextResponse = {
      placements: [
        {
          ...placement("item-1__1", 0),
          placedDimension: { width: 4000, length: 6000, depth: 4000 },
        },
      ],
      unplacedItems: [],
    };
    const result = await runOptimize(makePayload());
    assert.equal(result.packedContainers[0].utilisation, 1);
  });

  test("utilisation is null when the solver gives no placed dimensions", async () => {
    nextResponse = {
      placements: [{ ...placement("item-1__1", 0), placedDimension: undefined }],
      unplacedItems: [],
    };
    const result = await runOptimize(makePayload());
    assert.equal(result.packedContainers[0].utilisation, null);
    assert.equal("size" in result.packedContainers[0].placements[0], false);
  });

  test("an empty solver response gives no containers", async () => {
    nextResponse = {};
    const result = await runOptimize(makePayload());
    assert.deepEqual(result.packedContainers, []);
    assert.deepEqual(result.unpackedItems, []);
  });

  test("unplaced items resolve to our item id, with the violation code and message", async () => {
    nextResponse = {
      placements: [],
      unplacedItems: ["item-1__2"],
      violations: [{ itemCode: "item-1__2", code: "PROHIBITED_GOODS", message: "Class 1 not allowed" }],
    };
    const result = await runOptimize(makePayload());
    assert.deepEqual(result.unpackedItems, [
      { itemId: "item-1", reason: "PROHIBITED_GOODS", message: "Class 1 not allowed" },
    ]);
  });

  test("an unplaced object entry keeps its own reason", async () => {
    nextResponse = { placements: [], unplacedItems: [{ itemCode: "item-1__1", reason: "too_heavy" }] };
    const result = await runOptimize(makePayload());
    assert.deepEqual(result.unpackedItems, [{ itemId: "item-1", reason: "too_heavy" }]);
  });

  test("an unplaced item with no violation gets the 'no_container_fits' reason", async () => {
    nextResponse = { placements: [], unplacedItems: ["item-1__1"] };
    const result = await runOptimize(makePayload());
    assert.deepEqual(result.unpackedItems, [{ itemId: "item-1", reason: "no_container_fits" }]);
  });

  test("an unplaced object entry without a reason also gets 'no_container_fits'", async () => {
    nextResponse = { placements: [], unplacedItems: [{ itemCode: "item-1__1" }] };
    const result = await runOptimize(makePayload());
    assert.equal(result.unpackedItems[0].reason, "no_container_fits");
  });

  test("a violation's code wins over the generic reason", async () => {
    nextResponse = {
      placements: [],
      unplacedItems: ["item-1__1"],
      violations: [{ itemCode: "item-1__1", code: "TOO_HEAVY" }],
    };
    const result = await runOptimize(makePayload());
    assert.equal(result.unpackedItems[0].reason, "TOO_HEAVY");
    assert.equal("message" in result.unpackedItems[0], false);
  });
});

describe("runOptimize: more translation cases", () => {
  test("an item with quantity 0 sends no solver items", async () => {
    const payload = makePayload();
    payload.items[0].quantity = 0;
    await runOptimize(payload);
    assert.deepEqual(fetchCalls[0].body.items, []);
    assert.equal(fetchCalls[0].body.boxTypes.length, 1);
  });

  test("decimal centimetres become clean millimetres (no floating-point noise)", async () => {
    const payload = makePayload();
    payload.items[0].quantity = 1;
    payload.items[0].dimensions = { length: 0.57, width: 1.15, height: 2.3, unit: "cm" };
    payload.containers[0].dimensions = { length: 12.3, width: 0.57, height: 20.5, unit: "cm" };
    await runOptimize(payload);
    const [item] = fetchCalls[0].body.items;
    assert.equal(item.Length, 5.7);
    assert.equal(item.Width, 11.5);
    assert.equal(item.Depth, 23);
    const [box] = fetchCalls[0].body.boxTypes;
    assert.deepEqual([box.Length, box.Width, box.Depth], [123, 5.7, 205]);
  });

  test("a placement for an unknown item code falls back to the raw code", async () => {
    nextResponse = {
      placements: [
        {
          itemCode: "mystery",
          boxReference: "c-1",
          boxInstance: 1,
          position: { x: 0, y: 0, z: 0 },
          placedDimension: { width: 10, length: 10, depth: 10 },
        },
      ],
      unplacedItems: [],
    };
    const result = await runOptimize(makePayload());
    assert.equal(result.packedContainers[0].placements[0].itemId, "mystery");
  });

  test("several items and containers are sent and mapped back correctly", async () => {
    const payload = makePayload();
    payload.items = [
      { ...payload.items[0], id: "i1", name: "One", quantity: 1 },
      { ...payload.items[0], id: "i2", name: "Two", quantity: 2 },
    ];
    payload.containers.push({
      id: "c-2",
      name: "Small carton",
      dimensions: { length: 30, width: 20, height: 20, unit: "cm" },
      maxWeight: { value: 10, unit: "kg" },
    });
    const place = (itemCode, boxReference) => ({
      itemCode,
      boxReference,
      boxInstance: 1,
      position: { x: 0, y: 0, z: 0 },
      placedDimension: { width: 100, length: 100, depth: 100 },
    });
    nextResponse = {
      placements: [place("i1", "c-1"), place("i2__1", "c-2"), place("i2__2", "c-2")],
      unplacedItems: [],
    };

    const result = await runOptimize(payload);

    const sent = fetchCalls[0].body;
    assert.deepEqual(sent.boxTypes.map((b) => b.Reference), ["c-1", "c-2"]);
    assert.deepEqual(sent.items.map((i) => i.ItemCode), ["i1", "i2__1", "i2__2"]);

    assert.deepEqual(result.packedContainers.map((b) => b.containerId), ["c-1", "c-2"]);
    assert.deepEqual(result.packedContainers[1].placements.map((p) => p.itemId), ["i2", "i2"]);
    // utilisation uses each box's own volume: 2 x 1,000,000 in 200*300*200 = 12,000,000
    assert.ok(Math.abs(result.packedContainers[1].utilisation - 2 / 12) < 1e-9);
  });
});

describe("runOptimize: FITSOLVER_URL secret", () => {
  test("uses the FITSOLVER_URL environment variable when it is set", async () => {
    const realGet = globalThis.Deno.env.get;
    globalThis.Deno.env.get = (key) =>
      key === "FITSOLVER_URL" ? "https://custom.example/solve" : undefined;
    try {
      // a fresh copy of the module, so it re-reads the environment
      const fresh = await import("../supabase/functions/_shared/solver.js?with-env-url");
      await fresh.runOptimize(makePayload());
    } finally {
      globalThis.Deno.env.get = realGet;
    }
    assert.equal(fetchCalls[0].url, "https://custom.example/solve");
  });
});

describe("runOptimize: failures", () => {
  test("a network failure becomes solver_unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(runOptimize(makePayload()), { message: "solver_unreachable" });
  });

  test("a non-2xx response becomes solver_error", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await assert.rejects(runOptimize(makePayload()), { message: "solver_error" });
  });

  test("a 200 response carrying an error body becomes solver_error", async () => {
    stubFetch(() => okJson({ error: "bad input", details: "..." }));
    await assert.rejects(runOptimize(makePayload()), { message: "solver_error" });
  });
});

function fakeSupabase({ upsertError = null, updateError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(row) {
          calls.push({ table, op: "upsert", row });
          return Promise.resolve({ error: upsertError });
        },
        update(row) {
          calls.push({ table, op: "update", row });
          return {
            eq(column, value) {
              calls.push({ table, op: "eq", column, value });
              return Promise.resolve({ error: updateError });
            },
          };
        },
      };
    },
  };
}

describe("persistOptimizeResult / markOrderFailed", () => {
  const result = {
    packedContainers: [{ containerId: "c-1", placements: [] }],
    unpackedItems: [{ itemId: "i9", reason: "no_container_fits" }],
  };

  test("stores the result and marks the order solved", async () => {
    const supabase = fakeSupabase();
    const returned = await persistOptimizeResult(supabase, "order-1", result);

    assert.equal(returned, result);
    const upsert = supabase.calls.find((c) => c.op === "upsert");
    assert.equal(upsert.table, "order_results");
    assert.deepEqual(upsert.row, {
      order_id: "order-1",
      packed_containers: result.packedContainers,
      unpacked_items: result.unpackedItems,
    });
    const update = supabase.calls.find((c) => c.op === "update");
    assert.equal(update.table, "orders");
    assert.equal(update.row.status, "solved");
    assert.deepEqual(supabase.calls.find((c) => c.op === "eq"), {
      table: "orders",
      op: "eq",
      column: "id",
      value: "order-1",
    });
  });

  test("defaults missing arrays to empty ones", async () => {
    const supabase = fakeSupabase();
    await persistOptimizeResult(supabase, "order-1", {});
    const upsert = supabase.calls.find((c) => c.op === "upsert");
    assert.deepEqual(upsert.row.packed_containers, []);
    assert.deepEqual(upsert.row.unpacked_items, []);
  });

  test("does not mark the order solved when saving the result fails", async () => {
    const supabase = fakeSupabase({ upsertError: new Error("db down") });
    await assert.rejects(persistOptimizeResult(supabase, "order-1", result), { message: "db down" });
    assert.equal(supabase.calls.some((c) => c.op === "update"), false);
  });

  test("surfaces a failure to update the order status", async () => {
    const supabase = fakeSupabase({ updateError: new Error("status failed") });
    await assert.rejects(persistOptimizeResult(supabase, "order-1", result), {
      message: "status failed",
    });
  });

  test("markOrderFailed sets status to failed for that order", async () => {
    const supabase = fakeSupabase();
    await markOrderFailed(supabase, "order-1");
    assert.equal(supabase.calls.find((c) => c.op === "update").row.status, "failed");
    assert.equal(supabase.calls.find((c) => c.op === "eq").value, "order-1");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// config.js reads window.* at import time; give it an empty window before loading.
globalThis.window = {};
const config = await import("../src/config.js");
const {
  API_BASE,
  FITVISUALIZER_URL,
  viewerUrl,
  visualizePageUrl,
  orderResultApiUrl,
  statusLabel,
  formatDate,
  toVisualizerPayload,
} = config;

describe("URL helpers", () => {
  test("defaults point at the hosted Supabase functions and visualiser", () => {
    assert.equal(API_BASE, "https://obhsgsftqetjqqyvqelh.supabase.co/functions/v1");
    assert.equal(FITVISUALIZER_URL, "https://atomic-visualiser.vercel.app/");
  });

  test("viewerUrl strips the trailing slash and adds orderId", () => {
    assert.equal(viewerUrl("abc"), "https://atomic-visualiser.vercel.app?orderId=abc");
  });

  test("viewerUrl, visualizePageUrl and orderResultApiUrl encode the id", () => {
    assert.equal(viewerUrl("a b/c"), "https://atomic-visualiser.vercel.app?orderId=a%20b%2Fc");
    assert.equal(visualizePageUrl("a b/c"), "visualize.html?id=a%20b%2Fc");
    assert.equal(orderResultApiUrl("a b/c"), `${API_BASE}/order-result?id=a%20b%2Fc`);
  });

  test("visualizePageUrl keeps the .html extension (local servers drop ?id= on clean-URL redirects)", () => {
    assert.match(visualizePageUrl("x"), /^visualize\.html\?id=/);
  });
});

describe("display helpers", () => {
  test("statusLabel falls back to 'unknown'", () => {
    assert.equal(statusLabel("solved"), "solved");
    assert.equal(statusLabel(undefined), "unknown");
    assert.equal(statusLabel(null), "unknown");
  });

  test("formatDate shows a dash for empty values and a local string otherwise", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(""), "—");
    const iso = "2026-10-17T07:00:45.000Z";
    assert.equal(formatDate(iso), new Date(iso).toLocaleString());
  });
});

describe("toVisualizerPayload", () => {
  const makeResult = () => ({
    orderId: "o1",
    items: [{ id: "i1", name: "A", dimensions: { width: 10, length: 20, height: 30, unit: "cm" } }],
    containers: [{ id: "c1", name: "Box", dimensions: { width: 40, length: 50, height: 60, unit: "cm" } }],
    packedContainers: [
      {
        containerId: "c1",
        placements: [
          {
            itemId: "i1",
            position: { x: 1, y: 2, z: 3, unit: "cm" },
            size: { width: 10, length: 20, height: 30, unit: "cm" },
          },
        ],
      },
    ],
    unpackedItems: [{ itemId: "i9", reason: "no_container_fits" }],
  });

  test("returns null/undefined input unchanged", () => {
    assert.equal(toVisualizerPayload(null), null);
    assert.equal(toVisualizerPayload(undefined), undefined);
  });

  test("swaps length <-> height on containers and items", () => {
    const out = toVisualizerPayload(makeResult());
    assert.deepEqual(out.containers[0].dimensions, { width: 40, length: 60, height: 50, unit: "cm" });
    assert.deepEqual(out.items[0].dimensions, { width: 10, length: 30, height: 20, unit: "cm" });
  });

  test("swaps y <-> z on placements and gives each placement its own item entry", () => {
    const out = toVisualizerPayload(makeResult());
    const placement = out.packedContainers[0].placements[0];
    assert.equal(placement.itemId, "i1#1-1");
    assert.deepEqual(placement.position, { x: 1, y: 3, z: 2, unit: "cm" });
    assert.deepEqual(placement.size, { width: 10, length: 30, height: 20, unit: "cm" });

    const placedItem = out.items.find((i) => i.id === "i1#1-1");
    assert.ok(placedItem, "per-placement item entry exists");
    assert.equal(placedItem.name, "A");
    assert.deepEqual(placedItem.dimensions, placement.size);
    assert.equal(out.items.length, 2, "original item + one per placement");
  });

  test("keeps unpackedItems and orderId untouched", () => {
    const out = toVisualizerPayload(makeResult());
    assert.equal(out.orderId, "o1");
    assert.deepEqual(out.unpackedItems, [{ itemId: "i9", reason: "no_container_fits" }]);
  });

  test("does not mutate the stored result", () => {
    const input = makeResult();
    toVisualizerPayload(input);
    assert.deepEqual(input, makeResult());
  });

  test("falls back to the item's catalogue size when a placement has no size", () => {
    const input = makeResult();
    delete input.packedContainers[0].placements[0].size;
    const out = toVisualizerPayload(input);
    assert.deepEqual(out.packedContainers[0].placements[0].size, {
      width: 10,
      length: 30,
      height: 20,
      unit: "cm",
    });
  });

  test("defaults a missing position to the origin and survives an unknown item", () => {
    const input = makeResult();
    input.packedContainers[0].placements = [{ itemId: "ghost" }];
    const out = toVisualizerPayload(input);
    assert.deepEqual(out.packedContainers[0].placements[0].position, { x: 0, y: 0, z: 0 });
    assert.equal(out.packedContainers[0].placements[0].itemId, "ghost#1-1");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderFromSolverFiles,
  readRows,
  detectKind,
} from "../supabase/functions/_shared/solver-files.js";

// The real challenge files (sizes in mm).
const BOXES = [
  { Reference: "P200", Width: 440, Length: 275, Depth: 165, MaxWeight: 10, BoxWeight: 0.5, Active: true, MaximumBoxes: 2 },
  { Reference: "P300", Width: 400, Length: 300, Depth: 250, MaxWeight: 15, BoxWeight: 0.75, Active: true, MaximumBoxes: 1 },
  { Reference: "P500", Width: 525, Length: 365, Depth: 310, MaxWeight: 20, BoxWeight: 0.9, Active: true, MaximumBoxes: 1 },
];
const item = (code, ref, width, length, depth) => ({
  ItemCode: code,
  ItemReference: ref,
  Width: width,
  Length: length,
  Depth: depth,
  Weight: 0.1,
});
const ITEMS = [
  item("ITM-014", "U3", 108, 108, 137),
  item("ITM-013", "S6", 140, 140, 75),
  item("ITM-015", "N1", 83, 129, 74),
  item("ITM-001", "L1", 380, 285, 80),
  item("ITM-016", "S5", 86, 395, 55),
  item("ITM-008", "U2", 120, 131, 50),
  item("ITM-011", "N3", 72, 103, 38),
  item("ITM-006", "U1", 156, 200, 33),
  item("ITM-003", "N5", 112, 92, 50),
  item("ITM-010", "S3", 100, 105, 97),
  item("ITM-004", "N4", 127, 86, 45),
  item("ITM-009", "S4", 103, 175, 93),
  item("ITM-012", "S1", 140, 158, 115),
  item("ITM-007", "S2", 93, 245, 60),
  item("ITM-005", "N2", 89, 140, 55),
];

const json = (rows) => JSON.stringify(rows, null, 2);
const toCsv = (rows) => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");
};
const file = (name, text) => ({ name, text });
const boxesFile = (rows = BOXES) => file("boxesChallenge.json", json(rows));
const itemsFile = (rows = ITEMS) => file("itemsChallenge.json", json(rows));
const build = (files, ref = "CHALLENGE-1") => buildOrderFromSolverFiles(files, ref);

describe("the real challenge files", () => {
  test("two JSON files become one order with all items and boxes", () => {
    const order = build([boxesFile(), itemsFile()]);
    assert.equal(order.external_ref, "CHALLENGE-1");
    assert.equal(order.items.length, 15);
    assert.equal(order.containers.length, 3);
  });

  test("boxes are converted from mm to cm", () => {
    const { containers } = build([boxesFile(), itemsFile()]);
    assert.deepEqual(containers[0], {
      name: "P200",
      length_cm: 27.5,
      width_cm: 44,
      height_cm: 16.5,
      max_weight_kg: 10,
    });
    assert.deepEqual(
      containers.map((c) => [c.name, c.max_weight_kg]),
      [
        ["P200", 10],
        ["P300", 15],
        ["P500", 20],
      ],
    );
    assert.deepEqual(
      [containers[2].length_cm, containers[2].width_cm, containers[2].height_cm],
      [36.5, 52.5, 31],
    );
  });

  test("items are converted from mm to cm, one physical item each", () => {
    const { items } = build([boxesFile(), itemsFile()]);
    assert.deepEqual(items.find((i) => i.name === "L1"), {
      name: "L1",
      length_cm: 28.5,
      width_cm: 38,
      height_cm: 8,
      weight_kg: 0.1,
      quantity: 1,
    });
    assert.deepEqual(items.find((i) => i.name === "S5"), {
      name: "S5",
      length_cm: 39.5,
      width_cm: 8.6,
      height_cm: 5.5,
      weight_kg: 0.1,
      quantity: 1,
    });
    assert.ok(items.every((i) => i.quantity === 1));
  });

  test("the order of the two files doesn't matter", () => {
    const a = build([boxesFile(), itemsFile()]);
    const b = build([itemsFile(), boxesFile()]);
    assert.deepEqual(a, b);
  });

  test("the same data as CSV files gives the same order", () => {
    const fromJson = build([boxesFile(), itemsFile()]);
    const fromCsv = build([
      file("boxPacking.csv", toCsv(BOXES)),
      file("itemPacking.csv", toCsv(ITEMS)),
    ]);
    assert.deepEqual(fromCsv, fromJson);
  });

  test("one JSON file and one CSV file can be mixed", () => {
    const mixed = build([file("itemPacking.csv", toCsv(ITEMS)), boxesFile()]);
    assert.deepEqual(mixed, build([boxesFile(), itemsFile()]));
  });
});

describe("blank rows and formatting", () => {
  test("blank and comma-only CSV rows are ignored", () => {
    const boxes = toCsv(BOXES) + "\n,,,,,,,,\n\n,,,,,,,,\n";
    const items = "\n" + toCsv(ITEMS).replace("\n", "\n,,,,,,\n") + "\n,,,,,,\n";
    const order = build([file("b.csv", boxes), file("i.csv", items)]);
    assert.equal(order.containers.length, 3);
    assert.equal(order.items.length, 15);
  });

  test("an empty object in a JSON file is ignored", () => {
    const order = build([boxesFile([...BOXES, {}]), itemsFile([{}, ...ITEMS])]);
    assert.equal(order.containers.length, 3);
    assert.equal(order.items.length, 15);
  });

  test("column names are not case-sensitive", () => {
    const lower = BOXES.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k.toLowerCase(), v])));
    const order = build([boxesFile(lower), itemsFile()]);
    assert.equal(order.containers[0].name, "P200");
  });

  test("a UTF-8 byte-order mark at the start of a file is ignored", () => {
    const order = build([file("b.json", "﻿" + json(BOXES)), file("i.csv", "﻿" + toCsv(ITEMS))]);
    assert.equal(order.items.length, 15);
  });

  test("a single JSON object (not an array) is treated as one row", () => {
    const order = build([boxesFile(), file("one.json", JSON.stringify(ITEMS[0]))]);
    assert.equal(order.items.length, 1);
  });

  test("millimetres convert cleanly to centimetres", () => {
    const order = build([
      boxesFile(),
      itemsFile([{ ItemReference: "tiny", Width: 107, Length: 1, Depth: 12345, Weight: 0 }]),
    ]);
    assert.deepEqual(
      [order.items[0].width_cm, order.items[0].length_cm, order.items[0].height_cm, order.items[0].weight_kg],
      [10.7, 0.1, 1234.5, 0],
    );
  });

  test("an item can be named by ItemCode when ItemReference is missing", () => {
    const rows = [{ ItemCode: "ITM-099", Width: 100, Length: 100, Depth: 100, Weight: 1 }];
    assert.equal(build([boxesFile(), itemsFile(rows)]).items[0].name, "ITM-099");
  });
});

describe("boxes: Active, MaxWeight and limits", () => {
  test("inactive boxes are skipped (false, 'FALSE', 'no', 0)", () => {
    const rows = [
      BOXES[0],
      { ...BOXES[1], Active: false },
      { ...BOXES[2], Active: "FALSE" },
      { Reference: "X1", Width: 100, Length: 100, Depth: 100, Active: "no" },
      { Reference: "X2", Width: 100, Length: 100, Depth: 100, Active: 0 },
    ];
    const { containers } = build([boxesFile(rows), itemsFile()]);
    assert.deepEqual(containers.map((c) => c.name), ["P200"]);
  });

  test("an inactive box doesn't need a MaxWeight", () => {
    const rows = [BOXES[0], { Reference: "LRG", Width: 1200, Length: 1200, Depth: 1200, Active: false }];
    assert.equal(build([boxesFile(rows), itemsFile()]).containers.length, 1);
  });

  test("a missing Active column or blank Active means active", () => {
    const rows = BOXES.map(({ Active, ...rest }) => ({ ...rest, Active: "" }));
    assert.equal(build([boxesFile(rows), itemsFile()]).containers.length, 3);
    const noColumn = BOXES.map(({ Active, ...rest }) => rest);
    assert.equal(build([boxesFile(noColumn), itemsFile()]).containers.length, 3);
  });

  test("when every box is inactive the file is rejected", () => {
    const rows = BOXES.map((b) => ({ ...b, Active: false }));
    assert.throws(() => build([boxesFile(rows), itemsFile()]), /boxesChallenge\.json has no active boxes/);
  });

  test("an active box with no MaxWeight is rejected, naming the box", () => {
    const rows = [{ Reference: "P900", Width: 100, Length: 100, Depth: 100, MaxWeight: "", Active: true }];
    assert.throws(
      () => build([boxesFile(rows), itemsFile()]),
      /boxesChallenge\.json entry 1: box "P900" has no MaxWeight/,
    );
  });

  test("MaximumBoxes and BoxWeight are ignored for now, whatever they contain", () => {
    for (const extra of [{}, { MaximumBoxes: 0, BoxWeight: -1 }, { MaximumBoxes: "many", BoxWeight: "heavy" }]) {
      const rows = [{ ...BOXES[0], ...extra }];
      const [box] = build([boxesFile(rows), itemsFile()]).containers;
      assert.equal("max_boxes" in box, false);
      assert.equal("box_weight_kg" in box, false);
      assert.equal(box.name, "P200");
    }
  });

  test("a box with no Reference is rejected", () => {
    const rows = [{ ...BOXES[0], Reference: "" }];
    assert.throws(() => build([boxesFile(rows), itemsFile()]), /entry 1: Reference is missing/);
  });
});

describe("bad sizes and weights", () => {
  test("a size must be a number above 0, with the row named in the message", () => {
    for (const bad of ["abc", 0, -5, "", null]) {
      const rows = [{ ...ITEMS[0] }, { ...ITEMS[1], Width: bad }];
      assert.throws(
        () => build([boxesFile(), itemsFile(rows)]),
        /itemsChallenge\.json entry 2: Width must be a number above 0/,
        JSON.stringify(bad),
      );
    }
  });

  test("CSV errors name the real line number", () => {
    const text = "ItemReference,Width,Length,Depth,Weight\nA,1,1,1,1\n\n,,,,\nB,x,1,1,1\n";
    assert.throws(() => build([boxesFile(), file("items.csv", text)]), /items\.csv line 5: Width/);
  });

  test("Weight can be 0 but not negative or blank", () => {
    const zero = [{ ...ITEMS[0], Weight: 0 }];
    assert.equal(build([boxesFile(), itemsFile(zero)]).items[0].weight_kg, 0);
    for (const bad of [-1, "", "heavy"]) {
      const rows = [{ ...ITEMS[0], Weight: bad }];
      assert.throws(() => build([boxesFile(), itemsFile(rows)]), /Weight must be/, String(bad));
    }
  });

  test("an item with no name or code is rejected", () => {
    const rows = [{ ItemReference: "", Width: 1, Length: 1, Depth: 1, Weight: 1 }];
    assert.throws(() => build([boxesFile(), itemsFile(rows)]), /ItemReference is missing/);
  });
});

describe("the wrong files", () => {
  test("anything other than two files is rejected", () => {
    assert.throws(() => build([boxesFile()]), /Select exactly two files/);
    assert.throws(() => build([boxesFile(), itemsFile(), itemsFile()]), /Select exactly two files/);
    assert.throws(() => build([]), /Select exactly two files/);
    assert.throws(() => build(undefined), /Select exactly two files/);
  });

  test("two boxes files (or two items files) are rejected", () => {
    assert.throws(
      () => build([boxesFile(), boxesFile()]),
      /Need one boxes file and one items file, but got 2 boxes file\(s\) and 0 items file\(s\)/,
    );
    assert.throws(
      () => build([itemsFile(), itemsFile()]),
      /0 boxes file\(s\) and 2 items file\(s\)/,
    );
  });

  test("a file whose columns match neither kind lists what it found", () => {
    const other = file("orders.csv", "record_type,order_ref,item_name\nitem,ORD-1,Widget");
    assert.throws(
      () => build([boxesFile(), other]),
      /orders\.csv: can't tell whether this is a boxes or an items file[\s\S]*Found: record_type, order_ref, item_name/,
    );
  });

  test("a missing required column is named", () => {
    const noWidth = BOXES.map(({ Width, ...rest }) => rest);
    assert.throws(
      () => build([boxesFile(noWidth), itemsFile()]),
      /boxesChallenge\.json: missing column\(s\) Width\. Found: Reference, Length/,
    );
    const noWeight = ITEMS.map(({ Weight, ...rest }) => rest);
    assert.throws(() => build([boxesFile(), itemsFile(noWeight)]), /missing column\(s\) Weight/);
  });

  test("invalid JSON, empty files and empty arrays are rejected", () => {
    assert.throws(() => build([file("b.json", "[{"), itemsFile()]), /b\.json is not valid JSON/);
    assert.throws(() => build([file("b.json", "  \n "), itemsFile()]), /b\.json is empty/);
    assert.throws(() => build([file("b.json", "[]"), itemsFile()]), /b\.json has no rows/);
    assert.throws(() => build([file("b.csv", "Reference,Width"), itemsFile()]), /b\.csv has no rows/);
  });

  test("a JSON array containing non-objects is rejected", () => {
    assert.throws(() => build([file("b.json", "[1, 2]"), itemsFile()]), /b\.json: entry 1 is not an object/);
  });

  test("more than 5000 rows is rejected", () => {
    const many = Array.from({ length: 5001 }, () => ITEMS[0]);
    assert.throws(() => build([boxesFile(), itemsFile(many)]), /more than 5000 rows/);
  });
});

describe("readRows / detectKind", () => {
  test("detectKind tells boxes from items by their columns", () => {
    assert.equal(detectKind(["Reference", "Width"]), "boxes");
    assert.equal(detectKind(["ItemReference", "Width"]), "items");
    assert.equal(detectKind(["ItemCode"]), "items");
    assert.equal(detectKind(["something", "else"]), null);
  });

  test("readRows returns the original column names and normalised row keys", () => {
    const { rows, columns } = readRows(toCsv(BOXES), "b.csv");
    assert.deepEqual(columns.slice(0, 3), ["Reference", "Width", "Length"]);
    assert.equal(rows[0].data.maxweight, "10");
    assert.equal(rows[0].label, "line 2");
  });
});

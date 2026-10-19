import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, groupCsvOrders } from "../supabase/functions/_shared/csv.js";

const HEADER =
  "record_type,order_ref,item_name,length_cm,width_cm,height_cm,weight_kg,quantity,container_name,max_weight_kg";

const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url), "utf8");

describe("parseCsv", () => {
  test("parses header + rows, trims values and records line numbers", () => {
    const rows = parseCsv(`${HEADER}\nitem, ORD-1 , Box ,1,2,3,4,5,,\n`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].order_ref, "ORD-1");
    assert.equal(rows[0].item_name, "Box");
    assert.equal(rows[0]._line, 2);
  });

  test("handles Windows (CRLF) line endings", () => {
    const rows = parseCsv(`${HEADER}\r\nitem,ORD-1,Box,1,2,3,4,5,,\r\nitem,ORD-1,Lid,1,2,3,4,5,,\r\n`);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]._line, 3);
  });

  test("treats missing trailing cells as empty strings", () => {
    const rows = parseCsv(`${HEADER}\nitem,ORD-1,Box,1,2,3,4`);
    assert.equal(rows[0].quantity, "");
    assert.equal(rows[0].container_name, "");
  });

  test("throws csv_empty for an empty file or a header-only file", () => {
    assert.throws(() => parseCsv(""), /csv_empty/);
    assert.throws(() => parseCsv(HEADER), /csv_empty/);
  });
});

describe("groupCsvOrders", () => {
  test("groups rows into orders by order_ref and splits items from containers", () => {
    const orders = groupCsvOrders(
      parseCsv(
        `${HEADER}\n` +
          `item,ORD-1,Widget,20,15,10,2.5,4,,\n` +
          `container,ORD-1,,60,40,40,,,Standard carton,30\n` +
          `item,ORD-2,Gadget,5,5,5,1,,,\n` +
          `container,ORD-2,,20,20,20,,,Small carton,5\n`,
      ),
    );
    assert.equal(orders.length, 2);
    assert.equal(orders[0].external_ref, "ORD-1");
    assert.deepEqual(orders[0].items, [
      { name: "Widget", length_cm: 20, width_cm: 15, height_cm: 10, weight_kg: 2.5, quantity: 4 },
    ]);
    assert.deepEqual(orders[0].containers, [
      { name: "Standard carton", length_cm: 60, width_cm: 40, height_cm: 40, max_weight_kg: 30 },
    ]);
  });

  test("quantity defaults to 1 when blank", () => {
    const [order] = groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,5,5,5,1,,,\n`));
    assert.equal(order.items[0].quantity, 1);
  });

  test("record_type is case-insensitive", () => {
    const [order] = groupCsvOrders(parseCsv(`${HEADER}\nITEM,ORD-1,Gadget,5,5,5,1,2,,\n`));
    assert.equal(order.items.length, 1);
  });

  test("rejects a row with no order_ref (with its line number)", () => {
    const rows = parseCsv(`${HEADER}\nitem,,Gadget,5,5,5,1,1,,\n`);
    assert.throws(() => groupCsvOrders(rows), /missing order_ref on line 2/);
  });

  test("rejects an unknown record_type", () => {
    const rows = parseCsv(`${HEADER}\nbox,ORD-1,Gadget,5,5,5,1,1,,\n`);
    assert.throws(() => groupCsvOrders(rows), /invalid record_type on line 2/);
  });

  test("rejects an item with no name and a container with no name", () => {
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,,5,5,5,1,1,,\n`)),
      /missing item_name on line 2/,
    );
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\ncontainer,ORD-1,,5,5,5,,,,10\n`)),
      /missing container_name on line 2/,
    );
  });

  test("rejects a non-numeric dimension, weight or max weight", () => {
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,abc,5,5,1,1,,\n`)),
      /invalid length_cm on line 2/,
    );
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,5,5,5,heavy,1,,\n`)),
      /invalid weight_kg on line 2/,
    );
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\ncontainer,ORD-1,,5,5,5,,,Box,lots\n`)),
      /invalid max_weight_kg on line 2/,
    );
  });

  test("rejects a quantity below 1 or a non-integer quantity", () => {
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,5,5,5,1,0,,\n`)),
      /invalid quantity on line 2/,
    );
    assert.throws(
      () => groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,5,5,5,1,many,,\n`)),
      /invalid quantity on line 2/,
    );
  });

  test("rejects a blank dimension or weight instead of treating it as 0", () => {
    const cases = [
      ["item,ORD-1,Gadget,,5,5,1,1,,", /invalid length_cm on line 2/],
      ["item,ORD-1,Gadget,5,,5,1,1,,", /invalid width_cm on line 2/],
      ["item,ORD-1,Gadget,5,5,,1,1,,", /invalid height_cm on line 2/],
      ["item,ORD-1,Gadget,5,5,5,,1,,", /invalid weight_kg on line 2/],
      ["container,ORD-1,,5,5,5,,,Box,", /invalid max_weight_kg on line 2/],
    ];
    for (const [row, expected] of cases) {
      assert.throws(() => groupCsvOrders(parseCsv(`${HEADER}\n${row}`)), expected, row);
    }
  });

  test("a genuine zero is still accepted", () => {
    const [order] = groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,Gadget,5,5,5,0,1,,\n`));
    assert.equal(order.items[0].weight_kg, 0);
  });
});

describe("CSV format edge cases", () => {
  test("columns can be in any order (they are matched by header name)", () => {
    const header = "order_ref,record_type,container_name,max_weight_kg,length_cm,width_cm,height_cm";
    const [order] = groupCsvOrders(parseCsv(`${header}\nORD-1,container,Box,30,60,40,40\n`));
    assert.deepEqual(order.containers[0], {
      name: "Box",
      length_cm: 60,
      width_cm: 40,
      height_cm: 40,
      max_weight_kg: 30,
    });
  });

  test("extra, unknown columns are ignored", () => {
    const [order] = groupCsvOrders(
      parseCsv(`${HEADER},notes\nitem,ORD-1,Widget,1,2,3,4,5,,,fragile!\n`),
    );
    assert.equal(order.items[0].name, "Widget");
  });

  test("blank lines between rows are ignored", () => {
    const orders = groupCsvOrders(
      parseCsv(`${HEADER}\n\nitem,ORD-1,Widget,1,2,3,4,5,,\n\n\ncontainer,ORD-1,,9,9,9,,,Box,10\n`),
    );
    assert.equal(orders[0].items.length, 1);
    assert.equal(orders[0].containers.length, 1);
  });

  test("a UTF-8 byte-order mark at the start of the file (added by Excel) is ignored", () => {
    const [order] = groupCsvOrders(parseCsv(`﻿${HEADER}\nitem,ORD-1,Widget,1,2,3,4,5,,\n`));
    assert.equal(order.items[0].name, "Widget");
  });

  test("header names are case-sensitive", () => {
    const text = `${HEADER.replace("record_type", "Record_Type")}\nitem,ORD-1,Widget,1,2,3,4,5,,\n`;
    assert.throws(() => groupCsvOrders(parseCsv(text)), /invalid record_type on line 2/);
  });

  test("quoted fields can contain commas", () => {
    const [order] = groupCsvOrders(
      parseCsv(`${HEADER}\nitem,ORD-1,"Mouse, wireless",12,7,4,0.15,2,,\n`),
    );
    assert.equal(order.items[0].name, "Mouse, wireless");
    assert.equal(order.items[0].length_cm, 12);
  });

  test('a doubled quote inside a quoted field is a literal quote ("")', () => {
    const [order] = groupCsvOrders(
      parseCsv(`${HEADER}\nitem,ORD-1,"The ""Big"" Box",12,7,4,0.15,2,,\n`),
    );
    assert.equal(order.items[0].name, 'The "Big" Box');
  });

  test("a stray quote inside an unquoted field is kept as text", () => {
    const [order] = groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1,5" pipe,12,7,4,0.15,2,,\n`));
    assert.equal(order.items[0].name, '5" pipe');
  });

  test("quoted fields are still trimmed of surrounding spaces outside the quotes", () => {
    const [order] = groupCsvOrders(parseCsv(`${HEADER}\nitem,ORD-1, "Widget" ,1,2,3,4,5,,\n`));
    assert.equal(order.items[0].name, "Widget");
  });
});

describe("sample CSV files", () => {
  test("samples/orders-import.csv gives ORD-1042 and ORD-1043", () => {
    const orders = groupCsvOrders(parseCsv(sample("orders-import.csv")));
    assert.deepEqual(
      orders.map((o) => [o.external_ref, o.items.length, o.containers.length]),
      [
        ["ORD-1042", 2, 1],
        ["ORD-1043", 1, 1],
      ],
    );
    assert.equal(orders[0].items[0].quantity, 4);
    assert.equal(orders[1].items[0].name, "Hard drive");
  });

  test("samples/order-import-2.csv gives ORD-1044 to ORD-1053, one container each", () => {
    const orders = groupCsvOrders(parseCsv(sample("order-import-2.csv")));
    assert.deepEqual(
      orders.map((o) => o.external_ref),
      Array.from({ length: 10 }, (_, i) => `ORD-${1044 + i}`),
    );
    assert.ok(orders.every((o) => o.containers.length === 1));
    assert.equal(orders.reduce((n, o) => n + o.items.length, 0), 19);
  });
});

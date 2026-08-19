/** Minimal RFC-4180-ish CSV parser (no quoted-field escapes). */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("csv_empty");
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line, i) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    row._line = i + 2;
    return row;
  });
}

function splitCsvLine(line) {
  return line.split(",").map((v) => v.trim());
}

/** Group CSV rows into orders keyed by order_ref. */
export function groupCsvOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    const ref = row.order_ref;
    if (!ref) {
      throw new Error(`missing order_ref on line ${row._line}`);
    }
    if (!orders.has(ref)) {
      orders.set(ref, { external_ref: ref, items: [], containers: [] });
    }
    const bucket = orders.get(ref);
    const type = (row.record_type ?? "").toLowerCase();
    if (type === "item") {
      if (!row.item_name) {
        throw new Error(`missing item_name on line ${row._line}`);
      }
      bucket.items.push({
        name: row.item_name,
        length_cm: num(row.length_cm, "length_cm", row._line),
        width_cm: num(row.width_cm, "width_cm", row._line),
        height_cm: num(row.height_cm, "height_cm", row._line),
        weight_kg: num(row.weight_kg, "weight_kg", row._line),
        quantity: int(row.quantity || "1", "quantity", row._line),
      });
    } else if (type === "container") {
      if (!row.container_name) {
        throw new Error(`missing container_name on line ${row._line}`);
      }
      bucket.containers.push({
        name: row.container_name,
        length_cm: num(row.length_cm, "length_cm", row._line),
        width_cm: num(row.width_cm, "width_cm", row._line),
        height_cm: num(row.height_cm, "height_cm", row._line),
        max_weight_kg: num(row.max_weight_kg, "max_weight_kg", row._line),
      });
    } else {
      throw new Error(`invalid record_type on line ${row._line}`);
    }
  }
  return [...orders.values()];
}

function num(value, field, line) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid ${field} on line ${line}`);
  }
  return n;
}

function int(value, field, line) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`invalid ${field} on line ${line}`);
  }
  return n;
}

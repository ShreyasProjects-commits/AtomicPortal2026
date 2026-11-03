// Reads the FitSolver-format "boxes" and "items" files (each JSON or CSV) and
// builds ONE FitPortal order from them. Sizes in these files are millimetres;
// FitPortal stores centimetres. File columns:
//   boxes: Reference, Width, Length, Depth, MaxWeight  [Active]
//          (BoxWeight and MaximumBoxes in the file are ignored for now)
//   items: ItemReference (or ItemCode), Width, Length, Depth, Weight

import { parseCsv } from "./csv.js";

const MM_PER_CM = 10;
const MAX_ROWS = 5000;

const BOX_COLUMNS = ["Reference", "Width", "Length", "Depth", "MaxWeight"];
const ITEM_COLUMNS = ["ItemReference", "Width", "Length", "Depth", "Weight"];

const norm = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const cm = (mm) => +(mm / MM_PER_CM).toFixed(3);

/** Rows of a JSON array or CSV file, with keys normalised (case/space-insensitive). */
export function readRows(text, fileName = "file") {
  const body = String(text ?? "").replace(/^﻿/, "").trim();
  if (!body) throw new Error(`${fileName} is empty`);

  let raw;
  if (body.startsWith("[") || body.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`${fileName} is not valid JSON`);
    }
    raw = (Array.isArray(data) ? data : [data]).map((r, i) => ({ r, label: `entry ${i + 1}` }));
  } else {
    let rows;
    try {
      rows = parseCsv(body);
    } catch (err) {
      throw new Error(err.message === "csv_empty" ? `${fileName} has no rows` : `${fileName}: ${err.message}`);
    }
    raw = rows.map((r) => ({ r, label: `line ${r._line}` }));
  }

  const columns = [];
  const rows = [];
  for (const { r, label } of raw) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`${fileName}: ${label} is not an object`);
    }
    const data = {};
    for (const [key, value] of Object.entries(r)) {
      if (key === "_line") continue;
      if (!columns.includes(key)) columns.push(key);
      data[norm(key)] = value;
    }
    if (Object.values(data).every(isBlank)) continue; // blank row
    rows.push({ label, data });
  }

  if (!rows.length) throw new Error(`${fileName} has no rows`);
  if (rows.length > MAX_ROWS) throw new Error(`${fileName} has more than ${MAX_ROWS} rows`);
  return { rows, columns };
}

/** "boxes", "items", or null when the columns match neither. */
export function detectKind(columns) {
  const keys = new Set(columns.map(norm));
  if (keys.has("itemreference") || keys.has("itemcode")) return "items";
  if (keys.has("reference")) return "boxes";
  return null;
}

function requireColumns(columns, required, fileName) {
  const have = new Set(columns.map(norm));
  const missing = required.filter((c) => !have.has(norm(c)));
  if (missing.length) {
    throw new Error(`${fileName}: missing column(s) ${missing.join(", ")}. Found: ${columns.join(", ")}`);
  }
}

function number(value, what, where, { min = 0, allowEqualMin = false } = {}) {
  const n = isBlank(value) ? NaN : Number(value);
  const ok = Number.isFinite(n) && (allowEqualMin ? n >= min : n > min);
  if (!ok) {
    throw new Error(`${where}: ${what} must be a number ${allowEqualMin ? "of at least" : "above"} ${min}`);
  }
  return n;
}

function isInactive(value) {
  if (isBlank(value)) return false;
  if (typeof value === "boolean") return value === false;
  return ["false", "0", "no", "n"].includes(String(value).trim().toLowerCase());
}

function readBoxes(rows, fileName) {
  const containers = [];
  for (const { label, data } of rows) {
    if (isInactive(data.active)) continue;
    const where = `${fileName} ${label}`;

    const name = isBlank(data.reference) ? "" : String(data.reference).trim();
    if (!name) throw new Error(`${where}: Reference is missing`);

    const width = number(data.width, "Width", where);
    const length = number(data.length, "Length", where);
    const depth = number(data.depth, "Depth", where);
    if (isBlank(data.maxweight)) throw new Error(`${where}: box "${name}" has no MaxWeight`);
    const maxWeight = number(data.maxweight, "MaxWeight", where);

    containers.push({
      name,
      length_cm: cm(length),
      width_cm: cm(width),
      height_cm: cm(depth),
      max_weight_kg: maxWeight,
    });
  }
  return containers;
}

function readItems(rows, fileName) {
  const items = [];
  for (const { label, data } of rows) {
    const where = `${fileName} ${label}`;
    const reference = isBlank(data.itemreference) ? "" : String(data.itemreference).trim();
    const code = isBlank(data.itemcode) ? "" : String(data.itemcode).trim();
    const name = reference || code;
    if (!name) throw new Error(`${where}: ItemReference is missing`);

    items.push({
      name,
      length_cm: cm(number(data.length, "Length", where)),
      width_cm: cm(number(data.width, "Width", where)),
      height_cm: cm(number(data.depth, "Depth", where)),
      weight_kg: number(data.weight, "Weight", where, { min: 0, allowEqualMin: true }),
      quantity: 1,
    });
  }
  return items;
}

/**
 * files: [{ name, text }, { name, text }] in any order — one boxes file, one items file.
 * Returns { external_ref, items, containers } in the same shape the CSV importer builds.
 * Throws an Error whose message is safe to show the user.
 */
export function buildOrderFromSolverFiles(files, externalRef) {
  if (!Array.isArray(files) || files.length !== 2) {
    throw new Error("Select exactly two files: one boxes file and one items file");
  }

  const parsed = files.map((f) => {
    const name = f.name || "file";
    const { rows, columns } = readRows(f.text, name);
    const kind = detectKind(columns);
    if (!kind) {
      throw new Error(
        `${name}: can't tell whether this is a boxes or an items file. ` +
          `Boxes need the columns ${BOX_COLUMNS.join(", ")}; items need ${ITEM_COLUMNS.join(", ")}. ` +
          `Found: ${columns.join(", ")}`,
      );
    }
    requireColumns(
      columns,
      kind === "boxes" ? BOX_COLUMNS : ["Width", "Length", "Depth", "Weight"],
      name,
    );
    return { name, rows, kind };
  });

  const boxFiles = parsed.filter((p) => p.kind === "boxes");
  const itemFiles = parsed.filter((p) => p.kind === "items");
  if (boxFiles.length !== 1 || itemFiles.length !== 1) {
    throw new Error(
      `Need one boxes file and one items file, but got ${boxFiles.length} boxes file(s) and ` +
        `${itemFiles.length} items file(s)`,
    );
  }

  const containers = readBoxes(boxFiles[0].rows, boxFiles[0].name);
  if (!containers.length) throw new Error(`${boxFiles[0].name} has no active boxes`);
  const items = readItems(itemFiles[0].rows, itemFiles[0].name);

  return { external_ref: externalRef, items, containers };
}

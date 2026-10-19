import { randomUUID } from "node:crypto";

// A tiny in-memory stand-in for the Supabase client. It supports only the query
// calls the Edge Functions use. `select(...)` column lists (including embedded
// joins) are ignored: select returns the whole stored row, so seed rows already
// in the nested shape the code expects, e.g.
//   order_items rows:      { order_id, quantity, items: { ...item fields } }
//   order_containers rows: { order_id, containers: { ...container fields } }

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.patch = null;
    this.rows = null;
    this.wantSelect = false;
    this.orderBy = null;
    this.mode = "many";
  }

  select() {
    if (this.op !== "select") this.wantSelect = true;
    return this;
  }
  insert(rows) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(row) {
    this.op = "upsert";
    this.rows = [row];
    return this;
  }
  update(patch) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col, val) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col, val) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  not(col, _operator, val) {
    this.filters.push((r) => !(val === null ? r[col] == null : r[col] === val));
    return this;
  }
  in(col, vals) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  like(col, pattern) {
    const prefix = pattern.replace(/%$/, "");
    this.filters.push((r) => typeof r[col] === "string" && r[col].startsWith(prefix));
    return this;
  }
  order(col, { ascending = true } = {}) {
    this.orderBy = { col, ascending };
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.exec()).then(resolve, reject);
  }

  finish(rows) {
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "expected exactly one row" } };
      }
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "more than one row returned" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  exec() {
    const { db, table, op } = this;
    db.log.push({ table, op, patch: this.patch ?? undefined, rows: this.rows ?? undefined });

    const failure = db.takeFailure(table, op);
    if (failure) return { data: null, error: failure };

    const store = db.table(table);
    const matches = () => store.filter((r) => this.filters.every((f) => f(r)));

    if (op === "select") {
      let rows = matches();
      if (this.orderBy) {
        const { col, ascending } = this.orderBy;
        const up = ascending ? 1 : -1;
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -up : a[col] > b[col] ? up : 0));
      }
      return this.finish(rows.map((r) => structuredClone(r)));
    }

    if (op === "insert") {
      const inserted = [];
      for (const raw of this.rows) {
        const row = structuredClone(raw);
        if (
          table === "orders" &&
          row.external_ref != null &&
          store.some((r) => r.external_ref === row.external_ref)
        ) {
          return {
            data: null,
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "orders_external_ref_idx"',
            },
          };
        }
        row.id ??= randomUUID();
        row.created_at ??= new Date().toISOString();
        if (table === "orders") row.updated_at ??= row.created_at;
        store.push(row);
        inserted.push(structuredClone(row));
      }
      return this.wantSelect ? this.finish(inserted) : { data: null, error: null };
    }

    if (op === "upsert") {
      const key = table === "order_results" ? "order_id" : "id";
      const raw = structuredClone(this.rows[0]);
      const i = store.findIndex((r) => r[key] === raw[key]);
      if (i >= 0) {
        store[i] = { ...store[i], ...raw };
      } else {
        raw.created_at ??= new Date().toISOString();
        store.push(raw);
      }
      return { data: null, error: null };
    }

    if (op === "update") {
      const rows = matches();
      for (const r of rows) Object.assign(r, structuredClone(this.patch));
      return this.wantSelect
        ? this.finish(rows.map((r) => structuredClone(r)))
        : { data: null, error: null };
    }

    if (op === "delete") {
      for (const r of matches()) store.splice(store.indexOf(r), 1);
      return { data: null, error: null };
    }

    throw new Error(`fake db: unsupported operation ${op}`);
  }
}

export function createFakeDb() {
  const db = {
    tables: {},
    tokens: {},
    log: [],
    failures: [],
  };

  db.table = (name) => (db.tables[name] ??= []);

  db.seed = (name, rows) => {
    for (const r of rows) db.table(name).push(structuredClone(r));
    return db;
  };

  // Registers a login token and (by default) a matching profiles row.
  db.addUser = (
    token,
    { id, role = "warehouse_worker", first_name = "Test", last_name = "User", active = true, hasProfile = true },
  ) => {
    db.tokens[token] = { id, email: `${id}@example.test` };
    if (hasProfile) db.seed("profiles", [{ id, first_name, last_name, role, active }]);
    return db;
  };

  // Makes `op` on `table` return `error` (the next `times` calls, default always).
  db.fail = (table, op, error, times = Infinity) => {
    db.failures.push({ table, op, error, times });
    return db;
  };
  db.takeFailure = (table, op) => {
    const f = db.failures.find((x) => x.table === table && x.op === op && x.times > 0);
    if (!f) return null;
    f.times -= 1;
    return f.error;
  };

  // Write operations attempted so far (everything except reads).
  db.writes = () => db.log.filter((l) => l.op !== "select");

  db.client = {
    auth: {
      async getUser(token) {
        const user = db.tokens[token];
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
    from: (table) => new Query(db, table),
  };

  return db;
}

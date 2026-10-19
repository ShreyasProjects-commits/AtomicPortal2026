import { register } from "node:module";
import { createFakeDb } from "./fake-db.mjs";

// Must run before any Edge Function module is imported.
register("./loader.mjs", import.meta.url);

export const envVars = {
  SUPABASE_URL: "http://fake.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};
globalThis.Deno = { env: { get: (key) => envVars[key] } };

/** Imports an Edge Function and returns the request handler it passed to serve(). */
export async function loadHandler(name) {
  globalThis.__capturedHandler = undefined;
  await import(`../../supabase/functions/${name}/index.js`);
  const handler = globalThis.__capturedHandler;
  if (!handler) throw new Error(`function "${name}" did not call serve()`);
  return handler;
}

/** Fresh empty fake database, installed as the one the functions will talk to. */
export function newDb() {
  const db = createFakeDb();
  globalThis.__fakeDb = db;
  return db;
}

/** Deterministic valid UUID (version 4 / variant 8) so ids pass UUID_RE. */
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ADMIN_ID = uuid(1);
export const WORKER_ID = uuid(2);
export const WORKER2_ID = uuid(3);

/** Builds a Request and runs it through a handler. */
export function call(
  handler,
  { method = "GET", url = "http://localhost/fn", token, body, headers = {} } = {},
) {
  const h = new Headers(headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  const init = { method, headers: h };
  if (body !== undefined) {
    if (typeof body === "string" || body instanceof FormData) {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      if (!h.has("content-type")) h.set("content-type", "application/json");
    }
  }
  return handler(new Request(url, init));
}

// --- fake solver (global fetch) ---------------------------------------------
const realFetch = globalThis.fetch;
export const fetchCalls = [];

/** Replaces global fetch. impl(url, init, callNumber) returns a response-like object or throws. */
export function stubFetch(impl) {
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return impl(url, init, fetchCalls.length);
  };
}
export function restoreFetch() {
  globalThis.fetch = realFetch;
}
export const solverOk = (body = { placements: [], unplacedItems: [] }) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
export const solverHttpError = () => ({ ok: false, status: 500, json: async () => ({}) });

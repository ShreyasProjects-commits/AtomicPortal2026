// GET /orders — list orders (role-filtered) or fetch one by ?id=<uuid>
// POST /orders — admin-only: manually create a draft order from existing
//                catalog items/containers (see /catalog for the picker data)
// Used by the warehouse portal (no direct DB access from the browser).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient, UUID_RE } from "../_shared/supabase.js";
import { requireRole } from "../_shared/authz.js";

// "assigned_worker:profiles(...)" relies on PostgREST inferring the join
// from the single FK orders.assigned_worker_id -> profiles.id added in
// schema-roles-and-assignment.sql. There's only one such FK, so no
// !constraint_name disambiguator is needed.
const ORDER_LIST_SELECT =
  "id, external_ref, status, created_at, updated_at, assigned_worker_id, " +
  "assigned_worker:profiles ( id, first_name, last_name )";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Any signed-in user (admin or warehouse_worker) can read; only admins
  // can create. requireRole(req, null) below just checks "is someone",
  // the role split happens per-branch.
  const auth = await requireRole(req, null);
  if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
  const { profile, supabase } = auth;

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!UUID_RE.test(id)) {
        return errorResponse("invalid_request", "id must be a UUID");
      }
      return getOrderDetail(supabase, id, profile);
    }
    return listOrders(supabase, profile);
  }

  if (req.method === "POST") {
    if (profile.role !== "admin") {
      return errorResponse("forbidden", "Only admins can create orders", 403);
    }
    return createOrder(req, supabase);
  }

  return errorResponse("method_not_allowed", "GET or POST only", 405);
});

async function listOrders(supabase, profile) {
  let query = supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .order("created_at", { ascending: false });

  // Workers only ever see orders assigned to them — this is the actual
  // enforcement point; the client also filters its own view, but that's
  // just UX, this is the real gate.
  if (profile.role !== "admin") {
    query = query.eq("assigned_worker_id", profile.id);
  }

  const { data, error } = await query;
  if (error) {
    return errorResponse("database_error", error.message, 500);
  }
  return json(data ?? []);
}

async function getOrderDetail(supabase, id, profile) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (orderErr) {
    return errorResponse("database_error", orderErr.message, 500);
  }
  if (!order) {
    return errorResponse("not_found", "Order not found", 404);
  }
  if (profile.role !== "admin" && order.assigned_worker_id !== profile.id) {
    // Don't leak that the order exists to a worker it isn't assigned to.
    return errorResponse("not_found", "Order not found", 404);
  }

  const { data: orderItems } = await supabase
    .from("order_items")
    .select("quantity, items ( id, name, length_cm, width_cm, height_cm, weight_kg )")
    .eq("order_id", id);

  const { data: orderContainers } = await supabase
    .from("order_containers")
    .select("containers ( id, name, length_cm, width_cm, height_cm, max_weight_kg )")
    .eq("order_id", id);

  const { data: result } = await supabase
    .from("order_results")
    .select("packed_containers, unpacked_items, created_at")
    .eq("order_id", id)
    .maybeSingle();

  return json({
    ...order,
    items: (orderItems ?? []).map((row) => ({
      ...row.items,
      quantity: row.quantity,
    })),
    containers: (orderContainers ?? []).map((row) => row.containers),
    result: result ?? null,
  });
}

async function createOrder(req, supabase) {
  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Body must be JSON", 400);
  }

  const externalRef = typeof body.external_ref === "string" ? body.external_ref.trim() : null;
  const items = Array.isArray(body.items) ? body.items : [];
  const containers = Array.isArray(body.containers) ? body.containers : [];

  if (!items.length || !containers.length) {
    return errorResponse(
      "invalid_request",
      "Provide at least one item ({itemId, quantity}) and one container ({containerId})",
    );
  }
  for (const it of items) {
    if (!it.itemId || !UUID_RE.test(it.itemId) || !(Number(it.quantity) > 0)) {
      return errorResponse("invalid_request", "Each item needs a valid itemId and quantity > 0");
    }
  }
  for (const c of containers) {
    if (!c.containerId || !UUID_RE.test(c.containerId)) {
      return errorResponse("invalid_request", "Each container needs a valid containerId");
    }
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({ external_ref: externalRef, status: "draft" })
    .select("id, external_ref, status, created_at, updated_at")
    .single();

  if (orderErr) {
    if (orderErr.code === "23505") {
      return errorResponse("duplicate_ref", "An order with this reference already exists", 409);
    }
    return errorResponse("database_error", orderErr.message, 500);
  }

  const { error: itemsErr } = await supabase.from("order_items").insert(
    items.map((it) => ({ order_id: order.id, item_id: it.itemId, quantity: Number(it.quantity) })),
  );
  if (itemsErr) {
    await supabase.from("orders").delete().eq("id", order.id);
    return errorResponse("database_error", `Failed to attach items: ${itemsErr.message}`, 500);
  }

  const { error: containersErr } = await supabase.from("order_containers").insert(
    containers.map((c) => ({ order_id: order.id, container_id: c.containerId })),
  );
  if (containersErr) {
    await supabase.from("orders").delete().eq("id", order.id);
    return errorResponse("database_error", `Failed to attach containers: ${containersErr.message}`, 500);
  }

  return json(order, 201);
}
/*// GET /orders — list orders or fetch one by ?id=<uuid>
// Used by the warehouse portal (no direct DB access from the browser).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient, UUID_RE } from "../_shared/supabase.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET only", 405);
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return errorResponse("supabase_not_configured", "Set SUPABASE_URL and service role key", 500);
  }

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!UUID_RE.test(id)) {
      return errorResponse("invalid_request", "id must be a UUID");
    }
    return getOrderDetail(supabase, id);
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, external_ref, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse("database_error", error.message, 500);
  }
  return json(data ?? []);
});

async function getOrderDetail(supabase, id) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, external_ref, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (orderErr) {
    return errorResponse("database_error", orderErr.message, 500);
  }
  if (!order) {
    return errorResponse("not_found", "Order not found", 404);
  }

  const { data: orderItems } = await supabase
    .from("order_items")
    .select("quantity, items ( id, name, length_cm, width_cm, height_cm, weight_kg )")
    .eq("order_id", id);

  const { data: orderContainers } = await supabase
    .from("order_containers")
    .select("containers ( id, name, length_cm, width_cm, height_cm, max_weight_kg )")
    .eq("order_id", id);

  const { data: result } = await supabase
    .from("order_results")
    .select("packed_containers, unpacked_items, created_at")
    .eq("order_id", id)
    .maybeSingle();

  return json({
    ...order,
    items: (orderItems ?? []).map((row) => ({
      ...row.items,
      quantity: row.quantity,
    })),
    containers: (orderContainers ?? []).map((row) => row.containers),
    result: result ?? null,
  });
}*/

// GET /orders — list orders (role-filtered) or fetch one by ?id=<uuid>
// POST /orders — two actions, dispatched by body.action:
//   (default / no action) admin-only: manually create a draft order from
//     existing catalog items/containers (see /catalog for the picker data)
//   action: "complete"    { orderId } — the order's assigned worker (or an
//     admin) marks it as physically finished. Only allowed once the order
//     has been packed (status "solved") — completed_at/completed_by are
//     separate from the solver's status on purpose: "solved" means the
//     optimiser produced a pack plan, "completed" means a worker actually
//     finished packing it on the floor. Worker stats (days worked, orders
//     completed) are driven off completed_at, not status.
// Used by the warehouse portal (no direct DB access from the browser).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient, UUID_RE } from "../_shared/supabase.js";
import { requireRole } from "../_shared/authz.js";

// orders now has two FKs to profiles (assigned_worker_id, completed_by), so
// each embed must be disambiguated with !<constraint_name> — Postgres's
// default name for an unnamed single-column FK is <table>_<column>_fkey.
const ORDER_LIST_SELECT =
  "id, external_ref, status, created_at, updated_at, assigned_worker_id, " +
  "completed_at, completed_by, " +
  "assigned_worker:profiles!orders_assigned_worker_id_fkey ( id, first_name, last_name ), " +
  "completed_by_profile:profiles!orders_completed_by_fkey ( id, first_name, last_name )";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Any signed-in user (admin or warehouse_worker) can read; only admins
  // can create, and completion has its own worker-or-admin check below.
  // requireRole(req, null) here just checks "is someone", the role split
  // happens per-branch.
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
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("invalid_json", "Body must be JSON", 400);
    }

    if (body?.action === "complete") {
      return completeOrder(supabase, body, profile);
    }

    if (profile.role !== "admin") {
      return errorResponse("forbidden", "Only admins can create orders", 403);
    }
    return createOrder(body, supabase);
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

async function createOrder(body, supabase) {
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

async function completeOrder(supabase, body, profile) {
  const orderId = body.orderId;
  if (!orderId || !UUID_RE.test(orderId)) {
    return errorResponse("invalid_request", "orderId must be a UUID");
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, assigned_worker_id, completed_at")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) return errorResponse("database_error", orderErr.message, 500);
  if (!order) return errorResponse("not_found", "Order not found", 404);

  const isAssignedWorker = order.assigned_worker_id === profile.id;
  if (profile.role !== "admin" && !isAssignedWorker) {
    // Don't leak that the order exists to a worker it isn't assigned to.
    return errorResponse("not_found", "Order not found", 404);
  }
  if (order.status !== "solved") {
    return errorResponse(
      "not_ready",
      "Order must be packed (status: solved) before it can be marked complete",
      409,
    );
  }
  if (order.completed_at) {
    return errorResponse("already_completed", "This order is already marked complete", 409);
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ completed_at: new Date().toISOString(), completed_by: profile.id })
    .eq("id", orderId)
    .select(ORDER_LIST_SELECT)
    .maybeSingle();

  if (error) return errorResponse("database_error", error.message, 500);
  return json(data);
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

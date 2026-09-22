// GET  /assign-worker — admin-only. Lists all worker profiles (for the
//      assign dropdown / "Manage users" list), each with their current
//      count of assigned-but-not-yet-solved orders.
// POST /assign-worker — admin-only. Body: { action, ... }
//      action: "assign"   { orderId, workerId }  — workerId null unassigns
//      action: "auto"     { orderIds?: string[] } — least-loaded assignment
//                            across active workers for all currently
//                            unassigned orders, or just the given ids
//      action: "set_role" { userId, role }        — promote/demote a user
//      action: "set_active" { userId, active }    — enable/disable a user

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { requireRole } from "../_shared/authz.js";
import { UUID_RE } from "../_shared/supabase.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireRole(req, ["admin"]);
  if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
  const { supabase } = auth;

  if (req.method === "GET") {
    return listWorkers(supabase);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("invalid_json", "Body must be JSON", 400);
    }

    switch (body.action) {
      case "assign":
        return assignOrder(supabase, body);
      case "auto":
        return autoAssign(supabase, body);
      case "set_role":
        return setRole(supabase, body, auth.user.id);
      case "set_active":
        return setActive(supabase, body, auth.user.id);
      default:
        return errorResponse(
          "invalid_request",
          "action must be one of: assign, auto, set_role, set_active",
        );
    }
  }

  return errorResponse("method_not_allowed", "GET or POST only", 405);
});

async function listWorkers(supabase) {
  const { data: workers, error: workersErr } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, active")
    .order("first_name");

  if (workersErr) {
    return errorResponse("database_error", workersErr.message, 500);
  }

  // Current open workload per worker — orders assigned to them that
  // haven't reached a terminal state (solved/failed) yet.
  const { data: openOrders, error: ordersErr } = await supabase
    .from("orders")
    .select("assigned_worker_id")
    .not("assigned_worker_id", "is", null)
    .in("status", ["draft", "submitted"]);

  if (ordersErr) {
    return errorResponse("database_error", ordersErr.message, 500);
  }

  const loadByWorker = new Map();
  for (const o of openOrders ?? []) {
    loadByWorker.set(o.assigned_worker_id, (loadByWorker.get(o.assigned_worker_id) ?? 0) + 1);
  }

  return json(
    (workers ?? []).map((w) => ({
      ...w,
      open_order_count: loadByWorker.get(w.id) ?? 0,
    })),
  );
}

async function assignOrder(supabase, body) {
  const { orderId, workerId } = body;
  if (!orderId || !UUID_RE.test(orderId)) {
    return errorResponse("invalid_request", "orderId must be a UUID");
  }
  if (workerId !== null && workerId !== undefined && !UUID_RE.test(workerId)) {
    return errorResponse("invalid_request", "workerId must be a UUID or null to unassign");
  }

  if (workerId) {
    const { data: worker, error: workerErr } = await supabase
      .from("profiles")
      .select("id, role, active")
      .eq("id", workerId)
      .maybeSingle();
    if (workerErr) return errorResponse("database_error", workerErr.message, 500);
    if (!worker || worker.role !== "warehouse_worker") {
      return errorResponse("invalid_request", "workerId must be an active warehouse_worker");
    }
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ assigned_worker_id: workerId ?? null, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select("id, external_ref, status, assigned_worker_id")
    .maybeSingle();

  if (error) return errorResponse("database_error", error.message, 500);
  if (!data) return errorResponse("not_found", "Order not found", 404);
  return json(data);
}

/**
 * Least-loaded auto-assign: each unassigned order goes to whichever active
 * warehouse_worker currently has the fewest open (draft/submitted) orders,
 * updating the running count as we go so a batch spreads evenly rather than
 * dumping everything on whoever happened to have the lowest count first.
 */
async function autoAssign(supabase, body) {
  const { data: workers, error: workersErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "warehouse_worker")
    .eq("active", true);
  if (workersErr) return errorResponse("database_error", workersErr.message, 500);
  if (!workers?.length) {
    return errorResponse("no_workers", "No active warehouse workers to assign to", 409);
  }

  const { data: openOrders, error: openErr } = await supabase
    .from("orders")
    .select("assigned_worker_id")
    .not("assigned_worker_id", "is", null)
    .in("status", ["draft", "submitted"]);
  if (openErr) return errorResponse("database_error", openErr.message, 500);

  const load = new Map(workers.map((w) => [w.id, 0]));
  for (const o of openOrders ?? []) {
    if (load.has(o.assigned_worker_id)) {
      load.set(o.assigned_worker_id, load.get(o.assigned_worker_id) + 1);
    }
  }

  let targetQuery = supabase.from("orders").select("id").is("assigned_worker_id", null);
  if (Array.isArray(body.orderIds) && body.orderIds.length) {
    for (const id of body.orderIds) {
      if (!UUID_RE.test(id)) return errorResponse("invalid_request", "orderIds must all be UUIDs");
    }
    targetQuery = targetQuery.in("id", body.orderIds);
  }
  const { data: targets, error: targetsErr } = await targetQuery;
  if (targetsErr) return errorResponse("database_error", targetsErr.message, 500);
  if (!targets?.length) {
    return json({ assigned: [] });
  }

  const assignments = [];
  for (const order of targets) {
    // Pick the currently least-loaded worker; ties broken by whoever comes
    // first in `workers` (stable order from the query above).
    let pick = workers[0].id;
    let pickLoad = load.get(pick);
    for (const w of workers) {
      const l = load.get(w.id);
      if (l < pickLoad) {
        pick = w.id;
        pickLoad = l;
      }
    }
    assignments.push({ orderId: order.id, workerId: pick });
    load.set(pick, pickLoad + 1);
  }

  const nowIso = new Date().toISOString();
  for (const a of assignments) {
    const { error } = await supabase
      .from("orders")
      .update({ assigned_worker_id: a.workerId, updated_at: nowIso })
      .eq("id", a.orderId);
    if (error) {
      // Best-effort: report what succeeded so far rather than failing the
      // whole batch on one row.
      return json(
        { assigned: assignments.slice(0, assignments.indexOf(a)), error: error.message },
        207,
      );
    }
  }

  return json({ assigned: assignments });
}

async function setRole(supabase, body, callerId) {
  const { userId, role } = body;
  if (!userId || !UUID_RE.test(userId)) {
    return errorResponse("invalid_request", "userId must be a UUID");
  }
  if (role !== "admin" && role !== "warehouse_worker") {
    return errorResponse("invalid_request", "role must be admin or warehouse_worker");
  }
  if (userId === callerId && role !== "admin") {
    return errorResponse("invalid_request", "You can't demote your own account");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .select("id, first_name, last_name, role, active")
    .maybeSingle();

  if (error) return errorResponse("database_error", error.message, 500);
  if (!data) return errorResponse("not_found", "User not found", 404);
  return json(data);
}

async function setActive(supabase, body, callerId) {
  const { userId, active } = body;
  if (!userId || !UUID_RE.test(userId)) {
    return errorResponse("invalid_request", "userId must be a UUID");
  }
  if (typeof active !== "boolean") {
    return errorResponse("invalid_request", "active must be true or false");
  }
  if (userId === callerId && active === false) {
    return errorResponse("invalid_request", "You can't disable your own account");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId)
    .select("id, first_name, last_name, role, active")
    .maybeSingle();

  if (error) return errorResponse("database_error", error.message, 500);
  if (!data) return errorResponse("not_found", "User not found", 404);
  return json(data);
}
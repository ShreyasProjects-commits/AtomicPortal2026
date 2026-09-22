// GET /worker-stats            — caller's own stats (admin or worker)
// GET /worker-stats?scope=admin — admin-only: org totals + per-worker table
//
// "Days worked" = distinct calendar dates (from orders.completed_at) on
// which an order assigned to that worker was marked complete by them. There's
// no separate clock-in/attendance feature in this app, so this is derived
// entirely from existing order data rather than needing new tracking.
// "Orders completed" = orders assigned to that worker with completed_at set
// (a worker's own "done" action — see /orders action:"complete") — this is
// deliberately NOT the same as status:"solved", which just means the
// optimiser produced a pack plan, not that anyone finished packing it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { requireRole } from "../_shared/authz.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET only", 405);
  }

  const auth = await requireRole(req, null);
  if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
  const { profile, supabase } = auth;

  const scope = new URL(req.url).searchParams.get("scope");
  if (scope === "admin") {
    if (profile.role !== "admin") {
      return errorResponse("forbidden", "Admin only", 403);
    }
    return adminStats(supabase);
  }

  try {
    return json(await workerStats(supabase, profile.id));
  } catch (err) {
    return errorResponse("database_error", err.message, 500);
  }
});

async function workerStats(supabase, workerId) {
  const { data: assigned, error } = await supabase
    .from("orders")
    .select("id, external_ref, status, updated_at, completed_at")
    .eq("assigned_worker_id", workerId);

  if (error) throw error;

  const rows = assigned ?? [];
  const completed = rows.filter((o) => o.completed_at);
  const daysWorked = new Set(
    completed.map((o) => new Date(o.completed_at).toISOString().slice(0, 10)),
  );

  return {
    assigned_count: rows.length,
    open_count: rows.filter((o) => !o.completed_at).length,
    completed_count: completed.length,
    failed_count: rows.filter((o) => o.status === "failed").length,
    days_worked: daysWorked.size,
    days_worked_dates: [...daysWorked].sort(),
  };
}

async function adminStats(supabase) {
  const [{ data: orders, error: ordersErr }, { data: workers, error: workersErr }] =
    await Promise.all([
      supabase.from("orders").select("id, status, assigned_worker_id, updated_at, completed_at"),
      supabase.from("profiles").select("id, first_name, last_name, role, active"),
    ]);

  if (ordersErr) return errorResponse("database_error", ordersErr.message, 500);
  if (workersErr) return errorResponse("database_error", workersErr.message, 500);

  const allOrders = orders ?? [];
  const totals = {
    total_orders: allOrders.length,
    by_status: {
      draft: allOrders.filter((o) => o.status === "draft").length,
      submitted: allOrders.filter((o) => o.status === "submitted").length,
      solved: allOrders.filter((o) => o.status === "solved").length,
      failed: allOrders.filter((o) => o.status === "failed").length,
    },
    unassigned_count: allOrders.filter((o) => !o.assigned_worker_id).length,
    completed_count: allOrders.filter((o) => o.completed_at).length,
    total_workers: (workers ?? []).filter((w) => w.role === "warehouse_worker").length,
  };

  const workerRows = (workers ?? [])
    .filter((w) => w.role === "warehouse_worker")
    .map((w) => {
      const own = allOrders.filter((o) => o.assigned_worker_id === w.id);
      const completed = own.filter((o) => o.completed_at);
      const daysWorked = new Set(
        completed.map((o) => new Date(o.completed_at).toISOString().slice(0, 10)),
      );
      return {
        id: w.id,
        first_name: w.first_name,
        last_name: w.last_name,
        active: w.active,
        assigned_count: own.length,
        open_count: own.filter((o) => !o.completed_at).length,
        completed_count: completed.length,
        days_worked: daysWorked.size,
      };
    });

  return json({ totals, workers: workerRows });
}
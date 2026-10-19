// GET /order-result?id=<uuid>
// Returns packing result in api-contract.md shape — intended for FitVisualizer.
// Requires a signed-in user (Authorization: Bearer <access token>). Admins can read
// any order; a warehouse worker can only read orders assigned to them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { UUID_RE } from "../_shared/supabase.js";
import { requireRole } from "../_shared/authz.js";
import { loadOrderCatalog, toApiContractResult } from "../_shared/orders.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET only", 405);
  }

  const auth = await requireRole(req, null);
  if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
  const { profile, supabase } = auth;

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return errorResponse("invalid_request", "Query param id must be a UUID");
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, external_ref, assigned_worker_id")
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

  const { data: result, error: resultErr } = await supabase
    .from("order_results")
    .select("packed_containers, unpacked_items, created_at")
    .eq("order_id", id)
    .maybeSingle();

  if (resultErr) {
    return errorResponse("database_error", resultErr.message, 500);
  }
  if (!result) {
    return errorResponse("not_found", "No packing result for this order yet", 404);
  }

  let catalog;
  try {
    catalog = await loadOrderCatalog(supabase, id);
  } catch (err) {
    return errorResponse("database_error", err.message, 500);
  }

  return json({
    ...toApiContractResult(id, result),
    items: catalog.items,
    containers: catalog.containers,
    external_ref: order.external_ref,
    status: order.status,
    created_at: result.created_at,
  });
});

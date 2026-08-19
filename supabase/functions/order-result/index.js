// GET /order-result?id=<uuid>
// Returns packing result in api-contract.md shape — intended for FitVisualizer.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient, UUID_RE } from "../_shared/supabase.js";
import { toApiContractResult } from "../_shared/orders.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET only", 405);
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return errorResponse("invalid_request", "Query param id must be a UUID");
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return errorResponse("supabase_not_configured", "Set SUPABASE_URL and service role key", 500);
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, external_ref")
    .eq("id", id)
    .maybeSingle();

  if (orderErr) {
    return errorResponse("database_error", orderErr.message, 500);
  }
  if (!order) {
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

  return json({
    ...toApiContractResult(id, result),
    external_ref: order.external_ref,
    status: order.status,
    created_at: result.created_at,
  });
});

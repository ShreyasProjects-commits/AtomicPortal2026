// Supabase Edge Function: POST /optimize
// Forwards an order to FitSolver and persists the result when orderId is a UUID.
// Body: full api-contract payload OR { "orderId": "<uuid>" } to re-run from DB.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient, UUID_RE } from "../_shared/supabase.js";
import { loadOrderForOptimize } from "../_shared/orders.js";
import {
  markOrderFailed,
  persistOptimizeResult,
  runOptimize,
} from "../_shared/solver.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST only", 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Body must be JSON", 400);
  }

  const orderId = body.orderId;
  const shouldPersist = orderId && UUID_RE.test(orderId);

  let supabase;
  if (shouldPersist) {
    try {
      supabase = getServiceClient();
    } catch {
      return errorResponse("supabase_not_configured", "Cannot persist without Supabase", 500);
    }
  }

  let payload = body;
  if (shouldPersist && supabase && (!body.items?.length || !body.containers?.length)) {
    try {
      payload = await loadOrderForOptimize(supabase, orderId);
      await supabase
        .from("orders")
        .update({ status: "submitted", updated_at: new Date().toISOString() })
        .eq("id", orderId);
    } catch (err) {
      if (err.message === "not_found") {
        return errorResponse("not_found", "Order not found", 404);
      }
      return errorResponse("invalid_request", err.message);
    }
  } else if (!body.items?.length || !body.containers?.length) {
    return errorResponse(
      "items_and_containers_required",
      "Provide items and containers, or orderId to re-run an existing order",
    );
  } else if (shouldPersist && supabase) {
    await supabase
      .from("orders")
      .update({ status: "submitted", updated_at: new Date().toISOString() })
      .eq("id", orderId);
  }

  try {
    const result = await runOptimize(payload);
    if (shouldPersist && supabase) {
      await persistOptimizeResult(supabase, orderId, result);
    }
    return json(result, 200);
  } catch (err) {
    if (shouldPersist && supabase) {
      await markOrderFailed(supabase, orderId);
    }
    const code = err.message === "solver_unreachable"
      ? "solver_unreachable"
      : "solver_error";
    return errorResponse(code, err.message, 502);
  }
});

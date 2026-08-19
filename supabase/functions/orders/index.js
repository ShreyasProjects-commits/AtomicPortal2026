// GET /orders — list orders or fetch one by ?id=<uuid>
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
}

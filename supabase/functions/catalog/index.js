// GET /catalog — admin-only. Returns the full items + containers catalog,
// used by add-order.html's picker so an admin can build a manual order from
// existing item/container types (no direct DB access from the browser).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { requireRole } from "../_shared/authz.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET only", 405);
  }

  const auth = await requireRole(req, ["admin"]);
  if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
  const { supabase } = auth;

  const [{ data: items, error: itemsErr }, { data: containers, error: containersErr }] =
    await Promise.all([
      supabase
        .from("items")
        .select("id, name, length_cm, width_cm, height_cm, weight_kg")
        .order("name"),
      supabase
        .from("containers")
        .select("id, name, length_cm, width_cm, height_cm, max_weight_kg")
        .order("name"),
    ]);

  if (itemsErr || containersErr) {
    return errorResponse(
      "database_error",
      (itemsErr ?? containersErr).message,
      500,
    );
  }

  return json({ items: items ?? [], containers: containers ?? [] });
});
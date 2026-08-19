// POST /import-csv — parse business orders from CSV, optimise, persist results.
// See docs/import-contract.md for the column layout.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, json, errorResponse } from "../_shared/cors.js";
import { getServiceClient } from "../_shared/supabase.js";
import { groupCsvOrders, parseCsv } from "../_shared/csv.js";
import {
  markOrderFailed,
  persistOptimizeResult,
  runOptimize,
  toOptimizePayload,
} from "../_shared/solver.js";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST only", 405);
  }

  let csvText;
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return errorResponse("invalid_request", "Expected file field in form data");
      }
      csvText = await file.text();
    } else {
      csvText = await req.text();
    }
  } catch {
    return errorResponse("invalid_request", "Could not read request body");
  }

  if (!csvText.trim()) {
    return errorResponse("invalid_request", "CSV body is empty");
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return errorResponse("supabase_not_configured", "Set SUPABASE_URL and service role key", 500);
  }

  const replace = new URL(req.url).searchParams.get("replace") === "true";
  let grouped;
  try {
    grouped = groupCsvOrders(parseCsv(csvText));
  } catch (err) {
    return errorResponse("invalid_csv", err.message);
  }

  const imported = [];
  for (const orderData of grouped) {
    try {
      imported.push(await importOneOrder(supabase, orderData, replace));
    } catch (err) {
      if (err.message === "duplicate_order") {
        return errorResponse(
          "duplicate_order",
          `Order ${orderData.external_ref} already exists. Pass ?replace=true to re-import.`,
          409,
        );
      }
      imported.push({
        external_ref: orderData.external_ref,
        status: "failed",
        error: err.message,
      });
    }
  }

  return json({ imported });
});

async function importOneOrder(supabase, orderData, replace) {
  if (!orderData.items.length || !orderData.containers.length) {
    throw new Error("each order needs at least one item and one container");
  }

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("external_ref", orderData.external_ref)
    .maybeSingle();

  if (existing && !replace) {
    throw new Error("duplicate_order");
  }
  if (existing && replace) {
    await supabase.from("orders").delete().eq("id", existing.id);
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({ external_ref: orderData.external_ref, status: "draft" })
    .select("id, external_ref")
    .single();
  if (orderErr) throw orderErr;

  const itemRows = [];
  for (const item of orderData.items) {
    const { data: row, error } = await supabase
      .from("items")
      .insert({
        name: item.name,
        length_cm: item.length_cm,
        width_cm: item.width_cm,
        height_cm: item.height_cm,
        weight_kg: item.weight_kg,
      })
      .select("id, name, length_cm, width_cm, height_cm, weight_kg")
      .single();
    if (error) throw error;

    await supabase.from("order_items").insert({
      order_id: order.id,
      item_id: row.id,
      quantity: item.quantity,
    });
    itemRows.push({ ...row, quantity: item.quantity });
  }

  const containerRows = [];
  for (const container of orderData.containers) {
    const { data: row, error } = await supabase
      .from("containers")
      .insert({
        name: container.name,
        length_cm: container.length_cm,
        width_cm: container.width_cm,
        height_cm: container.height_cm,
        max_weight_kg: container.max_weight_kg,
      })
      .select("id, name, length_cm, width_cm, height_cm, max_weight_kg")
      .single();
    if (error) throw error;

    await supabase.from("order_containers").insert({
      order_id: order.id,
      container_id: row.id,
    });
    containerRows.push(row);
  }

  await supabase
    .from("orders")
    .update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  try {
    const payload = toOptimizePayload(order.id, itemRows, containerRows);
    const result = await runOptimize(payload);
    await persistOptimizeResult(supabase, order.id, result);
    return { id: order.id, external_ref: order.external_ref, status: "solved" };
  } catch (err) {
    await markOrderFailed(supabase, order.id);
    return {
      id: order.id,
      external_ref: order.external_ref,
      status: "failed",
      error: err.message,
    };
  }
}

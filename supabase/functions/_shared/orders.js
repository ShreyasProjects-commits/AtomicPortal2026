import { toOptimizePayload } from "./solver.js";

/** Nested dimensions object — shared integration contract (api-contract.md). */
export function toContractDimensions(row) {
  return {
    length: Number(row.length_cm),
    width: Number(row.width_cm),
    height: Number(row.height_cm),
    unit: "cm",
  };
}

export function toContractItem(row) {
  return {
    id: row.id,
    name: row.name,
    dimensions: toContractDimensions(row),
    weight: { value: Number(row.weight_kg), unit: "kg" },
    quantity: row.quantity ?? 1,
  };
}

export function toContractContainer(row) {
  return {
    id: row.id,
    name: row.name,
    dimensions: toContractDimensions(row),
    maxWeight: { value: Number(row.max_weight_kg), unit: "kg" },
  };
}

/** Load catalogue rows for an order in integration-contract shape. */
export async function loadOrderCatalog(supabase, orderId) {
  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items")
    .select("quantity, items ( id, name, length_cm, width_cm, height_cm, weight_kg )")
    .eq("order_id", orderId);

  if (itemsErr) throw itemsErr;

  const { data: orderContainers, error: contErr } = await supabase
    .from("order_containers")
    .select("containers ( id, name, length_cm, width_cm, height_cm, max_weight_kg )")
    .eq("order_id", orderId);

  if (contErr) throw contErr;

  return {
    items: (orderItems ?? []).map((row) =>
      toContractItem({ ...row.items, quantity: row.quantity }),
    ),
    containers: (orderContainers ?? []).map((row) => toContractContainer(row.containers)),
  };
}

/** Load items + containers from DB and build a FitSolver payload. */
export async function loadOrderForOptimize(supabase, orderId) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, external_ref, status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) throw orderErr;
  if (!order) throw new Error("not_found");

  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items")
    .select("quantity, items ( id, name, length_cm, width_cm, height_cm, weight_kg )")
    .eq("order_id", orderId);

  if (itemsErr) throw itemsErr;

  const { data: orderContainers, error: contErr } = await supabase
    .from("order_containers")
    .select("containers ( id, name, length_cm, width_cm, height_cm, max_weight_kg )")
    .eq("order_id", orderId);

  if (contErr) throw contErr;

  const itemRows = (orderItems ?? []).map((row) => ({
    ...row.items,
    quantity: row.quantity,
  }));

  const containerRows = (orderContainers ?? []).map((row) => row.containers);

  if (!itemRows.length || !containerRows.length) {
    throw new Error("order_missing_items_or_containers");
  }

  return toOptimizePayload(orderId, itemRows, containerRows);
}

/** api-contract.md shape for FitVisualizer consumption. */
export function toApiContractResult(orderId, dbResult) {
  if (!dbResult) return null;
  return {
    orderId,
    packedContainers: dbResult.packed_containers ?? [],
    unpackedItems: dbResult.unpacked_items ?? [],
  };
}

const FITSOLVER_URL = Deno.env.get("FITSOLVER_URL");

// atomic-solver's box sizes only make sense as millimetres (a "MED" box of
// 400x400x400 lines up with FitPortal's own 40x40x40cm sample container).
// FitPortal stores/exchanges centimetres everywhere else.
// TODO: confirm this with the FitSolver team rather than relying on inference.
const CM_TO_MM = 10;

/** Build api-contract.md payload from DB rows. */
export function toOptimizePayload(orderId, itemRows, containerRows) {
  return {
    orderId,
    items: itemRows.map((row) => ({
      id: row.id,
      name: row.name,
      dimensions: {
        length: Number(row.length_cm),
        width: Number(row.width_cm),
        height: Number(row.height_cm),
        unit: "cm",
      },
      weight: { value: Number(row.weight_kg), unit: "kg" },
      quantity: row.quantity,
    })),
    containers: containerRows.map((row) => ({
      id: row.id,
      name: row.name,
      dimensions: {
        length: Number(row.length_cm),
        width: Number(row.width_cm),
        height: Number(row.height_cm),
        unit: "cm",
      },
      maxWeight: { value: Number(row.max_weight_kg), unit: "kg" },
    })),
  };
}

/**
 * atomic-solver speaks a different shape than api-contract.md:
 *   { boxTypes: [{Reference,Width,Length,Depth,MaxWeight,BoxWeight,Active,MaximumBoxes}],
 *     items:    [{ItemCode,ItemReference,Width,Length,Depth,Weight,BoxGroup?}] }
 * No `orderId`, and no `quantity` field on items — one entry per physical item.
 * This translates FitPortal's canonical payload into that shape. We set
 * Reference/ItemCode to our own ids (suffixed for repeated quantity) so the
 * response can be mapped straight back without a side lookup table.
 */
function toAtomicSolverRequest(payload) {
  const itemCodeToId = new Map();

  const items = [];
  for (const item of payload.items) {
    const qty = item.quantity ?? 1;
    for (let i = 0; i < qty; i++) {
      const itemCode = qty > 1 ? `${item.id}__${i + 1}` : String(item.id);
      itemCodeToId.set(itemCode, item.id);
      items.push({
        ItemCode: itemCode,
        ItemReference: item.name,
        Width: item.dimensions.width * CM_TO_MM,
        Length: item.dimensions.length * CM_TO_MM,
        Depth: item.dimensions.height * CM_TO_MM,
        Weight: item.weight.value,
      });
    }
  }

  const boxVolumeByReference = new Map();
  const boxTypes = payload.containers.map((c) => {
    const width = c.dimensions.width * CM_TO_MM;
    const length = c.dimensions.length * CM_TO_MM;
    const depth = c.dimensions.height * CM_TO_MM;
    boxVolumeByReference.set(String(c.id), width * length * depth);
    return {
      Reference: String(c.id),
      Width: width,
      Length: length,
      Depth: depth,
      MaxWeight: c.maxWeight.value,
      // FitPortal doesn't track empty-box weight yet — confirm if this is required.
      BoxWeight: 0,
      Active: true,
    };
  });

  return { request: { boxTypes, items }, itemCodeToId, boxVolumeByReference };
}

/**
 * Translates atomic-solver's response back into api-contract.md shape so the
 * rest of FitPortal (persistOptimizeResult, /order-result, FitVisualizer) never
 * has to know the solver's real field names.
 */
function fromAtomicSolverResponse(orderId, solverResult, itemCodeToId, boxVolumeByReference) {
  const boxes = new Map(); // "reference#instance" -> packedContainer
  const placedVolumeByKey = new Map(); // "reference#instance" -> mm^3 of items placed

  for (const p of solverResult.placements ?? []) {
    const key = `${p.boxReference}#${p.boxInstance}`;
    if (!boxes.has(key)) {
      boxes.set(key, { containerId: p.boxReference, placements: [] });
    }
    boxes.get(key).placements.push({
      itemId: itemCodeToId.get(p.itemCode) ?? p.itemCode,
      position: {
        x: (p.position?.x ?? 0) / CM_TO_MM,
        y: (p.position?.y ?? 0) / CM_TO_MM,
        z: (p.position?.z ?? 0) / CM_TO_MM,
        unit: "cm",
      },
      // atomic-solver only returns placedDimension (post-rotation size), not
      // rotation degrees. TODO: confirm with FitSolver/FitVisualizer whether
      // rotation can be derived, or needs adding to their response.
      rotation: { x: 0, y: 0, z: 0 },
    });

    const d = p.placedDimension;
    if (d) {
      const vol = Number(d.width) * Number(d.length) * Number(d.depth);
      placedVolumeByKey.set(key, (placedVolumeByKey.get(key) ?? 0) + vol);
    }
  }

  const packedContainers = [...boxes.entries()].map(([key, box]) => {
    const boxVolume = boxVolumeByReference.get(box.containerId);
    const placedVolume = placedVolumeByKey.get(key);
    const utilisation =
      boxVolume && placedVolume != null
        ? Math.min(1, placedVolume / boxVolume)
        : null;
    return { ...box, utilisation };
  });

  const unpackedItems = (solverResult.unplacedItems ?? []).map((entry) => {
    const itemCode = typeof entry === "string" ? entry : entry.itemCode;
    return {
      itemId: itemCodeToId.get(itemCode) ?? itemCode,
      reason: (typeof entry === "object" && entry?.reason) || "no_container_fits",
    };
  });

  return { orderId, packedContainers, unpackedItems };
}

/** Call FitSolver or return a deterministic mock for local dev. */
export async function runOptimize(payload) {
  if (FITSOLVER_URL) {
    const { request, itemCodeToId, boxVolumeByReference } = toAtomicSolverRequest(payload);

    let solverRes;
    try {
      solverRes = await fetch(FITSOLVER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error("solver_unreachable");
    }
    if (!solverRes.ok) {
      throw new Error("solver_error");
    }

    const solverResult = await solverRes.json();
    if (solverResult.error) {
      // atomic-solver returns 200 + {error, details} rather than a non-2xx status.
      throw new Error("solver_error");
    }

    return fromAtomicSolverResponse(
      payload.orderId,
      solverResult,
      itemCodeToId,
      boxVolumeByReference,
    );
  }
  return mockSolverResult(payload);
}

function mockSolverResult(payload) {
  const firstContainer = payload.containers[0];
  let z = 0;
  const placements = [];
  for (const item of payload.items) {
    for (let q = 0; q < item.quantity; q++) {
      placements.push({
        itemId: item.id,
        position: { x: 0, y: 0, z, unit: "cm" },
        rotation: { x: 0, y: 0, z: 0 },
      });
      z += Number(item.dimensions.height) || 5;
    }
  }
  return {
    orderId: payload.orderId,
    packedContainers: [
      {
        containerId: firstContainer?.id ?? "mock-cont",
        placements,
        utilisation: 0.42,
      },
    ],
    unpackedItems: [],
  };
}

export async function persistOptimizeResult(supabase, orderId, result) {
  const { error: resultErr } = await supabase.from("order_results").upsert({
    order_id: orderId,
    packed_containers: result.packedContainers ?? [],
    unpacked_items: result.unpackedItems ?? [],
  });
  if (resultErr) throw resultErr;

  const { error: statusErr } = await supabase
    .from("orders")
    .update({ status: "solved", updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (statusErr) throw statusErr;

  return result;
}

export async function markOrderFailed(supabase, orderId) {
  await supabase
    .from("orders")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", orderId);
}
/*const FITSOLVER_URL = Deno.env.get("FITSOLVER_URL");

// Build api-contract.md payload from DB rows. 
export function toOptimizePayload(orderId, itemRows, containerRows) {
  return {
    orderId,
    items: itemRows.map((row) => ({
      id: row.id,
      name: row.name,
      dimensions: {
        length: Number(row.length_cm),
        width: Number(row.width_cm),
        height: Number(row.height_cm),
        unit: "cm",
      },
      weight: { value: Number(row.weight_kg), unit: "kg" },
      quantity: row.quantity,
    })),
    containers: containerRows.map((row) => ({
      id: row.id,
      name: row.name,
      dimensions: {
        length: Number(row.length_cm),
        width: Number(row.width_cm),
        height: Number(row.height_cm),
        unit: "cm",
      },
      maxWeight: { value: Number(row.max_weight_kg), unit: "kg" },
    })),
  };
}

// Call FitSolver or return a deterministic mock for local dev. 
export async function runOptimize(payload) {
  if (FITSOLVER_URL) {
    let solverRes;
    try {
      solverRes = await fetch(FITSOLVER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("solver_unreachable");
    }
    if (!solverRes.ok) {
      throw new Error("solver_error");
    }
    return await solverRes.json();
  }
  return mockSolverResult(payload);
}

function mockSolverResult(payload) {
  const firstContainer = payload.containers[0];
  let z = 0;
  const placements = [];
  for (const item of payload.items) {
    for (let q = 0; q < item.quantity; q++) {
      placements.push({
        itemId: item.id,
        position: { x: 0, y: 0, z, unit: "cm" },
        rotation: { x: 0, y: 0, z: 0 },
      });
      z += Number(item.dimensions.height) || 5;
    }
  }
  return {
    orderId: payload.orderId,
    packedContainers: [
      {
        containerId: firstContainer?.id ?? "mock-cont",
        placements,
        utilisation: 0.42,
      },
    ],
    unpackedItems: [],
  };
}

export async function persistOptimizeResult(supabase, orderId, result) {
  const { error: resultErr } = await supabase.from("order_results").upsert({
    order_id: orderId,
    packed_containers: result.packedContainers ?? [],
    unpacked_items: result.unpackedItems ?? [],
  });
  if (resultErr) throw resultErr;

  const { error: statusErr } = await supabase
    .from("orders")
    .update({ status: "solved", updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (statusErr) throw statusErr;

  return result;
}

export async function markOrderFailed(supabase, orderId) {
  await supabase
    .from("orders")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", orderId);
}*/

const FITSOLVER_URL = Deno.env.get("FITSOLVER_URL");

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

/** Call FitSolver or return a deterministic mock for local dev. */
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
}

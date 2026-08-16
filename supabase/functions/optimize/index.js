// Supabase Edge Function: POST /optimize
// Receives an order from FitPortal's frontend, forwards it to FitSolver,
// and returns packedContainers + unpackedItems.
//
// Runs on Deno (Supabase Edge runtime). Written in plain JavaScript to match
// the project stack. The `Deno` global and URL import below are provided by
// that runtime — your editor may not recognise them, but they work on deploy.
//
// Deploy: supabase functions deploy optimize
// Local:  supabase functions serve optimize

import { serve } from "https://deno.land/std/http/server.ts";

const FITSOLVER_URL = Deno.env.get("FITSOLVER_URL");

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body.items?.length || !body.containers?.length) {
    return json({ error: "items_and_containers_required" }, 400);
  }

  // Forward to FitSolver (the packing engine — owned by the sibling team).
  let solverRes;
  try {
    solverRes = await fetch(FITSOLVER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return json({ error: "solver_unreachable" }, 502);
  }

  if (!solverRes.ok) {
    return json({ error: "solver_error", status: solverRes.status }, 502);
  }

  const result = await solverRes.json();

  // TODO: persist result to order_results and flip orders.status -> 'solved'.
  // (Wired up once auth + Supabase client are added in Sprint 1/2.)

  return json(result, 200);
});

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

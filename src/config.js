// API base URLs — override in a script tag before modules load if needed:
// <script>window.FITPORTAL_API_BASE = "https://xxx.supabase.co/functions/v1"</script>

export const API_BASE =
  window.FITPORTAL_API_BASE ??
  "https://obhsgsftqetjqqyvqelh.supabase.co/functions/v1";

export const FITVISUALIZER_URL =
  window.FITVISUALIZER_URL ?? "https://atomic-visualiser.vercel.app/";

export function viewerUrl(orderId) {
  const base = FITVISUALIZER_URL.replace(/\/$/, "");
  return `${base}?orderId=${encodeURIComponent(orderId)}`;
}

// In-portal iframe wrapper — keeps FitPortal nav chrome. 
export function visualizePageUrl(orderId) {
  return `visualize.html?id=${encodeURIComponent(orderId)}`;
}

export function orderResultApiUrl(orderId) {
  return `${API_BASE}/order-result?id=${encodeURIComponent(orderId)}`;
}

/**
 * Fetches an order's packing result and pushes it into an already-loaded
 * FitVisualizer iframe via postMessage — the same mechanism visualize.html
 * uses, factored out so an inline embed (worker-order.js) can reuse it
 * without duplicating the postMessage plumbing. Call this from the
 * iframe's "load" event, not before.
 */
export async function sendResultToVisualizerFrame(iframe, orderId) {
  if (!iframe?.contentWindow) return;
  const targetOrigin = new URL(FITVISUALIZER_URL).origin;

  const res = await fetch(orderResultApiUrl(orderId));
  if (!res.ok) throw new Error(`order-result request failed: ${res.status}`);
  const result = await res.json();

  iframe.contentWindow.postMessage(
    { type: "viz-data", version: 1, payload: toVisualizerPayload(result) },
    targetOrigin,
  );
}

/*
 * FitSolver's axes: x = width, y = length, z = height (UP).
 * FitVisualizer currently draws y / "length" as the UP axis, so cartons and
 * items appear stood on end. Until FitVisualizer changes, we swap
 * length <-> height and y <-> z in the copy we send it. The stored result and
 * the /order-result API are NOT changed.
 *
 * Set this to false as soon as FitVisualizer uses z as up, or everything
 * will be swapped twice.
 */
export const VISUALIZER_Y_IS_UP = true;

export function toVisualizerPayload(result) {
  if (!VISUALIZER_Y_IS_UP || !result) return result;

  const upright = (d) => (d ? { ...d, length: d.height, height: d.length } : d);
  const itemById = new Map((result.items ?? []).map((item) => [item.id, item]));

  // Each placement gets its own item entry carrying its as-placed size, so
  // rotated items draw at the right size even if FitVisualizer only reads
  // items[].dimensions and ignores placement.size.
  const placedItems = [];
  const packedContainers = (result.packedContainers ?? []).map((box, b) => ({
    ...box,
    placements: (box.placements ?? []).map((p, i) => {
      const item = itemById.get(p.itemId);
      const size = upright(p.size ?? item?.dimensions);
      const id = `${p.itemId}#${b + 1}-${i + 1}`;
      placedItems.push({ ...item, id, dimensions: size });
      const pos = p.position ?? { x: 0, y: 0, z: 0 };
      return { ...p, itemId: id, size, position: { ...pos, y: pos.z, z: pos.y } };
    }),
  }));

  return {
    ...result,
    packedContainers,
    // Originals stay in the list so unpackedItems still resolve to a name.
    items: [
      ...(result.items ?? []).map((item) => ({ ...item, dimensions: upright(item.dimensions) })),
      ...placedItems,
    ],
    containers: (result.containers ?? []).map((c) => ({ ...c, dimensions: upright(c.dimensions) })),
  };
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function statusLabel(status) {
  return status ?? "unknown";
}

/*// API base URLs — override in a script tag before modules load if needed:
// <script>window.FITPORTAL_API_BASE = "https://xxx.supabase.co/functions/v1"</script>

export const API_BASE =
  window.FITPORTAL_API_BASE ??
  "https://obhsgsftqetjqqyvqelh.supabase.co/functions/v1";

export const FITVISUALIZER_URL =
  window.FITVISUALIZER_URL ?? "https://atomic-visualiser.vercel.app/";

export function viewerUrl(orderId) {
  const base = FITVISUALIZER_URL.replace(/\/$/, "");
  return `${base}?orderId=${encodeURIComponent(orderId)}`;
}

// In-portal iframe wrapper — keeps FitPortal nav chrome. 
export function visualizePageUrl(orderId) {
  return `visualize.html?id=${encodeURIComponent(orderId)}`;
}

export function orderResultApiUrl(orderId) {
  return `${API_BASE}/order-result?id=${encodeURIComponent(orderId)}`;
}


 //Fetches an order's packing result and pushes it into an already-loaded
 //FitVisualizer iframe via postMessage — the same mechanism visualize.html
 //uses, factored out so an inline embed (worker-order.js) can reuse it
 //without duplicating the postMessage plumbing. Call this from the
 //iframe's "load" event, not before.
 
export async function sendResultToVisualizerFrame(iframe, orderId) {
  if (!iframe?.contentWindow) return;
  const targetOrigin = new URL(FITVISUALIZER_URL).origin;

  const res = await fetch(orderResultApiUrl(orderId));
  if (!res.ok) throw new Error(`order-result request failed: ${res.status}`);
  const result = await res.json();

  iframe.contentWindow.postMessage({ type: "viz-data", version: 1, payload: result }, targetOrigin);
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function statusLabel(status) {
  return status ?? "unknown";
}*/
/*// API base URLs — override in a script tag before modules load if needed:
// <script>window.FITPORTAL_API_BASE = "https://xxx.supabase.co/functions/v1"</script>

export const API_BASE =
  window.FITPORTAL_API_BASE ??
  "https://obhsgsftqetjqqyvqelh.supabase.co/functions/v1";

export const FITVISUALIZER_URL =
  window.FITVISUALIZER_URL ?? "https://atomic-visualiser.vercel.app/";

export function viewerUrl(orderId) {
  const base = FITVISUALIZER_URL.replace(/\/$/, "");
  return `${base}?orderId=${encodeURIComponent(orderId)}`;
}

// In-portal iframe wrapper — keeps FitPortal nav chrome. 
export function visualizePageUrl(orderId) {
  return `visualize.html?id=${encodeURIComponent(orderId)}`;
}

export function orderResultApiUrl(orderId) {
  return `${API_BASE}/order-result?id=${encodeURIComponent(orderId)}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function statusLabel(status) {
  return status ?? "unknown";
}*/

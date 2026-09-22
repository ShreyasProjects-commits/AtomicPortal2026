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

  iframe.contentWindow.postMessage({ type: "viz-data", version: 1, payload: result }, targetOrigin);
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

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function statusLabel(status) {
  return status ?? "unknown";
}*/

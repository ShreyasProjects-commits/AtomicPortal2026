// API base URLs — override in a script tag before modules load if needed:
// <script>window.FITPORTAL_API_BASE = "https://xxx.supabase.co/functions/v1"</script>

export const API_BASE =
  window.FITPORTAL_API_BASE ??
  "https://obhsgsftqetjqqyvqelh.supabase.co/functions/v1";

export const FITVISUALIZER_URL =
  window.FITVISUALIZER_URL ?? "http://localhost:5173/view";

export function viewerUrl(orderId) {
  const base = FITVISUALIZER_URL.replace(/\/$/, "");
  return `${base}?orderId=${encodeURIComponent(orderId)}`;
}

/** In-portal iframe wrapper — keeps FitPortal nav chrome. */
export function visualizePageUrl(orderId) {
  return `visualize?id=${encodeURIComponent(orderId)}`;
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
}

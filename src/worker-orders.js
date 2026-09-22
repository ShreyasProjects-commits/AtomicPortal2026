import { API_BASE, formatDate, statusLabel } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const cardsEl = document.getElementById("orders-cards");
const emptyEl = document.getElementById("orders-empty");
const errorEl = document.getElementById("orders-error");

async function init() {
  const auth = await requireRole(["warehouse_worker"]);
  if (!auth) return;

  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}/orders`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    render(Array.isArray(data) ? data : []);
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Could not load your orders: ${err.message}`;
  }
}
init();

function render(orders) {
  if (!orders.length) {
    emptyEl.hidden = false;
    return;
  }

  cardsEl.innerHTML = orders
    .map(
      (o) => `
    <a class="worker-order-card" href="worker-order.html?id=${encodeURIComponent(o.id)}">
      <div class="woc-top">
        <strong>${esc(o.external_ref ?? o.id.slice(0, 8))}</strong>
        <span class="status-pill status-${o.status}">${statusLabel(o.status)}</span>
      </div>
      <p class="hint">Updated ${formatDate(o.updated_at)}</p>
    </a>`,
    )
    .join("");
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
import { API_BASE, formatDate, statusLabel, viewerUrl, sendResultToVisualizerFrame } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const loading = document.getElementById("order-loading");
const errorEl = document.getElementById("order-error");
const content = document.getElementById("order-content");
const notSolvedNote = document.getElementById("not-solved-note");
const boxesPanel = document.getElementById("boxes-panel");
const packBoxesEl = document.getElementById("pack-boxes");
const unpackedNote = document.getElementById("unpacked-note");
const vizPanel = document.getElementById("viz-panel");
const vizError = document.getElementById("viz-error");
const completeBtn = document.getElementById("complete-btn");
const completeError = document.getElementById("complete-error");
const completedNote = document.getElementById("completed-note");
const completedAtEl = document.getElementById("completed-at");

async function authHeaders() {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function init() {
  const auth = await requireRole(["warehouse_worker"]);
  if (!auth) return;

  if (!orderId) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Missing order id. Go back to your order list.";
    return;
  }

  await loadOrder();
}
init();

completeBtn?.addEventListener("click", async () => {
  completeBtn.disabled = true;
  completeBtn.textContent = "Marking complete…";
  completeError.hidden = true;
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "complete", orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    await loadOrder();
  } catch (err) {
    completeError.hidden = false;
    completeError.textContent = `Couldn't mark this order complete: ${err.message}`;
  } finally {
    completeBtn.disabled = false;
    completeBtn.textContent = "Mark order as complete";
  }
});

async function loadOrder() {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}/orders?id=${encodeURIComponent(orderId)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    render(data);
  } catch (err) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message;
  }
}

function render(order) {
  loading.hidden = true;
  content.hidden = false;

  document.getElementById("order-ref").textContent = order.external_ref ?? order.id;
  const statusEl = document.getElementById("order-status");
  statusEl.textContent = statusLabel(order.status);
  statusEl.className = `status-pill status-${order.status}`;

  // Completion (a worker's own "I finished packing this" action) is
  // separate from the solver's status — see /orders action:"complete".
  if (order.completed_at) {
    completedNote.hidden = false;
    completedAtEl.textContent = formatDate(order.completed_at);
    completeBtn.hidden = true;
  } else if (order.status === "solved") {
    completedNote.hidden = true;
    completeBtn.hidden = false;
  } else {
    completedNote.hidden = true;
    completeBtn.hidden = true;
  }

  if (order.status !== "solved" || !order.result) {
    notSolvedNote.hidden = false;
    boxesPanel.hidden = true;
    vizPanel.hidden = true;
    return;
  }
  notSolvedNote.hidden = true;

  const itemById = new Map((order.items ?? []).map((i) => [i.id, i]));
  const containerById = new Map((order.containers ?? []).map((c) => [c.id, c]));
  const packed = order.result.packed_containers ?? [];

  boxesPanel.hidden = false;
  packBoxesEl.innerHTML =
    packed.map((box) => renderBoxCard(box, itemById, containerById)).join("") ||
    `<p class="hint">No boxes were used.</p>`;

  const unpacked = order.result.unpacked_items ?? [];
  unpackedNote.hidden = !unpacked.length;
  if (unpacked.length) {
    const names = unpacked
      .map((u) => itemById.get(u.itemId)?.name ?? u.itemId)
      .join(", ");
    unpackedNote.textContent = `${unpacked.length} item(s) couldn't be packed: ${names}`;
  }

  // Inline 3D view — embedded right here in the order page rather than a
  // separate "View in 3D" page/tab, per the visual-first worker layout.
  vizPanel.hidden = false;
  const iframe = document.getElementById("viewer");
  iframe.src = viewerUrl(order.id);
  iframe.addEventListener("load", () => {
    sendResultToVisualizerFrame(iframe, order.id).catch((err) => {
      vizError.hidden = false;
      vizError.textContent = "Couldn't load the 3D view — try refreshing.";
      console.error(err);
    });
  });
}

function renderBoxCard(box, itemById, containerById) {
  const container = containerById.get(box.containerId);
  const counts = new Map();
  for (const p of box.placements ?? []) {
    counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .map(([itemId, qty]) => {
      const item = itemById.get(itemId);
      return `
      <div class="pack-item-row">
        <span>${esc(item?.name ?? "Unknown item")}${qty > 1 ? ` ×${qty}` : ""}</span>
        <span class="id-tag">${esc(itemId)}</span>
      </div>`;
    })
    .join("");

  const pct = box.utilisation != null ? Math.round(box.utilisation * 100) : null;

  return `
    <div class="pack-box-card">
      <h4>${esc(container?.name ?? "Box")}${pct != null ? ` — ${pct}% full` : ""}</h4>
      <div class="id-tag">Box ID: ${esc(box.containerId)}</div>
      ${rows || `<p class="hint">Empty.</p>`}
    </div>`;
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
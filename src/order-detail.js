import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const loading = document.getElementById("order-loading");
const errorEl = document.getElementById("order-error");
const content = document.getElementById("order-content");
const view3d = document.getElementById("view-3d");
const reoptimizeBtn = document.getElementById("reoptimize");

if (!orderId) {
  loading.hidden = true;
  errorEl.hidden = false;
  errorEl.textContent = "Missing order id. Go back to the order queue.";
} else {
  loadOrder(orderId);
}

reoptimizeBtn?.addEventListener("click", async () => {
  reoptimizeBtn.disabled = true;
  reoptimizeBtn.textContent = "Re-running…";
  try {
    const res = await fetch(`${API_BASE}/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    await loadOrder(orderId);
  } catch (err) {
    alert(`Re-optimise failed: ${err.message}`);
  } finally {
    reoptimizeBtn.disabled = false;
    reoptimizeBtn.textContent = "Re-run optimiser";
  }
});

async function loadOrder(id) {
  try {
    const res = await fetch(`${API_BASE}/orders?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    renderOrder(data);
  } catch (err) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message;
  }
}

function renderOrder(order) {
  loading.hidden = true;
  content.hidden = false;

  document.getElementById("order-ref").textContent =
    order.external_ref ?? order.id;
  document.getElementById("order-status").textContent = statusLabel(order.status);
  document.getElementById("order-status").className =
    `status-pill status-${order.status}`;
  document.getElementById("order-created").textContent = formatDate(order.created_at);

  document.getElementById("items-body").innerHTML = (order.items ?? [])
    .map(
      (item) => `
      <tr>
        <td>${esc(item.name)}</td>
        <td>${item.length_cm} × ${item.width_cm} × ${item.height_cm}</td>
        <td>${item.weight_kg}</td>
        <td>${item.quantity ?? 1}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="4" class="muted-cell">No items</td></tr>`;

  document.getElementById("containers-body").innerHTML = (order.containers ?? [])
    .map(
      (c) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${c.length_cm} × ${c.width_cm} × ${c.height_cm}</td>
        <td>${c.max_weight_kg}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="3" class="muted-cell">No containers</td></tr>`;

  const resultPanel = document.getElementById("result-panel");
  const resultPre = document.getElementById("result-json");
  const unpackedNote = document.getElementById("unpacked-note");
  unpackedNote.hidden = true;

  if (order.result) {
    resultPanel.hidden = false;
    resultPre.textContent = JSON.stringify(order.result, null, 2);
    const unpacked = order.result.unpacked_items ?? [];
    if (unpacked.length) {
      unpackedNote.hidden = false;
      unpackedNote.textContent =
        `${unpacked.length} item(s) could not be packed.`;
    }
  } else {
    resultPanel.hidden = true;
  }

  if (order.status === "solved" && order.result) {
    view3d.hidden = false;
    view3d.href = visualizePageUrl(order.id);
  } else {
    view3d.hidden = true;
  }

  if (reoptimizeBtn) {
    reoptimizeBtn.hidden = order.status !== "failed";
  }
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

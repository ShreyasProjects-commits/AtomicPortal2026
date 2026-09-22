import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const loading = document.getElementById("order-loading");
const errorEl = document.getElementById("order-error");
const content = document.getElementById("order-content");
const view3d = document.getElementById("view-3d");
const reoptimizeBtn = document.getElementById("reoptimize");
const assignedEl = document.getElementById("order-assigned");
const assignSelect = document.getElementById("assign-select");
const assignSaveBtn = document.getElementById("assign-save");
const assignStatus = document.getElementById("assign-status");

let currentOrder = null;

async function authHeaders() {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function init() {
  // Order management is an admin-only page — workers get their own
  // worker-orders.html / worker-order.html with a simpler, visual view.
  const auth = await requireRole(["admin"]);
  if (!auth) return;

  if (!orderId) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Missing order id. Go back to the order queue.";
    return;
  }

  await Promise.all([loadOrder(orderId), loadWorkers()]);
}
init();

reoptimizeBtn?.addEventListener("click", async () => {
  reoptimizeBtn.disabled = true;
  reoptimizeBtn.textContent = "Running…";
  try {
    const res = await fetch(`${API_BASE}/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    await loadOrder(orderId);
  } catch (err) {
    alert(`Optimiser run failed: ${err.message}`);
  } finally {
    reoptimizeBtn.disabled = false;
  }
});

assignSaveBtn?.addEventListener("click", async () => {
  assignSaveBtn.disabled = true;
  assignStatus.textContent = "Saving…";
  try {
    const workerId = assignSelect.value || null;
    const res = await fetch(`${API_BASE}/assign-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "assign", orderId, workerId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    assignStatus.textContent = "Saved.";
    await loadOrder(orderId);
  } catch (err) {
    assignStatus.textContent = `Failed: ${err.message}`;
  } finally {
    assignSaveBtn.disabled = false;
  }
});

async function loadWorkers() {
  try {
    const res = await fetch(`${API_BASE}/assign-worker`, {
      headers: await authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    const workers = (data ?? []).filter((w) => w.role === "warehouse_worker");
    assignSelect.innerHTML =
      `<option value="">Unassigned</option>` +
      workers
        .map(
          (w) =>
            `<option value="${w.id}">${esc(w.first_name)} ${esc(w.last_name)} (${w.open_order_count} open)</option>`,
        )
        .join("");
    syncAssignSelect();
  } catch (err) {
    console.warn("Could not load worker list:", err);
  }
}

function syncAssignSelect() {
  if (!currentOrder || !assignSelect.options.length) return;
  assignSelect.value = currentOrder.assigned_worker_id ?? "";
}

async function loadOrder(id) {
  try {
    const res = await fetch(`${API_BASE}/orders?id=${encodeURIComponent(id)}`, {
      headers: await authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    currentOrder = data;
    renderOrder(data);
    syncAssignSelect();
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

  assignedEl.textContent = order.assigned_worker
    ? `${order.assigned_worker.first_name} ${order.assigned_worker.last_name}`
    : "Unassigned";

  // completed_at/completed_by are the worker's own "I finished packing
  // this" action (see /orders action:"complete") — separate from
  // order.status, which only reflects whether the optimiser has run.
  document.getElementById("order-completed").textContent = order.completed_at
    ? `${formatDate(order.completed_at)}${
        order.completed_by_profile
          ? ` by ${order.completed_by_profile.first_name} ${order.completed_by_profile.last_name}`
          : ""
      }`
    : "Not yet";

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
  const resultSummaryBody = document.getElementById("result-summary-body");
  const unpackedNote = document.getElementById("unpacked-note");
  unpackedNote.hidden = true;

  if (order.result) {
    resultPanel.hidden = false;
    resultPre.textContent = JSON.stringify(order.result, null, 2);

    const itemNameById = new Map((order.items ?? []).map((i) => [i.id, i.name]));
    const containerNameById = new Map(
      (order.containers ?? []).map((c) => [c.id, c.name]),
    );

    const packed = order.result.packed_containers ?? [];
    resultSummaryBody.innerHTML =
      packed.map((box) => renderPackedRow(box, itemNameById, containerNameById)).join("") ||
      `<tr><td colspan="3" class="muted-cell">No containers used</td></tr>`;

    const unpacked = order.result.unpacked_items ?? [];
    if (unpacked.length) {
      unpackedNote.hidden = false;
      const names = unpacked
        .map((u) => itemNameById.get(u.itemId) ?? u.itemId)
        .join(", ");
      unpackedNote.textContent =
        `${unpacked.length} item(s) could not be packed: ${names}`;
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
    // "draft" (freshly created, never run) and "failed" (needs a retry)
    // both need the optimiser button; "submitted"/"solved" don't.
    const needsRun = order.status === "draft" || order.status === "failed";
    reoptimizeBtn.hidden = !needsRun;
    reoptimizeBtn.textContent = order.status === "failed" ? "Re-run optimiser" : "Run optimiser";
  }
}

function renderPackedRow(box, itemNameById, containerNameById) {
  const counts = new Map();
  for (const p of box.placements ?? []) {
    const name = itemNameById.get(p.itemId) ?? p.itemId;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const itemsLabel =
    [...counts.entries()]
      .map(([name, n]) => (n > 1 ? `${esc(name)} ×${n}` : esc(name)))
      .join(", ") || "—";

  const containerLabel = containerNameById.get(box.containerId) ?? box.containerId;

  const pct = box.utilisation != null ? Math.round(box.utilisation * 100) : null;
  const utilCell =
    pct != null
      ? `<div class="util-bar"><div class="util-bar-fill" style="width:${pct}%"></div></div><span class="util-label">${pct}%</span>`
      : `<span class="util-label">—</span>`;

  return `
    <tr>
      <td>${esc(containerLabel)}</td>
      <td>${itemsLabel}</td>
      <td>${utilCell}</td>
    </tr>`;
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
/*import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";

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
  const resultSummaryBody = document.getElementById("result-summary-body");
  const unpackedNote = document.getElementById("unpacked-note");
  unpackedNote.hidden = true;

  if (order.result) {
    resultPanel.hidden = false;
    resultPre.textContent = JSON.stringify(order.result, null, 2);

    const itemNameById = new Map((order.items ?? []).map((i) => [i.id, i.name]));
    const containerNameById = new Map(
      (order.containers ?? []).map((c) => [c.id, c.name]),
    );

    const packed = order.result.packed_containers ?? [];
    resultSummaryBody.innerHTML =
      packed.map((box) => renderPackedRow(box, itemNameById, containerNameById)).join("") ||
      `<tr><td colspan="3" class="muted-cell">No containers used</td></tr>`;

    const unpacked = order.result.unpacked_items ?? [];
    if (unpacked.length) {
      unpackedNote.hidden = false;
      const names = unpacked
        .map((u) => itemNameById.get(u.itemId) ?? u.itemId)
        .join(", ");
      unpackedNote.textContent =
        `${unpacked.length} item(s) could not be packed: ${names}`;
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

function renderPackedRow(box, itemNameById, containerNameById) {
  const counts = new Map();
  for (const p of box.placements ?? []) {
    const name = itemNameById.get(p.itemId) ?? p.itemId;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const itemsLabel =
    [...counts.entries()]
      .map(([name, n]) => (n > 1 ? `${esc(name)} ×${n}` : esc(name)))
      .join(", ") || "—";

  const containerLabel = containerNameById.get(box.containerId) ?? box.containerId;

  const pct = box.utilisation != null ? Math.round(box.utilisation * 100) : null;
  const utilCell =
    pct != null
      ? `<div class="util-bar"><div class="util-bar-fill" style="width:${pct}%"></div></div><span class="util-label">${pct}%</span>`
      : `<span class="util-label">—</span>`;

  return `
    <tr>
      <td>${esc(containerLabel)}</td>
      <td>${itemsLabel}</td>
      <td>${utilCell}</td>
    </tr>`;
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}*/
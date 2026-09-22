import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const ordersBody = document.getElementById("orders-body");
const ordersEmpty = document.getElementById("orders-empty");
const ordersError = document.getElementById("orders-error");
const importForm = document.getElementById("import-form");
const importStatus = document.getElementById("import-status");
const replaceCheckbox = document.getElementById("replace-existing");
const searchInput = document.getElementById("order-search");
const autoAssignBtn = document.getElementById("auto-assign");
const autoAssignStatus = document.getElementById("auto-assign-status");

let allOrders = [];

async function authHeaders() {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function init() {
  const auth = await requireRole(["admin"]);
  if (!auth) return;
  await loadOrders();
}
init();

searchInput?.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allOrders.filter(
        (o) =>
          (o.external_ref ?? "").toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q) ||
          workerLabel(o).toLowerCase().includes(q),
      )
    : allOrders;
  renderOrders(filtered);
});

importForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById("csv-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    showImportStatus("Choose a CSV file first.", true);
    return;
  }

  showImportStatus("Importing…");
  const replace = replaceCheckbox?.checked ? "?replace=true" : "";

  try {
    const res = await fetch(`${API_BASE}/import-csv${replace}`, {
      method: "POST",
      body: file,
      headers: { "content-type": "text/csv", ...(await authHeaders()) },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    const summary = (data.imported ?? [])
      .map((o) => `${o.external_ref ?? o.id}: ${o.status}`)
      .join(", ");
    showImportStatus(`Imported: ${summary || "done"}`);
    fileInput.value = "";
    await loadOrders();
  } catch (err) {
    showImportStatus(err.message, true);
  }
});

autoAssignBtn?.addEventListener("click", async () => {
  autoAssignBtn.disabled = true;
  autoAssignStatus.hidden = false;
  autoAssignStatus.textContent = "Assigning…";
  try {
    const res = await fetch(`${API_BASE}/assign-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "auto" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    const count = data.assigned?.length ?? 0;
    autoAssignStatus.textContent = count
      ? `Assigned ${count} order(s) across active workers.`
      : "No unassigned orders to give out.";
    await loadOrders();
  } catch (err) {
    autoAssignStatus.textContent = `Failed: ${err.message}`;
  } finally {
    autoAssignBtn.disabled = false;
  }
});

async function loadOrders() {
  ordersError.hidden = true;
  ordersBody.innerHTML = `<tr><td colspan="6" class="muted-cell">Loading…</td></tr>`;

  try {
    const res = await fetch(`${API_BASE}/orders`, { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    allOrders = Array.isArray(data) ? data : [];
    renderOrders(allOrders);
  } catch (err) {
    ordersBody.innerHTML = "";
    ordersEmpty.hidden = true;
    ordersError.hidden = false;
    ordersError.textContent = `Could not load orders: ${err.message}.`;
  }
}

function workerLabel(o) {
  return o.assigned_worker
    ? `${o.assigned_worker.first_name} ${o.assigned_worker.last_name}`
    : "Unassigned";
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersBody.innerHTML = "";
    ordersEmpty.hidden = false;
    return;
  }

  ordersEmpty.hidden = true;
  ordersBody.innerHTML = orders
    .map((o) => {
      const assigned = Boolean(o.assigned_worker_id);
      return `
    <tr>
      <td><a class="order-link" href="order.html?id=${encodeURIComponent(o.id)}">${escapeHtml(o.external_ref ?? o.id.slice(0, 8))}</a></td>
      <td><span class="status-pill status-${o.status}">${statusLabel(o.status)}</span></td>
      <td><span class="assign-pill ${assigned ? "assign-yes" : "assign-no"}">${escapeHtml(workerLabel(o))}</span></td>
      <td>${formatDate(o.created_at)}</td>
      <td>${formatDate(o.updated_at)}</td>
      <td class="actions-cell">
        <a class="btn btn-sm" href="order.html?id=${encodeURIComponent(o.id)}">Details</a>
        ${
          o.status === "solved"
            ? `<a class="btn btn-sm primary-btn" href="${visualizePageUrl(o.id)}">View in 3D</a>`
            : ""
        }
      </td>
    </tr>`;
    })
    .join("");
}

function showImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.className = isError ? "import-status error" : "import-status";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
/*import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";

const ordersBody = document.getElementById("orders-body");
const ordersEmpty = document.getElementById("orders-empty");
const ordersError = document.getElementById("orders-error");
const importForm = document.getElementById("import-form");
const importStatus = document.getElementById("import-status");
const replaceCheckbox = document.getElementById("replace-existing");
const searchInput = document.getElementById("order-search");

let allOrders = [];

loadOrders();

searchInput?.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allOrders.filter(
        (o) =>
          (o.external_ref ?? "").toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q),
      )
    : allOrders;
  renderOrders(filtered);
});

importForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById("csv-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    showImportStatus("Choose a CSV file first.", true);
    return;
  }

  showImportStatus("Importing…");
  const replace = replaceCheckbox?.checked ? "?replace=true" : "";

  try {
    const res = await fetch(`${API_BASE}/import-csv${replace}`, {
      method: "POST",
      body: file,
      headers: { "content-type": "text/csv" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    const summary = (data.imported ?? [])
      .map((o) => `${o.external_ref ?? o.id}: ${o.status}`)
      .join(", ");
    showImportStatus(`Imported: ${summary || "done"}`);
    fileInput.value = "";
    await loadOrders();
  } catch (err) {
    showImportStatus(err.message, true);
  }
});

async function loadOrders() {
  ordersError.hidden = true;
  ordersBody.innerHTML = `<tr><td colspan="5" class="muted-cell">Loading…</td></tr>`;

  try {
    const res = await fetch(`${API_BASE}/orders`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    allOrders = Array.isArray(data) ? data : [];
    renderOrders(allOrders);
  } catch (err) {
    ordersBody.innerHTML = "";
    ordersEmpty.hidden = true;
    ordersError.hidden = false;
    ordersError.textContent = `Could not load orders: ${err.message}. Is Supabase running (supabase functions serve)?`;
  }
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersBody.innerHTML = "";
    ordersEmpty.hidden = false;
    return;
  }

  ordersEmpty.hidden = true;
  ordersBody.innerHTML = orders
    .map(
      (o) => `
    <tr>
      <td><a class="order-link" href="order.html?id=${encodeURIComponent(o.id)}">${escapeHtml(o.external_ref ?? o.id.slice(0, 8))}</a></td>
      <td><span class="status-pill status-${o.status}">${statusLabel(o.status)}</span></td>
      <td>${formatDate(o.created_at)}</td>
      <td>${formatDate(o.updated_at)}</td>
      <td class="actions-cell">
        <a class="btn btn-sm" href="order.html?id=${encodeURIComponent(o.id)}">Details</a>
        ${
          o.status === "solved"
            ? `<a class="btn btn-sm primary-btn" href="${visualizePageUrl(o.id)}">View in 3D</a>`
            : ""
        }
      </td>
    </tr>`,
    )
    .join("");
}

function showImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.className = isError ? "import-status error" : "import-status";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}*/

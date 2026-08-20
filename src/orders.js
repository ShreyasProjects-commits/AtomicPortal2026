import { API_BASE, formatDate, statusLabel, visualizePageUrl } from "./config.js";

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
      <td><a class="order-link" href="order?id=${encodeURIComponent(o.id)}">${escapeHtml(o.external_ref ?? o.id.slice(0, 8))}</a></td>
      <td><span class="status-pill status-${o.status}">${statusLabel(o.status)}</span></td>
      <td>${formatDate(o.created_at)}</td>
      <td>${formatDate(o.updated_at)}</td>
      <td class="actions-cell">
        <a class="btn btn-sm" href="order?id=${encodeURIComponent(o.id)}">Details</a>
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
}

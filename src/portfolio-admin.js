import { API_BASE } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const loadError = document.getElementById("load-error");
const totalsPanel = document.getElementById("totals-panel");
const workersPanel = document.getElementById("workers-panel");
const workersBody = document.getElementById("workers-body");

let myUserId = null;

async function authHeaders() {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function init() {
  const auth = await requireRole(["admin"]);
  if (!auth) return;
  myUserId = auth.user.id;
  await load();
}
init();

async function load() {
  try {
    const res = await fetch(`${API_BASE}/worker-stats?scope=admin`, {
      headers: await authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    render(data);
  } catch (err) {
    loadError.hidden = false;
    loadError.textContent = `Could not load stats: ${err.message}`;
  }
}

function render(data) {
  totalsPanel.hidden = false;
  workersPanel.hidden = false;

  document.getElementById("stat-total-orders").textContent = data.totals.total_orders;
  document.getElementById("stat-solved").textContent = data.totals.by_status.solved;
  document.getElementById("stat-unassigned").textContent = data.totals.unassigned_count;
  document.getElementById("stat-workers").textContent = data.totals.total_workers;
  document.getElementById("status-breakdown").textContent =
    `Draft: ${data.totals.by_status.draft} · Submitted: ${data.totals.by_status.submitted} · ` +
    `Solved: ${data.totals.by_status.solved} · Failed: ${data.totals.by_status.failed}`;

  workersBody.innerHTML = data.workers.length
    ? data.workers.map(renderWorkerRow).join("")
    : `<tr><td colspan="8" class="muted-cell">No warehouse workers yet.</td></tr>`;

  workersBody.querySelectorAll(".toggle-active").forEach((btn) => {
    btn.addEventListener("click", () => setActive(btn.dataset.userId, btn.dataset.next === "true"));
  });
}

function renderWorkerRow(w) {
  const isMe = w.id === myUserId;
  return `
    <tr>
      <td>${esc(w.first_name)} ${esc(w.last_name)}${isMe ? " (you)" : ""}</td>
      <td>Warehouse worker</td>
      <td>${w.active ? "Yes" : "No"}</td>
      <td>${w.assigned_count}</td>
      <td>${w.open_count}</td>
      <td>${w.completed_count}</td>
      <td>${w.days_worked}</td>
      <td>
        ${
          isMe
            ? ""
            : `<button type="button" class="btn btn-sm toggle-active" data-user-id="${w.id}" data-next="${!w.active}">
                ${w.active ? "Disable" : "Enable"}
              </button>`
        }
      </td>
    </tr>`;
}

async function setActive(userId, nextActive) {
  try {
    const res = await fetch(`${API_BASE}/assign-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "set_active", userId, active: nextActive }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    await load();
  } catch (err) {
    alert(`Could not update that account: ${err.message}`);
  }
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
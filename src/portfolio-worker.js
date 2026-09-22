import { API_BASE } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const loadError = document.getElementById("load-error");
const statsPanel = document.getElementById("stats-panel");

async function init() {
  const auth = await requireRole(["warehouse_worker"]);
  if (!auth) return;

  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}/worker-stats`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    render(data);
  } catch (err) {
    loadError.hidden = false;
    loadError.textContent = `Could not load your stats: ${err.message}`;
  }
}
init();

function render(stats) {
  statsPanel.hidden = false;
  document.getElementById("stat-assigned").textContent = stats.assigned_count;
  document.getElementById("stat-open").textContent = stats.open_count;
  document.getElementById("stat-completed").textContent = stats.completed_count;
  document.getElementById("stat-days").textContent = stats.days_worked;
}
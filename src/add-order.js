import { API_BASE } from "./config.js";
import { requireRole, getAccessToken } from "./authz.js";

const loadError = document.getElementById("load-error");
const form = document.getElementById("add-order-form");
const itemsPicker = document.getElementById("items-picker");
const containersPicker = document.getElementById("containers-picker");
const externalRefInput = document.getElementById("external-ref");
const formError = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");

async function authHeaders() {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function init() {
  const auth = await requireRole(["admin"]);
  if (!auth) return;

  try {
    const res = await fetch(`${API_BASE}/catalog`, { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    renderCatalog(data.items ?? [], data.containers ?? []);
    form.hidden = false;
  } catch (err) {
    loadError.hidden = false;
    loadError.textContent = `Could not load the item/container catalog: ${err.message}`;
  }
}
init();

function renderCatalog(items, containers) {
  if (!items.length || !containers.length) {
    loadError.hidden = false;
    loadError.textContent =
      "The catalog has no items or no containers yet — import a CSV first so there's something to pick from.";
    return;
  }

  itemsPicker.innerHTML = items
    .map(
      (it) => `
    <tr>
      <td><input type="checkbox" class="item-check" value="${it.id}" /></td>
      <td>${esc(it.name)}</td>
      <td>${it.length_cm} × ${it.width_cm} × ${it.height_cm}</td>
      <td>${it.weight_kg}</td>
      <td><input type="number" class="qty-input item-qty" min="1" value="1" data-item-id="${it.id}" /></td>
    </tr>`,
    )
    .join("");

  containersPicker.innerHTML = containers
    .map(
      (c) => `
    <tr>
      <td><input type="checkbox" class="container-check" value="${c.id}" /></td>
      <td>${esc(c.name)}</td>
      <td>${c.length_cm} × ${c.width_cm} × ${c.height_cm}</td>
      <td>${c.max_weight_kg}</td>
    </tr>`,
    )
    .join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const items = [...itemsPicker.querySelectorAll(".item-check:checked")].map((cb) => {
    const qtyInput = itemsPicker.querySelector(`.item-qty[data-item-id="${cb.value}"]`);
    return { itemId: cb.value, quantity: Number(qtyInput?.value) || 1 };
  });
  const containers = [...containersPicker.querySelectorAll(".container-check:checked")].map(
    (cb) => ({ containerId: cb.value }),
  );

  if (!items.length || !containers.length) {
    formError.hidden = false;
    formError.textContent = "Pick at least one item and one container.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating…";
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({
        external_ref: externalRefInput.value.trim() || null,
        items,
        containers,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);

    // Straight to the order detail page — admin can run the optimiser and
    // assign a worker from there.
    window.location.href = `order.html?id=${encodeURIComponent(data.id)}`;
  } catch (err) {
    formError.hidden = false;
    formError.textContent = `Could not create order: ${err.message}`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Create order";
  }
});

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
// FitPortal — order console (Sprint 1 happy-path skeleton).
// Builds an /optimize request from the form and posts it to the Edge Function.
// Endpoint is read from a build-time env var; falls back to the local functions server.

const OPTIMIZE_URL =
  import.meta.env?.VITE_OPTIMIZE_URL ?? "http://localhost:54321/functions/v1/optimize";

const itemsList = document.getElementById("items-list");
const containersList = document.getElementById("containers-list");
const form = document.getElementById("order-form");
const resultPanel = document.getElementById("result-panel");
const resultEl = document.getElementById("result");

// --- Row templates ---------------------------------------------------------

function itemRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <input name="name" placeholder="Item name" required />
    <input name="length" type="number" min="1" step="any" placeholder="L (cm)" required />
    <input name="width"  type="number" min="1" step="any" placeholder="W (cm)" required />
    <input name="height" type="number" min="1" step="any" placeholder="H (cm)" required />
    <input name="weight" type="number" min="0" step="any" placeholder="kg" required />
    <input name="quantity" type="number" min="1" step="1" value="1" required />
    <button type="button" class="remove">&times;</button>`;
  row.querySelector(".remove").onclick = () => row.remove();
  return row;
}

function containerRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <input name="name" placeholder="Container name" required />
    <input name="length" type="number" min="1" step="any" placeholder="L (cm)" required />
    <input name="width"  type="number" min="1" step="any" placeholder="W (cm)" required />
    <input name="height" type="number" min="1" step="any" placeholder="H (cm)" required />
    <input name="maxWeight" type="number" min="1" step="any" placeholder="max kg" required />
    <button type="button" class="remove">&times;</button>`;
  row.querySelector(".remove").onclick = () => row.remove();
  return row;
}

// --- Wire up add buttons ---------------------------------------------------

document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.onclick = () => {
    if (btn.dataset.add === "items") itemsList.appendChild(itemRow());
    else containersList.appendChild(containerRow());
  };
});

// Start with one of each.
itemsList.appendChild(itemRow());
containersList.appendChild(containerRow());

// --- Build the /optimize payload -------------------------------------------

function readRows(container, mapper) {
  return [...container.querySelectorAll(".row")].map((row, i) => {
    const g = (n) => row.querySelector(`[name="${n}"]`).value;
    return mapper(g, i);
  });
}

function buildRequest() {
  return {
    orderId: `ord_${Date.now()}`,
    items: readRows(itemsList, (g, i) => ({
      id: `item_${i + 1}`,
      name: g("name"),
      dimensions: {
        length: +g("length"),
        width: +g("width"),
        height: +g("height"),
        unit: "cm",
      },
      weight: { value: +g("weight"), unit: "kg" },
      quantity: +g("quantity"),
    })),
    containers: readRows(containersList, (g, i) => ({
      id: `cont_${i + 1}`,
      name: g("name"),
      dimensions: {
        length: +g("length"),
        width: +g("width"),
        height: +g("height"),
        unit: "cm",
      },
      maxWeight: { value: +g("maxWeight"), unit: "kg" },
    })),
  };
}

// --- Submit ----------------------------------------------------------------

form.onsubmit = async (e) => {
  e.preventDefault();
  resultPanel.hidden = false;
  resultEl.textContent = "Submitting…";

  try {
    const res = await fetch(OPTIMIZE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    resultEl.textContent = JSON.stringify(data, null, 2);
    // TODO: forward result to FitVisualizer for rendering.
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
};

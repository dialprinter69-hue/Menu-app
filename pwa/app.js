/**
 * Keep in sync with Android `strings.xml` for WhatsApp, menu URL, and pricing.
 */
const CONFIG = {
  remoteMenuJsonUrl:
    "https://raw.githubusercontent.com/dialprinter69-hue/delicia-menu/refs/heads/main/menu.json",
  restaurantWhatsappE164: "19785027983",
  cashAppTag: "$Aleshkamatos6",
  drinkUnitPrice: 2.0,
  deliveryFee: 4.0,
  freeDrinkItemIds: new Set(["dish-arroz-pernil-coditos"]),
};

const DRINK_LABELS = ["Coca Cola", "Fanta", "Sprite", "Diet Coke", "Agua"];

const state = {
  menu: [],
  cart: new Map(),
  drinks: Object.fromEntries(DRINK_LABELS.map((d) => [d, 0])),
  delivery: false,
  paymentCashApp: false,
  loadError: null,
};

const $ = (sel, root = document) => root.querySelector(sel);

function parsePriceToDouble(raw) {
  const normalized = String(raw)
    .replace(/,/g, ".")
    .replace(/[^0-9.]/g, "");
  return parseFloat(normalized) || 0;
}

function loadState() {
  try {
    const raw = sessionStorage.getItem("delicias_pwa_state");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.cart && typeof data.cart === "object") {
      state.cart = new Map(Object.entries(data.cart).map(([k, v]) => [k, Number(v) || 0]));
    }
    if (data.drinks && typeof data.drinks === "object") {
      for (const d of DRINK_LABELS) {
        if (typeof data.drinks[d] === "number") state.drinks[d] = data.drinks[d];
      }
    }
    if (typeof data.delivery === "boolean") state.delivery = data.delivery;
    if (typeof data.paymentCashApp === "boolean") state.paymentCashApp = data.paymentCashApp;
  } catch {
    /* ignore */
  }
}

function saveState() {
  const data = {
    cart: Object.fromEntries(state.cart),
    drinks: { ...state.drinks },
    delivery: state.delivery,
    paymentCashApp: state.paymentCashApp,
  };
  sessionStorage.setItem("delicias_pwa_state", JSON.stringify(data));
}

function defaultMenu() {
  return [
    {
      id: "local-1",
      name: "Arroz con gandules y pernil",
      description: "Sazon casero (sin conexión al menú remoto).",
      price: "$16",
      imageUrl: null,
    },
  ];
}

async function fetchMenu() {
  state.loadError = null;
  const url = CONFIG.remoteMenuJsonUrl.trim();
  if (!url) {
    state.menu = defaultMenu();
    return;
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error("Menú vacío");
    state.menu = list;
  } catch (e) {
    state.loadError = "No se pudo cargar el menú en línea. Mostrando respaldo o última copia.";
    if (state.menu.length === 0) state.menu = defaultMenu();
  }
}

function itemById(id) {
  return state.menu.find((m) => m.id === id);
}

function calculateCartTotal() {
  let sum = 0;
  for (const [id, qty] of state.cart) {
    const item = itemById(id);
    if (!item || qty <= 0) continue;
    sum += parsePriceToDouble(item.price) * qty;
  }
  return sum;
}

function includedDrinkQty() {
  let n = 0;
  for (const [id, qty] of state.cart) {
    const item = itemById(id);
    if (!item || qty <= 0) continue;
    const byId = CONFIG.freeDrinkItemIds.has(id);
    const byDesc = /incluye bebida/i.test(item.description || "");
    if (byId || byDesc) n += qty;
  }
  return n;
}

function calculateDrinksTotal() {
  const selected = DRINK_LABELS.reduce((s, d) => s + (state.drinks[d] || 0), 0);
  const billable = Math.max(0, selected - includedDrinkQty());
  return CONFIG.drinkUnitPrice * billable;
}

function calculateDeliveryFee() {
  return state.delivery ? CONFIG.deliveryFee : 0;
}

function calculateOrderTotal() {
  return calculateCartTotal() + calculateDrinksTotal() + calculateDeliveryFee();
}

function cartCount() {
  let n = 0;
  for (const q of state.cart.values()) n += q;
  return n;
}

function setQty(id, qty) {
  if (qty <= 0) state.cart.delete(id);
  else state.cart.set(id, qty);
  saveState();
  render();
}

function addToCart(id) {
  const cur = state.cart.get(id) || 0;
  state.cart.set(id, cur + 1);
  saveState();
  render();
}

function renderMenu() {
  const list = $("#menu-list");
  if (!list) return;
  list.innerHTML = "";
  if (state.menu.length === 0) {
    list.innerHTML = '<p class="empty-hint">No hay platos para mostrar.</p>';
    return;
  }
  for (const item of state.menu) {
    const card = document.createElement("article");
    card.className = "menu-card";
    let img;
    if (item.imageUrl) {
      img = document.createElement("img");
      img.className = "menu-card-img";
      img.alt = "";
      img.src = item.imageUrl;
      img.loading = "lazy";
    } else {
      img = document.createElement("div");
      img.className = "menu-card-img";
      img.setAttribute("role", "presentation");
      img.style.background = "linear-gradient(145deg,#1E3D2F,#2D5A45)";
    }
    const body = document.createElement("div");
    body.className = "menu-card-body";
    body.innerHTML = `
      <h3></h3>
      <p class="desc"></p>
      <div class="menu-card-footer">
        <span class="price"></span>
        <button type="button" class="btn btn-primary btn-add" data-id="">Agregar</button>
      </div>
    `;
    body.querySelector("h3").textContent = item.name;
    body.querySelector(".desc").textContent = item.description || "";
    const priceEl = body.querySelector(".price");
    priceEl.textContent = item.price;
    const addBtn = body.querySelector(".btn-add");
    addBtn.dataset.id = item.id;
    addBtn.addEventListener("click", () => addToCart(item.id));
    card.append(img, body);
    list.appendChild(card);
  }
}

function renderOrder() {
  const linesEl = $("#order-lines");
  const summaryEl = $("#order-summary");
  const fab = $("#fab-order");
  if (!linesEl || !summaryEl) return;

  linesEl.innerHTML = "";
  const qtyById = Object.fromEntries(state.cart);

  for (const item of state.menu) {
    const qty = qtyById[item.id] || 0;
    if (qty <= 0) continue;
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = `${qty}× ${item.name}`;
    const controls = document.createElement("div");
    controls.className = "qty-controls";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.addEventListener("click", () => setQty(item.id, qty - 1));
    const num = document.createElement("span");
    num.textContent = String(qty);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => setQty(item.id, qty + 1));
    controls.append(minus, num, plus);
    li.append(left, controls);
    linesEl.appendChild(li);
  }

  if (linesEl.children.length === 0) {
    linesEl.innerHTML = '<li class="empty-hint">Agrega platos al pedido desde el menú.</li>';
  }

  const count = cartCount();
  const total = calculateOrderTotal();
  if (count === 0) {
    summaryEl.textContent = "Agrega platos al pedido desde el menú.";
  } else {
    summaryEl.textContent = `${count} plato(s) en el pedido · Total: $${total.toFixed(2)}`;
  }
  if (fab) fab.disabled = count === 0;

  const delSwitch = $("#delivery-switch");
  if (delSwitch) delSwitch.checked = state.delivery;
  const payCash = $("#pay-cash");
  const payCa = $("#pay-cashapp");
  if (payCash) payCash.checked = !state.paymentCashApp;
  if (payCa) payCa.checked = state.paymentCashApp;

  for (const d of DRINK_LABELS) {
    const el = document.querySelector(`[data-drink-qty="${CSS.escape(d)}"]`);
    if (el) el.textContent = String(state.drinks[d] || 0);
  }
}

function render() {
  const err = $("#load-error");
  if (err) {
    err.hidden = !state.loadError;
    err.textContent = state.loadError || "";
  }
  renderMenu();
  renderOrder();
}

function setupForm() {
  $("#delivery-switch")?.addEventListener("change", (e) => {
    state.delivery = e.target.checked;
    saveState();
    renderOrder();
  });
  $("#pay-cash")?.addEventListener("change", () => {
    state.paymentCashApp = false;
    saveState();
    renderOrder();
  });
  $("#pay-cashapp")?.addEventListener("change", () => {
    state.paymentCashApp = true;
    saveState();
    renderOrder();
  });

  for (const d of DRINK_LABELS) {
    document.querySelector(`[data-drink-plus="${CSS.escape(d)}"]`)?.addEventListener("click", () => {
      state.drinks[d] = (state.drinks[d] || 0) + 1;
      saveState();
      renderOrder();
    });
    document.querySelector(`[data-drink-minus="${CSS.escape(d)}"]`)?.addEventListener("click", () => {
      state.drinks[d] = Math.max(0, (state.drinks[d] || 0) - 1);
      saveState();
      renderOrder();
    });
  }

  $("#btn-refresh-menu")?.addEventListener("click", async () => {
    await fetchMenu();
    render();
  });

  $("#fab-order")?.addEventListener("click", () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth" });
  });

  $("#submit-order")?.addEventListener("click", submitOrder);
}

function selectedDrinksList() {
  return DRINK_LABELS.filter((d) => (state.drinks[d] || 0) > 0).map((d) => `${state.drinks[d]}× ${d}`);
}

function submitOrder() {
  const name = $("#customer-name")?.value?.trim() || "";
  const phone = $("#customer-phone")?.value?.trim() || "";
  const town = $("#customer-town")?.value?.trim() || "";
  if (!name || !phone || !town) {
    alert("Completa nombre, teléfono y pueblo.");
    return;
  }
  if (cartCount() === 0) {
    alert("Agrega al menos un plato al pedido.");
    return;
  }

  const paymentMethod = state.paymentCashApp ? "Cash App" : "Efectivo";
  const drinks = selectedDrinksList();
  const fmt = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  const linesSnapshot = [...state.cart.entries()].filter(([, q]) => q > 0);

  let text = "";
  text += "===== Pedido Delicia =====\n";
  text += `Fecha: ${fmt}\n`;
  text += `Cliente: ${name}\n`;
  text += `Teléfono: ${phone}\n`;
  text += `Pueblo: ${town}\n`;
  text += `Delivery: ${state.delivery ? "Sí" : "No (recoge en local)"}\n`;
  text += `Pago: ${paymentMethod}\n`;
  if (state.paymentCashApp && CONFIG.cashAppTag.trim()) {
    text += `Cash App: ${CONFIG.cashAppTag}\n`;
  }
  text += `Bebidas: ${drinks.length ? drinks.join(", ") : "Ninguna"}\n`;
  text += "--- Platos ---\n";
  for (const [id, qty] of linesSnapshot) {
    const item = itemById(id);
    if (!item) continue;
    const unit = parsePriceToDouble(item.price);
    text += `${qty}× ${item.name} @ ${item.price} = $${(unit * qty).toFixed(2)}\n`;
  }
  const drinksTotal = calculateDrinksTotal();
  if (drinks.length) text += `Total bebidas: $${drinksTotal.toFixed(2)}\n`;
  const delFee = calculateDeliveryFee();
  if (delFee > 0) text += `Cargo delivery: $${delFee.toFixed(2)}\n`;
  const total = calculateOrderTotal();
  text += `Total: $${total.toFixed(2)}\n`;
  text += "==========================\n";

  const businessPhone = CONFIG.restaurantWhatsappE164.replace(/\D/g, "");
  if (businessPhone.length < 10) {
    alert("Configura el WhatsApp del negocio en app.js (restaurantWhatsappE164).");
    return;
  }

  const wa = `https://wa.me/${businessPhone}?text=${encodeURIComponent(text)}`;
  window.open(wa, "_blank", "noopener,noreferrer");

  if (state.paymentCashApp) {
    const tag = CONFIG.cashAppTag.trim().replace(/^\$/, "");
    if (tag) {
      const cashUrl = `https://cash.app/$${tag}/${total.toFixed(2)}`;
      window.open(cashUrl, "_blank", "noopener,noreferrer");
    }
  }

  state.cart = new Map();
  for (const d of DRINK_LABELS) state.drinks[d] = 0;
  state.delivery = false;
  state.paymentCashApp = false;
  saveState();
  alert("Listo. Envía el mensaje en WhatsApp para confirmar el pedido.");
  render();
}

async function init() {
  loadState();
  setupForm();
  await fetchMenu();
  render();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch {
      /* localhost file:// or blocked */
    }
  }
}

init();

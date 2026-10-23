import { svg } from "./icons.js";
import {
  currencies,
  cents,
  cashTenderSummary,
  parseTenderAmount,
} from "./money.js";
import { t, lang, setLanguage, errorText } from "./i18n.js";

const staticSite = window.ONLY_STATIC_SITE === true;
const $ = (s, c = document) => c.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const app = $("#app"),
  dialog = $("#dialog");
let data = null,
  authTab = "login",
  mode = "pos",
  view = "reports",
  publicMode = "",
  publicKey = "",
  activeCategory = "",
  query = "",
  cart = [],
  posCurrency = "BRL",
  wholesale = false,
  orderId = null,
  installPrompt = null,
  busy = false,
  lastReceipt = null,
  reportFrom = localDay(new Date()),
  reportTo = localDay(new Date());
let mobileView = "products";
let selectedRegister = "",
  pendingSale = null,
  lastOrderCount = 0;
try {
  pendingSale = JSON.parse(
    sessionStorage.getItem("only.pendingSale") || "null",
  );
} catch {}
const path = location.pathname.split("/").filter(Boolean);
if (["store", "mobile", "collaborate"].includes(path[0]))
  [publicMode, publicKey] = path;
const money = (n, c = posCurrency) =>
  new Intl.NumberFormat({ pt: "pt-BR", es: "es-BO", en: "en-US" }[lang()], {
    style: "currency",
    currency: c,
  }).format(Number(n || 0) / 100);
const num = (n) =>
  new Intl.NumberFormat({ pt: "pt-BR", es: "es-BO", en: "en-US" }[lang()], {
    maximumFractionDigits: 3,
  }).format(Number(n || 0));
const date = (v) =>
  new Date(v).toLocaleString({ pt: "pt-BR", es: "es-BO", en: "en-US" }[lang()]);
const opts = (values, selected) =>
  values
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
const currencyOptions = (c) =>
  opts(
    currencies.map((c) => [
      c,
      {
        BRL: "R$ · Real",
        BOB: "Bs · Boliviano",
        USD: "US$ · Dollar",
        EUR: "€ · Euro",
      }[c],
    ]),
    c,
  );
const btn = (action, label, icon = "", cls = "", extra = "") =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${icon ? svg(icon) : ""}<span>${esc(label)}</span></button>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const select = (label, name, options, extra = "") =>
  `<label class="field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options}</select></label>`;
const check = (name, label, on = false) =>
  `<label class="toggle"><input type="checkbox" name="${name}" ${on ? "checked" : ""}><span>${esc(label)}</span></label>`;
const empty = (title, hint = "", icon = "box", action = "") =>
  `<div class="empty">${svg(icon)}<h3>${esc(title)}</h3>${hint ? `<p>${esc(hint)}</p>` : ""}${action}</div>`;
const toast = (message, error = false) => {
  const el = $("#toast");
  el.textContent = message;
  el.className = error ? "show error" : "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ""), 4500);
};
const api = async (path, body) => {
  if (staticSite) throw Error("serverNotConfigured");
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Only-Request": "1" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw Error("offline");
  }
  const json = await response.json().catch(() => ({ error: "serverError" }));
  if (!response.ok) throw Error(json.error || "serverError");
  return json;
};
const notifyError = (e) => {
  const key = e.message || e;
  const message = key === "offline" ? t("offline") : errorText(key);
  const error = $("[data-form-error]", dialog);
  if (dialog.open && error) {
    error.textContent = message;
    error.hidden = false;
  } else toast(message, true);
};
const settings = () => data?.business || {};
const isOwner = () => data?.user?.role === "owner";
const currentRegister = () =>
  data?.registers?.find((r) => r.id === selectedRegister && !r.closed);
const canUseRegister = (r) =>
  !r.closed && (isOwner() || r.user === data.user.id);
const publicPath = () =>
  `/api/public/${publicMode}/${encodeURIComponent(publicKey)}`;
const productPrice = (p) =>
  wholesale
    ? (p.wholesale?.[posCurrency] ?? p.prices[posCurrency])
    : p.prices[posCurrency];
const cartLines = () =>
  cart
    .map((i) => {
      const p = data.products.find((p) => p.id === i.id);
      return p
        ? {
            ...i,
            p,
            price: productPrice(p),
            total: Math.round((productPrice(p) || 0) * i.quantity),
          }
        : null;
    })
    .filter(Boolean);
const subtotal = () => cartLines().reduce((n, i) => n + i.total, 0);
const pendingForBusiness = () =>
  pendingSale && pendingSale.business === data?.user?.business;
function theme() {
  document.documentElement.dataset.mobileView =
    !publicMode && settings().showCatalog === false ? "cart" : mobileView;
  document.documentElement.dataset.theme = settings().theme || "dark";
  document.documentElement.dataset.layout = settings().layout || "clean";
  document.documentElement.dataset.menu = settings().menuPosition || "top";
  document.title = `${settings().name || "ONLY"} · ONLY`;
}
function brand() {
  return `<div class="brand">${settings().logo ? `<img src="${esc(settings().logo)}" alt="${esc(settings().name)}">` : `<span class="wordmark">only<i>®</i></span>`}<div class="brand-divider"></div><div class="company"><strong>${esc(settings().name || "ONLY")}</strong><small>${publicMode ? t(publicMode === "store" ? "catalog" : "mobile") : mode === "pos" ? t("pos") : t("erp")}</small></div></div>`;
}
const languagePicker = () =>
  `<select data-language aria-label="${t("language")}" class="language-select">${opts(
    [
      ["pt", "PT"],
      ["es", "ES"],
      ["en", "EN"],
    ],
    lang(),
  )}</select>`;
function header() {
  const reg = currentRegister();
  return `<header class="topbar">${brand()}<div class="top-actions"><span class="connection ${navigator.onLine ? "" : "offline"}"><i></i>${t(navigator.onLine ? "online" : "offline")}</span>${languagePicker()}${publicMode ? "" : `${btn("register", reg ? reg.name : t("openRegister"), "wallet", reg ? "soft" : "")} ${mode === "erp" ? btn("pos", t("pos"), "cart", "primary") : ""}${btn("menu", t("menu"), "menu", "menu-button")}`}</div></header>`;
}
function auth() {
  app.innerHTML = `<div class="auth-shell"><aside class="auth-visual"><span class="wordmark">only<i>®</i></span><div><small>PDV + ERP</small><h1>${esc(t("loginPitch")).replace("\n", "<br>")}</h1><p>${t("loginHint")}</p><div class="auth-pills"><span>${svg("cart")} ${t("pos")}</span><span>${svg("store")} ${t("catalog")}</span><span>${svg("chart")} ${t("reports")}</span></div></div><footer>onlysystem · 2026</footer><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div></aside><section class="auth-panel"><div class="auth-top">${languagePicker()}${btn("join", t("join"), "smartphone")}</div><div class="auth-form"><span class="eyebrow">ONLY SYSTEM</span><h2>${t(authTab === "login" ? "loginTitle" : "signup")}</h2><p>${t(authTab === "login" ? "loginHint" : "signupHint")}</p><div class="segmented">${btn("auth-login", t("login"), "", "", `aria-pressed="${authTab === "login"}"`)}${btn("auth-signup", t("signup"), "", "", `aria-pressed="${authTab === "signup"}"`)}</div><form data-form="${authTab}">${authTab === "signup" ? field(t("name"), "name", "", "text", 'required autocomplete="name"') + field(t("businessName"), "businessName", "", "text", 'required autocomplete="organization"') : ""}${field(t("email"), "email", "", "email", 'required autocomplete="username"')}${field(t("password"), "password", "", "password", `required minlength="8" maxlength="128" autocomplete="${authTab === "signup" ? "new-password" : "current-password"}"`)}<p class="form-error" data-inline-error hidden></p><button class="btn primary wide" type="submit">${t(authTab === "login" ? "login" : "signup")}${svg("chevron")}</button></form></div><small class="auth-foot">ONLY · PDV & ERP</small></section></div>`;
  if (staticSite) {
    $(".auth-form > p").insertAdjacentHTML("afterend", `<p class="notice" role="status">${t("serverConnectionNeeded")}</p>`);
    $("[data-action=join]").hidden = true;
    document.querySelectorAll(".auth-form form input, .auth-form form button[type=submit]").forEach(el => el.disabled = true);
  }

}
function render() {
  if (!data) return auth();
  theme();
  if (publicMode === "collaborate") {
    renderCollaborate();
    return;
  }
  app.innerHTML =
    header() +
    (!navigator.onLine
      ? `<div class="offline-banner">${t("offline")}</div>`
      : "") +
    (publicMode || mode === "pos" ? pos() : erp());
}
function catalogProducts() {
  return data.products.filter(
    (p) =>
      p.active !== false &&
      p.prices[posCurrency] != null &&
      (!activeCategory || p.category === activeCategory) &&
      (!query ||
        `${p.name} ${p.code} ${p.category}`
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase()
          .includes(
            query
              .normalize("NFD")
              .replace(/\p{Diacritic}/gu, "")
              .toLowerCase(),
          )),
  );
}
function cards() {
  const products = catalogProducts();
  return products.length
    ? products
        .map(
          (p, index) =>
            `<button class="product-card" data-add="${esc(p.id)}" ${p.trackStock && p.stock <= 0 ? "disabled" : ""}><span class="product-visual hue-${index % 4}">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : svg("box")}<span class="product-code">${esc(p.code)}</span>${p.trackStock ? `<small class="stock-pill ${p.stock <= p.minStock ? "warning" : ""}">${num(p.stock)} ${esc(p.unit || "un")}</small>` : ""}</span><span class="product-info"><small>${esc(p.category || t("general"))}</small><strong>${esc(p.name)}</strong><span><b>${money(productPrice(p))}</b><i>${svg("plus")}</i></span></span></button>`,
        )
        .join("")
    : empty(
        t("emptyProducts"),
        publicMode ? "" : t("emptyProductsHint"),
        "box",
        !publicMode && isOwner()
          ? btn("new-product", t("newProduct"), "plus", "primary")
          : "",
      );
}
function cartMarkup() {
  const lines = cartLines();
  return lines.length
    ? lines
        .map(
          (i) =>
            `<article class="cart-line"><div class="cart-line-icon">${i.p.image ? `<img src="${esc(i.p.image)}" alt="">` : svg("box")}</div><div class="cart-item-copy"><strong>${esc(i.p.name)}</strong><small>${money(i.price)} · ${esc(i.p.code)}</small><div class="stepper"><button type="button" data-quantity="${esc(i.id)}" data-delta="-1" aria-label="−">−</button><input data-cart-quantity="${esc(i.id)}" aria-label="${t("quantity")} ${esc(i.p.name)}" inputmode="decimal" value="${esc(lang() === "en" ? i.quantity : String(i.quantity).replace(".", ","))}"><button type="button" data-quantity="${esc(i.id)}" data-delta="1" aria-label="+">+</button></div></div><div class="cart-line-end"><button type="button" data-remove="${esc(i.id)}" class="icon-button" aria-label="${t("remove")}">${svg("close")}</button><b>${money(i.total)}</b></div></article>`,
        )
        .join("")
    : empty(t("emptyCart"), t("emptyCartHint"), "cart");
}
function pos() {
  const categories = [
      ...new Set(
        data.products
          .filter((p) => p.active !== false)
          .map((p) => p.category)
          .filter(Boolean),
      ),
    ],
    reg = currentRegister(),
    sum = subtotal();
  const show = publicMode || settings().showCatalog !== false;
  return `<div class="pos-shell ${show ? "" : "no-catalog"}"><section class="catalog-area"><div class="section-title"><div><span class="eyebrow">${publicMode ? esc(settings().name) : "ONLY POINT OF SALE"}</span><h1>${t(publicMode === "store" ? "catalog" : publicMode ? "mobile" : "pos")}<span class="live-dot"></span></h1><p>${publicMode ? esc(settings().storeDescription || t("storeHint")) : t("noConversion")}</p></div>${!publicMode ? `<div class="pos-currency">${svg("globe")}<select data-pos-currency aria-label="${t("currency")}">${currencyOptions(posCurrency)}</select></div>` : ""}</div><div class="search-wrap">${svg("search")}<input id="search" autocomplete="off" placeholder="${t("search")}" aria-label="${t("search")}" value="${esc(query)}"><kbd>F2</kbd></div><div class="categories"><button data-category="" class="${!activeCategory ? "active" : ""}">${t("all")}</button>${categories.map((c) => `<button data-category="${esc(c)}" class="${c === activeCategory ? "active" : ""}">${esc(c)}</button>`).join("")}</div><div id="productGrid" class="product-grid">${cards()}</div><footer class="catalog-footer"><span>${num(catalogProducts().length)} ${t("products").toLowerCase()}</span>${!publicMode ? `<span>F2 · ${t("search").split(",")[0]}<i>F9 · ${t("checkout")}</i></span>` : ""}</footer></section><aside class="cart-panel"><div class="cart-heading"><div class="cart-title-icon">${svg("cart")}</div><div><h2>${t("cart")}</h2><small>${cart.length} ${t("products").toLowerCase()} ${orderId ? " · " + t("orders") : ""}</small></div>${cart.length ? btn("clear-cart", t("remove"), "trash", "text-button") : ""}</div>${!publicMode ? `<div class="client-select">${svg("users")}<select data-pos-client aria-label="${t("customer")}">${opts([["", t("finalCustomer")], ...data.clients.map((c) => [c.id, c.name])], pos.clientId)}</select>${btn("new-client", "+", "", "square")}</div>` : ""}<div id="cartItems" class="cart-items">${cartMarkup()}</div><div class="cart-bottom">${!publicMode ? `<div class="sale-options">${check("wholesale", t("wholesale"), wholesale)}${btn("sale-notes", t("notes"), "edit", "text-button")}</div>` : ""}<div class="total-row"><span>${t("subtotal")}</span><b id="cartSubtotal">${money(sum)}</b></div>${!publicMode ? `<label class="discount-row"><span>${t("discount")} (${posCurrency})</span><input id="discount" inputmode="decimal" value="${esc(pos.discount || "0")}" aria-label="${t("discount")}"></label>` : ""}<div class="grand-total"><span>${t("total")} <small>${posCurrency}</small></span><strong id="grandTotal">${money(Math.max(0, sum - cents(parseTenderAmount(pos.discount || 0) || 0)))}</strong></div>${pendingForBusiness() ? `<div class="notice">${t("retry")} · ${t("checkout")}</div>` : ""}<button type="button" class="btn primary checkout" data-action="${pendingForBusiness() ? "retry-sale" : publicMode ? "order-checkout" : "checkout"}" ${cart.length || pendingForBusiness() ? "" : "disabled"}>${svg(publicMode ? "check" : "card")}<span>${t(pendingForBusiness() ? "retry" : publicMode ? "makeOrder" : "checkout")}</span>${!publicMode ? "<kbd>F9</kbd>" : ""}</button><div class="cart-note">${publicMode ? t("orderDoneHint") : reg ? `${svg("wallet")} ${esc(reg.name)} · ${t("registerOpen")}` : t("checkoutHint")}</div></div></aside></div><nav class="mobile-pos-bar" aria-label="${t("pos")}">${btn("mobile-products", t("products"), "box", mobileView === "products" ? "active" : "", !show ? "disabled" : "")}${btn("mobile-cart", t("cart"), "cart", mobileView === "cart" ? "active" : "")}<strong data-mobile-total>${money(Math.max(0, sum - cents(parseTenderAmount(pos.discount || 0) || 0)))}</strong></nav>`;
}
const posState = { clientId: "", discount: "0", notes: "" };
Object.assign(pos, posState);
function updateCart() {
  if (!$("#cartItems")) return;
  $("#cartItems").innerHTML = cartMarkup();
  $("#cartSubtotal").textContent = money(subtotal());
  $("#grandTotal").textContent = money(
    Math.max(0, subtotal() - cents(parseTenderAmount(pos.discount || 0) || 0)),
  );
  $(".cart-heading small").textContent =
    `${cart.length} ${t("products").toLowerCase()}`;
  $(".checkout").disabled = !cart.length && !pendingForBusiness();
  if ($("[data-mobile-total]"))
    $("[data-mobile-total]").textContent = money(
      Math.max(
        0,
        subtotal() - cents(parseTenderAmount(pos.discount || 0) || 0),
      ),
    );
}
function addProduct(id) {
  const p = data.products.find((p) => p.id === id);
  if (!p || productPrice(p) == null)
    return toast(errorText("priceUnavailable"), true);
  const old = cart.find((i) => i.id === id),
    qty = (old?.quantity || 0) + 1;
  if (p.trackStock && qty > p.stock)
    return toast(errorText("insufficientStock"), true);
  if (old) old.quantity = qty;
  else cart.push({ id, quantity: 1 });
  updateCart();
}
const navItems = [
  ["reports", "chart"],
  ["products", "box"],
  ["orders", "receipt"],
  ["clients", "users"],
  ["cash", "wallet"],
  ["catalog", "store"],
  ["team", "badge"],
  ["settings", "settings"],
];
function erp() {
  const allowed = isOwner()
    ? navItems
    : navItems.filter(([k]) => !["settings", "team", "catalog"].includes(k));
  return `<div class="erp-shell"><nav class="erp-nav" aria-label="ERP">${allowed.map(([key, icon]) => `<button data-view="${key}" class="${view === key ? "active" : ""}">${svg(icon)}<span>${t(key)}</span>${key === "orders" ? `<b class="order-count">${data.orders.filter((o) => o.status === "new").length}</b>` : ""}</button>`).join("")}<div class="nav-bottom"><small>${esc(data.user.name)}</small>${btn("logout", t("logout"), "transfer", "text-button")}</div></nav><section class="erp-content">${erpPage()}</section></div>`;
}
function pageTitle(title, subtitle = "", actions = "") {
  return `<div class="page-title"><div><span class="eyebrow">ONLY BUSINESS</span><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
}
function table(headers, rows) {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : empty(t("noData"));
}
function erpPage() {
  if (view === "products") return productsPage();
  if (view === "reports") return reportsPage();
  if (view === "orders") return ordersPage();
  if (view === "cash") return cashPage();
  if (view === "clients") return clientsPage();
  if (view === "settings") return settingsPage();
  if (view === "catalog") return storePage();
  if (view === "team") return teamPage();
  return "";
}
function productsPage() {
  return (
    pageTitle(
      t("products"),
      t("pricesHint"),
      isOwner()
        ? btn("collaborate", t("collaboration"), "qr") +
            btn("new-product", t("newProduct"), "plus", "primary")
        : "",
    ) +
    (isOwner() && data.drafts.length
      ? `<section class="panel pending-panel"><h2>${t("pending")} <span class="badge">${data.drafts.length}</span></h2>${table(
          [t("code"), t("name"), t("price"), t("stock"), t("actions")],
          data.drafts.map((p) => [
            esc(p.code),
            esc(p.name),
            currencies
              .filter((c) => p.prices[c] != null)
              .map((c) => money(p.prices[c], c))
              .join(" · "),
            num(p.stock),
            btn(
              "approve",
              t("approve"),
              "check",
              "primary",
              `data-id="${p.id}"`,
            ) + btn("reject", t("reject"), "close", "", `data-id="${p.id}"`),
          ]),
        )}</section>`
      : "") +
    table(
      [
        t("products"),
        t("code"),
        t("category"),
        ...currencies,
        t("stock"),
        t("status"),
        t("actions"),
      ],
      data.products.map((p) => [
        `<strong>${esc(p.name)}</strong>`,
        esc(p.code),
        esc(p.category),
        ...currencies.map((c) =>
          p.prices[c] == null ? "—" : money(p.prices[c], c),
        ),
        p.trackStock
          ? `<span class="${p.stock <= p.minStock ? "warning-text" : ""}">${num(p.stock)}</span>`
          : "∞",
        `<span class="badge ${p.active ? "success" : ""}">${t(p.active ? "active" : "unavailable")}</span>`,
        isOwner()
          ? btn("edit-product", t("edit"), "edit", "small", `data-id="${p.id}"`)
          : "",
      ]),
    )
  );
}
function reportsData() {
  return data.sales.filter(
    (s) =>
      s.status !== "cancelled" &&
      localDay(s.date) >= reportFrom &&
      localDay(s.date) <= reportTo,
  );
}
function localDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function reportFilters() {
  return `<form class="filters" data-form="report-filter">${field(t("from"), "from", reportFrom, "date", "required")}${field(t("to"), "to", reportTo, "date", "required")}<button type="submit" class="btn">${svg("filter")}${t("filter")}</button></form>`;
}
function reportsPage() {
  const sales = reportsData();
  return (
    pageTitle(
      t("overview"),
      t("reportHint"),
      btn("export", t("exportCsv"), "download") +
        btn("print-report", t("printReport"), "receipt", "primary"),
    ) +
    reportFilters() +
    `<div class="metrics">${currencies
      .map((c) => {
        const rows = sales.filter((s) => s.currency === c),
          total = rows.reduce((n, s) => n + s.total, 0);
        return `<article class="metric"><div><span>${t("salesTotal")}</span><b>${c}</b></div><strong>${money(total, c)}</strong><p>${rows.length} ${t("sales").toLowerCase()} <span>${t("average")}: ${money(rows.length ? total / rows.length : 0, c)}</span></p><footer><span>${t("netReceived")} <b>${money(
          rows.reduce((n, s) => n + s.paid, 0),
          c,
        )}</b></span><span>${t("due")} <b>${money(
          rows.reduce((n, s) => n + (s.outstanding ?? s.due), 0),
          c,
        )}</b></span></footer></article>`;
      })
      .join(
        "",
      )}</div><section class="panel"><div class="panel-title"><h2>${t("sales")}</h2><span class="badge">${sales.length}</span></div>${table(
      [
        t("code"),
        t("date"),
        t("customer"),
        t("cash"),
        t("total"),
        t("received"),
        t("due"),
        t("actions"),
      ],
      sales.map((s) => [
        esc(s.number),
        date(s.date),
        esc(s.client?.name || t("finalCustomer")),
        esc(s.registerName),
        money(s.total, s.currency),
        money(s.paid, s.currency),
        money(s.outstanding ?? s.due, s.currency),
        btn("receipt", t("receipt"), "receipt", "small", `data-id="${s.id}"`) +
          (isOwner()
            ? btn(
                "cancel-sale",
                t("cancelSale"),
                "close",
                "small",
                `data-id="${s.id}"`,
              )
            : ""),
      ]),
    )}</section><section class="panel"><h2>${t("lowStock")}</h2>${table(
      [t("products"), t("stock"), t("minStock")],
      data.products
        .filter((p) => p.active && p.trackStock && p.stock <= p.minStock)
        .map((p) => [esc(p.name), num(p.stock), num(p.minStock)]),
    )}</section>`
  );
}
function ordersPage() {
  return (
    pageTitle(
      t("orders"),
      t("mobileHint"),
      btn("refresh", t("refresh"), "transfer") +
        btn("mobile", t("mobile"), "smartphone"),
    ) +
    `<div class="order-grid">${data.orders.length ? data.orders.map((o) => `<article class="order-card"><header><strong>${esc(o.number)}</strong><span class="badge ${o.status === "new" ? "purple" : o.status === "completed" ? "success" : ""}">${t(o.status)}</span></header><h3>${esc(o.customer)}</h3><p>${esc(o.phone)} ${o.table ? " · " + esc(o.table) : ""}</p><small>${date(o.date)} · ${t(o.channel === "store" ? "catalog" : "mobile")}</small><ul>${o.items.map((i) => `<li><span>${num(i.quantity)} × ${esc(i.name)}</span><b>${money(i.total, o.currency)}</b></li>`).join("")}</ul>${o.address ? `<p>${svg("store")} ${esc(o.address)}</p>` : ""}${o.notes ? `<p>${esc(o.notes)}</p>` : ""}<div class="total-row"><span>${t("total")}</span><strong>${money(o.total, o.currency)}</strong></div>${["new", "accepted"].includes(o.status) ? `<footer>${o.status === "new" ? btn("accept-order", t("accept"), "check", "", `data-id="${o.id}"`) : ""}${btn("import-order", t("importOrder"), "cart", "primary", `data-id="${o.id}"`)}${btn("cancel-order", t("cancelOrder"), "close", "text-button", `data-id="${o.id}"`)}</footer>` : ""}</article>`).join("") : empty(t("noData"), t("storeHint"), "receipt")}</div>`
  );
}
function cashPage() {
  return (
    pageTitle(
      t("cash"),
      t("printCash"),
      btn("register", t("openRegister"), "plus", "primary") +
        btn("movement", t("movement"), "transfer") +
        btn("print-cash", t("printReport"), "receipt"),
    ) +
    table(
      [
        t("cash"),
        t("currency"),
        t("opening"),
        t("expected"),
        t("counted"),
        t("difference"),
        t("date"),
        t("status"),
        t("actions"),
      ],
      data.registers.map((r) => [
        esc(r.name),
        esc(r.currency),
        money(r.opening, r.currency),
        money(r.expected, r.currency),
        r.closed ? money(r.counted, r.currency) : "—",
        r.closed ? money(r.counted - r.expected, r.currency) : "—",
        date(r.opened) + (r.closed ? "<br>" + date(r.closed) : ""),
        `<span class="badge ${r.closed ? "" : "success"}">${t(r.closed ? "registerClosed" : "registerOpen")}</span>`,
        canUseRegister(r)
          ? btn(
              "select-register",
              t("cash"),
              "wallet",
              "small",
              `data-id="${r.id}"`,
            ) +
            btn(
              "close-register",
              t("closeRegister"),
              "close",
              "small",
              `data-id="${r.id}"`,
            )
          : "",
      ]),
    ) +
    `<section class="panel"><h2>${t("movement")}</h2>${table(
      [t("date"), t("cash"), t("reason"), t("amount")],
      data.movements.map((m) => {
        const r = data.registers.find((r) => r.id === m.registerId);
        return [
          date(m.date),
          esc(r?.name),
          esc(m.note),
          `${m.kind === "in" ? "+" : "−"} ${money(m.amount, r?.currency)}`,
        ];
      }),
    )}</section>`
  );
}
function clientsPage() {
  return (
    pageTitle(
      t("clients"),
      "",
      btn("new-client", t("newClient"), "plus", "primary"),
    ) +
    table(
      [
        t("customer"),
        t("phone"),
        t("taxId"),
        ...currencies.map((c) => `${t("due")} ${c}`),
        t("actions"),
      ],
      data.clients.map((c) => [
        esc(c.name),
        esc(c.phone),
        esc(c.taxId),
        ...currencies.map((code) => money(c.balances[code], code)),
        btn("edit-client", t("edit"), "edit", "small", `data-id="${c.id}"`) +
          btn("receive", t("receive"), "cash", "small", `data-id="${c.id}"`),
      ]),
    ) +
    `<section class="panel"><h2>${t("receipts")}</h2>${table(
      [t("date"), t("customer"), t("amount")],
      data.receipts.map((r) => [
        date(r.date),
        esc(data.clients.find((c) => c.id === r.client)?.name),
        money(r.amount, r.currency),
      ]),
    )}</section>`
  );
}
function brandFields(b) {
  return `${field(t("businessName"), "name", b.name, "text", "required")}${field(t("phone"), "phone", b.phone)}${field(t("taxId"), "taxId", b.taxId)}${field(t("address"), "address", b.address)}`;
}
function imageField(value, label = "logo") {
  return `<div class="field full"><span>${t(label)}</span><div class="image-upload"><img data-image-preview ${value ? `src="${esc(value)}"` : "hidden"} alt="${t("preview")}"><div><label class="btn file-label">${svg("upload")}${t("upload")}<input type="file" data-image-file accept="image/png,image/jpeg,image/webp" hidden></label><small>${t("imageHelp")}</small></div>${btn("remove-image", t("removeLogo"), "trash", "small")}</div><input type="hidden" name="imageData" value="${esc(value || "")}"></div>`;
}
function settingsFields(section = "all") {
  const b = settings();
  return `${section === "all" ? `<h3>${t("business")}</h3><div class="form-grid">${brandFields(b)}</div>` : ""}<h3>${t("currency")} & ${t("language")}</h3><div class="form-grid">${select(t("defaultCurrency"), "currency", currencyOptions(b.currency))}${select(
    t("language"),
    "language",
    opts(
      [
        ["pt", "Português"],
        ["es", "Español"],
        ["en", "English"],
      ],
      b.language,
    ),
  )}</div><p class="hint">${t("pricesHint")}</p><h3>${t("customization")}</h3><div class="form-grid">${select(
    t("appearance"),
    "theme",
    opts(
      [
        ["dark", t("dark")],
        ["light", t("light")],
      ],
      b.theme,
    ),
  )}${select(
    t("layout"),
    "layout",
    opts(
      [
        ["clean", t("clean")],
        ["classic", t("classic")],
      ],
      b.layout,
    ),
  )}${select(
    t("menuPosition"),
    "menuPosition",
    opts(
      [
        ["top", t("top")],
        ["side", t("side")],
      ],
      b.menuPosition,
    ),
  )}${check("showCatalog", t("showCatalog"), b.showCatalog)}</div><div class="layout-previews"><div class="layout-preview ${b.layout === "clean" ? "selected" : ""}"><div class="preview-top"></div><div class="preview-blocks"><i></i><i></i><i></i><b></b></div><small>${t("clean")}</small></div><div class="layout-preview classic ${b.layout === "classic" ? "selected" : ""}"><div class="preview-top"></div><div class="preview-blocks"><i></i><i></i><i></i><b></b></div><small>${t("classic")}</small></div></div>${imageField(b.logo)}`;
}
function settingsPage() {
  return (
    pageTitle(t("settings")) +
    `<form data-form="settings" class="settings-form panel">${settingsFields()}<p data-inline-error class="form-error" hidden></p><button type="submit" class="btn primary">${svg("check")}${t("save")}</button></form><section class="panel"><h2>${t("changePassword")}</h2><form data-form="password" class="form-grid">${field(t("currentPassword"), "currentPassword", "", "password", 'required autocomplete="current-password"')}${field(t("password"), "password", "", "password", 'required minlength="8" autocomplete="new-password"')}<button type="submit" class="btn">${t("save")}</button></form></section>`
  );
}
function linkBlock(relative, label, code = "") {
  const url = location.origin + relative;
  return `<div class="share-card"><div class="qr-box"><img src="/api/qr?path=${encodeURIComponent(relative)}" alt="QR Code" width="220" height="220"></div><div class="share-copy"><small>${esc(label)}</small><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${code ? `<div class="access-code"><small>${t("joinCode")}</small><strong>${esc(code)}</strong><a href="/join" target="_blank" rel="noopener">${location.origin}/join</a></div>` : ""}<div class="actions">${btn("copy", t("copy"), "transfer", "primary", `data-value="${esc(url)}"`)}${btn("share", t("share"), "upload", "", `data-value="${esc(url)}"`)}</div></div></div>`;
}
function storePage() {
  const b = settings();
  return (
    pageTitle(t("catalog"), t("storeHint")) +
    `<section class="panel"><form data-form="store">${check("storeEnabled", t("storeEnabled"), b.storeEnabled)}<div class="form-grid">${field(t("storeDescription"), "storeDescription", b.storeDescription)}${field(`${t("minOrder")} (${b.currency})`, "minOrder", b.minOrder / 100, "number", 'min="0" step="0.01"')}</div><button class="btn primary" type="submit">${t("save")}</button></form></section>${b.storeEnabled ? linkBlock(`/store/${b.code}`, t("storeLink")) : `<div class="notice">${t("storeDisabled")}</div>`}`
  );
}
function teamPage() {
  return (
    pageTitle(
      t("team"),
      t("operatorHint"),
      btn("new-user", t("newUser"), "plus", "primary"),
    ) +
    table(
      [t("name"), t("email"), t("account")],
      data.users.map((u) => [esc(u.name), esc(u.email), t(u.role)]),
    )
  );
}
function modal(title, content, footer = "", wide = false) {
  dialog.innerHTML = `<div class="modal-head"><div><small>ONLY SYSTEM</small><h2 id="dialogTitle">${esc(title)}</h2></div>${btn("close-dialog", t("close"), "close", "icon-button")}</div><div class="modal-body">${content}<p class="form-error" data-form-error hidden></p></div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}`;
  dialog.className = wide ? "wide-dialog" : "";
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() =>
    dialog
      .querySelector(
        'input:not([type="hidden"]):not([type="checkbox"]),select,button',
      )
      ?.focus(),
  );
}
function formModal(title, type, fields, extra = "", wide = false) {
  modal(
    title,
    `<form id="modalForm" data-form="${type}" ${extra}>${fields}</form>`,
    btn("close-dialog", t("cancel")) +
      `<button type="submit" form="modalForm" class="btn primary">${svg("check")}${t("save")}</button>`,
    wide,
  );
}
function menu() {
  const entries = [
    ["customize", "customization", "settings"],
    ["currency", "currency", "globe"],
    ["mobile", "mobile", "smartphone"],
    ["erp", "erp", "monitor"],
    ["store", "catalog", "store"],
    ["register", "cash", "wallet"],
  ];
  modal(
    t("menu"),
    `<div class="menu-grid">${entries
      .filter(
        ([a]) => isOwner() || !["customize", "currency", "store"].includes(a),
      )
      .map(
        ([action, key, icon]) =>
          `<button data-action="${action}">${svg(icon)}<strong>${t(key)}</strong>${svg("chevron")}</button>`,
      )
      .join(
        "",
      )}</div><div class="menu-profile"><div><strong>${esc(data.user.name)}</strong><small>${esc(data.user.email)}</small></div>${btn("logout", t("logout"), "transfer", "text-button")}</div>${installPrompt ? btn("install", t("install"), "download") : ""}`,
  );
}
function registerModal(question = false) {
  const usable = data.registers.filter(canUseRegister);
  formModal(
    question ? t("openQuestion") : t("openRegister"),
    "open-register",
    `<p class="hint">${t("openHint")}</p>${usable.length ? select(t("registerOpen"), "existing", opts([["", "—"], ...usable.map((r) => [r.id, `${r.name} · ${r.currency}`])], selectedRegister)) : ""}<div class="form-grid">${field(t("registerName"), "name", localStorage.getItem(`only.registerName.${data.user.business}`) || `${t("cash")} ${data.registers.length + 1}`, "text", 'required maxlength="80"')}${select(t("currency"), "currency", currencyOptions(posCurrency))}${field(t("opening"), "opening", "0", "number", 'min="0" step="0.01" required')}</div>`,
  );
  if (question)
    $('.modal-footer button[data-action="close-dialog"]').textContent =
      t("later");
}
function productFields(p = {}) {
  return `<div class="form-grid">${field(t("name"), "name", p.name, "text", 'required maxlength="200"')}${field(t("code"), "code", p.code, "text", 'maxlength="80"')}${field(t("category"), "category", p.category)}${field(t("unit"), "unit", p.unit || "un")}${field(t("description"), "description", p.description, "text", 'maxlength="1000"')}${field(t("stock"), "stock", p.stock ?? 0, "number", 'min="0" step="0.001"')}${field(t("minStock"), "minStock", p.minStock ?? 0, "number", 'min="0" step="0.001"')}${check("trackStock", t("trackStock"), p.trackStock !== false)}${check("published", t("published"), p.published !== false)}${check("active", t("active"), p.active !== false)}</div><h3>${t("price")}</h3><p class="hint">${t("pricesHint")}</p><div class="price-grid"><b>${t("currency")}</b><b>${t("retail")}</b><b>${t("wholesale")}</b>${currencies.map((c) => `<strong>${c}</strong><input type="number" name="price_${c}" aria-label="${t("price")} ${c}" min="0" step="0.01" value="${p.prices?.[c] != null ? p.prices[c] / 100 : ""}"><input type="number" name="wholesale_${c}" aria-label="${t("wholesale")} ${c}" min="0" step="0.01" value="${p.wholesale?.[c] != null ? p.wholesale[c] / 100 : ""}">`).join("")}</div><div class="form-grid">${field(t("cost"), "cost", p.cost ? p.cost / 100 : 0, "number", 'min="0" step="0.01"')}${select(t("currency"), "costCurrency", currencyOptions(p.costCurrency || settings().currency))}</div>${imageField(p.image, "productImage")}`;
}
function productForm(id) {
  const p = data.products.find((p) => p.id === id) || {};
  formModal(
    t(id ? "edit" : "newProduct"),
    "product",
    productFields(p),
    `data-id="${esc(id || "")}"`,
    true,
  );
}
function clientForm(id) {
  const c = data.clients.find((c) => c.id === id) || {};
  formModal(
    t(id ? "edit" : "newClient"),
    "client",
    `<div class="form-grid">${field(t("name"), "name", c.name, "text", "required")}${field(t("phone"), "phone", c.phone, "tel")}${field(t("taxId"), "taxId", c.taxId)}${field(t("address"), "address", c.address)}</div>`,
    `data-id="${esc(id || "")}"`,
  );
}
function checkout() {
  if (pendingForBusiness()) return retrySale();
  if (!cart.length) return;
  const r = currentRegister();
  if (!r) return registerModal();
  if (posCurrency !== r.currency)
    return toast(errorText("registerCurrency"), true);
  if (cartLines().some((i) => i.price == null))
    return toast(errorText("priceUnavailable"), true);
  const discount = parseTenderAmount(pos.discount || 0);
  if (!Number.isFinite(discount) || cents(discount) > subtotal())
    return toast(errorText("invalidDiscount"), true);
  const total = subtotal() - cents(discount);
  modal(
    t("checkout"),
    `<div class="payment-total"><small>${t("total")} · ${posCurrency}</small><strong>${money(total)}</strong></div><form id="paymentForm" data-form="sale"><input name="requestId" type="hidden" value="${crypto.randomUUID()}"><div class="form-grid">${select(t("customer"), "clientId", opts([["", t("finalCustomer")], ...data.clients.map((c) => [c.id, c.name])], pos.clientId))}${select(
      t("checkout"),
      "method",
      opts(
        ["cash", "pix", "qr", "card", "transfer", "credit"].map((m) => [
          m,
          t(m === "cash" ? "cashMethod" : m),
        ]),
        "cash",
      ),
    )}</div>${field(`${t("received")} (${posCurrency})`, "received", (total / 100).toFixed(2), "text", 'inputmode="decimal" required autocomplete="off"')}<div id="tenderSummary" class="tender-summary" aria-live="polite"></div>${check("allowPartial", t("partial"))}<p class="hint">${t("clientRequired")}</p></form>`,
    btn("close-dialog", t("back")) +
      `<button type="submit" form="paymentForm" class="btn primary">${svg("check")}${t("confirmPayment")}</button>`,
  );
  updateTender();
}
function updateTender() {
  const form = $("#paymentForm");
  if (!form) return;
  const total = Math.max(
    0,
    subtotal() - cents(parseTenderAmount(pos.discount || 0) || 0),
  );
  if (form.elements.method.value === "credit")
    form.elements.received.value = "0";
  const summary = cashTenderSummary(total / 100, form.elements.received.value);
  $("#tenderSummary").innerHTML =
    `<span>${t(summary.remaining ? "remaining" : "change")}</span><strong>${summary.valid ? money(cents(summary.remaining || summary.change)) : "—"}</strong>`;
}
function receipt(s) {
  lastReceipt = s;
  const b = settings();
  const content = `<article class="receipt" id="printArea">${b.logo ? `<img class="receipt-logo" src="${esc(b.logo)}" alt="">` : ""}<h2>${esc(b.name)}</h2><p>${esc(b.taxId)}<br>${esc(b.address)}<br>${esc(b.phone)}</p><hr><h3>${t("receipt")}</h3><strong>${esc(s.number)}</strong><p>${date(s.date)}<br>${t("seller")}: ${esc(s.seller)}</p>${table(
    [t("products"), t("quantity"), t("total")],
    s.items.map((i) => [
      esc(i.name),
      num(i.quantity),
      money(i.total, s.currency),
    ]),
  )}<hr><div class="total-row"><span>${t("subtotal")}</span><b>${money(s.subtotal, s.currency)}</b></div><div class="total-row"><span>${t("discount")}</span><b>− ${money(s.discount, s.currency)}</b></div><div class="total-row receipt-total"><strong>${t("total")}</strong><strong>${money(s.total, s.currency)}</strong></div><div class="total-row"><span>${t("checkout")}</span><b>${t(s.method === "cash" ? "cashMethod" : s.method)}</b></div><div class="total-row"><span>${t("received")}</span><b>${money(s.received, s.currency)}</b></div><div class="total-row"><span>${t("change")}</span><b>${money(s.change, s.currency)}</b></div>${s.due ? `<div class="total-row"><span>${t("due")}</span><b>${money(s.due, s.currency)}</b></div>` : ""}<hr><p>${t("customer")}: ${esc(s.client?.name || t("finalCustomer"))}${s.client ? `<br>${esc(s.client.taxId)} · ${esc(s.client.phone)}<br>${esc(s.client.address)}` : ""}</p>${s.notes ? `<p>${esc(s.notes)}</p>` : ""}<p>${t("receiptCaption")}</p><small>${t("fiscalNote")}<br>onlysystem</small></article>`;
  modal(
    t(s.status === "cancelled" ? "cancelledHint" : "saleDone"),
    content,
    btn("print", t("print"), "receipt") +
      btn("close-dialog", t("newSale"), "plus", "primary"),
  );
}
async function load(silent = false) {
  const next = await api("/api/workspace");
  data = next;
  if (pendingSale && pendingSale.business !== data.user.business)
    pendingSale = null;
  const usable = data.registers.filter(canUseRegister);
  if (!usable.some((r) => r.id === selectedRegister)) {
    const stored = localStorage.getItem(`only.register.${data.user.business}`);
    selectedRegister =
      usable.find((r) => r.id === stored)?.id || usable[0]?.id || "";
  }
  lastOrderCount = data.orders.filter((o) => o.status === "new").length;
  if (!silent) {
    setLanguage(data.business.language);
    posCurrency = currentRegister()?.currency || data.business.currency;
    render();
  }
}
async function refresh() {
  await load(true);
  render();
}
function serializeProduct(form) {
  const f = Object.fromEntries(new FormData(form));
  return {
    ...f,
    image: f.imageData,
    prices: Object.fromEntries(
      currencies
        .filter((c) => f[`price_${c}`] !== "")
        .map((c) => [c, f[`price_${c}`]]),
    ),
    wholesale: Object.fromEntries(
      currencies
        .filter((c) => f[`wholesale_${c}`] !== "")
        .map((c) => [c, f[`wholesale_${c}`]]),
    ),
    trackStock: form.elements.trackStock.checked,
    published: form.elements.published.checked,
    active: form.elements.active.checked,
  };
}
function settingsBody(form) {
  const f = Object.fromEntries(new FormData(form)),
    old = settings();
  return {
    ...old,
    minOrder: old.minOrder / 100,
    ...f,
    logo: f.imageData ?? old.logo,
    showCatalog: form.elements.showCatalog?.checked ?? old.showCatalog,
  };
}
async function saveSettings(body) {
  await api("/api/settings", body);
  await load(true);
  setLanguage(data.business.language);
  if (!cart.length)
    posCurrency = currentRegister()?.currency || data.business.currency;
  dialog.close();
  render();
  toast(t("settingsSaved"));
}
async function createLink(kind) {
  const link = await api("/api/links", { kind });
  modal(
    t(kind === "mobile" ? "mobile" : "collaboration"),
    `<p class="hint">${t(kind === "mobile" ? "mobileHint" : "collaborationHint")}</p>${linkBlock(`/${kind}/${link.token}`, t(kind === "mobile" ? "mobile" : "collaboration"), kind === "mobile" ? link.code : "")}<p class="hint">${t("expires")}: ${date(link.expires)}</p>`,
    btn("close-dialog", t("close")),
  );
  await load(true);
}
async function linksModal(kind) {
  const links = data.links.filter(
    (l) => l.kind === kind && l.active && l.expires > Date.now(),
  );
  modal(
    t(kind === "mobile" ? "mobile" : "collaboration"),
    `<p class="hint">${t(kind === "mobile" ? "mobileHint" : "collaborationHint")}</p><div class="invite-hero">${svg(kind === "mobile" ? "smartphone" : "users")}<h3>${t(kind === "mobile" ? "mobile" : "collaboration")}</h3>${btn(kind === "mobile" ? "create-mobile" : "create-collaborate", t("invite"), "qr", "primary")}</div>${
      links.length
        ? table(
            [t("code"), t("expires"), t("actions")],
            links.map((l) => [
              esc(l.code),
              date(l.expires),
              btn(
                "revoke",
                t("revoke"),
                "close",
                "small",
                `data-code="${l.code}"`,
              ),
            ]),
          )
        : ""
    }`,
    btn("close-dialog", t("close")),
  );
}
function orderCheckout() {
  if (!cart.length) return;
  formModal(
    t("orderDetails"),
    "order",
    `<div class="form-grid">${field(t("name"), "customer", "", "text", 'required autocomplete="name"')}${field(t("phone"), "phone", "", "tel", 'required autocomplete="tel"')}${field(t("address"), "address", "", "text", 'autocomplete="street-address"')}${publicMode === "mobile" ? field(t("table"), "table") : ""}${field(t("notes"), "notes")}</div><input type="hidden" name="requestId" value="${(orderCheckout.requestId ||= crypto.randomUUID())}"><div class="payment-total"><small>${t("total")}</small><strong>${money(subtotal())}</strong></div>`,
  );
  $('.modal-footer [type="submit"]').textContent = t("makeOrder");
}
function renderCollaborate() {
  theme();
  app.innerHTML =
    header() +
    `<div class="collaborate-page"><span class="eyebrow">${esc(settings().name)}</span><h1>${t("draftTitle")}</h1><p>${t("collaborationHint")}</p><form class="panel" data-form="draft">${productFields()}<p data-inline-error class="form-error" hidden></p><button type="submit" class="btn primary wide">${svg("check")}${t("save")}</button></form></div>`;
}
function joinPage() {
  app.innerHTML = `<div class="join-page"><a class="wordmark" href="/">only<i>®</i></a>${languagePicker()}<div class="panel"><div class="join-icon">${svg("smartphone")}</div><h1>${t("join")}</h1><p>${t("joinHint")}</p><form data-form="join">${field(t("code"), "code", "", "text", 'required maxlength="20" autocomplete="off" autocapitalize="characters"')}<p data-inline-error class="form-error" hidden></p><button type="submit" class="btn primary wide">${t("start")}${svg("chevron")}</button></form></div></div>`;
}
async function sendSale(payload) {
  pendingSale = { business: data.user.business, payload };
  sessionStorage.setItem("only.pendingSale", JSON.stringify(pendingSale));
  const sale = await api("/api/sales", payload);
  pendingSale = null;
  sessionStorage.removeItem("only.pendingSale");
  cart = [];
  pos.discount = "0";
  pos.notes = "";
  orderId = null;
  try {
    await load(true);
  } catch {
    toast(t("offline"), true);
  }
  render();
  receipt(sale);
}
async function retrySale() {
  if (!pendingForBusiness()) return;
  modal(
    t("checkout"),
    `<p>${t("retry")} · ${t("confirmPayment")}</p><div class="payment-total"><small>${t("total")}</small><strong>${money(pendingSale.payload.previewTotal, pendingSale.payload.currency)}</strong></div><p class="hint">${t("retryHint")}</p>`,
    btn("close-dialog", t("close")) +
      btn("confirm-retry", t("retry"), "check", "primary"),
  );
}
function csvCell(v) {
  const s = String(v ?? "");
  return `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}
function exportCsv() {
  const rows = [
    [
      t("code"),
      t("date"),
      t("customer"),
      t("cash"),
      t("currency"),
      t("total"),
      t("received"),
      t("change"),
      t("due"),
    ],
    ...reportsData().map((s) => [
      s.number,
      date(s.date),
      s.client?.name || t("finalCustomer"),
      s.registerName,
      s.currency,
      (s.total / 100).toFixed(2),
      (s.received / 100).toFixed(2),
      (s.change / 100).toFixed(2),
      ((s.outstanding ?? s.due) / 100).toFixed(2),
    ]),
  ];
  const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `ONLY-${reportFrom}-${reportTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function printReport(cash = false) {
  const title = t(cash ? "printCash" : "reports");
  const body = cash ? cashPage() : reportsPage();
  modal(
    title,
    `<article id="printArea" class="print-report"><header><h2>${esc(settings().name)}</h2><p>${esc(settings().taxId)} · ${esc(settings().phone)}<br>${esc(settings().address)}</p><small>${date(new Date())}</small></header>${body}<footer>onlysystem</footer></article>`,
    btn("print", t("print"), "receipt"),
    true,
  );
}

const actions = {
  "auth-login": () => {
    authTab = "login";
    auth();
  },
  "auth-signup": () => {
    authTab = "signup";
    auth();
  },
  "mobile-products": () => {
    mobileView = "products";
    render();
    window.scrollTo(0, 0);
  },
  "mobile-cart": () => {
    mobileView = "cart";
    render();
    window.scrollTo(0, 0);
  },
  menu,
  "close-dialog": () => dialog.close(),
  pos: () => {
    dialog.close();
    mode = "pos";
    render();
  },
  erp: () => {
    dialog.close();
    mode = "erp";
    view = "reports";
    render();
  },
  join: () => {
    location.href = "/join";
  },
  register: () => registerModal(),
  "new-product": () => productForm(),
  "edit-product": (el) => productForm(el.dataset.id),
  "new-client": () => clientForm(),
  "edit-client": (el) => clientForm(el.dataset.id),
  mobile: () => linksModal("mobile"),
  collaborate: () => linksModal("collaborate"),
  "create-mobile": () => createLink("mobile"),
  "create-collaborate": () => createLink("collaborate"),
  customize: () =>
    formModal(
      t("customization"),
      "quick-settings",
      settingsFields("appearance"),
      "",
      true,
    ),
  currency: () =>
    formModal(
      t("currency"),
      "quick-settings",
      `${select(t("defaultCurrency"), "currency", currencyOptions(settings().currency))}${select(
        t("language"),
        "language",
        opts(
          [
            ["pt", "Português"],
            ["es", "Español"],
            ["en", "English"],
          ],
          settings().language,
        ),
      )}<p class="hint">${t("pricesHint")}</p>`,
    ),
  store: () => {
    dialog.close();
    mode = "erp";
    view = "catalog";
    render();
  },
  "clear-cart": () => {
    cart = [];
    orderId = null;
    pos.discount = "0";
    render();
  },
  checkout,
  "order-checkout": orderCheckout,
  "retry-sale": retrySale,
  "confirm-retry": () => sendSale(pendingSale.payload),
  "sale-notes": () =>
    formModal(
      t("notes"),
      "notes",
      `<label class="field"><span>${t("notes")}</span><textarea name="notes" maxlength="1000" rows="5">${esc(pos.notes)}</textarea></label>`,
    ),
  receipt: (el) => receipt(data.sales.find((s) => s.id === el.dataset.id)),
  print: () => window.print(),
  "print-report": () => printReport(),
  "print-cash": () => printReport(true),
  export: exportCsv,
  refresh,
  "cancel-sale": (el) => {
    modal(
      t("cancelSale"),
      `<p>${t("confirmCancel")}</p>`,
      btn("close-dialog", t("back")) +
        btn(
          "confirm-cancel-sale",
          t("cancelSale"),
          "close",
          "danger",
          `data-id="${el.dataset.id}"`,
        ),
    );
  },
  "confirm-cancel-sale": async (el) => {
    await api("/api/sales/cancel", { id: el.dataset.id });
    dialog.close();
    await refresh();
  },
  "accept-order": async (el) => {
    await api("/api/orders/status", { id: el.dataset.id, status: "accepted" });
    await refresh();
  },
  "cancel-order": (el) =>
    modal(
      t("cancelOrder"),
      `<p>${t("confirmCancelOrder")}</p>`,
      btn("close-dialog", t("back")) +
        btn(
          "confirm-cancel-order",
          t("cancelOrder"),
          "close",
          "danger",
          `data-id="${el.dataset.id}"`,
        ),
    ),
  "confirm-cancel-order": async (el) => {
    await api("/api/orders/status", { id: el.dataset.id, status: "cancelled" });
    dialog.close();
    await refresh();
  },
  "import-order": (el) => {
    const order = data.orders.find((o) => o.id === el.dataset.id);
    if (!order) return;
    const apply = () => {
      cart = order.items.map((i) => ({ id: i.id, quantity: i.quantity }));
      posCurrency = order.currency;
      wholesale = false;
      orderId = order.id;
      pos.discount = "0";
      pos.notes = `${order.customer} · ${order.phone}${order.table ? " · " + order.table : ""}\n${order.notes || ""}`;
      mode = "pos";
      dialog.close();
      render();
    };
    if (cart.length) {
      modal(
        t("importOrder"),
        `<p>${t("confirmReplaceCart")}</p>`,
        btn("close-dialog", t("back")) +
          btn(
            "replace-order",
            t("importOrder"),
            "cart",
            "primary",
            `data-id="${order.id}"`,
          ),
      );
    } else apply();
  },
  "replace-order": (el) => {
    cart = [];
    actions["import-order"](el);
  },
  approve: async (el) => {
    await api("/api/drafts/approve", { id: el.dataset.id });
    await refresh();
  },
  reject: async (el) => {
    await api("/api/drafts/reject", { id: el.dataset.id });
    await refresh();
  },
  revoke: async (el) => {
    await api("/api/links/revoke", { code: el.dataset.code });
    await load(true);
    linksModal(
      data.links.find((l) => l.code === el.dataset.code)?.kind || "mobile",
    );
  },
  copy: async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.value);
      toast(t("copied"));
    } catch {
      modal(
        t("copy"),
        field(t("storeLink"), "copyLink", el.dataset.value, "text", "readonly"),
      );
      $('input[name="copyLink"]').select();
    }
  },
  share: async (el) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: settings().name,
          url: el.dataset.value,
        });
      } catch (e) {
        if (e.name !== "AbortError") throw e;
      }
    } else await actions.copy(el);
  },
  "remove-image": (el) => {
    const form = el.closest("form");
    form.elements.imageData.value = "";
    const img = $("[data-image-preview]", form);
    img.hidden = true;
    img.removeAttribute("src");
  },
  "select-register": (el) => {
    selectedRegister = el.dataset.id;
    localStorage.setItem(
      `only.register.${data.user.business}`,
      selectedRegister,
    );
    posCurrency = currentRegister().currency;
    render();
  },
  "close-register": (el) => {
    const r = data.registers.find((r) => r.id === el.dataset.id);
    formModal(
      t("closeRegister"),
      "close-register",
      `<input type="hidden" name="id" value="${r.id}"><h3>${esc(r.name)} · ${r.currency}</h3><div class="payment-total"><small>${t("expected")}</small><strong>${money(r.expected, r.currency)}</strong></div>${field(t("counted"), "counted", "", "number", 'required min="0" step="0.01"')}`,
    );
  },
  movement: () => {
    const registers = data.registers.filter(canUseRegister);
    if (!registers.length) return registerModal();
    formModal(
      t("movement"),
      "movement",
      `${select(
        t("cash"),
        "registerId",
        opts(
          registers.map((r) => [r.id, `${r.name} · ${r.currency}`]),
          selectedRegister,
        ),
      )}${select(
        t("movement"),
        "kind",
        opts(
          [
            ["in", t("in")],
            ["out", t("out")],
          ],
          "out",
        ),
      )}${field(t("amount"), "amount", "", "number", 'required min="0.01" step="0.01"')}${field(t("reason"), "note", "", "text", "required")}`,
    );
  },
  receive: (el) => {
    const client = data.clients.find((c) => c.id === el.dataset.id),
      registers = data.registers.filter(canUseRegister);
    if (!registers.length) return registerModal();
    formModal(
      t("receive"),
      "receive",
      `<input type="hidden" name="clientId" value="${client.id}"><h3>${esc(client.name)}</h3>${select(
        t("currency"),
        "currency",
        opts(
          currencies.map((c) => [
            c,
            `${c} · ${t("due")}: ${money(client.balances[c], c)}`,
          ]),
          posCurrency,
        ),
      )}${select(
        t("cash"),
        "registerId",
        opts(
          registers.map((r) => [r.id, `${r.name} · ${r.currency}`]),
          selectedRegister,
        ),
      )}${field(t("amount"), "amount", "", "number", 'required min="0.01" step="0.01"')}${select(
        t("checkout"),
        "method",
        opts(
          ["cash", "pix", "qr", "card", "transfer"].map((m) => [
            m,
            t(m === "cash" ? "cashMethod" : m),
          ]),
          "cash",
        ),
      )}`,
    );
  },
  "new-user": () =>
    formModal(
      t("newUser"),
      "user",
      `${field(t("name"), "name", "", "text", "required")}${field(t("email"), "email", "", "email", "required")}${field(t("password"), "password", "", "password", 'required minlength="8" autocomplete="new-password"')}<p class="hint">${t("operatorHint")}</p>`,
    ),
  logout: async () => {
    await api("/api/logout", {});
    cart = [];
    data = null;
    dialog.close();
    auth();
  },
  install: async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = null;
      dialog.close();
    }
  },
};
async function run(action, el) {
  try {
    await actions[action]?.(el);
  } catch (e) {
    notifyError(e);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) {
    e.preventDefault();
    if (!busy) run(el.dataset.action, el);
    return;
  }
  const add = e.target.closest("[data-add]");
  if (add) {
    addProduct(add.dataset.add);
    return;
  }
  const category = e.target.closest("[data-category]");
  if (category) {
    activeCategory = category.dataset.category;
    render();
    return;
  }
  const nav = e.target.closest("[data-view]");
  if (nav) {
    view = nav.dataset.view;
    render();
    return;
  }
  const qty = e.target.closest("[data-quantity]");
  if (qty) {
    const item = cart.find((i) => i.id === qty.dataset.quantity),
      p = data.products.find((p) => p.id === item?.id);
    if (!item) return;
    const next =
      Math.round((item.quantity + Number(qty.dataset.delta)) * 1000) / 1000;
    if (next <= 0) cart = cart.filter((i) => i.id !== item.id);
    else if (p.trackStock && next > p.stock)
      return toast(errorText("insufficientStock"), true);
    else item.quantity = next;
    updateCart();
    return;
  }
  const remove = e.target.closest("[data-remove]");
  if (remove) {
    cart = cart.filter((i) => i.id !== remove.dataset.remove);
    updateCart();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    query = e.target.value;
    $("#productGrid").innerHTML = cards();
  }
  if (e.target.id === "discount") {
    pos.discount = e.target.value;
    const total = subtotal() - cents(parseTenderAmount(pos.discount) || 0);
    $("#grandTotal").textContent = money(Math.max(0, total));
    if ($("[data-mobile-total]"))
      $("[data-mobile-total]").textContent = money(Math.max(0, total));
  }
  if (e.target.name === "received") updateTender();
});
document.addEventListener("change", async (e) => {
  try {
    const el = e.target;
    if (el.matches("[data-language]")) {
      setLanguage(el.value);
      if (path[0] === "join") joinPage();
      else render();
    }
    if (el.matches("[data-pos-currency]")) {
      posCurrency = el.value;
      render();
    }
    if (el.matches("[data-pos-client]")) pos.clientId = el.value;
    if (el.name === "wholesale") {
      wholesale = el.checked;
      render();
    }
    if (el.name === "method" && $("#paymentForm")) updateTender();
    if (el.matches("[data-cart-quantity]")) {
      const n = Number(el.value.replace(",", ".")),
        item = cart.find((i) => i.id === el.dataset.cartQuantity),
        p = data.products.find((p) => p.id === item?.id);
      if (!Number.isFinite(n) || n <= 0) throw Error("invalidQuantity");
      if (p.trackStock && n > p.stock) throw Error("insufficientStock");
      item.quantity = Math.round(n * 1000) / 1000;
      updateCart();
    }
    if (el.matches("[data-image-file]")) {
      const file = el.files[0];
      if (!file) return;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 500000
      )
        throw Error("invalidImage");
      const value = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const form = el.closest("form");
      form.elements.imageData.value = value;
      const img = $("[data-image-preview]", form);
      img.src = value;
      img.hidden = false;
    }
  } catch (e) {
    notifyError(e);
    if (e.target.matches("[data-cart-quantity]")) updateCart();
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  if (busy) return;
  const kind = form.dataset.form,
    fields = Object.fromEntries(new FormData(form));
  busy = true;
  const buttons = [
    ...form.querySelectorAll('button[type="submit"]'),
    ...document.querySelectorAll(`button[form="${form.id}"]`),
  ];
  buttons.forEach((b) => (b.disabled = true));
  const inline = $("[data-inline-error]", form);
  if (inline) inline.hidden = true;
  const err = $("[data-form-error]", dialog);
  if (err) err.hidden = true;
  try {
    if (kind === "login" || kind === "signup") {
      await api(`/api/${kind}`, fields);
      await load();
      if (!currentRegister()) registerModal(true);
    }
    if (kind === "join") {
      const result = await api("/api/join", fields);
      location.href = result.path;
    }
    if (kind === "open-register") {
      const r = fields.existing
        ? data.registers.find((r) => r.id === fields.existing)
        : await api("/api/registers/open", fields);
      selectedRegister = r.id;
      localStorage.setItem(`only.register.${data.user.business}`, r.id);
      localStorage.setItem(`only.registerName.${data.user.business}`, r.name);
      posCurrency = r.currency;
      await load(true);
      dialog.close();
      render();
    }
    if (kind === "product") {
      await api("/api/products", {
        ...serializeProduct(form),
        ...(form.dataset.id ? { id: form.dataset.id } : {}),
      });
      await load(true);
      dialog.close();
      render();
      toast(t("productSaved"));
    }
    if (kind === "client") {
      await api("/api/clients", {
        ...fields,
        ...(form.dataset.id ? { id: form.dataset.id } : {}),
      });
      await load(true);
      dialog.close();
      render();
      toast(t("clientSaved"));
    }
    if (kind === "settings" || kind === "quick-settings")
      await saveSettings(settingsBody(form));
    if (kind === "store")
      await saveSettings({
        ...settings(),
        minOrder: fields.minOrder,
        storeDescription: fields.storeDescription,
        storeEnabled: form.elements.storeEnabled.checked,
      });
    if (kind === "notes") {
      pos.notes = fields.notes;
      dialog.close();
    }
    if (kind === "sale") {
      const payload = {
        ...fields,
        allowPartial: form.elements.allowPartial.checked,
        registerId: selectedRegister,
        currency: posCurrency,
        items: cart.map((i) => ({ ...i })),
        wholesale,
        discount: pos.discount,
        notes: pos.notes,
        orderId,
        previewTotal:
          subtotal() - cents(parseTenderAmount(pos.discount || 0) || 0),
      };
      await sendSale(payload);
    }
    if (kind === "close-register") {
      await api("/api/registers/close", fields);
      dialog.close();
      await refresh();
    }
    if (kind === "movement") {
      await api("/api/movements", fields);
      dialog.close();
      await refresh();
    }
    if (kind === "receive") {
      await api("/api/receipts", fields);
      dialog.close();
      await refresh();
    }
    if (kind === "user") {
      await api("/api/users", fields);
      dialog.close();
      await refresh();
    }
    if (kind === "password") {
      await api("/api/password", fields);
      form.reset();
      toast(t("saved"));
    }
    if (kind === "order") {
      const result = await api(`${publicPath()}/order`, {
        ...fields,
        items: cart.map((i) => ({ ...i })),
        currency: posCurrency,
      });
      cart = [];
      orderCheckout.requestId = null;
      render();
      modal(
        t("orderDone"),
        `<div class="success-state">${svg("check")}<h3>${esc(result.number || result.id.slice(0, 8))}</h3><p>${t("orderDoneHint")}</p></div>`,
        btn("close-dialog", t("close")),
      );
    }
    if (kind === "draft") {
      await api(`${publicPath()}/draft`, serializeProduct(form));
      renderCollaborate();
      toast(t("draftSaved"));
    }
    if (kind === "report-filter") {
      reportFrom = fields.from;
      reportTo = fields.to;
      render();
    }
  } catch (error) {
    if (
      kind === "sale" &&
      error.message !== "offline" &&
      error.message !== "serverError"
    ) {
      pendingSale = null;
      sessionStorage.removeItem("only.pendingSale");
    }
    if (inline && !dialog.open) {
      inline.textContent =
        error.message === "offline" ? t("offline") : errorText(error.message);
      inline.hidden = false;
    } else notifyError(error);
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
});

document.addEventListener("keydown", (e) => {
  if (dialog.open) return;
  if (e.key === "F2") {
    e.preventDefault();
    $("#search")?.focus();
  }
  if (e.key === "Escape" && $("#search")) {
    $("#search").value = "";
    query = "";
    $("#productGrid").innerHTML = cards();
    $("#search").blur();
  }
  if (e.key === "Enter" && e.target.id === "search") {
    e.preventDefault();
    const exact =
      data.products.find((p) => p.code.toLowerCase() === query.toLowerCase()) ||
      catalogProducts()[0];
    if (exact) {
      addProduct(exact.id);
      e.target.value = "";
      query = "";
      $("#productGrid").innerHTML = cards();
    }
  }
  if (e.key === "F9" && !publicMode && mode === "pos" && data) {
    e.preventDefault();
    checkout();
  }
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog && !busy) dialog.close();
});
window.addEventListener("online", () => {
  render();
  toast(t("online"));
});
window.addEventListener("offline", () => {
  render();
  toast(t("offline"), true);
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener("beforeunload", (e) => {
  if (cart.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function boot() {
  if (staticSite) { setLanguage(lang()); auth(); return; }
  setLanguage(lang());
  if (path[0] === "join") {
    joinPage();
    return;
  }
  try {
    if (publicMode) {
      data = await api(publicPath());
      posCurrency = data.business.currency;
      setLanguage(data.business.language);
      render();
    } else {
      await load();
      if (!currentRegister()) registerModal(true);
    }
  } catch (e) {
    if (
      !publicMode &&
      (e.message === "loginRequired" || e.message === "invalidLogin")
    ) {
      data = null;
      auth();
    } else {
      app.innerHTML = `<div class="error-page"><span class="wordmark">only<i>®</i></span>${empty(e.message === "offline" ? t("offline") : errorText(e.message), "", "store", `<a class="btn primary" href="${esc(location.pathname)}">${t("retry")}</a>`)}</div>`;
    }
  }
}
setInterval(async () => {
  if (!data || publicMode === "collaborate" || busy || document.hidden) return;
  try {
    if (publicMode) {
      const next = await api(publicPath());
      data.products = next.products;
    } else {
      const before = lastOrderCount;
      await load(true);
      if (lastOrderCount > before) toast(`${t("new")} · ${t("orders")}`);
      if (
        mode === "erp" &&
        ["orders", "cash", "products"].includes(view) &&
        !dialog.open &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName,
        )
      )
        render();
    }
  } catch (e) {
    if (e.message === "loginRequired") {
      data = null;
      dialog.close();
      auth();
    }
  }
}, 12000);
if (!staticSite && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
boot();

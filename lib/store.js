import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { currencies, cents, cashTenderSummary } from "../public/money.js";

export const defaults = {
  name: "Minha empresa",
  currency: "BRL",
  language: "pt",
  logo: "",
  theme: "dark",
  layout: "clean",
  showCatalog: true,
  menuPosition: "top",
  phone: "",
  address: "",
  taxId: "",
  storeEnabled: false,
  storeDescription: "",
  minOrder: 0,
};
export const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const text = (v, max = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
export const hash = (v) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(24).toString("base64url");
const json = (v) => JSON.stringify(v);
const parse = (v) => JSON.parse(v);
export const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) fail("invalidAmount");
  return cents(n);
};
const quantity = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) fail("invalidQuantity");
  return Math.round(n * 1000) / 1000;
};
export const currency = (v) =>
  currencies.includes(v) ? v : fail("invalidCurrency");
const passwordHash = (pass) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pass, salt, 64).toString("hex")}`;
};
const passwordMatches = (pass, encoded) => {
  const [salt, hex] = encoded.split(":");
  return timingSafeEqual(scryptSync(pass, salt, 64), Buffer.from(hex, "hex"));
};
const password = (v) => {
  if (typeof v !== "string" || v.length < 8 || v.length > 128)
    fail("passwordLength");
  return v;
};
const image = (v) => {
  if (!v) return "";
  if (
    typeof v !== "string" ||
    v.length > 700000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  )
    fail("invalidImage");
  return v;
};

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "only.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','cashier')));
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), code TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(business,code));
      CREATE INDEX IF NOT EXISTS products_business ON products(business);
      CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registers (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL, user TEXT NOT NULL, opened TEXT NOT NULL, closed TEXT, currency TEXT NOT NULL, opening INTEGER NOT NULL, counted INTEGER, expected INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS register_active ON registers(business,name) WHERE closed IS NULL;
      CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), registerId TEXT NOT NULL REFERENCES registers(id), date TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), requestId TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(business,requestId));
      CREATE INDEX IF NOT EXISTS sales_business ON sales(business,date);
      CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), kind TEXT NOT NULL, expires INTEGER NOT NULL, code TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), requestId TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', data TEXT NOT NULL, UNIQUE(business,requestId));
      CREATE INDEX IF NOT EXISTS orders_business ON orders(business);
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), date TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, business TEXT NOT NULL REFERENCES businesses(id), date TEXT NOT NULL, client TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, registerId TEXT);
    `);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  business(id) {
    const b = this.get("SELECT * FROM businesses WHERE id=?", id);
    if (!b) fail("notFound", 404);
    return { id: b.id, code: b.code, ...defaults, ...parse(b.settings) };
  }
  signup(body) {
    const email = text(body.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("invalidEmail");
    const pass = passwordHash(password(body.password)),
      name = text(body.name),
      businessName = text(body.businessName);
    if (!name || !businessName) fail("required");
    if (this.get("SELECT id FROM users WHERE email=?", email))
      fail("emailUsed", 409);
    const business = randomUUID(),
      id = randomUUID(),
      code = randomBytes(5).toString("hex").toUpperCase();
    this.transaction(() => {
      this.run(
        "INSERT INTO businesses VALUES (?,?,?)",
        business,
        code,
        json({ ...defaults, name: businessName }),
      );
      this.run(
        "INSERT INTO users VALUES (?,?,?,?,?,?)",
        id,
        business,
        email,
        name,
        pass,
        "owner",
      );
    });
    return this.newSession(id);
  }
  newSession(userId) {
    const raw = token();
    this.run("DELETE FROM sessions WHERE expires<?", Date.now());
    this.run(
      "INSERT INTO sessions VALUES (?,?,?)",
      hash(raw),
      userId,
      Date.now() + 7 * 86400000,
    );
    return {
      token: raw,
      user: this.safeUser(this.get("SELECT * FROM users WHERE id=?", userId)),
    };
  }
  safeUser(u) {
    return {
      id: u.id,
      business: u.business,
      email: u.email,
      name: u.name,
      role: u.role,
    };
  }
  login(body) {
    const u = this.get(
      "SELECT * FROM users WHERE email=?",
      text(body.email).toLowerCase(),
    );
    if (
      !u ||
      typeof body.password !== "string" ||
      body.password.length > 128 ||
      !passwordMatches(body.password, u.password)
    )
      fail("invalidLogin", 401);
    return this.newSession(u.id);
  }
  authenticate(raw) {
    if (!raw) fail("loginRequired", 401);
    const u = this.get(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>?",
      hash(raw),
      Date.now(),
    );
    if (!u) fail("loginRequired", 401);
    return this.safeUser(u);
  }
  owner(u) {
    if (u.role !== "owner") fail("forbidden", 403);
  }
  listProducts(b) {
    return this.all(
      "SELECT data FROM products WHERE business=? ORDER BY code",
      b,
    ).map((r) => parse(r.data));
  }
  product(b, id) {
    const row = this.get(
      "SELECT data FROM products WHERE business=? AND id=?",
      b,
      id,
    );
    if (!row) fail("notFound", 404);
    return parse(row.data);
  }
  normalizeProduct(body, id = randomUUID()) {
    const name = text(body.name),
      code = text(body.code || `P-${randomBytes(3).toString("hex")}`, 80);
    if (!name) fail("required");
    const prices = {},
      wholesale = {};
    for (const c of currencies) {
      if (body.prices?.[c] !== "" && body.prices?.[c] != null)
        prices[c] = money(body.prices[c]);
      if (body.wholesale?.[c] !== "" && body.wholesale?.[c] != null)
        wholesale[c] = money(body.wholesale[c]);
    }
    if (!Object.keys(prices).length) fail("priceRequired");
    return {
      id,
      name,
      code,
      category: text(body.category, 80),
      description: text(body.description, 1000),
      unit: text(body.unit || "un", 20),
      image: image(body.image),
      prices,
      wholesale,
      cost: money(body.cost || 0),
      costCurrency: currency(body.costCurrency || "BRL"),
      stock: quantity(body.stock || 0),
      minStock: quantity(body.minStock || 0),
      trackStock: body.trackStock !== false,
      published: body.published !== false,
      active: body.active !== false,
    };
  }
  saveProduct(b, body, id) {
    if (id) this.product(b, id);
    const p = this.normalizeProduct(body, id);
    this.writeProduct(b, p);
    return p;
  }
  writeProduct(b, p) {
    const other = this.get(
      "SELECT id FROM products WHERE business=? AND code=? AND id<>?",
      b,
      p.code,
      p.id,
    );
    if (other) fail("duplicateCode", 409);
    this.run(
      "INSERT INTO products VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,data=excluded.data",
      p.id,
      b,
      p.code,
      json(p),
    );
  }
  saveSettings(b, body) {
    const current = this.business(b);
    const next = {
      ...current,
      name: text(body.name),
      currency: currency(body.currency),
      language: ["pt", "es", "en"].includes(body.language)
        ? body.language
        : "pt",
      theme: body.theme === "light" ? "light" : "dark",
      layout: body.layout === "classic" ? "classic" : "clean",
      menuPosition: body.menuPosition === "side" ? "side" : "top",
      showCatalog: body.showCatalog !== false,
      logo: image(body.logo),
      phone: text(body.phone, 50),
      address: text(body.address),
      taxId: text(body.taxId, 50),
      storeEnabled: Boolean(body.storeEnabled),
      storeDescription: text(body.storeDescription, 1000),
      minOrder: money(body.minOrder || 0),
    };
    if (!next.name) fail("required");
    this.run("UPDATE businesses SET settings=? WHERE id=?", json(next), b);
    return next;
  }
  client(b, body) {
    const name = text(body.name);
    if (!name) fail("required");
    const id = body.id || randomUUID();
    if (
      body.id &&
      !this.get("SELECT id FROM clients WHERE id=? AND business=?", id, b)
    )
      fail("notFound", 404);
    const c = {
      id,
      name,
      phone: text(body.phone, 60),
      address: text(body.address),
      taxId: text(body.taxId, 60),
    };
    this.run(
      "INSERT INTO clients VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      id,
      b,
      json(c),
    );
    return c;
  }
  register(b, id) {
    const r = this.get(
      "SELECT * FROM registers WHERE id=? AND business=? AND closed IS NULL",
      id || "",
      b,
    );
    if (!r) fail("openRegisterRequired");
    return r;
  }
  openRegister(b, u, body) {
    const name = text(body.name, 80);
    if (!name) fail("required");
    if (
      this.get(
        "SELECT id FROM registers WHERE business=? AND name=? AND closed IS NULL",
        b,
        name,
      )
    )
      fail("registerAlreadyOpen", 409);
    const r = {
      id: randomUUID(),
      name,
      currency: currency(body.currency),
      opening: money(body.opening || 0),
    };
    this.run(
      "INSERT INTO registers(id,business,name,user,opened,currency,opening) VALUES(?,?,?,?,?,?,?)",
      r.id,
      b,
      name,
      u.id,
      new Date().toISOString(),
      r.currency,
      r.opening,
    );
    return this.get("SELECT * FROM registers WHERE id=?", r.id);
  }
  expected(b, r) {
    const sales = this.all("SELECT data FROM sales WHERE business=?", b)
      .map((x) => parse(x.data))
      .filter((s) => s.registerId === r.id && s.status !== "cancelled");
    const received = this.get(
      "SELECT coalesce(sum(amount),0) as n FROM receipts WHERE business=? AND registerId=? AND method='cash'",
      b,
      r.id,
    ).n;
    const movements = this.all(
      "SELECT * FROM movements WHERE business=? AND registerId=?",
      b,
      r.id,
    );
    return (
      r.opening +
      sales.reduce((s, v) => s + (v.method === "cash" ? v.paid : 0), 0) +
      received +
      movements.reduce(
        (s, m) => s + (m.kind === "in" ? m.amount : -m.amount),
        0,
      )
    );
  }
  closeRegister(b, body) {
    const r = this.register(b, body.id),
      expected = this.expected(b, r),
      counted = money(body.counted);
    this.run(
      "UPDATE registers SET closed=?,expected=?,counted=? WHERE id=?",
      new Date().toISOString(),
      expected,
      counted,
      r.id,
    );
    return { ...r, expected, counted, difference: counted - expected };
  }
  movement(b, body) {
    const r = this.register(b, body.registerId),
      amount = money(body.amount),
      note = text(body.note);
    if (!amount || !note || !["in", "out"].includes(body.kind))
      fail("required");
    const m = { id: randomUUID(), date: new Date().toISOString() };
    this.run(
      "INSERT INTO movements VALUES(?,?,?,?,?,?,?)",
      m.id,
      b,
      r.id,
      m.date,
      body.kind,
      amount,
      note,
    );
    return m;
  }
  priceItems(b, body, publicMode = false) {
    currency(body.currency);
    if (
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 200
    )
      fail("emptyCart");
    const combined = new Map();
    for (const item of body.items) {
      const q = quantity(item.quantity);
      if (!q) fail("invalidQuantity");
      combined.set(item.id, (combined.get(item.id) || 0) + q);
    }
    return [...combined].map(([id, qty]) => {
      const p = this.product(b, id);
      if (!p.active || (publicMode && !p.published)) fail("unavailableProduct");
      const price =
        !publicMode && body.wholesale
          ? (p.wholesale[body.currency] ?? p.prices[body.currency])
          : p.prices[body.currency];
      if (price == null) fail("priceUnavailable");
      if (p.trackStock && qty > p.stock) fail("insufficientStock");
      return {
        id,
        code: p.code,
        name: p.name,
        quantity: quantity(qty),
        price,
        total: Math.round(price * qty),
      };
    });
  }
  completeSale(b, u, body) {
    const requestId = text(body.requestId, 100);
    if (requestId.length < 12) fail("requestIdRequired");
    return this.transaction(() => {
      const previous = this.get(
        "SELECT data FROM sales WHERE business=? AND requestId=?",
        b,
        requestId,
      );
      if (previous) return parse(previous.data);
      const r = this.register(b, body.registerId);
      if (r.user !== u.id && u.role !== "owner") fail("forbidden", 403);
      if (r.currency !== body.currency) fail("registerCurrency");
      const items = this.priceItems(b, body),
        subtotal = items.reduce((n, p) => n + p.total, 0),
        discount = money(body.discount || 0);
      if (discount > subtotal) fail("invalidDiscount");
      const total = subtotal - discount,
        method = body.method;
      if (!["cash", "pix", "qr", "card", "transfer", "credit"].includes(method))
        fail("invalidPayment");
      const client = body.clientId
        ? this.get(
            "SELECT data FROM clients WHERE business=? AND id=?",
            b,
            body.clientId,
          )
        : null;
      if (body.clientId && !client) fail("notFound", 404);
      const tender = cashTenderSummary(
        total / 100,
        method === "credit" ? 0 : (body.received ?? total / 100),
      );
      if (!tender.valid) fail("invalidAmount");
      if (tender.remaining && !client) fail("clientRequired");
      if (tender.remaining && body.allowPartial !== true && method !== "credit")
        fail("insufficientPayment");
      if (method !== "cash" && tender.change) fail("nonCashOverpayment");
      if (body.orderId) {
        const o = this.get(
          "SELECT * FROM orders WHERE business=? AND id=?",
          b,
          body.orderId,
        );
        if (!o || !["new", "accepted"].includes(o.status))
          fail("orderAlreadyProcessed", 409);
      }
      const id = randomUUID(),
        date = new Date().toISOString(),
        paid = Math.min(cents(tender.received), total);
      const sale = {
        id,
        number: `V-${date.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`,
        date,
        items,
        subtotal,
        discount,
        total,
        currency: body.currency,
        method,
        received: cents(tender.received),
        change: cents(tender.change),
        paid,
        due: total - paid,
        client: client ? parse(client.data) : null,
        registerId: r.id,
        registerName: r.name,
        seller: u.name,
        status: "completed",
        notes: text(body.notes, 1000),
        orderId: body.orderId || null,
      };
      for (const item of items) {
        const p = this.product(b, item.id);
        if (p.trackStock) {
          p.stock = quantity(p.stock - item.quantity);
          this.writeProduct(b, p);
        }
      }
      this.run(
        "INSERT INTO sales VALUES(?,?,?,?,?)",
        id,
        b,
        requestId,
        date,
        json(sale),
      );
      if (body.orderId)
        this.run(
          "UPDATE orders SET status='completed' WHERE business=? AND id=?",
          b,
          body.orderId,
        );
      return sale;
    });
  }
  cancel(b, id) {
    return this.transaction(() => {
      const row = this.get(
        "SELECT data FROM sales WHERE business=? AND id=?",
        b,
        id,
      );
      if (!row) fail("notFound", 404);
      const s = parse(row.data);
      if (s.status === "cancelled") return s;
      if (
        !this.get(
          "SELECT id FROM registers WHERE id=? AND closed IS NULL",
          s.registerId,
        )
      )
        fail("registerClosed");
      if (
        this.get(
          "SELECT id FROM receipts WHERE business=? AND client=? AND currency=?",
          b,
          s.client?.id || "",
          s.currency,
        )
      )
        fail("saleHasReceipts");
      for (const item of s.items) {
        const p = this.product(b, item.id);
        if (p.trackStock) {
          p.stock = quantity(p.stock + item.quantity);
          this.writeProduct(b, p);
        }
      }
      s.status = "cancelled";
      this.run("UPDATE sales SET data=? WHERE id=?", json(s), id);
      return s;
    });
  }
  balance(b, client, c) {
    const total = this.all("SELECT data FROM sales WHERE business=?", b)
      .map((r) => parse(r.data))
      .filter(
        (s) =>
          s.client?.id === client &&
          s.currency === c &&
          s.status !== "cancelled",
      )
      .reduce((n, s) => n + s.due, 0);
    return (
      total -
      this.get(
        "SELECT coalesce(sum(amount),0) as n FROM receipts WHERE business=? AND client=? AND currency=?",
        b,
        client,
        c,
      ).n
    );
  }
  receive(b, body) {
    const c = currency(body.currency),
      amount = money(body.amount),
      client = text(body.clientId);
    if (
      !this.get("SELECT id FROM clients WHERE business=? AND id=?", b, client)
    )
      fail("notFound", 404);
    if (!amount || amount > this.balance(b, client, c)) fail("invalidAmount");
    if (!["cash", "pix", "qr", "card", "transfer"].includes(body.method))
      fail("invalidPayment");
    const r = this.register(b, body.registerId);
    if (r.currency !== c) fail("registerCurrency");
    const id = randomUUID();
    this.run(
      "INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?)",
      id,
      b,
      new Date().toISOString(),
      client,
      c,
      amount,
      body.method,
      r.id,
    );
    return { id };
  }
  link(b, kind) {
    if (!["mobile", "collaborate"].includes(kind)) fail("invalidLink");
    const raw = token(),
      code = randomBytes(6).toString("hex").toUpperCase(),
      expires = Date.now() + (kind === "collaborate" ? 7 : 30) * 86400000;
    this.run(
      "INSERT INTO links(token,business,kind,expires,code) VALUES(?,?,?,?,?)",
      hash(raw),
      b,
      kind,
      expires,
      code,
    );
    return { token: raw, code, kind, expires };
  }
  resolve(raw, kind) {
    const l = this.get(
      "SELECT * FROM links WHERE (token=? OR (kind='mobile' AND code=?)) AND kind=? AND active=1 AND expires>?",
      hash(raw),
      raw.toUpperCase(),
      kind,
      Date.now(),
    );
    if (!l) fail("expiredLink", 404);
    return l;
  }
  publicCatalog(raw, kind) {
    const row =
      kind === "store"
        ? this.get(
            "SELECT id as business FROM businesses WHERE code=?",
            raw.toUpperCase(),
          )
        : this.resolve(raw, kind);
    if (!row) fail("notFound", 404);
    const b = this.business(row.business);
    if (kind === "store" && !b.storeEnabled) fail("storeDisabled", 404);
    return {
      business: {
        name: b.name,
        logo: b.logo,
        currency: b.currency,
        language: b.language,
        theme: b.theme,
        storeDescription: b.storeDescription,
        minOrder: b.minOrder,
      },
      products: this.listProducts(b.id)
        .filter((p) => p.active && p.published)
        .map(
          ({
            id,
            name,
            code,
            category,
            description,
            image,
            prices,
            stock,
            trackStock,
            unit,
          }) => ({
            id,
            name,
            code,
            category,
            description,
            image,
            prices,
            stock,
            trackStock,
            unit,
          }),
        ),
    };
  }
  publicOrder(raw, kind, body) {
    return this.transaction(() => {
      this.publicCatalog(raw, kind);
      const b =
        kind === "store"
          ? this.get(
              "SELECT id FROM businesses WHERE code=?",
              raw.toUpperCase(),
            ).id
          : this.resolve(raw, kind).business;
      const requestId = text(body.requestId, 100);
      if (requestId.length < 12) fail("requestIdRequired");
      const existing = this.get(
        "SELECT * FROM orders WHERE business=? AND requestId=?",
        b,
        requestId,
      );
      if (existing) return { id: existing.id, status: existing.status };
      if (!text(body.customer) || !text(body.phone)) fail("required");
      const items = this.priceItems(b, body, true),
        total = items.reduce((s, i) => s + i.total, 0),
        settings = this.business(b);
      if (body.currency !== settings.currency) fail("invalidCurrency");
      if (total < settings.minOrder) fail("minimumOrder");
      const id = randomUUID(),
        date = new Date().toISOString();
      const data = {
        id,
        number: `P-${id.slice(0, 8).toUpperCase()}`,
        date,
        items,
        total,
        currency: body.currency,
        customer: text(body.customer),
        phone: text(body.phone, 60),
        address: text(body.address),
        table: text(body.table, 60),
        notes: text(body.notes, 1000),
        channel: kind,
      };
      this.run(
        "INSERT INTO orders(id,business,requestId,date,data) VALUES(?,?,?,?,?)",
        id,
        b,
        requestId,
        date,
        json(data),
      );
      return { id, number: data.number, status: "new" };
    });
  }
  draft(raw, body) {
    const l = this.resolve(raw, "collaborate"),
      p = this.normalizeProduct(body);
    this.run(
      "INSERT INTO drafts VALUES(?,?,?,?)",
      p.id,
      l.business,
      new Date().toISOString(),
      json(p),
    );
    return { id: p.id };
  }
  approve(b, id) {
    return this.transaction(() => {
      const d = this.get(
        "SELECT * FROM drafts WHERE id=? AND business=?",
        id,
        b,
      );
      if (!d) fail("notFound", 404);
      const p = parse(d.data);
      this.writeProduct(b, p);
      this.run("DELETE FROM drafts WHERE id=?", id);
      return p;
    });
  }
  workspace(u) {
    const b = u.business;
    const registers = this.all(
      "SELECT * FROM registers WHERE business=? ORDER BY opened DESC",
      b,
    );
    const sales = this.all(
      "SELECT data FROM sales WHERE business=? ORDER BY date DESC",
      b,
    ).map((r) => parse(r.data));
    const paidBalances = new Map();
    for (const r of this.all(
      "SELECT client,currency,sum(amount) as amount FROM receipts WHERE business=? GROUP BY client,currency",
      b,
    ))
      paidBalances.set(`${r.client}:${r.currency}`, r.amount);
    for (const sale of [...sales].reverse()) {
      const key = `${sale.client?.id}:${sale.currency}`,
        received = paidBalances.get(key) || 0;
      const applied =
        sale.status === "cancelled" ? 0 : Math.min(sale.due, received);
      sale.outstanding = sale.status === "cancelled" ? 0 : sale.due - applied;
      paidBalances.set(key, received - applied);
    }
    const clients = this.all(
      "SELECT data FROM clients WHERE business=?",
      b,
    ).map((r) => ({
      ...parse(r.data),
      balances: Object.fromEntries(
        currencies.map((c) => [c, this.balance(b, parse(r.data).id, c)]),
      ),
    }));
    return {
      business: this.business(b),
      user: u,
      products: this.listProducts(b),
      clients,
      sales,
      registers: registers.map((r) => ({
        ...r,
        expected: r.closed ? r.expected : this.expected(b, r),
      })),
      movements: this.all(
        "SELECT * FROM movements WHERE business=? ORDER BY date DESC",
        b,
      ),
      orders: this.all(
        "SELECT * FROM orders WHERE business=? ORDER BY date DESC",
        b,
      ).map((r) => ({ ...parse(r.data), status: r.status })),
      drafts:
        u.role === "owner"
          ? this.all("SELECT data FROM drafts WHERE business=?", b).map((r) =>
              parse(r.data),
            )
          : [],
      users:
        u.role === "owner"
          ? this.all("SELECT id,name,email,role FROM users WHERE business=?", b)
          : [],
      receipts: this.all(
        "SELECT * FROM receipts WHERE business=? ORDER BY date DESC",
        b,
      ),
      links:
        u.role === "owner"
          ? this.all(
              "SELECT code,kind,expires,active FROM links WHERE business=? ORDER BY expires DESC",
              b,
            )
          : [],
    };
  }
  addUser(b, body) {
    const email = text(body.email).toLowerCase(),
      name = text(body.name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) fail("required");
    if (this.get("SELECT id FROM users WHERE email=?", email))
      fail("emailUsed", 409);
    const id = randomUUID();
    this.run(
      "INSERT INTO users VALUES(?,?,?,?,?,?)",
      id,
      b,
      email,
      name,
      passwordHash(password(body.password)),
      "cashier",
    );
    return { id, name, email, role: "cashier" };
  }
}

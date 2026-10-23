import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.js";
import { Store } from "../lib/store.js";
import { cashTenderSummary, parseTenderAmount } from "../public/money.js";

const dir = mkdtempSync(join(tmpdir(), "only-test-"));
let server,
  store,
  base,
  owner,
  other,
  operator,
  business,
  product,
  register,
  client,
  sale,
  mobile,
  collab;
const headers = { "Content-Type": "application/json", "X-Only-Request": "1" };
async function call(path, body, cookie = "") {
  const r = await fetch(base + path, {
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined
      ? { method: "POST", body: JSON.stringify(body) }
      : {}),
  });
  const type = r.headers.get("content-type");
  return {
    status: r.status,
    body: type?.includes("json") ? await r.json() : await r.text(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function good(path, body, cookie = owner) {
  const r = await call(path, body, cookie);
  assert.ok(r.status < 300, JSON.stringify(r));
  return r.body;
}
before(async () => {
  ({ server, store } = createApp({ dataDir: dir }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test("Florales tender rules preserve cents and parse comma decimals", () => {
  assert.equal(parseTenderAmount("1.234,56"), 1234.56);
  assert.equal(parseTenderAmount("1,234.56"), 1234.56);
  assert.ok(Number.isNaN(parseTenderAmount("-10")));
  assert.deepEqual(cashTenderSummary(17.9, "20"), {
    valid: true,
    received: 20,
    total: 17.9,
    change: 2.1,
    remaining: 0,
  });
  assert.equal(cashTenderSummary(17.9, "10").remaining, 7.9);
});
test("create independent companies, sign in, and persist an HTTP-only session", async () => {
  const a = await call("/api/signup", {
    email: "owner@example.test",
    password: "secure-test-123",
    name: "Owner",
    businessName: "ONLY Store",
  });
  assert.equal(a.status, 200);
  owner = a.cookie;
  assert.ok(owner.startsWith("only_session="));
  const b = await call("/api/signup", {
    email: "other@example.test",
    password: "secure-test-123",
    name: "Other",
    businessName: "Other Store",
  });
  other = b.cookie;
  const w = await good("/api/workspace");
  business = w.business;
  assert.equal(business.name, "ONLY Store");
  assert.equal(w.products.length, 0);
  assert.equal((await call("/api/workspace")).status, 401);
  assert.equal(
    (
      await call("/api/login", {
        email: "owner@example.test",
        password: "wrong",
      })
    ).status,
    401,
  );
  const login = await call("/api/login", {
    email: "owner@example.test",
    password: "secure-test-123",
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await call("/api/workspace", undefined, login.cookie)).body.business.id,
    business.id,
  );
});
test("products have four independent price tables and tenant isolation", async () => {
  product = await good("/api/products", {
    name: "Coffee",
    code: "CAF-01",
    prices: { BRL: 10, BOB: 15, USD: 3, EUR: 2 },
    wholesale: { BRL: 8 },
    stock: 10,
    trackStock: true,
    cost: 3,
    published: true,
  });
  assert.deepEqual(product.prices, {
    BRL: 1000,
    BOB: 1500,
    USD: 300,
    EUR: 200,
  });
  assert.equal(
    (await good("/api/workspace", undefined, other)).products.length,
    0,
  );
  assert.equal(
    (
      await call(
        "/api/products",
        { id: product.id, name: "Attack", prices: { BRL: 1 } },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/api/products",
        { name: "Duplicate", code: "CAF-01", prices: { BRL: 1 } },
        owner,
      )
    ).status,
    409,
  );
});
test("declining register setup does not open a register; payment requires one", async () => {
  const w = await good("/api/workspace");
  assert.equal(w.registers.length, 0);
  const r = await call(
    "/api/sales",
    {
      requestId: randomUUID(),
      currency: "BRL",
      items: [{ id: product.id, quantity: 1 }],
      received: 10,
      method: "cash",
    },
    owner,
  );
  assert.equal(r.body.error, "openRegisterRequired");
  register = await good("/api/registers/open", {
    name: "Caixa 1",
    currency: "BRL",
    opening: 50,
  });
  const second = await good("/api/registers/open", {
    name: "Caixa 2",
    currency: "USD",
    opening: 20,
  });
  assert.notEqual(second.id, register.id);
});
test("sale reprices on server, gives change, decrements stock once, and is idempotent", async () => {
  const payload = {
    requestId: randomUUID(),
    registerId: register.id,
    currency: "BRL",
    method: "cash",
    received: "30,00",
    items: [{ id: product.id, quantity: 2, price: 1 }],
  };
  sale = await good("/api/sales", payload);
  assert.equal(sale.total, 2000);
  assert.equal(sale.change, 1000);
  assert.equal(sale.paid, 2000);
  const retry = await good("/api/sales", payload);
  assert.equal(retry.id, sale.id);
  const w = await good("/api/workspace");
  assert.equal(w.products[0].stock, 8);
  assert.equal(w.registers.find((r) => r.id === register.id).expected, 7000);
});
test("underpayment requires a customer and explicit partial payment", async () => {
  const payload = {
    requestId: randomUUID(),
    registerId: register.id,
    currency: "BRL",
    method: "cash",
    received: 4,
    items: [{ id: product.id, quantity: 1 }],
  };
  assert.equal(
    (await call("/api/sales", payload, owner)).body.error,
    "clientRequired",
  );
  client = await good("/api/clients", { name: "Customer", phone: "123" });
  assert.equal(
    (await call("/api/sales", { ...payload, clientId: client.id }, owner)).body
      .error,
    "insufficientPayment",
  );
  const partial = await good("/api/sales", {
    ...payload,
    clientId: client.id,
    allowPartial: true,
  });
  assert.equal(partial.due, 600);
  let w = await good("/api/workspace");
  assert.equal(w.clients[0].balances.BRL, 600);
  await good("/api/receipts", {
    clientId: client.id,
    currency: "BRL",
    amount: 6,
    method: "cash",
    registerId: register.id,
  });
  w = await good("/api/workspace");
  assert.equal(w.clients[0].balances.BRL, 0);
  assert.equal(
    w.sales
      .filter((s) => s.client?.id === client.id)
      .reduce((n, s) => n + s.outstanding, 0),
    0,
  );
  assert.equal(w.registers.find((r) => r.id === register.id).expected, 8000);
});
test("atomic validation prevents overselling, combined duplicate quantities, and cross-currency errors", async () => {
  const payload = {
    requestId: randomUUID(),
    registerId: register.id,
    currency: "BRL",
    method: "cash",
    received: 2000,
    items: [
      { id: product.id, quantity: 5 },
      { id: product.id, quantity: 5 },
    ],
  };
  assert.equal(
    (await call("/api/sales", payload, owner)).body.error,
    "insufficientStock",
  );
  assert.equal((await good("/api/workspace")).products[0].stock, 7);
  assert.equal(
    (await call("/api/sales", { ...payload, currency: "USD" }, owner)).body
      .error,
    "registerCurrency",
  );
  const foreign = await good(
    "/api/products",
    { name: "Foreign", prices: { BRL: 4 }, stock: 10 },
    other,
  );
  assert.equal(
    (
      await call(
        "/api/sales",
        { ...payload, items: [{ id: foreign.id, quantity: 1 }] },
        owner,
      )
    ).status,
    404,
  );
});
test("public storefront hides private data and does not trust posted totals", async () => {
  const b = await good("/api/settings", {
    ...business,
    storeEnabled: true,
    minOrder: 5,
  });
  const catalog = await good(`/api/public/store/${b.code}`, undefined, "");
  assert.equal(catalog.business.name, "ONLY Store");
  assert.ok(!("users" in catalog));
  assert.ok(!("wholesale" in catalog.products[0]));
  assert.ok(!("cost" in catalog.products[0]));
  const payload = {
    requestId: randomUUID(),
    currency: "BRL",
    customer: "Online Customer",
    phone: "555",
    items: [{ id: product.id, quantity: 1, price: 0 }],
    total: 0,
  };
  const order = await good(`/api/public/store/${b.code}/order`, payload, "");
  assert.ok(order.number.startsWith("P-"));
  const duplicate = await good(
    `/api/public/store/${b.code}/order`,
    payload,
    "",
  );
  assert.equal(order.id, duplicate.id);
  const w = await good("/api/workspace");
  assert.equal(w.orders[0].total, 1000);
  assert.equal(w.products[0].stock, 7);
  assert.equal(w.sales.length, 2);
});
test("multiple mobile phones and join codes submit orders into the same ERP", async () => {
  mobile = await good("/api/links", { kind: "mobile" });
  const catalog = await good(
    `/api/public/mobile/${mobile.token}`,
    undefined,
    "",
  );
  assert.equal(catalog.products[0].id, product.id);
  const join = await good("/api/join", { code: mobile.code }, "");
  assert.ok(join.path.startsWith("/mobile/"));
  assert.equal((await call(join.path)).status, 200);
  for (const customer of ["Phone A", "Phone B"])
    await good(
      `/api/public/mobile/${mobile.token}/order`,
      {
        requestId: randomUUID(),
        currency: "BRL",
        customer,
        phone: "555",
        items: [{ id: product.id, quantity: 1 }],
      },
      "",
    );
  assert.equal((await good("/api/workspace")).orders.length, 3);
  const qr = await call(
    `/api/qr?path=${encodeURIComponent("/mobile/" + mobile.token)}`,
  );
  assert.equal(qr.status, 200);
  assert.match(qr.body, /<svg/);
  await good("/api/links/revoke", { code: mobile.code });
  assert.equal((await call(`/api/public/mobile/${mobile.token}`)).status, 404);
  assert.equal((await call("/api/public" + join.path)).status, 404);
});
test("collaborative registrations wait for approval and links can be revoked", async () => {
  collab = await good("/api/links", { kind: "collaborate" });
  const info = await good(
    `/api/public/collaborate/${collab.token}`,
    undefined,
    "",
  );
  assert.ok(!info.products);
  assert.ok(!info.users);
  await good(
    `/api/public/collaborate/${collab.token}/draft`,
    { name: "New snack", code: "SNACK", prices: { BRL: 20 }, stock: 3 },
    "",
  );
  let w = await good("/api/workspace");
  assert.equal(w.products.length, 1);
  assert.equal(w.drafts.length, 1);
  await good("/api/drafts/approve", { id: w.drafts[0].id });
  w = await good("/api/workspace");
  assert.equal(w.products.length, 2);
  assert.equal(w.drafts.length, 0);
  assert.equal(w.products.find((p) => p.code === "SNACK").prices.BRL, 2000);
  await good("/api/links/revoke", { code: collab.code });
  assert.equal(
    (await call(`/api/public/collaborate/${collab.token}`)).status,
    404,
  );
});
test("cashiers cannot modify brand, products, links, or another cashier register", async () => {
  await good("/api/users", {
    name: "Cashier",
    email: "cashier@example.test",
    password: "secure-test-123",
  });
  const login = await call("/api/login", {
    email: "cashier@example.test",
    password: "secure-test-123",
  });
  operator = login.cookie;
  for (const [path, body] of [
    ["/api/settings", { name: "Attack" }],
    ["/api/products", { name: "Attack" }],
    ["/api/links", { kind: "mobile" }],
  ])
    assert.equal((await call(path, body, operator)).status, 403);
  assert.equal(
    (
      await call(
        "/api/registers/close",
        { id: register.id, counted: 0 },
        operator,
      )
    ).status,
    403,
  );
  const register2 = await good(
    "/api/registers/open",
    { name: "Cashier 3", currency: "BRL", opening: 0 },
    operator,
  );
  assert.ok(register2.id);
  assert.equal(
    (
      await call(
        "/api/movements",
        { registerId: register.id, kind: "out", note: "Attack", amount: 1 },
        operator,
      )
    ).status,
    403,
  );
});
test("cancelled sales restore stock and cash once; closed registers reject new sales", async () => {
  await good("/api/sales/cancel", { id: sale.id });
  await good("/api/sales/cancel", { id: sale.id });
  let w = await good("/api/workspace");
  assert.equal(w.products.find((p) => p.id === product.id).stock, 9);
  assert.equal(w.registers.find((r) => r.id === register.id).expected, 6000);
  await good("/api/movements", {
    registerId: register.id,
    kind: "out",
    amount: 10,
    note: "Sangria",
  });
  const close = await good("/api/registers/close", {
    id: register.id,
    counted: 50,
    pin: "1234",
  });
  assert.equal(close.expected, 5000);
  assert.equal(close.difference, 0);
  assert.equal(
    (
      await call(
        "/api/sales",
        {
          requestId: randomUUID(),
          registerId: register.id,
          currency: "BRL",
          method: "cash",
          received: 10,
          items: [{ id: product.id, quantity: 1 }],
        },
        owner,
      )
    ).body.error,
    "openRegisterRequired",
  );
});
test("ordered items settle once and order finalization is transactional", async () => {
  const w = await good("/api/workspace"),
    o = w.orders.find((o) => o.status === "new"),
    r = w.registers.find((r) => r.currency === "BRL" && !r.closed);
  const sale = await good("/api/sales", {
    requestId: randomUUID(),
    registerId: r.id,
    currency: "BRL",
    method: "cash",
    received: 10,
    orderId: o.id,
    items: o.items,
  });
  assert.equal(sale.orderId, o.id);
  assert.equal(
    (
      await call(
        "/api/sales",
        {
          requestId: randomUUID(),
          registerId: r.id,
          currency: "BRL",
          method: "cash",
          received: 10,
          orderId: o.id,
          items: o.items,
        },
        owner,
      )
    ).body.error,
    "orderAlreadyProcessed",
  );
  assert.equal(
    (await good("/api/workspace")).orders.find((x) => x.id === o.id).status,
    "completed",
  );
});
test("CSRF rejects foreign origins and non-JSON posts", async () => {
  const r = await fetch(base + "/api/clients", {
    method: "POST",
    headers: { ...headers, Origin: "https://evil.test", Cookie: owner },
    body: JSON.stringify({ name: "Attack" }),
  });
  assert.equal(r.status, 403);
  const other = await fetch(base + "/api/clients", {
    method: "POST",
    headers: { "Content-Type": "text/plain", Cookie: owner },
    body: '{"name":"Attack"}',
  });
  assert.equal(other.status, 403);
  const privateFile = await fetch(base + "/data/only.sqlite");
  assert.equal(privateFile.status, 404);
});
test("database survives a new connection with all companies and transactions", () => {
  const reopened = new Store(dir);
  try {
    const rows = reopened.all("SELECT count(*) as n FROM businesses");
    assert.equal(rows[0].n, 2);
    const persisted = reopened.get(
      "SELECT data FROM sales WHERE id=?",
      sale.id,
    );
    assert.equal(JSON.parse(persisted.data).status, "cancelled");
  } finally {
    reopened.db.close();
  }
});

test("sales in BOB, USD and EUR use native prices without conversion", async () => {
  for (const [code, expected] of [
    ["BOB", 1500],
    ["USD", 300],
    ["EUR", 200],
  ]) {
    const r = await good("/api/registers/open", {
      name: `Currency ${code}`,
      currency: code,
      opening: 0,
    });
    const s = await good("/api/sales", {
      requestId: randomUUID(),
      registerId: r.id,
      currency: code,
      method: "cash",
      received: expected / 100,
      items: [{ id: product.id, quantity: 1 }],
    });
    assert.equal(s.currency, code);
    assert.equal(s.total, expected);
    assert.equal(s.change, 0);
  }
});

test('closing PIN and feedback settings persist without exposing the PIN hash', async () => {
  const first = await good('/api/registers/open',{name:'PIN validation 1',currency:'BRL',opening:20});
  const second = await good('/api/registers/open',{name:'PIN validation 2',currency:'BRL',opening:30});
  for (const pin of [undefined,'9999']) {
    const result=await call('/api/registers/close',{id:first.id,counted:20,pin},owner);
    assert.equal(result.status,403); assert.equal(result.body.error,'invalidClosingPin');
  }
  await good('/api/registers/close',{id:first.id,counted:20,pin:'1234'});
  const before=(await good('/api/workspace')).business;
  const changed=await good('/api/settings',{...before,minOrder:before.minOrder/100,closePin:'5678',soundEffects:false,saleAnimations:true});
  assert.equal(changed.closePinHash,undefined); assert.equal(changed.closePin,undefined);
  const settings=(await good('/api/workspace')).business;
  assert.equal(settings.soundEffects,false);assert.equal(settings.saleAnimations,true);assert.equal(settings.closePinHash,undefined);
  const wrong=await call('/api/registers/close',{id:second.id,counted:30,pin:'1234'},owner);
  assert.equal(wrong.body.error,'invalidClosingPin');
  assert.equal((await call('/api/settings',{...settings,closePin:'123'},owner)).body.error,'closingPinLength');
  assert.equal((await call('/api/settings',{...settings,closePin:'9999'},operator)).status,403);
  await good('/api/settings',{...settings,minOrder:settings.minOrder/100,soundEffects:false,saleAnimations:false});
  assert.ok(store.business(before.id).closePinHash);
  assert.ok(!store.business(before.id).closePinHash.includes('5678'));
  await good('/api/registers/close',{id:second.id,counted:30,pin:'5678'});
  const foreign=await call('/api/registers/close',{id:second.id,counted:30,pin:'5678'},other);
  assert.equal(foreign.status,400);
  assert.equal(foreign.body.error,"openRegisterRequired");
});

import { createApp } from "../server.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const dir = mkdtempSync(join(tmpdir(), "only-ui-"));
const { server } = createApp({ dataDir: dir });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: [
    "--no-sandbox",
    "--no-zygote",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
  ],
  headless: true,
});
const artifacts = process.env.SCREENSHOT_DIR || "test-results";
mkdirSync(artifacts, { recursive: true });
const errors = [],
  responses = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript(() => {
  window.onlyAudioStarts = [];
  const Native = window.AudioContext || window.webkitAudioContext;
  if (Native) {
    const original = Native.prototype.createOscillator;
    Native.prototype.createOscillator = function(...args) {
      const oscillator = original.apply(this,args), start = oscillator.start, setFrequency = oscillator.frequency.setValueAtTime;
      let scheduledFrequency;
      oscillator.frequency.setValueAtTime = function(value,time) { scheduledFrequency=value;return setFrequency.call(this,value,time); };
      oscillator.start = function(time) { window.onlyAudioStarts.push({frequency:scheduledFrequency,time});return start.call(this,time); };
      return oscillator;
    };
  }
});
const p = await context.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("401") && !m.text().includes("403")) errors.push(m.text());
});
p.on("response", (r) => {
  if (
    r.url().includes("/api/") &&
    r.status() >= 400 &&
    !r.url().endsWith("/workspace") && !(r.url().endsWith('/registers/close') && r.status() === 403)
  )
    responses.push([r.url(), r.status()]);
});
const click = async (action) =>
  p.locator(`[data-action="${action}"]`).first().click();
const submit = async (form) =>
  p.locator(`[data-form="${form}"]`).evaluate((f) => f.requestSubmit());
try {
  await p.goto(base);
  await p.locator('[data-form="login"]').waitFor();
  await click("auth-signup");
  await p.locator('[name="name"]').fill("Operador exemplo");
  await p.locator('[name="businessName"]').fill("Minha empresa");
  await p.locator('[name="email"]').fill("demo@only.example");
  await p.locator('[name="password"]').fill("only-test-123");
  await submit("signup");
  await p.getByText("Vamos abrir o caixa?", { exact: true }).waitFor();
  await click("close-dialog");
  assert.ok(await p.locator('[data-action="checkout"]').isDisabled());
  await click("menu");
  await click("erp");
  await p.locator('[data-view="products"]').click();
  await click("new-product");
  await p.locator('dialog [name="name"]').fill("Café especial");
  await p.locator('dialog [name="code"]').fill("CAF-001");
  await p.locator('dialog [name="category"]').fill("Bebidas");
  await p.locator('dialog [name="stock"]').fill("25");
  for (const [c, v] of Object.entries({
    BRL: "8.5",
    BOB: "12",
    USD: "2.2",
    EUR: "2",
  }))
    await p.locator(`[name="price_${c}"]`).fill(v);
  await submit("product");
  await p.locator("dialog").waitFor({ state: "hidden" });
  await p.getByText("Café especial", { exact: true }).waitFor();
  // Add the remaining sample products through the same authenticated HTTP boundary.
  const seeded = await p.evaluate(async () => {
    const products = [
      ["Salgado assado", "SAL-002", "Lanches", 12],
      ["Suco natural", "SUC-003", "Bebidas", 9],
      ["Sanduíche artesanal", "SAN-004", "Lanches", 24.9],
      ["Água mineral", "AGU-005", "Bebidas", 4],
      ["Porção individual", "POR-006", "Porções", 18],
      ["Doce da casa", "DOC-007", "Sobremesas", 7.5],
      ["Combo especial", "COM-008", "Combos", 32],
    ];
    for (const [name, code, category, price] of products)
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Only-Request": "1" },
        body: JSON.stringify({
          name,
          code,
          category,
          prices: {
            BRL: price,
            BOB: price * 1.5,
            USD: price / 5,
            EUR: price / 6,
          },
          stock: 30,
        }),
      });
    return true;
  });
  assert.ok(seeded);
  await click("pos");
  await p.reload();
  await p.getByText("Vamos abrir o caixa?", { exact: true }).waitFor();
  await click("close-dialog");
  await p.locator("[data-add]").first().click();
  await p.locator("#search").fill("CAF-001");
  await p.locator("#search").press("Enter");
  assert.equal(await p.locator(".cart-line").count(), 2);
  await p.locator('.topbar [data-action="registers"]').click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  assert.equal(await p.locator('.register-card').count(),0);
  await click("register");
  await p.locator('dialog [name="name"]').fill("Caixa 01");
  await p.locator('dialog [name="opening"]').fill("100");
  await submit("open-register");
  await p.locator("dialog").waitFor({ state: "hidden" });

  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p.screenshot({ animations: "disabled",
    path: join(artifacts, "pdv-desktop.png"),
    fullPage: true,
  });
  await click("checkout");
  await p.locator('#paymentForm [name="received"]').fill("50,00");
  const summary = await p.locator("#tenderSummary").innerText();
  assert.match(summary, /Troco/);
  console.log("Tender:", summary.replaceAll("\n", " "));
  await submit("sale");
  await p.locator("#printArea").waitFor();
  await p.locator('.sale-success-badge').waitFor();
  assert.equal(await p.locator('.sale-feedback-layer').evaluate(el=>el.matches(':popover-open')),true);
  assert.ok(await p.evaluate(()=>window.onlyAudioStarts.some(n=>Math.abs(n.frequency-783.99)<1)), 'soft sale chime was scheduled after confirmation');
  await p.waitForTimeout(180);
  await p.screenshot({path:join(artifacts,'venda-concluida-efeitos.png'),fullPage:true});
  assert.match(await p.locator("#printArea").innerText(), /Troco/);
  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p.screenshot({ animations: "disabled", path: join(artifacts, "comprovante.png") });
  await click("close-dialog");
  await click("menu");
  await click("erp");
  await p.locator('[data-view="catalog"]').click();
  await p.locator('[name="storeEnabled"]').check();
  await p
    .locator('[name="storeDescription"]')
    .fill("Peça seus favoritos. A gente prepara com carinho.");
  await submit("store");
  await p.locator(".share-copy>a").waitFor();
  const storeUrl = await p.locator(".share-copy>a").getAttribute("href");
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(storeUrl);
  await phone.locator("[data-add]").first().click();
  await phone.locator('[data-action="mobile-cart"]').click();
  await phone.locator('[data-action="order-checkout"]').click();
  await phone.locator('[name="customer"]').fill("Cliente no celular");
  await phone.locator('[name="phone"]').fill("999999999");
  await phone.locator('[data-form="order"]').evaluate((f) => f.requestSubmit());
  await phone.getByText("Pedido enviado!", { exact: true }).waitFor();
  await phone.locator('[data-action="close-dialog"]').first().click();
  await phone.locator("#toast").evaluate((el) => (el.className = ""));
  await phone.screenshot({ animations: "disabled",
    path: join(artifacts, "loja-mobile.png"),
    fullPage: false,
  });
  await p.locator('[data-view="orders"]').click();
  await click("refresh");
  await p.getByText("Cliente no celular", { exact: true }).waitFor();
  await click("import-order");
  await p.locator(".cart-line").waitFor();
  await click("checkout");
  await submit("sale");
  await p.locator("#printArea").waitFor();
  await click("close-dialog");
  await click("menu");
  await click("erp");
  await p.locator('[data-view="reports"]').click();
  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p.screenshot({ animations: "disabled",
    path: join(artifacts, "erp-desktop.png"),
    fullPage: true,
  });
  await p.locator('[data-view="settings"]').click();
  await p.locator('[name="theme"]').selectOption("light");
  await p.locator('[name="language"]').selectOption("es");
  await submit("settings");
  await p
    .getByRole("heading", { name: "Configuración", exact: true })
    .waitFor();
  assert.equal(await p.locator("html").getAttribute("data-theme"), "light");
  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p.screenshot({ animations: "disabled",
    path: join(artifacts, "config-claro.png"),
    fullPage: true,
  });
  await p.locator('[name="theme"]').selectOption("dark");
  await p.locator('[name="language"]').selectOption("pt");
  await p.locator('[name="soundEffects"]').uncheck();
  await p.locator('[name="saleAnimations"]').uncheck();
  await p.locator('[name="closePin"]').fill('5678');
  await p.locator('[name="closePinConfirm"]').fill('5678');
  await submit("settings");
  await p
    .getByRole("heading", { name: "Configurações", exact: true })
    .waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  await click("pos");
  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p.screenshot({ animations: "disabled",
    path: join(artifacts, "pdv-mobile.png"),
    fullPage: false,
  });
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, "mobile horizontal overflow");
  const savedEffects=await p.evaluate(async()=> (await (await fetch('/api/workspace')).json()).business);
  assert.equal(savedEffects.soundEffects,false);assert.equal(savedEffects.saleAnimations,false);assert.equal(savedEffects.closePinHash,undefined);
  // Disabling feedback keeps the next completed sale silent and undecorated.
  await p.locator('[data-add]').first().click(); await click('mobile-cart');
  const soundsBefore=await p.evaluate(()=>window.onlyAudioStarts.length);
  await click('checkout'); await submit('sale'); await p.locator('#printArea').waitFor();
  assert.equal(await p.locator('.sale-feedback-layer').count(),0);
  assert.equal(await p.evaluate(()=>window.onlyAudioStarts.length),soundsBefore);
  await click('close-dialog');await click('mobile-products');
  // Manage registers created on multiple terminals from one POS screen.
  await p.locator("[data-add]").first().click();
  const registerBeforeClose = await p.evaluate(async () => {
    const w = await (await fetch("/api/workspace")).json();
    return w.registers.find((r) => !r.closed);
  });
  await p.locator('.topbar [data-action="registers"]').click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  await p.locator(`[data-action="close-register"][data-id="${registerBeforeClose.id}"]`).click();
  await p.locator('[data-form="close-register"]').waitFor();
  assert.equal(await p.locator('[data-form="close-register"] [name="id"]').inputValue(), registerBeforeClose.id);
  await p.locator('[name="counted"]').fill(String(registerBeforeClose.expected / 100 + 1));
  assert.match(await p.locator('[data-closing-difference] strong').innerText(), /1,00/);
  await p.locator('.modal-footer [data-action="close-dialog"]').click();
  assert.equal(await p.locator('.cart-line').count(), 1, "cancel keeps the sale in progress");
  const stillOpen = await p.evaluate(async (id) => (await (await fetch('/api/workspace')).json()).registers.find(r => r.id === id), registerBeforeClose.id);
  assert.equal(stillOpen.closed, null, "cancel leaves the register open");
  const otherRegister = await p.evaluate(async () => (await fetch('/api/registers/open', {method:'POST', headers:{'Content-Type':'application/json','X-Only-Request':'1'}, body:JSON.stringify({name:'Outro caixa',currency:'BRL',opening:50})})).json());
  await click('mobile-cart');
  await p.locator('.topbar [data-action="registers"]').click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  assert.equal(await p.locator('.register-card').count(),2);
  await p.screenshot({path:join(artifacts,'todos-caixas-mobile.png'),fullPage:true,animations:'disabled'});
  await p.locator(`[data-action="close-register"][data-id="${registerBeforeClose.id}"]`).click();
  await p.locator('[data-form="close-register"]').waitFor();
  await p.locator('[name="counted"]').fill(String(registerBeforeClose.expected / 100 - 1));
  assert.match(await p.locator('[data-closing-difference] strong').innerText(), /-.*1,00/);
  await p.setViewportSize({width:320,height:740});
  assert.equal(await p.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false,'closing dialog fits narrow phones');
  await p.setViewportSize({width:390,height:844});
  await p.screenshot({path:join(artifacts,'fechar-caixa-mobile.png'),fullPage:true,animations:'disabled'});
  await p.setViewportSize({width:1366,height:768});
  await p.screenshot({path:join(artifacts,'fechar-caixa-desktop.png'),fullPage:true,animations:'disabled'});
  await p.locator('[name="pin"]').fill('1234');
  await p.getByRole('button',{name:'Confirmar fechamento',exact:true}).click();
  await p.getByText('Senha do caixa incorreta. Confira e tente novamente.',{exact:true}).waitFor();
  await p.locator('[name="pin"]').fill('5678');
  await p.getByRole('button',{name:'Confirmar fechamento',exact:true}).click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  assert.equal(await p.locator('.register-card').count(),1);
  await p.locator('.modal-footer [data-action="close-dialog"]').click();
  await p.locator('.pos-shell').waitFor();
  assert.equal(await p.locator('.cart-line').count(),1,"closing keeps the cart");
  const afterClose = await p.evaluate(async()=> (await (await fetch('/api/workspace')).json()));
  const closedRegister=afterClose.registers.find(r=>r.id===registerBeforeClose.id);
  assert.ok(closedRegister.closed);
  assert.equal(closedRegister.counted,registerBeforeClose.expected-100);
  assert.equal(afterClose.registers.find(r=>r.id===otherRegister.id).closed,null,"other registers remain open");
  await click('menu'); await click('erp'); await p.locator('[data-view="cash"]').click();
  assert.match(await p.locator('tbody').first().innerText(), /Caixa fechado/);
  // The ERP retains access to the same closing dialog.
  await p.locator(`[data-action="close-register"][data-id="${otherRegister.id}"]`).click();
  await p.locator('[data-form="close-register"]').waitFor();
  assert.equal(await p.locator('[name="id"]').inputValue(),otherRegister.id);
  await p.locator('.modal-footer [data-action="close-dialog"]').click();
  await click('pos');await p.locator('.topbar [data-action="registers"]').click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  await p.locator(`[data-action="close-register"][data-id="${otherRegister.id}"]`).click();
  await p.locator('[name="counted"]').fill('50');await p.locator('[name="pin"]').fill('5678');
  await p.getByRole('button',{name:'Confirmar fechamento',exact:true}).click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  assert.equal(await p.locator('.register-card').count(),0);
  await p.locator('.modal-footer [data-action="close-dialog"]').click();
  assert.equal(await p.locator('.topbar [data-action="registers"]').innerText(),'Caixa');
  assert.equal(await p.locator('.cart-panel [data-action="registers"], .pos-register-strip button').count(),0);
  await p.locator('.topbar [data-action="registers"]').click();
  await p.getByRole('heading',{name:'Caixas abertos',exact:true}).waitFor();
  assert.ok(await p.locator('dialog [data-action="register"]').isVisible());
  await p.locator('.modal-footer [data-action="close-dialog"]').click();
  console.log('Register closing passed: central manager, independent registers, custom PIN enforcement, cancel, discrepancy, preserved cart, ERP.');
  console.log('Feedback passed: success chime and popover after persisted sale; independent saved toggles disable feedback.');
  console.log(
    "UI flows passed:",
    JSON.stringify({
      desktop: true,
      mobile: true,
      storeOrder: true,
      settledOrder: true,
      spanish: true,
      lightTheme: true,
      errors,
      responses,
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(responses, []);
} catch (e) {
  console.log("Original error:", e);
  await p.locator("#toast").evaluate((el) => (el.className = ""));
  await p
    .screenshot({ path: join(artifacts, "error.png"), fullPage: true })
    .catch(() => {});
  console.log(
    "ERROR TEXT:",
    (
      await p
        .locator("body")
        .innerText()
        .catch(() => "")
    ).slice(-3000),
  );
  console.log("Browser errors:", errors);
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
}

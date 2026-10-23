import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Store, fail, hash, text } from "./lib/store.js";

const root = dirname(fileURLToPath(import.meta.url));
export function createApp({
  dataDir = process.env.DATA_DIR || join(root, "data"),
  secure = process.env.COOKIE_SECURE === "true",
  appOrigin = process.env.APP_ORIGIN || "",
} = {}) {
  const store = new Store(dataDir),
    limits = new Map();
  const limit = (key, max = 60, period = 600000) => {
    const now = Date.now();
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const entry = limits.get(key);
    if (!entry || entry.until < now) {
      limits.set(key, { count: 1, until: now + period });
      return;
    }
    if (++entry.count > max) fail("rateLimited", 429);
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const send = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const origin =
          appOrigin || `${secure ? "https" : "http"}://${req.headers.host}`,
        url = new URL(req.url, origin),
        path = url.pathname;
      const session = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("only_session="))
        ?.slice(13);
      if (path === "/health")
        return send({ ok: true, app: "ONLY", version: "1.0.0" });
      if (path.startsWith("/api/")) {
        res.setHeader("Cache-Control", "no-store");
        let body = {};
        if (!["GET", "HEAD"].includes(req.method)) {
          if (
            req.headers["x-only-request"] !== "1" ||
            (req.headers.origin && req.headers.origin !== origin)
          )
            fail("forbidden", 403);
          if (!req.headers["content-type"]?.startsWith("application/json"))
            fail("invalidBody");
          let bytes = 0,
            parts = [];
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 1800000) fail("bodyTooLarge", 413);
            parts.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(parts).toString() || "{}");
          } catch {
            fail("invalidBody");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            fail("invalidBody");
        }
        const mutation = req.method === "POST";
        if (mutation && ["/api/signup", "/api/login"].includes(path)) {
          const ip = req.socket.remoteAddress;
          limit(`auth:${ip}`, 30);
          limit(`account:${hash(String(body.email).toLowerCase())}`, 12);
          const result = path.endsWith("signup")
            ? store.signup(body)
            : store.login(body);
          res.setHeader(
            "Set-Cookie",
            `only_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`,
          );
          return send({ user: result.user });
        }
        if (mutation && path === "/api/logout") {
          if (session)
            store.run("DELETE FROM sessions WHERE token=?", hash(session));
          res.setHeader(
            "Set-Cookie",
            "only_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          );
          return send({ ok: true });
        }
        if (path === "/api/qr" && req.method === "GET") {
          const relative = url.searchParams.get("path") || "";
          if (!/^\/(store|mobile|collaborate)\/[A-Za-z0-9_-]+$/.test(relative))
            fail("invalidLink");
          const svg = await QRCode.toString(origin + relative, {
            type: "svg",
            margin: 3,
            width: 260,
            color: { dark: "#111111", light: "#ffffff" },
          });
          res.writeHead(200, {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-store",
          });
          return res.end(svg);
        }
        if (path === "/api/join" && mutation) {
          limit(`join:${req.socket.remoteAddress}`, 30);
          const l = store.get(
            "SELECT * FROM links WHERE code=? AND kind='mobile' AND active=1 AND expires>?",
            text(body.code).toUpperCase(),
            Date.now(),
          );
          if (!l) fail("expiredLink", 404);
          // Resolve by code without ever returning a privileged session.
          return send({ path: `/mobile/${l.code}` });
        }
        const pub = path.match(
          /^\/api\/public\/(store|mobile|collaborate)\/([A-Za-z0-9_-]+)(?:\/(order|draft))?$/,
        );
        if (pub) {
          const [, kind, key, action] = pub;
          limit(`public:${req.socket.remoteAddress}`, 180);
          if (!action && req.method === "GET") {
            if (kind === "collaborate") {
              const l = store.resolve(key, kind),
                b = store.business(l.business);
              return send({
                business: {
                  name: b.name,
                  currency: b.currency,
                  language: b.language,
                  theme: b.theme,
                  logo: b.logo,
                },
              });
            }
            return send(store.publicCatalog(key, kind));
          }
          if (mutation && action === "order" && kind !== "collaborate")
            return send(store.publicOrder(key, kind, body), 201);
          if (mutation && action === "draft" && kind === "collaborate")
            return send(store.draft(key, body), 201);
          fail("notFound", 404);
        }
        const u = store.authenticate(session),
          b = u.business;
        if (path === "/api/workspace" && req.method === "GET")
          return send(store.workspace(u));
        if (mutation && path === "/api/settings") {
          store.owner(u);
          return send(store.saveSettings(b, body));
        }
        if (mutation && path === "/api/products") {
          store.owner(u);
          return send(store.saveProduct(b, body, body.id));
        }
        if (mutation && path === "/api/clients")
          return send(store.client(b, body));
        if (mutation && path === "/api/registers/open")
          return send(store.openRegister(b, u, body));
        if (mutation && path === "/api/registers/close") {
          const r = store.register(b, body.id);
          if (r.user !== u.id) store.owner(u);
          return send(store.closeRegister(b, body));
        }
        if (mutation && path === "/api/movements") {
          const r = store.register(b, body.registerId);
          if (r.user !== u.id) store.owner(u);
          return send(store.movement(b, body));
        }
        if (mutation && path === "/api/sales")
          return send(store.completeSale(b, u, body), 201);
        if (mutation && path === "/api/sales/cancel") {
          store.owner(u);
          return send(store.cancel(b, body.id));
        }
        if (mutation && path === "/api/receipts") {
          const r = store.register(b, body.registerId);
          if (r.user !== u.id) store.owner(u);
          return send(store.receive(b, body));
        }
        if (mutation && path === "/api/links") {
          store.owner(u);
          return send(store.link(b, body.kind));
        }
        if (mutation && path === "/api/links/revoke") {
          store.owner(u);
          store.run(
            "UPDATE links SET active=0 WHERE business=? AND code=?",
            b,
            text(body.code),
          );
          return send({ ok: true });
        }
        if (mutation && path === "/api/drafts/approve") {
          store.owner(u);
          return send(store.approve(b, body.id));
        }
        if (mutation && path === "/api/drafts/reject") {
          store.owner(u);
          store.run(
            "DELETE FROM drafts WHERE business=? AND id=?",
            b,
            text(body.id),
          );
          return send({ ok: true });
        }
        if (mutation && path === "/api/users") {
          store.owner(u);
          return send(store.addUser(b, body));
        }
        if (mutation && path === "/api/password") {
          // Verify the current password before rotating it and invalidating other sessions.
          const row = store.get("SELECT email FROM users WHERE id=?", u.id);
          const verified = store.login({
            email: row.email,
            password: body.currentPassword,
          });
          store.run("DELETE FROM sessions WHERE token=?", hash(verified.token));
          const { scryptSync, randomBytes } = await import("node:crypto");
          if (
            typeof body.password !== "string" ||
            body.password.length < 8 ||
            body.password.length > 128
          )
            fail("passwordLength");
          const salt = randomBytes(16).toString("hex");
          store.run(
            "UPDATE users SET password=? WHERE id=?",
            `${salt}:${scryptSync(body.password, salt, 64).toString("hex")}`,
            u.id,
          );
          store.run(
            "DELETE FROM sessions WHERE user=? AND token<>?",
            u.id,
            hash(session),
          );
          return send({ ok: true });
        }
        if (mutation && path === "/api/orders/status") {
          if (!["accepted", "cancelled"].includes(body.status))
            fail("invalidStatus");
          const order = store.get(
            "SELECT * FROM orders WHERE id=? AND business=?",
            text(body.id),
            b,
          );
          if (!order) fail("notFound", 404);
          if (["completed", "cancelled"].includes(order.status))
            fail("orderAlreadyProcessed", 409);
          store.run(
            "UPDATE orders SET status=? WHERE id=? AND business=?",
            body.status,
            body.id,
            b,
          );
          return send({ ok: true });
        }
        fail("notFound", 404);
      }
      if (!["GET", "HEAD"].includes(req.method)) fail("notFound", 404);
      const file =
        path === "/" ||
        /^\/(store|mobile|collaborate|join)(\/[^/]+)?$/.test(path)
          ? "index.html"
          : decodeURIComponent(path.slice(1));
      const target = resolve(root, "public", file);
      if (!target.startsWith(resolve(root, "public") + "/"))
        fail("notFound", 404);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
      };
      const data = await readFile(target).catch(() => fail("notFound", 404));
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (!e.status) console.error("ONLY request failed:", e.message);
      send({ error: e.status ? e.message : "serverError" }, e.status || 500);
    }
  });
  server.on("close", () => store.db.close());
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () =>
    console.log(`ONLY running on port ${port}`),
  );
}

// GitHub Pages serves the interface. A configured system URL opens the live server.
let systemUrl = "";
try {
  const response = await fetch(new URL("./site-config.json", import.meta.url), {
    cache: "no-store",
  });
  if (response.ok) systemUrl = (await response.json()).systemUrl || "";
} catch {}
if (systemUrl) {
  const target = new URL(systemUrl);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("The system URL must be a public HTTPS address.");
  if (target.origin === location.origin)
    throw new Error("The system URL must point to the running application.");
  location.replace(target.href);
} else {
  window.ONLY_STATIC_SITE = true;
  await import("./app.js");
}

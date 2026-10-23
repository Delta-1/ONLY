// GitHub Pages serves the interface. A configured system URL opens the live server.
let systemUrl = "", cloud = null;
try {
  const response = await fetch(new URL("./site-config.json", import.meta.url), {
    cache: "no-store",
  });
  if (response.ok) { const config = await response.json(); systemUrl=config.systemUrl||""; cloud=config.supabase||null; }
} catch {}
if (systemUrl) {
  const target = new URL(systemUrl);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("The system URL must be a public HTTPS address.");
  if (target.origin === location.origin)
    throw new Error("The system URL must point to the running application.");
  location.replace(target.href);
} else {
  if(cloud?.url && cloud?.publishableKey) { window.ONLY_CLOUD=cloud; window.ONLY_STATIC_SITE=false; }
  else window.ONLY_STATIC_SITE = true;
  await import("./app.js");
}

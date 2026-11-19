const CACHE = "tong-yuck-shell-v3";
const OFFLINE = "asad-offline-shell-v2";
const READY = "/offline-v2/shell-ready";
const SHELL = ["/", "/live", "/prep", "/sessions", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
const RUNTIME = new Set([
  "/offline-v2/inference.js",
  "/offline-v2/transformers.web.js",
  "/offline-v2/ort-wasm-simd-threaded.jsep.mjs",
  "/offline-v2/ort-wasm-simd-threaded.jsep.wasm",
  "/offline-v2/ko-check.wav",
]);
const asset = (path) => RUNTIME.has(path) || /^\/_next\/static\/[\w./-]+$/.test(path);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => (key.startsWith("tong-yuck-shell-") && key !== CACHE) ||
      (key.startsWith("asad-offline-shell-") && key !== OFFLINE)).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "ASAD_PREPARE_SHELL" || !event.ports[0]) return;
  const respond = (ok) => event.ports[0].postMessage({ ok });
  event.waitUntil((async () => {
    try {
      const paths = event.data.paths;
      if (!Array.isArray(paths) || paths.length > 200 || !paths.every((path) => typeof path === "string" && asset(path))) {
        throw new Error("Invalid offline assets");
      }
      const cache = await caches.open(OFFLINE);
      for (const path of new Set([...RUNTIME, ...paths])) {
        if (await cache.match(path)) continue;
        const response = await fetch(path, { redirect: "error", cache: "reload" });
        if (!response.ok) throw new Error("Cannot cache offline asset");
        await cache.put(path, response);
      }
      const page = await fetch("/live", { redirect: "error", cache: "reload" });
      if (!page.ok || !page.headers.get("content-type")?.startsWith("text/html")) throw new Error("Cannot cache ASAD");
      // Include the assets referenced by the downloaded document, which may
      // belong to a different build than the tab requesting preparation.
      const markup = await page.clone().text();
      const required = [...new Set([...markup.matchAll(/["'](\/_next\/static\/[\w./-]+)/g)].map((match) => match[1]))];
      if (!required.some((path) => path.endsWith(".js"))) throw new Error("ASAD JavaScript assets were not found");
      for (const path of required) {
        if (!(await cache.match(path))) await cache.add(path);
      }
      await cache.put("/live", page);
      await cache.put(READY, new Response(JSON.stringify(["/live", ...new Set([...RUNTIME, ...paths, ...required])])));
      respond(true);
    } catch {
      respond(false);
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cached = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && SHELL.includes(url.pathname) && !url.search) {
          await cached.put(url.pathname, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        const offline = await caches.open(OFFLINE);
        return (url.pathname === "/live" ? await offline.match("/live") : undefined)
          ?? await cached.match(url.pathname) ?? await cached.match("/")
          ?? Response.error();
      }
    })());
    return;
  }

  if (!asset(url.pathname) && !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const prepared = await caches.open(OFFLINE);
    const offline = await prepared.match(url.pathname);
    if (offline) return offline;
    const shell = await caches.open(CACHE);
    const cached = await shell.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && !RUNTIME.has(url.pathname)) {
      await shell.put(request, response.clone()).catch(() => {});
    }
    return response;
  })());
});

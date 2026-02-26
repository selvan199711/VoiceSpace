const CACHE_NAME = "placevoice-shell-v4";
const APP_SHELL = [
  "/",
  "/index.html",
  "/drop.html",
  "/confirm.html",
  "/search.html",
  "/play.html",
  "/photos.html",
  "/settings.html",
  "/help.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Never intercept cross-origin calls (Firebase/Maps/CDNs), otherwise CORS can break.
  if (!isSameOrigin) return;

  const isNavigation = event.request.mode === "navigate";

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache only successful basic responses from this origin.
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (isNavigation) {
          const fallback = await caches.match("/index.html");
          if (fallback) return fallback;
        }
        throw new Error("Network error and no cache");
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const voiceId = event.notification?.data?.voiceId;
  const deepLink = event.notification?.data?.url;
  const target = deepLink || (voiceId ? `/play.html?voice=${encodeURIComponent(voiceId)}` : "/index.html");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "VoiceSpace";
  const options = {
    body: payload.body || "New update available",
    icon: payload.icon || "/assets/logo.png",
    badge: payload.badge || "/assets/logo.png",
    tag: payload.tag || "voicespace-push",
    renotify: true,
    data: {
      ...(payload.data || {}),
      url: payload.url || payload?.data?.url || "/index.html"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

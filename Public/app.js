(() => {
  const page = document.body.dataset.page || "";
  const toastEl = document.getElementById("toast");
  const MAP_RADIUS_M = 1200;
  const ALERT_RADIUS_M = 1000;
  const ALERT_POLL_MS = 45000;
  const ONBOARDING_SEEN_KEY = "pv.onboardingSeen.v1";
  const API_BASE = (
    localStorage.getItem("pv.apiBase") ||
    document.querySelector('meta[name="api-base"]')?.content ||
    ""
  ).trim().replace(/\/+$/, "");
  const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 };
  const DEFAULT_GOOGLE_KEY = "AIzaSyBPGOsRFpUMCXQQIKxGcN7ObedfUuXfwQU";
  const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA8Oai8MCZrDeNPSnRub3kg_NUPZXSdZ7I",
    authDomain: "voicebase-51a13.firebaseapp.com",
    projectId: "voicebase-51a13",
    storageBucket: "voicebase-51a13.firebasestorage.app",
    messagingSenderId: "2525113010",
    appId: "1:2525113010:web:2fdd5ce20df70592aff7ab",
    measurementId: "G-Y69EF2816H"
  };
  const FIREBASE_STORAGE_BUCKETS = [
    "voicebase-51a13.appspot.com",
    "voicebase-51a13.firebasestorage.app"
  ];

  let installPromptEvent = null;
  let firebaseReady = null;
  let navUi = null;
  let proximityAlertTimer = null;
  const placeBackfillSeen = new Set();

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastEl._t);
    toastEl._t = window.setTimeout(() => toastEl.classList.remove("show"), 2500);
  }

  function apiUrl(pathname) {
    return `${API_BASE}${pathname}`;
  }

  function resolveMediaUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
    if (raw.startsWith("/uploads/") && API_BASE) return `${API_BASE}${raw}`;
    return raw;
  }

  function setupReveal() {
    const nodes = document.querySelectorAll(".reveal");
    if (!nodes.length) return;
    if (window.matchMedia("(max-width: 860px)").matches) {
      nodes.forEach((node) => node.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );
    nodes.forEach((node) => io.observe(node));
  }

  function initMobileShell() {
    const isMobile = window.matchMedia("(max-width: 860px)").matches;
    const existingTabbar = document.getElementById("mobileTabBar");
    const existingSheet = document.getElementById("mobileSheet");

    if (!isMobile) {
      existingTabbar?.remove();
      existingSheet?.remove();
      return;
    }

    const root = document.querySelector(".shell");
    if (!root || existingTabbar) return;

    const tabMap = {
      explore: "explore",
      search: "explore",
      play: "explore",
      photos: "explore",
      drop: "drop",
      confirm: "drop",
      settings: "menu",
      help: "menu"
    };
    const activeTab = tabMap[page] || "explore";

    const tabbar = document.createElement("nav");
    tabbar.id = "mobileTabBar";
    tabbar.className = "mobile-tabbar";
    tabbar.setAttribute("aria-label", "Mobile app tabs");
    tabbar.innerHTML = `
      <a class="mobile-tab" href="/index.html" ${activeTab === "explore" ? 'aria-current="page"' : ""}>Explore</a>
      <a class="mobile-tab" href="/drop.html" ${activeTab === "drop" ? 'aria-current="page"' : ""}>Drop Voice</a>
      <button class="mobile-tab menu" id="mobileMenuBtn" type="button" ${activeTab === "menu" ? 'aria-current="page"' : ""}>Menu</button>
    `;

    const sheet = document.createElement("section");
    sheet.id = "mobileSheet";
    sheet.className = "mobile-sheet";
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = `
      <div class="mobile-sheet-backdrop" data-close="1"></div>
      <div class="mobile-sheet-panel" role="dialog" aria-modal="true" aria-label="Quick menu">
        <div class="mobile-sheet-head">
          <strong>Quick Menu</strong>
          <button class="mobile-sheet-close" id="mobileSheetClose" type="button" aria-label="Close menu">×</button>
        </div>
        <div class="mobile-sheet-links">
          <a class="mobile-sheet-link" href="/settings.html">Settings</a>
          <a class="mobile-sheet-link" href="/search.html">Search</a>
          <a class="mobile-sheet-link" href="/play.html">Playback</a>
          <a class="mobile-sheet-link" href="/photos.html">Photos</a>
          <a class="mobile-sheet-link" href="/help.html">Help</a>
          <a class="mobile-sheet-link" href="/index.html">Explore</a>
        </div>
      </div>
    `;

    const closeSheet = () => {
      sheet.classList.remove("open");
      sheet.setAttribute("aria-hidden", "true");
    };
    const openSheet = () => {
      sheet.classList.add("open");
      sheet.setAttribute("aria-hidden", "false");
    };

    tabbar.querySelector("#mobileMenuBtn")?.addEventListener("click", () => {
      if (sheet.classList.contains("open")) closeSheet();
      else openSheet();
    });
    sheet.querySelector("#mobileSheetClose")?.addEventListener("click", closeSheet);
    sheet.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.close === "1") closeSheet();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && sheet.classList.contains("open")) closeSheet();
    });

    document.body.appendChild(tabbar);
    document.body.appendChild(sheet);
  }

  function isStandalonePwa() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function getDeviceProfile() {
    const ua = String(navigator.userAgent || "").toLowerCase();
    const isIpadOs = ua.includes("macintosh") && navigator.maxTouchPoints > 1;
    const ios = /iphone|ipad|ipod/.test(ua) || isIpadOs;
    const android = /android/.test(ua);
    const mobile = ios || android || /mobile/.test(ua);
    const safari = /safari/.test(ua) && !/crios|chrome|android|fxios|firefox|edg/.test(ua);
    const label = ios ? "iPhone/iPad" : android ? "Android phone" : mobile ? "Mobile browser" : "Desktop browser";
    return { ios, android, mobile, safari, label };
  }

  function getPushSupportMessage() {
    const profile = getDeviceProfile();
    if (!pushSupported()) {
      return "This browser has limited push support. Install in a modern browser for the best result.";
    }
    if (profile.ios && !isStandalonePwa()) {
      return "On iPhone/iPad, push works after installing to Home Screen. Then reopen the app and enable notifications.";
    }
    if (profile.ios && isStandalonePwa()) {
      return "This iPhone/iPad is ready for push. Enable notifications in-app and allow alerts when prompted.";
    }
    if (profile.android) {
      return "Android push is supported. Install the app and allow notifications when prompted.";
    }
    return "Push is supported on this device. Turn on notifications in Settings.";
  }

  function ensureInstallCoach() {
    const existing = document.getElementById("installCoach");
    if (existing) return existing;

    const root = document.createElement("section");
    root.id = "installCoach";
    root.className = "install-coach";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="install-coach-backdrop" data-close="1"></div>
      <article class="install-coach-panel" role="dialog" aria-modal="true" aria-label="Install and push guide">
        <header class="install-coach-head">
          <h3>Device + Push Setup</h3>
          <button id="installCoachClose" class="popup-x" type="button" aria-label="Close">×</button>
        </header>
        <p id="installCoachDevice" class="meta"></p>
        <p id="installCoachPush" class="meta"></p>
        <div id="installCoachSteps" class="list"></div>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="btn" id="installCoachTry" type="button">Try Install</button>
          <button class="btn secondary" id="installCoachDone" type="button">Got it</button>
        </div>
      </article>
    `;
    document.body.appendChild(root);

    const close = () => {
      root.classList.remove("open");
      root.setAttribute("aria-hidden", "true");
    };
    root.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.close === "1") close();
    });
    root.querySelector("#installCoachClose")?.addEventListener("click", close);
    root.querySelector("#installCoachDone")?.addEventListener("click", close);
    root.querySelector("#installCoachTry")?.addEventListener("click", async () => {
      await promptInstallApp();
    });
    return root;
  }

  function openInstallCoach() {
    const root = ensureInstallCoach();
    const profile = getDeviceProfile();
    const deviceEl = root.querySelector("#installCoachDevice");
    const pushEl = root.querySelector("#installCoachPush");
    const stepsEl = root.querySelector("#installCoachSteps");

    if (deviceEl) deviceEl.textContent = `Detected device: ${profile.label}`;
    if (pushEl) pushEl.textContent = getPushSupportMessage();

    if (stepsEl) {
      const iosSteps = `
        <article class="row-item"><strong>1. Tap Share in Safari</strong><div class="meta">Use the Share button at the bottom toolbar.</div></article>
        <article class="row-item"><strong>2. Add to Home Screen</strong><div class="meta">Install VoiceSpace as an app icon.</div></article>
        <article class="row-item"><strong>3. Reopen app + allow notifications</strong><div class="meta">Go to Settings and enable Nearby Alerts.</div></article>`;
      const androidSteps = `
        <article class="row-item"><strong>1. Tap Install App</strong><div class="meta">Accept browser install prompt.</div></article>
        <article class="row-item"><strong>2. Open installed app</strong><div class="meta">Launch from home screen icon.</div></article>
        <article class="row-item"><strong>3. Enable Nearby Alerts</strong><div class="meta">Allow notifications when prompted.</div></article>`;
      const genericSteps = `
        <article class="row-item"><strong>1. Install with browser menu</strong><div class="meta">Look for "Install app" or "Add to Home Screen".</div></article>
        <article class="row-item"><strong>2. Reopen app after install</strong><div class="meta">Installed mode improves push support.</div></article>
        <article class="row-item"><strong>3. Enable notifications in Settings</strong><div class="meta">Allow permission when requested.</div></article>`;
      stepsEl.innerHTML = profile.ios ? iosSteps : profile.android ? androidSteps : genericSteps;
    }

    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
  }

  async function promptInstallApp() {
    if (isStandalonePwa()) {
      toast("App is already installed on this device");
      return;
    }

    if (installPromptEvent) {
      try {
        installPromptEvent.prompt();
        await installPromptEvent.userChoice;
      } catch {
        // continue to guidance
      } finally {
        installPromptEvent = null;
      }
      return;
    }

    openInstallCoach();
  }

  function initOnboarding() {
    if (localStorage.getItem(ONBOARDING_SEEN_KEY) === "1") return;
    if (document.getElementById("onboardFlow")) return;

    const profile = getDeviceProfile();
    const root = document.createElement("section");
    root.id = "onboardFlow";
    root.className = "onboard-flow";
    root.setAttribute("aria-hidden", "false");
    root.innerHTML = `
      <div class="onboard-backdrop"></div>
      <article class="onboard-panel" role="dialog" aria-modal="true" aria-label="Welcome onboarding">
        <div class="onboard-glow"></div>
        <div class="onboard-track" id="onboardTrack">
          <section class="onboard-slide">
            <div class="onboard-art skyline"></div>
            <h3>Welcome to VoiceSpace</h3>
            <p>A location-first voice layer that feels like a native app.</p>
          </section>
          <section class="onboard-slide">
            <div class="onboard-art rocket"></div>
            <h3>Your Phone Check</h3>
            <p>Detected: <strong>${profile.label}</strong></p>
            <p>${getPushSupportMessage()}</p>
          </section>
          <section class="onboard-slide">
            <div class="onboard-art ripple"></div>
            <h3>Install for Best Experience</h3>
            <p>Install app mode gives smoother navigation and better notification reliability.</p>
          </section>
        </div>
        <footer class="onboard-actions">
          <button class="btn secondary" id="onboardPrev" type="button">Back</button>
          <button class="btn" id="onboardNext" type="button">Next</button>
          <button class="btn" id="onboardInstall" type="button">Install App</button>
          <button class="btn" id="onboardDone" type="button">Start Exploring</button>
        </footer>
      </article>
    `;
    document.body.appendChild(root);

    const track = root.querySelector("#onboardTrack");
    const btnPrev = root.querySelector("#onboardPrev");
    const btnNext = root.querySelector("#onboardNext");
    const btnInstall = root.querySelector("#onboardInstall");
    const btnDone = root.querySelector("#onboardDone");
    let step = 0;
    const maxStep = 2;

    const render = () => {
      if (track) track.style.transform = `translateX(-${step * 100}%)`;
      if (btnPrev) btnPrev.style.visibility = step === 0 ? "hidden" : "visible";
      if (btnNext) btnNext.style.display = step < maxStep ? "inline-flex" : "none";
      if (btnInstall) btnInstall.style.display = step === maxStep ? "inline-flex" : "none";
      if (btnDone) btnDone.style.display = step === maxStep ? "inline-flex" : "none";
    };

    const close = () => {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
      root.classList.add("closing");
      window.setTimeout(() => root.remove(), 260);
    };

    btnPrev?.addEventListener("click", () => {
      step = Math.max(0, step - 1);
      render();
    });
    btnNext?.addEventListener("click", () => {
      step = Math.min(maxStep, step + 1);
      render();
    });
    btnInstall?.addEventListener("click", async () => {
      await promptInstallApp();
    });
    btnDone?.addEventListener("click", close);

    render();
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "?m";
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
    return `${Math.round(meters)}m`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "expired";
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(m, 1)}m`;
  }

  function ensureNavigationOverlay() {
    if (navUi?.root?.isConnected) return navUi;

    const root = document.createElement("section");
    root.id = "inAppNavOverlay";
    root.className = "nav-overlay";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="nav-overlay-backdrop" data-nav-close="1"></div>
      <article class="nav-panel" role="dialog" aria-modal="true" aria-label="Live navigation">
        <header class="nav-head">
          <div>
            <h3 id="navTitle">Live Navigation</h3>
            <p id="navSubtitle">Preparing route...</p>
          </div>
          <button class="popup-x" id="btnNavClose" type="button" aria-label="Close navigation">×</button>
        </header>
        <div id="navMapCanvas" class="nav-map"></div>
        <div class="nav-stats">
          <article class="nav-stat"><strong id="navDistance">--</strong><span>Distance</span></article>
          <article class="nav-stat"><strong id="navDuration">--</strong><span>Travel Time</span></article>
          <article class="nav-stat"><strong id="navEta">--</strong><span>ETA</span></article>
        </div>
      </article>
    `;
    document.body.appendChild(root);

    const close = () => {
      root.classList.remove("show");
      root.setAttribute("aria-hidden", "true");
      window.setTimeout(() => {
        if (!root.classList.contains("show")) root.classList.add("hidden");
      }, 240);
    };

    root.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.navClose === "1") close();
    });
    root.querySelector("#btnNavClose")?.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("show")) close();
    });

    navUi = {
      root,
      close,
      title: root.querySelector("#navTitle"),
      subtitle: root.querySelector("#navSubtitle"),
      mapEl: root.querySelector("#navMapCanvas"),
      distance: root.querySelector("#navDistance"),
      duration: root.querySelector("#navDuration"),
      eta: root.querySelector("#navEta"),
      map: null,
      directionsService: null,
      directionsRenderer: null
    };
    return navUi;
  }

  function showNavigationOverlay(title, subtitle) {
    const ui = ensureNavigationOverlay();
    if (ui.title) ui.title.textContent = title;
    if (ui.subtitle) ui.subtitle.textContent = subtitle;
    if (ui.distance) ui.distance.textContent = "--";
    if (ui.duration) ui.duration.textContent = "--";
    if (ui.eta) ui.eta.textContent = "--";
    ui.root.classList.remove("hidden");
    ui.root.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => ui.root.classList.add("show"));
    return ui;
  }

  async function openNavigationTo(destination, label = "destination") {
    if (!Number.isFinite(destination?.lat) || !Number.isFinite(destination?.lng)) {
      toast("Navigation location is unavailable");
      return;
    }

    const ui = showNavigationOverlay(`Navigate to ${String(label).split(",")[0]}`, "Locating you and building route...");
    const googleOk = await loadGoogleMaps();
    if (!googleOk || !window.google?.maps?.DirectionsService || !ui.mapEl) {
      if (ui.subtitle) ui.subtitle.textContent = "Navigation map unavailable. Check Google Maps API access.";
      return;
    }

    if (!ui.map) {
      ui.map = new google.maps.Map(ui.mapEl, {
        center: { lat: destination.lat, lng: destination.lng },
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy"
      });
      ui.directionsService = new google.maps.DirectionsService();
      ui.directionsRenderer = new google.maps.DirectionsRenderer({
        map: ui.map,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: "#22d3ee",
          strokeOpacity: 0.95,
          strokeWeight: 6
        }
      });
    }
    window.setTimeout(() => {
      if (ui.map && window.google?.maps?.event) {
        google.maps.event.trigger(ui.map, "resize");
        ui.map.setCenter({ lat: destination.lat, lng: destination.lng });
      }
    }, 120);

    const liveOrigin = await getLiveCoordsOrNull();
    const origin = liveOrigin || await getUserCoords();

    const request = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      travelMode: google.maps.TravelMode.WALKING
    };

    ui.directionsService.route(request, (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        if (ui.subtitle) ui.subtitle.textContent = "Could not calculate route. Try moving outdoors for better GPS.";
        return;
      }

      ui.directionsRenderer.setDirections(result);
      const leg = result.routes[0]?.legs?.[0];
      const distanceText = leg?.distance?.text || "--";
      const durationText = leg?.duration?.text || "--";
      const seconds = Number(leg?.duration?.value || 0);
      const etaDate = seconds > 0 ? new Date(Date.now() + (seconds * 1000)) : null;
      const etaText = etaDate
        ? etaDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "--";

      if (ui.subtitle) {
        ui.subtitle.textContent = liveOrigin
          ? "Live walking route from your current GPS location."
          : "Route built using your last known/default location.";
      }
      if (ui.distance) ui.distance.textContent = distanceText;
      if (ui.duration) ui.duration.textContent = durationText;
      if (ui.eta) ui.eta.textContent = etaText;
    });
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function classifyPlaceKind(types = []) {
    const set = new Set(Array.isArray(types) ? types : []);
    if (set.has("shopping_mall")) return "Shopping Mall";
    if (set.has("supermarket")) return "Supermarket";
    if (set.has("convenience_store")) return "Convenience Store";
    if (set.has("department_store")) return "Department Store";
    if (set.has("store")) return "Store";
    if (set.has("playground")) return "Playground";
    if (set.has("park")) return "Park";
    if (set.has("school")) return "School";
    if (set.has("hospital")) return "Hospital";
    if (set.has("transit_station")) return "Transit Station";
    if (set.has("restaurant")) return "Restaurant";
    if (set.has("cafe")) return "Cafe";
    if (set.has("lodging")) return "Hotel/Lodging";
    if (set.has("apartment") || set.has("subpremise")) return "Apartment";
    if (set.has("premise") || set.has("street_address")) return "Building Address";
    if (set.has("establishment") || set.has("point_of_interest")) return "Point of Interest";
    return "Unknown Place";
  }

  function placeContextFromMeta(meta) {
    if (!meta) return null;
    return {
      name: meta.place_name || meta.formatted_address || "Pinned location",
      vicinity: meta.formatted_address || "",
      type_label: meta.place_kind || classifyPlaceKind(meta.types),
      rating: Number.isFinite(meta.rating) ? Number(meta.rating) : null,
      distance_m: Number.isFinite(meta.accuracy_m) ? Number(meta.accuracy_m) : null
    };
  }

  async function resolvePlaceMetaFromCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const mapsOk = await loadGoogleMaps();
    if (!mapsOk || !window.google?.maps?.Geocoder) return null;

    let geocode = null;
    try {
      const geocoder = new google.maps.Geocoder();
      geocode = await new Promise((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status !== "OK" || !Array.isArray(results) || !results.length) return resolve(null);
          resolve(results[0]);
        });
      });
    } catch {
      geocode = null;
    }

    let nearest = null;
    if (window.google?.maps?.places?.PlacesService) {
      try {
        const svc = new google.maps.places.PlacesService(document.createElement("div"));
        nearest = await new Promise((resolve) => {
          svc.nearbySearch(
            {
              location: { lat, lng },
              radius: 60
            },
            (results, status) => {
              if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(results) || !results.length) {
                return resolve(null);
              }
              resolve(results[0] || null);
            }
          );
        });
      } catch {
        nearest = null;
      }
    }

    const geoTypes = Array.isArray(geocode?.types) ? geocode.types : [];
    const placeTypes = Array.isArray(nearest?.types) ? nearest.types : [];
    const types = Array.from(new Set([...placeTypes, ...geoTypes]));
    const nLat = Number(nearest?.geometry?.location?.lat?.());
    const nLng = Number(nearest?.geometry?.location?.lng?.());
    const accuracy = Number.isFinite(nLat) && Number.isFinite(nLng)
      ? Math.round(haversineMeters({ lat, lng }, { lat: nLat, lng: nLng }))
      : null;

    return {
      lat,
      lng,
      place_id: nearest?.place_id || geocode?.place_id || "",
      place_name: nearest?.name || "",
      formatted_address: geocode?.formatted_address || nearest?.vicinity || "",
      types,
      place_kind: classifyPlaceKind(types),
      rating: Number(nearest?.rating),
      accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
      source: nearest ? "places+geocoder" : "geocoder",
      updated_at: Date.now()
    };
  }

  function getGoogleKey() {
    return (
      localStorage.getItem("pv.googleMapsKey") ||
      document.querySelector('meta[name="google-maps-key"]')?.content ||
      DEFAULT_GOOGLE_KEY
    ).trim();
  }

  function getDeleteTokens() {
    try {
      return JSON.parse(localStorage.getItem("pv.deleteTokens") || "{}");
    } catch {
      return {};
    }
  }

  function saveDeleteToken(id, token) {
    const map = getDeleteTokens();
    map[id] = token;
    localStorage.setItem("pv.deleteTokens", JSON.stringify(map));
  }

  function removeDeleteToken(id) {
    const map = getDeleteTokens();
    delete map[id];
    localStorage.setItem("pv.deleteTokens", JSON.stringify(map));
  }

  function getUserCoords() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(DEFAULT_CENTER);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(DEFAULT_CENTER),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 10000 }
      );
    });
  }

  function getLiveCoordsOrNull() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 10000 }
      );
    });
  }

  function notificationsEnabled() {
    const value = localStorage.getItem("pv.setNotify");
    return value === null ? true : value === "true";
  }

  function pushSupported() {
    return Boolean(
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  function base64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normalized);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function getPushPublicKey() {
    try {
      const res = await fetch(apiUrl("/api/push/public-key"));
      if (!res.ok) return "";
      const data = await res.json();
      if (!data?.enabled || !data?.publicKey) return "";
      return String(data.publicKey);
    } catch {
      return "";
    }
  }

  async function syncPushSubscription({ requestPermission = false } = {}) {
    if (!pushSupported() || !notificationsEnabled()) return;
    const publicKey = await getPushPublicKey();
    if (!publicKey) return;

    if (Notification.permission === "default" && requestPermission) {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (Notification.permission !== "granted") return;

    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }

      await fetch(apiUrl("/api/push/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription })
      });
    } catch {
      // permission or browser-level failure
    }
  }

  async function unsubscribePush() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      await fetch(apiUrl("/api/push/unsubscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    } catch {
      // no-op
    }
  }

  function settingEnabled(settingId, defaultValue = false) {
    const raw = localStorage.getItem(`pv.${settingId}`);
    if (raw === null) return defaultValue;
    return raw === "true";
  }

  function applyContrastMode() {
    const enabled = settingEnabled("setContrast", false);
    document.body.classList.toggle("high-contrast", enabled);
  }

  function shouldAutoplayOnSelect() {
    return settingEnabled("setAutoplay", false);
  }

  function isSoundOnStartEnabled() {
    return settingEnabled("setSound", true);
  }

  function getNotifiedMap() {
    try {
      return JSON.parse(localStorage.getItem("pv.notifiedVoices") || "{}");
    } catch {
      return {};
    }
  }

  function saveNotifiedMap(map) {
    localStorage.setItem("pv.notifiedVoices", JSON.stringify(map));
  }

  function pruneNotifiedMap(map) {
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    Object.keys(map).forEach((id) => {
      if (Number(map[id] || 0) < cutoff) delete map[id];
    });
  }

  async function sendLocalNotification(voice) {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const title = voice.images?.length
      ? "New voice + photo nearby"
      : "New voice nearby";
    const body = `${voice.title || "Untitled voice"} • ${formatDistance(voice.distance_m || NaN)} away`;
    const icon = "/assets/logo.png";

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          body,
          icon,
          badge: icon,
          tag: `voice-${voice.id}`,
          renotify: true,
          data: {
            voiceId: voice.id,
            lat: Number(voice.lat),
            lng: Number(voice.lng)
          }
        });
        return true;
      }
    } catch {
      // fallback below
    }

    try {
      const n = new Notification(title, { body, icon, tag: `voice-${voice.id}` });
      n.onclick = () => window.focus();
      return true;
    } catch {
      return false;
    }
  }

  async function runProximityNotificationCheck() {
    if (!notificationsEnabled()) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const here = await getLiveCoordsOrNull();
    if (!here) return;

    const voices = await fetchVoices(here.lat, here.lng, ALERT_RADIUS_M);
    const now = Date.now();
    const startedAt = Number(localStorage.getItem("pv.notifyStartAt") || String(now));
    const notified = getNotifiedMap();
    pruneNotifiedMap(notified);

    for (const voice of voices) {
      if (!voice?.id) continue;
      if (notified[voice.id]) continue;
      if (Number(voice.created_at || 0) < startedAt - 15000) continue;
      const notifiedOk = await sendLocalNotification(voice);
      if (notifiedOk) notified[voice.id] = now;
    }

    saveNotifiedMap(notified);
  }

  async function startProximityNotifications({ requestPermission = false } = {}) {
    if (proximityAlertTimer) window.clearInterval(proximityAlertTimer);
    if (!notificationsEnabled()) return;
    if (!("Notification" in window)) return;
    localStorage.setItem("pv.notifyStartAt", String(Date.now()));
    if (Notification.permission === "default" && requestPermission) {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (Notification.permission !== "granted") return;

    await runProximityNotificationCheck();
    proximityAlertTimer = window.setInterval(runProximityNotificationCheck, ALERT_POLL_MS);
  }

  function normalizeVoice(row, origin) {
    const now = Date.now();
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const distance = origin && Number.isFinite(lat) && Number.isFinite(lng)
      ? haversineMeters(origin, { lat, lng })
      : Number(row.distance_m || NaN);

    const expiresAt = Number(row.expires_at || row.expiresAt || 0);

    return {
      id: row.id,
      title: row.title || "Untitled voice",
      description: row.description || "",
      category: row.category || "General",
      lat,
      lng,
      created_at: Number(row.created_at || row.createdAt || now),
      expires_at: expiresAt,
      expires_in_ms: 0,
      distance_m: Number.isFinite(distance) ? Math.round(distance) : Number(row.distance_m || 0),
      audio_path: resolveMediaUrl(row.audio_path || row.audioUrl || row.audio_url || ""),
      images: Array.isArray(row.images)
        ? row.images.map(resolveMediaUrl)
        : Array.isArray(row.imageUrls)
          ? row.imageUrls.map(resolveMediaUrl)
          : []
    };
  }

  async function loadExternalScript(src, attrs = {}) {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return;
      await new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
      return;
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.src = src;
      Object.entries(attrs).forEach(([k, v]) => script.setAttribute(k, v));
      script.onload = () => {
        script.dataset.loaded = "1";
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadStylesheet(href) {
    if (document.querySelector(`link[data-href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.href = href;
    document.head.appendChild(link);
  }

  async function initFirebase() {
    if (firebaseReady) return firebaseReady;

    firebaseReady = (async () => {
      try {
        await loadExternalScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
        await loadExternalScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js");
        await loadExternalScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js");
        await loadExternalScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage-compat.js");

        if (!window.firebase) throw new Error("Firebase unavailable");
        const app = window.firebase.apps.length
          ? window.firebase.app()
          : window.firebase.initializeApp(FIREBASE_CONFIG);

        const auth = app.auth();
        const db = app.firestore();
        const storage = app.storage();

        // Use anonymous auth so Firestore/Storage rules can allow authenticated writes.
        if (!auth.currentUser) {
          try {
            await auth.signInAnonymously();
          } catch (authError) {
            console.error("Anonymous auth failed", authError);
          }
        }
        if (!auth.currentUser) {
          await new Promise((resolve) => {
            const timeoutId = window.setTimeout(resolve, 3000);
            const unsub = auth.onAuthStateChanged(() => {
              window.clearTimeout(timeoutId);
              unsub();
              resolve();
            });
          });
        }

        return { app, auth, db, storage };
      } catch (error) {
        console.error("Firebase init failed", error);
        return null;
      }
    })();

    return firebaseReady;
  }

  async function fetchVoicesFromFirebase(lat, lng, radius = MAP_RADIUS_M) {
    const fb = await initFirebase();
    if (!fb) return null;

    try {
      const snap = await fb.db
        .collection("voices")
        .orderBy("createdAt", "desc")
        .limit(400)
        .get();

      const origin = { lat, lng };
      const voices = snap.docs
        .map((doc) => normalizeVoice({ id: doc.id, ...doc.data() }, origin))
        .filter((voice) => Number.isFinite(voice.distance_m) && voice.distance_m <= radius)
        .sort((a, b) => b.created_at - a.created_at);

      return voices;
    } catch (error) {
      console.error("Firestore fetch failed", error);
      toast("Firestore read failed, using local API fallback");
      return null;
    }
  }

  async function fetchVoicesFromServer(lat, lng, radius = MAP_RADIUS_M) {
    try {
      const res = await fetch(apiUrl(`/api/voices?lat=${lat}&lng=${lng}&radius=${radius}`));
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data.voices) ? data.voices : []).map((voice) => normalizeVoice(voice, { lat, lng }));
    } catch {
      return [];
    }
  }

  async function fetchVoices(lat, lng, radius = MAP_RADIUS_M) {
    const fromFirebase = await fetchVoicesFromFirebase(lat, lng, radius);
    if (fromFirebase) return enrichVoicesWithPlaceContext(fromFirebase, { lat, lng });
    const fallback = await fetchVoicesFromServer(lat, lng, radius);
    return enrichVoicesWithPlaceContext(fallback, { lat, lng });
  }

  async function getVoiceById(id) {
    const fb = await initFirebase();
    if (fb) {
      try {
        const doc = await fb.db.collection("voices").doc(id).get();
        if (!doc.exists) return null;
        const voice = normalizeVoice({ id: doc.id, ...doc.data() });
        return voice;
      } catch {
        // continue to fallback
      }
    }

    try {
      const res = await fetch(apiUrl(`/api/voices/${encodeURIComponent(id)}`));
      if (!res.ok) return null;
      const row = await res.json();
      return normalizeVoice(row);
    } catch {
      return null;
    }
  }

  async function createVoiceOnFirebase(payload) {
    const fb = await initFirebase();
    if (!fb) return null;

    const id = fb.db.collection("voices").doc().id;
    const deleteToken = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const createdAt = Date.now();
    const expiresAt = 0;

    try {
      if (!fb.auth?.currentUser) throw new Error("unauthenticated");

      let usedBucket = "";
      let audioPath = "";
      let audioUrl = "";
      let imageUrls = [];
      let imagePaths = [];
      let lastStorageError = null;

      for (const bucket of FIREBASE_STORAGE_BUCKETS) {
        try {
          const storage = fb.app.storage(`gs://${bucket}`);
          audioPath = `voices/${id}/audio_${Date.now()}.webm`;
          const audioRef = storage.ref().child(audioPath);
          await audioRef.put(payload.audioFile, { contentType: payload.audioFile.type || "audio/webm" });
          audioUrl = await audioRef.getDownloadURL();

          const imageRows = await Promise.all(
            (payload.images || []).slice(0, 6).map(async (file, idx) => {
              const imagePath = `voices/${id}/image_${Date.now()}_${idx}.jpg`;
              const imageRef = storage.ref().child(imagePath);
              await imageRef.put(file, { contentType: file.type || "image/jpeg" });
              const imageUrl = await imageRef.getDownloadURL();
              return { imagePath, imageUrl };
            })
          );

          imageUrls = imageRows.map((x) => x.imageUrl);
          imagePaths = imageRows.map((x) => x.imagePath);
          usedBucket = bucket;
          break;
        } catch (storageError) {
          lastStorageError = storageError;
        }
      }

      if (!usedBucket || !audioUrl) {
        throw (lastStorageError || new Error("storage-upload-failed"));
      }

      await fb.db.collection("voices").doc(id).set({
        title: payload.title,
        description: payload.description,
        category: payload.category,
        lat: payload.lat,
        lng: payload.lng,
        createdAt,
        expiresAt,
        deleteToken,
        audioUrl,
        audioPath,
        imageUrls,
        imagePaths,
        storageBucket: usedBucket
      });

      return {
        id,
        deleteToken,
        createdAt,
        expiresAt,
        voice: normalizeVoice({
          id,
          title: payload.title,
          description: payload.description,
          category: payload.category,
          lat: payload.lat,
          lng: payload.lng,
          createdAt,
          expiresAt,
          audioUrl,
          imageUrls
        })
      };
    } catch (error) {
      console.error("Firestore create failed", error);
      const code = String(error?.code || "");
      if (code.includes("permission-denied") || code.includes("unauthorized")) {
        toast("Firebase permission denied. Enable Anonymous Auth and update Firestore/Storage rules.");
      } else if (code.includes("unauthenticated")) {
        toast("Firebase auth required. Enable Anonymous Auth in Firebase Console.");
      } else {
        toast(`Firebase write failed: ${code || error?.message || "unknown-error"}`);
      }
      return null;
    }
  }

  async function createVoiceOnServer(payload) {
    const form = new FormData();
    form.append("title", payload.title);
    form.append("description", payload.description);
    form.append("category", payload.category);
    form.append("lat", String(payload.lat));
    form.append("lng", String(payload.lng));
    form.append("audio", payload.audioFile, payload.audioFile.name || "voice.webm");
    (payload.images || []).slice(0, 6).forEach((img) => {
      form.append("images", img, img.name || "image.jpg");
    });

    const res = await fetch(apiUrl("/api/voices"), { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Server create failed");
    const full = await getVoiceById(data.id);
    return { id: data.id, deleteToken: data.deleteToken, createdAt: data.createdAt, expiresAt: data.expiresAt, voice: full };
  }

  async function createVoice(payload) {
    const firebaseResult = await createVoiceOnFirebase(payload);
    if (firebaseResult) return firebaseResult;
    return createVoiceOnServer(payload);
  }

  async function deleteVoice(id, token) {
    const fb = await initFirebase();
    if (fb) {
      try {
        const ref = fb.db.collection("voices").doc(id);
        const doc = await ref.get({ source: "server" });
        if (doc.exists) {
          const data = doc.data();
          if (String(data.deleteToken || "") !== String(token || "")) {
            throw new Error("Invalid delete token");
          }

          const paths = [];
          if (data.audioPath) paths.push(data.audioPath);
          if (Array.isArray(data.imagePaths)) paths.push(...data.imagePaths);

          const buckets = data.storageBucket
            ? [data.storageBucket, ...FIREBASE_STORAGE_BUCKETS.filter((b) => b !== data.storageBucket)]
            : FIREBASE_STORAGE_BUCKETS;

          await Promise.all(paths.map(async (p) => {
            for (const bucket of buckets) {
              try {
                await fb.app.storage(`gs://${bucket}`).ref().child(p).delete();
                break;
              } catch (_) {
                // try next bucket
              }
            }
          }));

          await ref.delete();
          return;
        }
        return;
      } catch (error) {
        console.error("Firestore delete failed", error);
      }
    }

    const res = await fetch(apiUrl(`/api/voices/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: { "x-delete-token": token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Delete failed");
  }

  async function geocodeFallback(query) {
    const q = String(query || "").trim();
    if (!q) return null;
    const url = `${NOMINATIM_ENDPOINT}?format=json&limit=1&q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) return null;
      return {
        name: rows[0].display_name,
        lat: Number(rows[0].lat),
        lng: Number(rows[0].lon)
      };
    } catch {
      return null;
    }
  }

  function placeTypeLabel(types = []) {
    if (!Array.isArray(types)) return "Nearby place";
    if (types.includes("shopping_mall")) return "Shopping Mall";
    if (types.includes("convenience_store")) return "Convenience Store";
    if (types.includes("supermarket")) return "Supermarket";
    if (types.includes("department_store")) return "Department Store";
    if (types.includes("store")) return "Store";
    if (types.includes("cafe")) return "Cafe";
    if (types.includes("restaurant")) return "Restaurant";
    return "Nearby place";
  }

  async function openAppDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("pv-app", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
        if (!db.objectStoreNames.contains("places")) db.createObjectStore("places");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function savePlacesCache(center, rows) {
    const db = await openAppDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("places", "readwrite");
      tx.objectStore("places").put(
        {
          updatedAt: Date.now(),
          center,
          rows
        },
        "nearby"
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadPlacesCache() {
    const db = await openAppDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("places", "readonly");
      const req = tx.objectStore("places").get("nearby");
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function findNearestCachedPlace(point, rows, maxMeters = 220) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let best = null;
    for (const row of rows) {
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
      const d = haversineMeters(point, { lat: row.lat, lng: row.lng });
      if (d > maxMeters) continue;
      if (!best || d < best.distance_m) best = { ...row, distance_m: Math.round(d) };
    }
    return best;
  }

  function findSuggestedPlace(query, rows) {
    const q = String(query || "").trim().toLowerCase();
    if (!q || !Array.isArray(rows)) return null;
    return rows.find((p) => {
      const name = String(p.name || "").toLowerCase();
      const vicinity = String(p.vicinity || "").toLowerCase();
      return name === q || `${name}, ${vicinity}`.includes(q) || name.includes(q);
    }) || null;
  }

  function fillPlaceSuggestions(datalistId, rows) {
    const el = document.getElementById(datalistId);
    if (!el) return;
    el.innerHTML = "";
    if (!Array.isArray(rows)) return;
    rows.slice(0, 30).forEach((p) => {
      const option = document.createElement("option");
      option.value = p.name;
      option.label = p.vicinity || "";
      el.appendChild(option);
    });
  }

  async function resolveGooglePlace(placeId) {
    if (!placeId || !window.google?.maps?.places?.PlacesService) return null;
    try {
      const service = new google.maps.places.PlacesService(document.createElement("div"));
      return await new Promise((resolve) => {
        service.getDetails(
          {
            placeId,
            fields: ["name", "formatted_address", "geometry", "types"]
          },
          (place, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
              return resolve(null);
            }
            resolve({
              place_id: placeId,
              name: place.name || "Selected place",
              vicinity: place.formatted_address || "",
              types: Array.isArray(place.types) ? place.types : [],
              lat: Number(place.geometry.location.lat()),
              lng: Number(place.geometry.location.lng())
            });
          }
        );
      });
    } catch {
      return null;
    }
  }

  function setupSearchSuggestions(input, opts) {
    if (!input) return () => {};
    const box = document.createElement("div");
    box.className = "search-suggest-box";
    box.hidden = true;
    const parent = input.closest(".search") || input.parentElement;
    if (parent) parent.insertAdjacentElement("afterend", box);

    let timer = null;
    let requestToken = 0;

    const hide = () => {
      box.hidden = true;
      box.innerHTML = "";
    };

    const render = (items) => {
      box.innerHTML = "";
      if (!items.length) {
        hide();
        return;
      }
      items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "search-suggest-item";
        btn.innerHTML = `<strong>${item.name}</strong><span>${item.meta || ""}</span>`;
        btn.addEventListener("click", async () => {
          input.value = item.name;
          hide();
          if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
            opts?.onPick?.(item);
            return;
          }
          if (item.place_id) {
            const place = await resolveGooglePlace(item.place_id);
            if (place) {
              opts?.onPick?.(place);
              return;
            }
          }
          opts?.onPick?.({ name: item.name });
        });
        box.appendChild(btn);
      });
      box.hidden = false;
    };

    const onInput = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const q = String(input.value || "").trim();
        if (q.length < 2) {
          hide();
          return;
        }
        const token = ++requestToken;
        const cachedRows = (opts?.getCachedRows?.() || [])
          .filter((row) => {
            const name = String(row.name || "").toLowerCase();
            const vicinity = String(row.vicinity || "").toLowerCase();
            const qq = q.toLowerCase();
            return name.includes(qq) || vicinity.includes(qq);
          })
          .slice(0, 5)
          .map((row) => ({
            name: row.name || "Nearby place",
            meta: row.vicinity || placeTypeLabel(row.types),
            lat: Number(row.lat),
            lng: Number(row.lng),
            place_id: row.place_id || null
          }));

        let googleRows = [];
        if (window.google?.maps?.places?.AutocompleteService) {
          try {
            const service = new google.maps.places.AutocompleteService();
            const center = opts?.getCenter?.() || DEFAULT_CENTER;
            googleRows = await new Promise((resolve) => {
              service.getPlacePredictions(
                {
                  input: q,
                  location: new google.maps.LatLng(center.lat, center.lng),
                  radius: 50000,
                  types: ["establishment", "geocode"]
                },
                (predictions, status) => {
                  if (
                    status !== google.maps.places.PlacesServiceStatus.OK &&
                    status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS
                  ) {
                    return resolve([]);
                  }
                  if (!Array.isArray(predictions)) return resolve([]);
                  resolve(
                    predictions.slice(0, 8).map((p) => ({
                      name: p.structured_formatting?.main_text || p.description || "Place",
                      meta: p.structured_formatting?.secondary_text || "Google Places",
                      place_id: p.place_id
                    }))
                  );
                }
              );
            });
          } catch {
            googleRows = [];
          }
        }

        if (token !== requestToken) return;
        const merged = [...cachedRows, ...googleRows];
        const dedup = [];
        const seen = new Set();
        for (const row of merged) {
          const key = row.place_id || `${row.name}-${row.meta}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dedup.push(row);
        }
        render(dedup.slice(0, 10));
      }, 180);
    };

    const onDocClick = (event) => {
      if (event.target === input || box.contains(event.target)) return;
      hide();
    };

    input.addEventListener("input", onInput);
    input.addEventListener("focus", onInput);
    document.addEventListener("click", onDocClick);
    return () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("focus", onInput);
      document.removeEventListener("click", onDocClick);
      box.remove();
    };
  }

  async function prefillNearbyPlacesCache(center) {
    const cached = await loadPlacesCache().catch(() => null);
    const isFresh = cached?.updatedAt && (Date.now() - cached.updatedAt < 30 * 60 * 1000);
    const nearCachedCenter = cached?.center
      ? haversineMeters(center, cached.center) <= 1800
      : false;

    if (isFresh && nearCachedCenter && Array.isArray(cached.rows) && cached.rows.length) {
      return cached.rows;
    }

    if (!window.google?.maps?.places?.PlacesService) {
      return Array.isArray(cached?.rows) ? cached.rows : [];
    }

    try {
      const service = new google.maps.places.PlacesService(document.createElement("div"));
      const types = [
        "shopping_mall",
        "convenience_store",
        "supermarket",
        "store",
        "cafe",
        "restaurant"
      ];

      const grouped = await Promise.all(
        types.map(
          (type) =>
            new Promise((resolve) => {
              service.nearbySearch(
                {
                  location: { lat: center.lat, lng: center.lng },
                  radius: 2000,
                  type
                },
                (results, status) => {
                  if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(results)) {
                    return resolve([]);
                  }
                  resolve(
                    results.slice(0, 8).map((place) => ({
                      place_id: place.place_id,
                      name: place.name || "Nearby place",
                      vicinity: place.vicinity || "",
                      rating: Number(place.rating),
                      types: Array.isArray(place.types) ? place.types : [],
                      lat: Number(place.geometry?.location?.lat?.()),
                      lng: Number(place.geometry?.location?.lng?.())
                    }))
                  );
                }
              );
            })
        )
      );

      const dedup = new Map();
      grouped.flat().forEach((row) => {
        const key = row.place_id || `${row.name}-${row.lat}-${row.lng}`;
        if (!dedup.has(key)) dedup.set(key, row);
      });
      const rows = Array.from(dedup.values());
      await savePlacesCache(center, rows).catch(() => {});
      return rows;
    } catch {
      return Array.isArray(cached?.rows) ? cached.rows : [];
    }
  }

  async function enrichVoicesWithPlaceContext(voices, center) {
    const rows = await prefillNearbyPlacesCache(center);
    if (!Array.isArray(rows) || !rows.length) return voices;
    return voices.map((voice) => {
      if (!Number.isFinite(voice.lat) || !Number.isFinite(voice.lng)) return voice;
      const nearest = findNearestCachedPlace({ lat: voice.lat, lng: voice.lng }, rows);
      if (!nearest) return voice;
      return {
        ...voice,
        place_context: {
          name: nearest.name,
          vicinity: nearest.vicinity,
          type_label: placeTypeLabel(nearest.types),
          rating: Number.isFinite(nearest.rating) ? nearest.rating : null,
          distance_m: nearest.distance_m
        }
      };
    });
  }

  function renderListItems(targetId, rows, emptyTitle, emptyMeta) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = "";
    if (!rows.length) {
      const item = document.createElement("article");
      item.className = "row-item";
      item.innerHTML = `<strong>${emptyTitle}</strong><div class='meta'>${emptyMeta}</div>`;
      el.appendChild(item);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("article");
      item.className = "row-item";
      item.innerHTML = `<strong>${row.title}</strong><div class='meta'>${row.meta}</div>`;
      if (row.navigate && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
        const actions = document.createElement("div");
        actions.className = "row-actions";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn secondary row-nav-btn";
        btn.textContent = "Navigate";
        btn.addEventListener("click", () => {
          openNavigationTo(
            { lat: Number(row.lat), lng: Number(row.lng), place_id: row.place_id || "" },
            row.title
          );
        });
        actions.appendChild(btn);
        item.appendChild(actions);
      }
      el.appendChild(item);
    });
  }

  function ensureMarkerPopup() {
    let popup = document.getElementById("mapVoicePopup");
    if (popup) return popup;
    popup = document.createElement("section");
    popup.id = "mapVoicePopup";
    popup.className = "marker-popup";
    popup.innerHTML = `
      <div class="marker-popup-head">
        <div>
          <h4 id="popupVoiceTitle">Voice</h4>
          <p id="popupVoiceMeta">Nearby voice</p>
        </div>
        <button class="popup-x" id="btnPopupClose" type="button" aria-label="Close popup">×</button>
      </div>
      <p id="popupVoiceDesc"></p>
      <p id="popupVoicePlace" class="meta"></p>
      <div class="marker-popup-actions">
        <button class="btn" id="btnPopupPlay" type="button">Play Now</button>
        <button class="btn secondary" id="btnPopupPhotos" type="button">Open Photos</button>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector("#btnPopupClose")?.addEventListener("click", () => popup.classList.remove("show"));
    return popup;
  }

  function openMarkerPopup(voice) {
    const popup = ensureMarkerPopup();
    const title = popup.querySelector("#popupVoiceTitle");
    const meta = popup.querySelector("#popupVoiceMeta");
    const desc = popup.querySelector("#popupVoiceDesc");
    const place = popup.querySelector("#popupVoicePlace");
    const playBtn = popup.querySelector("#btnPopupPlay");
    const photosBtn = popup.querySelector("#btnPopupPhotos");

    if (title) title.textContent = voice.title || "Untitled voice";
    if (meta) meta.textContent = `${formatDistance(voice.distance_m)} • ${voice.category || "General"} • permanent`;
    if (desc) desc.textContent = voice.description || "No description";
    if (place) {
      const context = voice.place_context;
      place.textContent = context
        ? `Left near ${context.name} (${context.type_label})${context.vicinity ? ` • ${context.vicinity}` : ""}`
        : "Exact storefront context unavailable for this marker.";
    }

    playBtn?.replaceWith(playBtn.cloneNode(true));
    photosBtn?.replaceWith(photosBtn.cloneNode(true));
    const playBtnNew = popup.querySelector("#btnPopupPlay");
    const photosBtnNew = popup.querySelector("#btnPopupPhotos");

    playBtnNew?.addEventListener("click", () => {
      localStorage.setItem("pv.activeVoice", JSON.stringify(voice));
      window.location.href = "/play.html";
    });
    photosBtnNew?.addEventListener("click", () => {
      localStorage.setItem("pv.activeVoice", JSON.stringify(voice));
      window.location.href = "/photos.html";
    });

    popup.classList.remove("show");
    requestAnimationFrame(() => popup.classList.add("show"));
  }

  async function fetchNearbyPlacesInsights(center) {
    if (!window.google?.maps?.places?.PlacesService) return [];
    try {
      const service = new google.maps.places.PlacesService(document.createElement("div"));
      const types = ["cafe", "restaurant", "park"];
      const all = await Promise.all(
        types.map(
          (type) =>
            new Promise((resolve) => {
              service.nearbySearch(
                {
                  location: { lat: center.lat, lng: center.lng },
                  radius: 1500,
                  type
                },
                (results, status) => {
                  if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(results)) {
                    return resolve([]);
                  }
                  resolve(
                    results.slice(0, 2).map((place) => ({
                      place_id: place.place_id,
                      name: place.name || "Nearby place",
                      vicinity: place.vicinity || "Nearby",
                      rating: place.rating,
                      lat: Number(place.geometry?.location?.lat?.()),
                      lng: Number(place.geometry?.location?.lng?.())
                    }))
                  );
                }
              );
            })
        )
      );
      return all.flat().slice(0, 5);
    } catch {
      return [];
    }
  }

  function buildVoiceInsights(voices) {
    const byCategory = voices.reduce((acc, voice) => {
      const k = (voice.category || "General").trim();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const top = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return top.map(([category, count]) => ({
      title: `${category} voices rising`,
      meta: `${count} recent drops in your current radius.`
    }));
  }

  function summarizeVoiceCount(count) {
    if (count <= 0) return "No voices nearby.";
    if (count === 1) return "Only 1 voice nearby.";
    if (count <= 3) return `Only ${count} voices nearby.`;
    if (count <= 10) return `${count} voices nearby.`;
    return `${count}+ voices nearby.`;
  }

  async function populateExploreInsights(center, voices) {
    const places = await fetchNearbyPlacesInsights(center);
    const voiceCount = voices.length;
    const nearest = voices
      .filter((v) => Number.isFinite(v.distance_m))
      .sort((a, b) => a.distance_m - b.distance_m)[0] || null;
    const categoryStats = voices.reduce((acc, voice) => {
      const k = (voice.category || "General").trim();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const topCategory = Object.entries(categoryStats).sort((a, b) => b[1] - a[1])[0] || null;

    const trendRows = places.length
      ? places.map((p) => ({
          title: `${p.name}`,
          meta: `${p.vicinity}${Number.isFinite(p.rating) ? ` • ${p.rating.toFixed(1)}★` : ""}`,
          place_id: p.place_id,
          lat: Number(p.lat),
          lng: Number(p.lng),
          navigate: true
        }))
      : [{ title: "No nearby places found", meta: "Try moving map area or enabling location access." }];

    const summaryRows = [
      { title: "Voices in this area", meta: summarizeVoiceCount(voiceCount) },
      {
        title: "Nearest voice",
        meta: nearest ? `${formatDistance(nearest.distance_m)} away` : "No voice marker in current radius."
      },
      { title: "Retention policy", meta: "All voice drops are permanent." },
      {
        title: "Top category",
        meta: topCategory ? `${topCategory[0]} (${topCategory[1]} voice${topCategory[1] === 1 ? "" : "s"})` : "No category data yet."
      }
    ];

    renderListItems("trendList", trendRows, "No nearby places", "No place data available.");
    renderListItems("creatorList", summaryRows, "No area summary", "No voice data available in this radius.");
  }

  async function populatePlayInsights(voice, distance, liveUser) {
    const origin = Number.isFinite(voice.lat) && Number.isFinite(voice.lng)
      ? { lat: Number(voice.lat), lng: Number(voice.lng) }
      : await getUserCoords();

    const nearbyVoices = await fetchVoices(origin.lat, origin.lng, 2000);
    const places = await fetchNearbyPlacesInsights(origin);

    const placeRows = places.length
      ? places.map((p) => ({
          title: p.name,
          meta: `${p.vicinity}${Number.isFinite(p.rating) ? ` • ${p.rating.toFixed(1)}★` : ""}`
        }))
      : [{ title: "No nearby place data", meta: "No place metadata available for this spot." }];

    const nearbyCount = nearbyVoices.length;

    const insightRows = [
      {
        title: "Drop spot",
        meta: voice.place_context
          ? `${voice.place_context.name} (${voice.place_context.type_label})${voice.place_context.vicinity ? ` • ${voice.place_context.vicinity}` : ""}`
          : "No mapped place context for this voice."
      },
      {
        title: "Your distance to this voice",
        meta: liveUser
          ? `${formatDistance(distance)} from the voice marker.`
          : "Live location unavailable on this device/session."
      },
      {
        title: "Voices around this pin (2km)",
        meta: summarizeVoiceCount(nearbyCount)
      },
      { title: "Retention policy", meta: "This voice and nearby voices are permanent drops." }
    ];

    renderListItems("playPlacesList", placeRows, "No nearby places", "No place data available for this pin.");
    renderListItems("playInsightsList", insightRows, "No playback data", "No useful stats available right now.");
  }

  function renderVoiceRows(listEl, voices) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!voices.length) {
      const empty = document.createElement("article");
      empty.className = "row-item";
      empty.innerHTML = "<strong>No voices nearby</strong><div class='meta'>Create one to seed this location.</div>";
      listEl.appendChild(empty);
      return;
    }

    voices.forEach((voice) => {
      const row = document.createElement("article");
      row.className = "row-item";
      row.innerHTML = `
        <strong>${voice.title}</strong>
        <div class="meta">${voice.description || "No description"}</div>
        <div class="meta">${formatDistance(voice.distance_m)} • ${voice.category} • permanent</div>
        <div class="meta">${voice.place_context ? `${voice.place_context.type_label}: ${voice.place_context.name}` : "Location context loading..."}</div>
      `;
      row.addEventListener("click", () => {
        localStorage.setItem("pv.activeVoice", JSON.stringify(voice));
        window.location.href = "/play.html";
      });
      listEl.appendChild(row);
    });
  }

  function updateExploreMetrics(voicesCount) {
    const streakEl = document.getElementById("streakCount");
    const meter = document.getElementById("questMeter");
    const questValue = document.getElementById("questValue");
    const metricVoices = document.getElementById("metricVoices");
    const metricRadius = document.getElementById("metricRadius");

    const dayKey = new Date().toISOString().slice(0, 10);
    const seenDay = localStorage.getItem("pv.streakDay");
    let streak = Number(localStorage.getItem("pv.streakCount") || "0");
    if (seenDay !== dayKey) {
      streak += 1;
      localStorage.setItem("pv.streakCount", String(streak));
      localStorage.setItem("pv.streakDay", dayKey);
    }

    if (streakEl) streakEl.textContent = String(streak);
    if (metricVoices) metricVoices.textContent = String(voicesCount);
    if (metricRadius) metricRadius.textContent = `${(MAP_RADIUS_M / 1000).toFixed(1)}km`;

    const progress = Math.min(100, Math.round((voicesCount / 7) * 100));
    if (meter) meter.style.width = `${progress}%`;
    if (questValue) questValue.textContent = `${Math.min(voicesCount, 7)}/7`;

    document.getElementById("btnBoost")?.addEventListener("click", () => toast("Boost enabled for 20 min"));
  }

  async function loadGoogleMaps() {
    if (window.google?.maps) return true;

    const key = getGoogleKey();
    if (!key) return false;

    let authFailed = false;
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => {
      authFailed = true;
      if (typeof prev === "function") prev();
    };

    try {
      await loadExternalScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`);
      if (authFailed || !window.google?.maps) return false;
      return true;
    } catch {
      return false;
    }
  }

  async function loadLeaflet() {
    if (window.L) return true;
    try {
      loadStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      await loadExternalScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", {
        integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
        crossorigin: ""
      });
      return Boolean(window.L);
    } catch {
      return false;
    }
  }

  function buildGoogleVoiceMarkerIcon() {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="52" height="66" viewBox="0 0 52 66">
        <defs>
          <filter id="g" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="26" cy="22" r="16" fill="#5ffff1" fill-opacity="0.2" filter="url(#g)"/>
        <path d="M26 60C26 60 8 39 8 25C8 15 16 7 26 7C36 7 44 15 44 25C44 39 26 60 26 60Z" fill="#5ffff1" stroke="#1e1035" stroke-width="3"/>
        <circle cx="26" cy="25" r="8" fill="#ff4fa6" stroke="#1e1035" stroke-width="2"/>
      </svg>
    `.trim();

    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(34, 42),
      anchor: new google.maps.Point(17, 40)
    };
  }

  function createLeafletVoiceIcon() {
    if (!window.L?.divIcon) return null;
    return L.divIcon({
      className: "voice-marker-wrap",
      html: "<span class='voice-marker-pin'><span class='voice-marker-core'></span></span>",
      iconSize: [26, 34],
      iconAnchor: [13, 34]
    });
  }

  async function handleVoiceMarkerClick(voice, mapAdapter) {
    const here = await getLiveCoordsOrNull();
    const dist = here && Number.isFinite(voice.lat) && Number.isFinite(voice.lng)
      ? haversineMeters(here, { lat: Number(voice.lat), lng: Number(voice.lng) })
      : NaN;
    openMarkerPopup({ ...voice, distance_m: Number.isFinite(dist) ? Math.round(dist) : voice.distance_m });
  }

  async function createMapAdapter(mapEl, center) {
    const googleOk = await loadGoogleMaps();

    if (googleOk) {
      let mapAdapter;
      let map;
      if (String(mapEl.tagName || "").toLowerCase() === "gmp-map") {
        await customElements.whenDefined("gmp-map");
        mapEl.center = `${center.lat},${center.lng}`;
        mapEl.zoom = 14;
        map = mapEl.innerMap;
        map.setOptions({
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });
      } else {
        map = new google.maps.Map(mapEl, {
          center,
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          styles: [
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#10283f" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#1f3f62" }] },
            { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#0f1f33" }] },
            { featureType: "poi.business", elementType: "geometry", stylers: [{ color: "#1a2b44" }] },
            { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#95b7df" }] },
            { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#245378" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c6a8f" }] }
          ]
        });
      }

      new google.maps.Circle({
        map,
        center,
        radius: MAP_RADIUS_M,
        strokeColor: "#22d3ee",
        strokeOpacity: 0.7,
        strokeWeight: 1,
        fillColor: "#22d3ee",
        fillOpacity: 0.12
      });

      let markers = [];
      const markerIcon = buildGoogleVoiceMarkerIcon();

      function plot(voices) {
        markers.forEach((m) => m.setMap(null));
        markers = [];
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(center);

        voices.forEach((voice) => {
          if (!Number.isFinite(voice.lat) || !Number.isFinite(voice.lng)) return;
          const marker = new google.maps.Marker({
            map,
            position: { lat: voice.lat, lng: voice.lng },
            title: voice.title,
            icon: markerIcon
          });
          marker.addListener("click", () => handleVoiceMarkerClick(voice, mapAdapter));
          markers.push(marker);
          bounds.extend(marker.getPosition());
        });

        if (voices.length) map.fitBounds(bounds, 70);
      }

      mapAdapter = {
        provider: "google",
        plot,
        goTo(lat, lng, zoom = 15) {
          map.panTo({ lat, lng });
          map.setZoom(zoom);
        },
        enableAutocomplete(input, onPlace) {
          if (!input || !google.maps.places?.Autocomplete) return;
          const autocomplete = new google.maps.places.Autocomplete(input, {
            fields: ["geometry", "name"],
            types: ["establishment", "geocode"]
          });
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            const loc = place?.geometry?.location;
            if (!loc) return;
            onPlace({ lat: loc.lat(), lng: loc.lng(), name: place.name || "Selected place" });
          });
        }
      };
      return mapAdapter;
    }

    const leafOk = await loadLeaflet();
    if (leafOk) {
      let mapAdapter;
      const map = L.map(mapEl).setView([center.lat, center.lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      L.circle([center.lat, center.lng], {
        radius: MAP_RADIUS_M,
        color: "#22d3ee",
        weight: 1,
        fillColor: "#22d3ee",
        fillOpacity: 0.12
      }).addTo(map);

      let markers = [];
      const leafletVoiceIcon = createLeafletVoiceIcon();

      function plot(voices) {
        markers.forEach((m) => map.removeLayer(m));
        markers = [];
        const points = [];
        voices.forEach((voice) => {
          if (!Number.isFinite(voice.lat) || !Number.isFinite(voice.lng)) return;
          const marker = leafletVoiceIcon
            ? L.marker([voice.lat, voice.lng], { icon: leafletVoiceIcon })
            : L.circleMarker([voice.lat, voice.lng], {
                radius: 8,
                color: "#1e1035",
                weight: 2,
                fillColor: "#5ffff1",
                fillOpacity: 1
              });
          marker.addTo(map).on("click", () => handleVoiceMarkerClick(voice, mapAdapter));
          markers.push(marker);
          points.push([voice.lat, voice.lng]);
        });
        if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
      }

      mapAdapter = {
        provider: "leaflet",
        plot,
        goTo(lat, lng, zoom = 15) {
          map.setView([lat, lng], zoom);
        },
        enableAutocomplete(input, onPlace) {
          if (!input) return;
          input.addEventListener("keydown", async (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const found = await geocodeFallback(input.value);
            if (!found) return toast("Location not found");
            onPlace(found);
          });
        }
      };
      return mapAdapter;
    }

    mapEl.innerHTML = "<div class='row-item map-fallback'><strong>Map unavailable</strong><div class='meta'>Check internet and API settings.</div></div>";
    return {
      provider: "none",
      plot() {},
      goTo() {},
      enableAutocomplete(input, onPlace) {
        if (!input) return;
        input.addEventListener("keydown", async (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const found = await geocodeFallback(input.value);
          if (found) onPlace(found);
        });
      }
    };
  }

  async function initExplore() {
    if (page !== "explore") return;

    const mapEl = document.getElementById("mapCanvas");
    const listEl = document.getElementById("nearbyList");
    const searchInput = document.getElementById("searchInput");
    const recenterBtn = document.getElementById("btnRecenterMap");
    const filterEls = Array.from(document.querySelectorAll(".filter-pill"));
    if (!mapEl || !listEl) return;

    const center = await getUserCoords();
    let activeCenter = { ...center };
    let voices = await fetchVoices(center.lat, center.lng, MAP_RADIUS_M);
    const justPublished = JSON.parse(localStorage.getItem("pv.lastPublishedVoice") || "null");
    if (justPublished?.id && !voices.some((v) => v.id === justPublished.id)) {
      voices = [normalizeVoice(justPublished, center), ...voices];
    }
    let filtered = [...voices];

    renderVoiceRows(listEl, filtered);
    updateExploreMetrics(voices.length);

    const map = await createMapAdapter(mapEl, center);
    if (map.provider !== "google") toast("Primary map unavailable, using fallback map");
    let placeRows = await prefillNearbyPlacesCache(activeCenter);
    fillPlaceSuggestions("nearbyPlaceSuggestions", placeRows);
    populateExploreInsights(center, voices);

    const applyFilters = () => {
      const active = filterEls.find((el) => el.classList.contains("active"))?.dataset.filter || "all";
      const query = String(searchInput?.value || "").trim().toLowerCase();
      filtered = voices.filter((voice) => {
        const text = `${voice.title} ${voice.description} ${voice.category}`.toLowerCase();
        const queryOk = !query || text.includes(query);
        const cat = voice.category.toLowerCase();
        const typeOk =
          active === "all" ||
          (active === "near" && voice.distance_m <= 300) ||
          (active === "story" && cat.includes("story")) ||
          (active === "review" && cat.includes("review"));
        return queryOk && typeOk;
      });
      renderVoiceRows(listEl, filtered);
      map.plot(filtered);
    };

    filterEls.forEach((el) => {
      el.addEventListener("click", () => {
        filterEls.forEach((x) => x.classList.remove("active"));
        el.classList.add("active");
        applyFilters();
      });
    });

    searchInput?.addEventListener("input", applyFilters);
    setupSearchSuggestions(searchInput, {
      getCenter: () => activeCenter,
      getCachedRows: () => placeRows,
      onPick: async ({ lat, lng, name }) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        activeCenter = { lat: Number(lat), lng: Number(lng) };
        map.goTo(activeCenter.lat, activeCenter.lng);
        voices = await fetchVoices(activeCenter.lat, activeCenter.lng, MAP_RADIUS_M);
        placeRows = await prefillNearbyPlacesCache(activeCenter);
        fillPlaceSuggestions("nearbyPlaceSuggestions", placeRows);
        updateExploreMetrics(voices.length);
        applyFilters();
        populateExploreInsights(activeCenter, voices);
        toast(`Scanning ${String(name || "location").split(",")[0]}`);
      }
    });
    const executeMapJump = async () => {
      const q = String(searchInput?.value || "").trim();
      if (!q) return;
      const localMatch = findSuggestedPlace(q, placeRows);
      const found = localMatch || await geocodeFallback(q);
      if (!found) return toast("Location not found");
      activeCenter = { lat: Number(found.lat), lng: Number(found.lng) };
      map.goTo(activeCenter.lat, activeCenter.lng);
      voices = await fetchVoices(activeCenter.lat, activeCenter.lng, MAP_RADIUS_M);
      placeRows = await prefillNearbyPlacesCache(activeCenter);
      fillPlaceSuggestions("nearbyPlaceSuggestions", placeRows);
      updateExploreMetrics(voices.length);
      applyFilters();
      populateExploreInsights(activeCenter, voices);
      toast(`Scanning ${found.name.split(",")[0]}`);
    };
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      executeMapJump();
    });
    recenterBtn?.addEventListener("click", async () => {
      const here = await getUserCoords();
      activeCenter = { ...here };
      map.goTo(here.lat, here.lng, 15);
      voices = await fetchVoices(here.lat, here.lng, MAP_RADIUS_M);
      placeRows = await prefillNearbyPlacesCache(here);
      fillPlaceSuggestions("nearbyPlaceSuggestions", placeRows);
      updateExploreMetrics(voices.length);
      applyFilters();
      populateExploreInsights(here, voices);
      toast("Recentered to your location");
    });

    map.plot(filtered);
  }

  async function initSearch() {
    if (page !== "search") return;

    const input = document.getElementById("queryInput");
    const run = document.getElementById("btnRunSearch");
    const navBtn = document.getElementById("btnNavigateSearch");
    const myLocBtn = document.getElementById("btnSearchMyLoc");
    const list = document.getElementById("searchResults");
    const mapEl = document.getElementById("searchMap");
    if (!list || !mapEl) return;

    const center = await getUserCoords();
    let activeCenter = { ...center };
    let activeDestination = { ...center, name: "Current area", place_id: "" };
    let voices = await fetchVoices(center.lat, center.lng, 3000);

    const render = (rows, query = "") => {
      const q = query.trim().toLowerCase();
      const filtered = rows.filter((voice) => {
        const blob = `${voice.title} ${voice.description} ${voice.category}`.toLowerCase();
        return !q || blob.includes(q);
      });

      list.innerHTML = "";
      if (!filtered.length) {
        const item = document.createElement("article");
        item.className = "row-item";
        item.innerHTML = "<strong>No matching voices</strong><div class='meta'>Try a broader place or keyword.</div>";
        list.appendChild(item);
        return;
      }

      filtered.forEach((voice) => {
        const row = document.createElement("article");
        row.className = "row-item";
        row.innerHTML = `
          <strong>${voice.title}</strong>
          <div class="meta">${voice.description || "No description"}</div>
          <div class="meta">${voice.category} • ${formatDistance(voice.distance_m)} • permanent</div>
        `;
        row.addEventListener("click", () => {
          localStorage.setItem("pv.activeVoice", JSON.stringify(voice));
          window.location.href = "/play.html";
        });
        list.appendChild(row);
      });
    };

    render(voices);
    const map = await createMapAdapter(mapEl, center);
    map.plot(voices);
    let placeRows = await prefillNearbyPlacesCache(activeCenter);
    fillPlaceSuggestions("searchPlaceSuggestions", placeRows);
    setupSearchSuggestions(input, {
      getCenter: () => activeCenter,
      getCachedRows: () => placeRows,
      onPick: async ({ lat, lng, name, place_id }) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        activeCenter = { lat: Number(lat), lng: Number(lng) };
        activeDestination = {
          lat: Number(lat),
          lng: Number(lng),
          name: name || "Selected place",
          place_id: place_id || ""
        };
        map.goTo(activeCenter.lat, activeCenter.lng);
        voices = await fetchVoices(activeCenter.lat, activeCenter.lng, 3000);
        placeRows = await prefillNearbyPlacesCache(activeCenter);
        fillPlaceSuggestions("searchPlaceSuggestions", placeRows);
        render(voices, input?.value || "");
        map.plot(voices);
        toast(`Updated search around ${name || "selected place"}`);
      }
    });

    const executeSearch = async () => {
      const q = input?.value || "";
      if (!q.trim()) {
        render(voices, "");
        map.plot(voices);
        return;
      }

      const localMatch = findSuggestedPlace(q, placeRows);
      const found = localMatch || await geocodeFallback(q);
      if (!found) {
        render(voices, q);
        return;
      }

      activeCenter = { lat: Number(found.lat), lng: Number(found.lng) };
      activeDestination = {
        lat: Number(found.lat),
        lng: Number(found.lng),
        name: found.name || q,
        place_id: localMatch?.place_id || ""
      };
      map.goTo(activeCenter.lat, activeCenter.lng);
      voices = await fetchVoices(activeCenter.lat, activeCenter.lng, 3000);
      placeRows = await prefillNearbyPlacesCache(activeCenter);
      fillPlaceSuggestions("searchPlaceSuggestions", placeRows);
      render(voices, q);
      map.plot(voices);
      toast(`Updated search around ${found.name.split(",")[0]}`);
    };

    run?.addEventListener("click", executeSearch);
    navBtn?.addEventListener("click", () => {
      openNavigationTo(activeDestination, activeDestination?.name || (input?.value || "destination"));
    });
    myLocBtn?.addEventListener("click", async () => {
      const here = await getUserCoords();
      activeCenter = { ...here };
      activeDestination = { ...here, name: "Your location", place_id: "" };
      map.goTo(here.lat, here.lng, 15);
      voices = await fetchVoices(here.lat, here.lng, 3000);
      placeRows = await prefillNearbyPlacesCache(here);
      fillPlaceSuggestions("searchPlaceSuggestions", placeRows);
      render(voices, "");
      map.plot(voices);
      toast("Showing voices around you");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      executeSearch();
    });
  }

  async function saveDraftMedia(media) {
    const db = await openAppDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(media, "current");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadDraftMedia() {
    const db = await openAppDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly");
      const req = tx.objectStore("drafts").get("current");
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function clearDraftMedia() {
    const db = await openAppDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete("current");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  function initDrop() {
    if (page !== "drop") return;

    const wave = document.getElementById("recordWave");
    const status = document.getElementById("recordStatus");
    const btnRecord = document.getElementById("btnRecord");
    const btnStop = document.getElementById("btnStop");
    const btnCancel = document.getElementById("btnCancel");
    const form = document.getElementById("dropForm");
    const mediaInput = document.getElementById("voiceMedia");
    const audioInput = document.getElementById("voiceAudio");

    let recorder = null;
    let stream = null;
    let chunks = [];
    let audioBlob = null;
    let timer = null;
    let seconds = 0;

    const stopTimer = () => {
      if (timer) window.clearInterval(timer);
      timer = null;
    };

    const stopStream = () => {
      if (!stream) return;
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    btnRecord?.addEventListener("click", async () => {
      try {
        if (recorder && recorder.state === "recording") return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          audioBlob = new Blob(chunks, { type: "audio/webm" });
          stopStream();
        };

        recorder.start();
        seconds = 0;
        wave?.classList.add("playing");
        status.textContent = "Recording...";
        stopTimer();
        timer = window.setInterval(() => {
          seconds += 1;
          status.textContent = `Recording ${seconds}s / 300s`;
          if (seconds >= 300) btnStop?.click();
        }, 1000);
        toast("Recording started");
      } catch {
        toast("Microphone permission blocked");
      }
    });

    btnStop?.addEventListener("click", () => {
      if (!recorder || recorder.state !== "recording") return;
      recorder.stop();
      stopTimer();
      wave?.classList.remove("playing");
      status.textContent = `Recorded ${seconds}s`;
      toast("Recording saved");
    });

    btnCancel?.addEventListener("click", () => {
      stopTimer();
      if (recorder && recorder.state === "recording") recorder.stop();
      recorder = null;
      stopStream();
      chunks = [];
      audioBlob = null;
      seconds = 0;
      wave?.classList.remove("playing");
      status.textContent = "Draft cleared";
      toast("Draft reset");
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = String(document.getElementById("voiceTitle")?.value || "").trim();
      const description = String(document.getElementById("voiceDesc")?.value || "").trim();
      const category = String(document.getElementById("voiceCategory")?.value || "General").trim();

      if (!title) return toast("Title required");

      const fallbackAudio = audioInput?.files?.[0] || null;
      const audioFile = audioBlob || fallbackAudio;
      if (!audioFile) return toast("Record or upload audio first");

      const images = Array.from(mediaInput?.files || []).filter((f) => f.type.startsWith("image/"));
      const coords = await getUserCoords();

      try {
        await saveDraftMedia({ audio: audioFile, images });
      } catch {
        return toast("Failed to save draft media");
      }

      localStorage.setItem(
        "pv.draft",
        JSON.stringify({
          title,
          description,
          category,
          lat: coords.lat,
          lng: coords.lng,
          created_at: Date.now()
        })
      );

      window.location.href = "/confirm.html";
    });
  }

  function initConfirm() {
    if (page !== "confirm") return;

    const summary = document.getElementById("confirmSummary");
    const publish = document.getElementById("btnPublish");
    const draft = JSON.parse(localStorage.getItem("pv.draft") || "null");

    if (!draft) {
      if (summary) summary.innerHTML = "<article class='row-item'><strong>No draft found</strong><div class='meta'>Create one from Drop Voice.</div></article>";
      if (publish) publish.disabled = true;
      return;
    }

    if (summary) {
      summary.innerHTML = "";
      [
        ["Title", draft.title],
        ["Description", draft.description || "No description"],
        ["Category", draft.category],
        ["Retention", "Permanent"],
        ["Coordinates", `${Number(draft.lat).toFixed(5)}, ${Number(draft.lng).toFixed(5)}`]
      ].forEach(([k, v]) => {
        const row = document.createElement("article");
        row.className = "row-item";
        row.innerHTML = `<strong>${k}</strong><div class='meta'>${v}</div>`;
        summary.appendChild(row);
      });
    }

    publish?.addEventListener("click", async () => {
      publish.disabled = true;

      try {
        const media = await loadDraftMedia();
        if (!media?.audio) throw new Error("Missing audio draft");

        const result = await createVoice({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          audioFile: media.audio,
          images: media.images || []
        });

        saveDeleteToken(result.id, result.deleteToken);
        localStorage.removeItem("pv.draft");
        await clearDraftMedia();

        localStorage.setItem("pv.activeVoice", JSON.stringify(result.voice));
        localStorage.setItem("pv.lastPublishedVoice", JSON.stringify(result.voice));
        toast("Voice published to Firestore");
        window.setTimeout(() => (window.location.href = "/play.html"), 600);
      } catch (error) {
        console.error(error);
        toast(error.message || "Publish failed");
        publish.disabled = false;
      }
    });
  }

  async function initPlay() {
    if (page !== "play") return;

    const voiceFromUrl = new URLSearchParams(window.location.search).get("voice");
    let selected = JSON.parse(localStorage.getItem("pv.activeVoice") || "null");
    if (voiceFromUrl) {
      const byUrl = await getVoiceById(voiceFromUrl);
      if (byUrl) {
        selected = byUrl;
        localStorage.setItem("pv.activeVoice", JSON.stringify(byUrl));
      }
    }
    const title = document.getElementById("playTitle");
    const desc = document.getElementById("playDesc");
    const placeContextEl = document.getElementById("playPlaceContext");
    const badge = document.getElementById("playDistance");
    const expiry = document.getElementById("playExpiry");
    const audio = document.getElementById("audio");
    const wave = document.getElementById("playWave");
    const btnPlay = document.getElementById("btnPlay");
    const soundOnStart = isSoundOnStartEnabled();

    if (!selected?.id) {
      if (title) title.textContent = "No voice selected";
      if (desc) desc.textContent = "Select one from Explore first.";
      if (btnPlay) btnPlay.disabled = true;
      return;
    }

    const voice = (await getVoiceById(selected.id)) || selected;

    if (title) title.textContent = voice.title;
    if (desc) desc.textContent = voice.description || "No description";
    const categoryEl = document.getElementById("playCategory");
    const accessEl = document.getElementById("playAccess");
    if (!voice.place_context && Number.isFinite(voice.lat) && Number.isFinite(voice.lng)) {
      const rows = await prefillNearbyPlacesCache({ lat: Number(voice.lat), lng: Number(voice.lng) });
      const nearest = findNearestCachedPlace({ lat: Number(voice.lat), lng: Number(voice.lng) }, rows);
      if (nearest) {
        voice.place_context = {
          name: nearest.name,
          vicinity: nearest.vicinity,
          type_label: placeTypeLabel(nearest.types),
          rating: Number.isFinite(nearest.rating) ? nearest.rating : null,
          distance_m: nearest.distance_m
        };
      }
    }
    if (placeContextEl) {
      placeContextEl.textContent = voice.place_context
        ? `Pinned near ${voice.place_context.name} (${voice.place_context.type_label})`
        : "Pinned near: exact storefront context unavailable";
    }

    const liveUser = await getLiveCoordsOrNull();
    const distance = liveUser ? haversineMeters(liveUser, { lat: Number(voice.lat), lng: Number(voice.lng) }) : NaN;
    if (badge) badge.textContent = Number.isFinite(distance) ? formatDistance(distance) : "location off";
    if (expiry) expiry.textContent = "Permanent";
    if (categoryEl) categoryEl.textContent = voice.category || "General";

    const playable = true;

    if (audio && voice.audio_path) {
      audio.src = voice.audio_path;
      audio.preload = "metadata";
      audio.controls = playable;
      audio.muted = !soundOnStart;
      audio.volume = soundOnStart ? 1 : 0;
    }

    if (!liveUser) {
      toast("Location unavailable. Playback unlocked for this session.");
      if (accessEl) accessEl.textContent = "Fallback Access";
    } else if (accessEl) {
      accessEl.textContent = "Open";
    }

    populatePlayInsights(voice, distance, liveUser);

    btnPlay?.addEventListener("click", () => {
      if (!audio || btnPlay.disabled) return;
      if (audio.paused) {
        audio.play().catch(() => toast("Playback blocked by browser"));
        wave?.classList.add("playing");
      } else {
        audio.pause();
        wave?.classList.remove("playing");
      }
    });

    audio?.addEventListener("ended", () => wave?.classList.remove("playing"));
    const queryAutoplay = new URLSearchParams(window.location.search).get("autoplay") === "1";
    const shouldAutoplay = (queryAutoplay || shouldAutoplayOnSelect()) && soundOnStart && !getDeviceProfile().mobile;
    if (shouldAutoplay && !btnPlay?.disabled) {
      window.setTimeout(() => btnPlay?.click(), 350);
    }

    document.getElementById("btnDelete")?.addEventListener("click", async () => {
      const token = getDeleteTokens()[voice.id];
      if (!token) return toast("Delete token missing for this voice");

      try {
        await deleteVoice(voice.id, token);
        removeDeleteToken(voice.id);
        localStorage.removeItem("pv.activeVoice");
        const lastPublished = JSON.parse(localStorage.getItem("pv.lastPublishedVoice") || "null");
        if (lastPublished?.id === voice.id) localStorage.removeItem("pv.lastPublishedVoice");
        toast("Voice deleted");
        window.setTimeout(() => (window.location.href = "/index.html"), 500);
      } catch (error) {
        toast(error.message || "Delete failed");
      }
    });
  }

  async function initPhotos() {
    if (page !== "photos") return;

    const grid = document.getElementById("photoGrid");
    if (!grid) return;

    const selected = JSON.parse(localStorage.getItem("pv.activeVoice") || "null");
    let images = [];

    if (selected?.images?.length) {
      images = selected.images;
    } else {
      const center = await getUserCoords();
      const voices = await fetchVoices(center.lat, center.lng, 3000);
      images = voices.flatMap((v) => v.images || []).slice(0, 18);
    }

    grid.innerHTML = "";
    if (!images.length) {
      const empty = document.createElement("article");
      empty.className = "row-item";
      empty.style.gridColumn = "1 / -1";
      empty.innerHTML = "<strong>No photos found</strong><div class='meta'>Add images when publishing a voice.</div>";
      grid.appendChild(empty);
      return;
    }

    images.forEach((src) => {
      const tile = document.createElement("article");
      tile.className = "media-tile";
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Voice attachment";
      tile.appendChild(img);
      grid.appendChild(tile);
    });
  }

  function initSettings() {
    if (page !== "settings") return;

    ["setSound", "setAutoplay", "setContrast", "setNotify"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const stored = localStorage.getItem(`pv.${id}`);
      if (stored !== null) el.checked = stored === "true";
      el.addEventListener("change", () => {
        localStorage.setItem(`pv.${id}`, String(el.checked));
        if (id === "setContrast") applyContrastMode();
      });
    });

    const keyInput = document.getElementById("setGoogleKey");
    if (keyInput) keyInput.value = getGoogleKey();
    const apiBaseInput = document.getElementById("setApiBase");
    if (apiBaseInput) apiBaseInput.value = localStorage.getItem("pv.apiBase") || "";

    document.getElementById("btnInstallPwa")?.addEventListener("click", async () => {
      await promptInstallApp();
    });

    document.getElementById("btnSaveSettings")?.addEventListener("click", () => {
      const previousApiBase = localStorage.getItem("pv.apiBase") || "";
      if (keyInput?.value.trim()) localStorage.setItem("pv.googleMapsKey", keyInput.value.trim());
      if (apiBaseInput) {
        const value = apiBaseInput.value.trim().replace(/\/+$/, "");
        if (value) localStorage.setItem("pv.apiBase", value);
        else localStorage.removeItem("pv.apiBase");
      }
      const nextApiBase = localStorage.getItem("pv.apiBase") || "";
      applyContrastMode();
      if (notificationsEnabled()) {
        startProximityNotifications({ requestPermission: true });
        syncPushSubscription({ requestPermission: true });
        const profile = getDeviceProfile();
        if (profile.mobile && (profile.ios || !pushSupported())) {
          openInstallCoach();
        }
      } else if (proximityAlertTimer) {
        window.clearInterval(proximityAlertTimer);
        proximityAlertTimer = null;
        unsubscribePush();
      }
      if (previousApiBase !== nextApiBase) {
        toast("Settings saved. Reload app to apply new API URL.");
      } else {
        toast("Settings saved");
      }
    });
  }

  function initPwa() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(() => {
        startProximityNotifications({ requestPermission: false });
        syncPushSubscription({ requestPermission: false });
      }).catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPromptEvent = event;
    });
    window.addEventListener("appinstalled", () => {
      installPromptEvent = null;
      toast("VoiceSpace installed. Enable notifications in Settings.");
    });
  }

  applyContrastMode();
  window.addEventListener("storage", (event) => {
    if (event.key === "pv.setContrast") applyContrastMode();
  });
  setupReveal();
  initMobileShell();
  let mobileShellResizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(mobileShellResizeTimer);
    mobileShellResizeTimer = window.setTimeout(initMobileShell, 120);
  });
  initPwa();
  initExplore();
  initSearch();
  initDrop();
  initConfirm();
  initPlay();
  initPhotos();
  initSettings();
  initOnboarding();
})();

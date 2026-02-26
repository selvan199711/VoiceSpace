import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { nanoid } from "nanoid";
import { db } from "./db.js";

const app = express();
const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || "127.0.0.1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = fs.existsSync(path.join(__dirname, "..", "Public"))
  ? path.join(__dirname, "..", "Public")
  : path.join(__dirname, "..", "public");
const uploadsDir = path.join(__dirname, "uploads");
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@voicespace.local").trim();

let webPushRef = null;
let webPushInitTried = false;

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = String(file.originalname || "audio.webm").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${nanoid(8)}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

function endpointHash(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint)).digest("hex");
}

function hasValidSubscriptionShape(subscription) {
  if (!subscription || typeof subscription !== "object") return false;
  if (typeof subscription.endpoint !== "string" || !subscription.endpoint.startsWith("https://")) return false;
  if (!subscription.keys || typeof subscription.keys !== "object") return false;
  if (typeof subscription.keys.p256dh !== "string" || typeof subscription.keys.auth !== "string") return false;
  return true;
}

async function getWebPushClient() {
  if (webPushRef) return webPushRef;
  if (webPushInitTried) return null;
  webPushInitTried = true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  try {
    const mod = await import("web-push");
    const client = mod.default || mod;
    client.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    webPushRef = client;
    return webPushRef;
  } catch {
    return null;
  }
}

async function sendPushToAll(payload) {
  const webPush = await getWebPushClient();
  if (!webPush) return { attempted: 0, sent: 0, removed: 0 };

  const rows = db.prepare("SELECT endpoint_hash, subscription_json FROM push_subscriptions").all();
  if (!rows.length) return { attempted: 0, sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;
  const serialized = JSON.stringify(payload);

  for (const row of rows) {
    let subscription = null;
    try {
      subscription = JSON.parse(row.subscription_json);
    } catch {
      subscription = null;
    }

    if (!hasValidSubscriptionShape(subscription)) {
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint_hash = ?").run(row.endpoint_hash);
      removed += 1;
      continue;
    }

    try {
      await webPush.sendNotification(subscription, serialized, { TTL: 60 });
      sent += 1;
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint_hash = ?").run(row.endpoint_hash);
        removed += 1;
      }
    }
  }

  return { attempted: rows.length, sent, removed };
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function unlinkUploads(audioPath, imagePaths) {
  const paths = [audioPath, ...parseJsonArray(imagePaths)];
  paths.forEach((rel) => {
    if (!rel) return;
    const filePath = path.join(__dirname, rel.replace(/^\/+/, ""));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // best effort cleanup
    }
  });
}

function cleanupExpiredVoices() {
  return 0;
}

setInterval(() => {
  cleanupExpiredVoices();
}, 60 * 1000).unref();

app.use((req, res, next) => next());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get("/api/push/public-key", async (req, res) => {
  const webPush = await getWebPushClient();
  return res.json({
    enabled: Boolean(webPush && VAPID_PUBLIC_KEY),
    publicKey: webPush ? VAPID_PUBLIC_KEY : ""
  });
});

app.post("/api/push/subscribe", async (req, res) => {
  const webPush = await getWebPushClient();
  if (!webPush) return res.status(503).json({ error: "push unavailable on server" });

  const subscription = req.body?.subscription;
  if (!hasValidSubscriptionShape(subscription)) {
    return res.status(400).json({ error: "invalid subscription payload" });
  }

  const hash = endpointHash(subscription.endpoint);
  const now = Date.now();
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint_hash, endpoint, subscription_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint_hash) DO UPDATE SET
       endpoint = excluded.endpoint,
       subscription_json = excluded.subscription_json,
       updated_at = excluded.updated_at`
  ).run(hash, subscription.endpoint, JSON.stringify(subscription), now, now);

  return res.json({ ok: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "").trim();
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  const hash = endpointHash(endpoint);
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint_hash = ?").run(hash);
  return res.json({ ok: true });
});

app.get("/api/voices", (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(50, Math.min(5000, Number(req.query.radius || 300)));
  const now = Date.now();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const rows = db
    .prepare(
      `SELECT id, title, description, category, lat, lng, created_at, expires_at, audio_path, image_paths
       FROM voices
       ORDER BY created_at DESC
       LIMIT 400`
    )
    .all();

  const voices = rows
    .map((row) => {
      const dist = distanceMeters(lat, lng, row.lat, row.lng);
      return {
        ...row,
        distance_m: Math.round(dist),
        expires_in_ms: 0,
        images: parseJsonArray(row.image_paths)
      };
    })
    .filter((v) => v.distance_m <= radius)
    .map((v) => {
      delete v.image_paths;
      return v;
    });

  res.json({ radius_m: radius, now, count: voices.length, voices });
});

app.get("/api/voices/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT id, title, description, category, lat, lng, created_at, expires_at, audio_path, image_paths
       FROM voices
       WHERE id = ?`
    )
    .get(req.params.id);

  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({
    ...row,
    images: parseJsonArray(row.image_paths),
    expires_in_ms: 0
  });
});

app.post(
  "/api/voices",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "images", maxCount: 6 }
  ]),
  (req, res) => {
    try {
      const title = String(req.body.title || "").trim();
      const description = String(req.body.description || "").trim();
      const category = String(req.body.category || "").trim();
      const lat = Number(req.body.lat);
      const lng = Number(req.body.lng);

      if (!title) return res.status(400).json({ error: "title is required" });
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "valid lat/lng required" });
      }

      const audioFile = req.files?.audio?.[0];
      if (!audioFile) return res.status(400).json({ error: "audio is required" });

      const createdAt = Date.now();
      const expiresAt = 0;

      const imageFiles = req.files?.images || [];
      const images = imageFiles.map((f) => `/uploads/${f.filename}`);

      const id = nanoid(10);
      const deleteToken = nanoid(24);

      db.prepare(
        `INSERT INTO voices
         (id, title, description, category, lat, lng, created_at, expires_at, audio_path, image_paths, delete_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        title,
        description || null,
        category || null,
        lat,
        lng,
        createdAt,
        expiresAt,
        `/uploads/${audioFile.filename}`,
        JSON.stringify(images),
        deleteToken
      );

      // Fire-and-forget: notify subscribers that a new nearby voice exists.
      void sendPushToAll({
        title: "New Voice Nearby",
        body: `${title} is now live on VoiceSpace`,
        tag: `voice-${id}`,
        url: `/play.html?voice=${encodeURIComponent(id)}`,
        data: { voiceId: id, lat, lng },
        icon: "/assets/logo.png",
        badge: "/assets/logo.png"
      });

      return res.status(201).json({
        id,
        deleteToken,
        createdAt,
        expiresAt,
        message: "Created"
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to create voice" });
    }
  }
);

app.delete("/api/voices/:id", (req, res) => {
  const token = String(req.headers["x-delete-token"] || "").trim();
  if (!token) return res.status(401).json({ error: "Missing delete token" });

  const row = db
    .prepare("SELECT id, audio_path, image_paths FROM voices WHERE id = ? AND delete_token = ?")
    .get(req.params.id, token);

  if (!row) return res.status(403).json({ error: "Not allowed" });

  db.prepare("DELETE FROM voices WHERE id = ?").run(req.params.id);
  unlinkUploads(row.audio_path, row.image_paths);

  return res.json({ message: "Deleted" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`VoiceSpace running: http://${HOST}:${PORT}`);
});

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "voicespace.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    audio_path TEXT NOT NULL,
    image_paths TEXT,
    delete_token TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint_hash TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

`);

function ensureColumn(name, typeDecl) {
  const columns = db.prepare("PRAGMA table_info(voices)").all();
  const exists = columns.some((c) => c.name === name);
  if (!exists) db.exec(`ALTER TABLE voices ADD COLUMN ${name} ${typeDecl}`);
}

ensureColumn("expires_at", "INTEGER");

// Permanent retention policy: keep all voices with no expiry.
db.prepare("UPDATE voices SET expires_at = 0").run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_voices_created_at ON voices(created_at);
  CREATE INDEX IF NOT EXISTS idx_voices_expires_at ON voices(expires_at);
  CREATE INDEX IF NOT EXISTS idx_voices_lat_lng ON voices(lat, lng);
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_updated_at ON push_subscriptions(updated_at);
`);

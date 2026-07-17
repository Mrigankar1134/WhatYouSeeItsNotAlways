// The Garden Beyond Seasons — static host + memory API backed by Neon Postgres.
// Run with:  node --env-file=.env server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8123;
const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with: node --env-file=.env server.mjs');
  process.exit(1);
}

// Neon requires TLS; channel_binding isn't understood by node-postgres, so we
// configure ssl explicitly and drop that query flag.
const pool = new pg.Pool({
  connectionString: DATABASE_URL.replace(/&?channel_binding=require/, ''),
  ssl: { require: true, rejectUnauthorized: false },
  max: 4,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY,
      player_name   TEXT,
      title         TEXT NOT NULL,
      date_mode     TEXT,
      date_value    TEXT,
      place         TEXT,
      emotion       TEXT NOT NULL,
      story         TEXT,
      music_title   TEXT,
      music_artist  TEXT,
      world_x       DOUBLE PRECISION,
      world_z       DOUBLE PRECISION,
      flower_variant INTEGER,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now(),
      raw           JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      client_id   TEXT PRIMARY KEY,
      name        TEXT,
      prefs       JSONB,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('DB ready — memories and players tables ensured.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.seed': 'application/octet-stream',
};

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function rowFromMemory(m) {
  return [
    String(m.id), m.playerName || null, String(m.title || 'Untitled').slice(0, 300),
    m.dateMode || 'unknown', (m.dateValue || '').slice(0, 60), (m.place || '').slice(0, 300),
    m.emotion || 'silence', (m.story || '').slice(0, 10000),
    m.musicReference?.title || null, m.musicReference?.artist || null,
    m.worldPosition?.x ?? 0, m.worldPosition?.z ?? 0, m.flowerVariant ?? 0, m,
  ];
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','memories', id?]
  const id = parts[2];

  if (parts[1] === 'player') {
    if (req.method === 'POST' && parts.length === 2) {
      const p = await readBody(req);
      if (!p.clientId) return json(res, 400, { error: 'missing clientId' });
      await pool.query(
        `INSERT INTO players (client_id, name, prefs) VALUES ($1,$2,$3)
         ON CONFLICT (client_id) DO UPDATE SET name=EXCLUDED.name, prefs=EXCLUDED.prefs, updated_at=now()`,
        [String(p.clientId), (p.name || '').slice(0, 60) || null, p.prefs || {}]
      );
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && id) {
      const q = await pool.query('SELECT name, prefs FROM players WHERE client_id = $1', [id]);
      return json(res, 200, { player: q.rows[0] || null });
    }
  }

  if (req.method === 'GET' && parts.length === 2) {
    const q = await pool.query('SELECT raw FROM memories ORDER BY created_at ASC');
    return json(res, 200, { memories: q.rows.map((r) => r.raw) });
  }

  if (req.method === 'POST' && parts.length === 2) {
    const m = await readBody(req);
    if (!m.id || !m.title || !m.emotion) return json(res, 400, { error: 'A memory needs a title and an emotion.' });
    await pool.query(
      `INSERT INTO memories (id, player_name, title, date_mode, date_value, place, emotion, story,
         music_title, music_artist, world_x, world_z, flower_variant, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         player_name=EXCLUDED.player_name, title=EXCLUDED.title, date_mode=EXCLUDED.date_mode,
         date_value=EXCLUDED.date_value, place=EXCLUDED.place, emotion=EXCLUDED.emotion, story=EXCLUDED.story,
         music_title=EXCLUDED.music_title, music_artist=EXCLUDED.music_artist,
         world_x=EXCLUDED.world_x, world_z=EXCLUDED.world_z, flower_variant=EXCLUDED.flower_variant,
         raw=EXCLUDED.raw, updated_at=now()`,
      rowFromMemory(m)
    );
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && id) {
    await pool.query('DELETE FROM memories WHERE id = $1', [id]);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const file = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error('request error', e);
    json(res, 500, { error: 'The garden could not reach its roots just now.' });
  }
});

initDb()
  .then(() => server.listen(PORT, () => console.log(`The garden is growing at http://localhost:${PORT}`)))
  .catch((e) => { console.error('DB init failed:', e.message); process.exit(1); });

// Talks to the local memory API (server.mjs → Neon Postgres).
// Every save is written to the database as well as to local IndexedDB, so the
// garden survives offline and is also gathered centrally. Failures never block
// the experience — the local copy is always authoritative for what you see.

let online = true;

async function req(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('api ' + res.status);
  return res.json();
}

export async function remoteSave(record, playerName) {
  try {
    await req('POST', '/memories', { ...record, playerName });
    online = true;
    return true;
  } catch (e) {
    online = false;
    console.warn('memory could not reach the database (kept locally):', e.message);
    return false;
  }
}

export async function remoteDelete(id) {
  try { await req('DELETE', '/memories/' + encodeURIComponent(id)); return true; }
  catch (e) { console.warn('remote delete failed (removed locally):', e.message); return false; }
}

export async function remoteAll() {
  try { const { memories } = await req('GET', '/memories'); return memories || []; }
  catch { return null; }
}

export async function remotePlayer(clientId, name, prefs) {
  try { await req('POST', '/player', { clientId, name, prefs }); return true; }
  catch (e) { console.warn('player sync failed (kept locally):', e.message); return false; }
}

export function isOnline() { return online; }

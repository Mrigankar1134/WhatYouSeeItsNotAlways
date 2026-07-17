// Encrypted .seed export / restore using the Web Crypto API.
// The passphrase never leaves this device and cannot be recovered.
import { allMemories, putMemory, deleteMemory } from './db.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function exportSeed(passphrase) {
  const memories = await allMemories();
  const payload = enc.encode(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), memories }));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));

  // container: magic(4) | salt(16) | iv(12) | cipher
  const magic = enc.encode('SEED');
  const out = new Uint8Array(4 + 16 + 12 + cipher.length);
  out.set(magic, 0); out.set(salt, 4); out.set(iv, 20); out.set(cipher, 32);

  const blob = new Blob([out], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `garden-${new Date().toISOString().slice(0, 10)}.seed`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return memories.length;
}

export async function readSeed(file, passphrase) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (dec.decode(buf.slice(0, 4)) !== 'SEED') throw new Error('unrecognised');
  const salt = buf.slice(4, 20);
  const iv = buf.slice(20, 32);
  const cipher = buf.slice(32);
  const key = await deriveKey(passphrase, salt);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  } catch {
    throw new Error('passphrase');
  }
  const data = JSON.parse(dec.decode(plain));
  if (!data || !Array.isArray(data.memories)) throw new Error('malformed');
  return data.memories;
}

export async function restoreSeed(memories, mode) {
  if (mode === 'replace') {
    const existing = await allMemories();
    for (const m of existing) await deleteMemory(m.id);
  }
  for (const m of memories) {
    // sanitize: only keep known scalar fields, never execute anything
    await putMemory(sanitize(m));
  }
}

function sanitize(m) {
  return {
    id: String(m.id || ('m_' + Math.random().toString(36).slice(2))),
    title: String(m.title || 'Untitled memory').slice(0, 200),
    dateMode: ['exact', 'month', 'year', 'unknown'].includes(m.dateMode) ? m.dateMode : 'unknown',
    dateValue: String(m.dateValue || '').slice(0, 60),
    place: String(m.place || '').slice(0, 200),
    emotion: ['joy', 'love', 'comfort', 'adventure', 'goodbye', 'silence'].includes(m.emotion) ? m.emotion : 'silence',
    story: String(m.story || '').slice(0, 10000),
    musicReference: m.musicReference && typeof m.musicReference === 'object'
      ? { title: String(m.musicReference.title || '').slice(0, 200), artist: String(m.musicReference.artist || '').slice(0, 200) }
      : undefined,
    createdAt: String(m.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    worldPosition: m.worldPosition && typeof m.worldPosition === 'object'
      ? { zone: 'garden', x: +m.worldPosition.x || 0, y: 0, z: +m.worldPosition.z || 0 }
      : { zone: 'garden', x: 0, y: 0, z: -24 },
    flowerVariant: Number.isFinite(+m.flowerVariant) ? +m.flowerVariant : 0,
  };
}

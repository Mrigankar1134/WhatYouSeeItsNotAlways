// Keepsake — paints every planted memory onto one parchment PNG for download.
// Pure canvas; nothing leaves the device.
import { EMOTIONS } from './config.js';

const W = 1080;          // logical width; rendered at 2x for crispness
const SCALE = 2;
const M = 84;            // outer margin
const INK = '#302B25';
const FADED = '#6D6255';
const SOIL = '#6B4934';
const LINE = 'rgba(74,52,39,0.35)';

export async function downloadKeepsake(memories, playerName) {
  await Promise.all([
    document.fonts.load('600 60px "Cormorant Garamond"'),
    document.fonts.load('italic 400 24px "Cormorant Garamond"'),
    document.fonts.load('500 30px "Cormorant Garamond"'),
    document.fonts.load('400 26px "Caveat"'),
    document.fonts.load('400 15px "Inter"'),
  ]).catch(() => {});

  const list = [...memories].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // measure pass to size the canvas
  const probe = document.createElement('canvas').getContext('2d');
  const entries = list.map((m) => layoutEntry(probe, m));
  const headerH = 340;
  const footerH = 170;
  const bodyH = entries.reduce((s, e) => s + e.height, 0);
  const H = headerH + bodyH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  paintParchment(ctx, H);
  paintFrame(ctx, H);
  paintHeader(ctx, playerName);

  let y = headerH;
  entries.forEach((e, i) => {
    paintEntry(ctx, e, y);
    if (i < entries.length - 1) paintDivider(ctx, y + e.height - 18);
    y += e.height;
  });

  paintFooter(ctx, H);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'the-garden-beyond-seasons.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- layout
function layoutEntry(ctx, m) {
  const textX = M + 118;
  const textW = W - textX - M;
  ctx.font = '500 30px "Cormorant Garamond"';
  const titleLines = wrap(ctx, m.title || 'Untitled', textW, 2);
  ctx.font = 'italic 400 21px "Cormorant Garamond"';
  const story = (m.story || '').replace(/\s+/g, ' ').trim();
  const storyLines = story ? wrap(ctx, story, textW, 3) : [];
  const h = 46 + titleLines.length * 36 + 30 + (storyLines.length ? storyLines.length * 29 + 10 : 0) + 40;
  return { m, titleLines, storyLines, height: Math.max(h, 140) };
}

function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) { cur = t; continue; }
    lines.push(cur || w);
    cur = cur ? w : '';
    if (lines.length === maxLines) {
      let last = lines[maxLines - 1];
      while (ctx.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/[ ,.;]+$/, '') + '…';
      return lines;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- painting
function paintParchment(ctx, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#F5EEDF');
  g.addColorStop(0.5, '#EFE5CF');
  g.addColorStop(1, '#E8DDC5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // soft light from the upper left
  const r = ctx.createRadialGradient(W * 0.22, 120, 60, W * 0.22, 120, W * 0.9);
  r.addColorStop(0, 'rgba(255,252,240,0.5)');
  r.addColorStop(1, 'rgba(255,252,240,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  // paper fibre speckle
  ctx.save();
  for (let i = 0; i < H * 6; i++) {
    const a = Math.random() * 0.05;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(74,52,39,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
  }
  ctx.restore();
  // gentle edge vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(74,52,39,0)');
  v.addColorStop(1, 'rgba(74,52,39,0.10)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

function paintFrame(ctx, H) {
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.4;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.strokeStyle = 'rgba(74,52,39,0.18)'; ctx.lineWidth = 0.8;
  ctx.strokeRect(42, 42, W - 84, H - 84);
  // botanical corner flourishes
  for (const [cx, cy, sx, sy] of [[52, 52, 1, 1], [W - 52, 52, -1, 1], [52, H - 52, 1, -1], [W - 52, H - 52, -1, -1]]) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(sx, sy);
    ctx.strokeStyle = 'rgba(74,52,39,0.45)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.quadraticCurveTo(4, 22, 58, 2); ctx.stroke();
    for (const [t, len] of [[0.25, 16], [0.5, 13], [0.75, 9]]) {
      const px = 4 * (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 4 + t * t * 58;
      const py = (1 - t) * (1 - t) * 64 + 2 * (1 - t) * t * 22 + t * t * 2;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + len * 0.6, py - len * 0.5, px + len, py - len * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function paintHeader(ctx, playerName) {
  ctx.textAlign = 'center';
  ctx.fillStyle = FADED;
  ctx.font = '400 15px "Inter"';
  spaced(ctx, 'A  K E E P S A K E  F R O M', W / 2, 108);
  ctx.fillStyle = INK;
  ctx.font = '600 60px "Cormorant Garamond"';
  ctx.fillText('The Garden Beyond Seasons', W / 2, 168);
  ctx.fillStyle = SOIL;
  ctx.font = '400 28px "Caveat"';
  const who = playerName ? `${playerName}’s garden` : 'A quiet garden';
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${who} · gathered ${date}`, W / 2, 210);
  ctx.fillStyle = FADED;
  ctx.font = 'italic 400 21px "Cormorant Garamond"';
  ctx.fillText('“Some people don’t stay forever. Some never become ours.', W / 2, 252);
  ctx.fillText('Yet somehow… they still become part of who we are.”', W / 2, 280);
  paintDivider(ctx, 312);
  ctx.textAlign = 'left';
}

function spaced(ctx, text, x, y) { ctx.fillText(text, x, y); }

function paintDivider(ctx, y) {
  ctx.save();
  ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(W / 2 - 120, y); ctx.lineTo(W / 2 - 16, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2 + 16, y); ctx.lineTo(W / 2 + 120, y); ctx.stroke();
  // tiny leaf at centre
  ctx.fillStyle = 'rgba(74,52,39,0.5)';
  ctx.beginPath();
  ctx.ellipse(W / 2, y, 7, 3.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintFlower(ctx, x, y, emotion, variant = 0) {
  const e = EMOTIONS[emotion] || EMOTIONS.silence;
  const petals = 6 + (variant % 3);
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = e.glow; ctx.shadowBlur = 26;
  ctx.rotate((variant % 10) * 0.13);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 34, Math.sin(a) * 34);
    g.addColorStop(0, e.primary); g.addColorStop(1, e.secondary);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 19, Math.sin(a) * 19, 17, 9.5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  const c = ctx.createRadialGradient(-3, -3, 1, 0, 0, 12);
  c.addColorStop(0, e.secondary); c.addColorStop(1, e.primary);
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function paintEntry(ctx, entry, y) {
  const { m, titleLines, storyLines } = entry;
  const e = EMOTIONS[m.emotion] || EMOTIONS.silence;
  paintFlower(ctx, M + 44, y + 62, m.emotion, m.flowerVariant || 0);

  const textX = M + 118;
  let ty = y + 52;
  ctx.fillStyle = INK;
  ctx.font = '500 30px "Cormorant Garamond"';
  for (const line of titleLines) { ctx.fillText(line, textX, ty); ty += 36; }

  ctx.fillStyle = SOIL;
  ctx.font = '400 24px "Caveat"';
  const meta = [dateText(m), m.place, e.flower].filter(Boolean).join('  ·  ');
  ctx.fillText(meta, textX, ty); ty += 34;

  if (storyLines.length) {
    ctx.fillStyle = FADED;
    ctx.font = 'italic 400 21px "Cormorant Garamond"';
    for (const line of storyLines) { ctx.fillText(line, textX, ty); ty += 29; }
  }
}

function dateText(m) {
  if (!m.dateValue || m.dateMode === 'unknown') return 'a time not quite remembered';
  return m.dateValue;
}

function paintFooter(ctx, H) {
  const y = H - 150;
  paintDivider(ctx, y);
  ctx.textAlign = 'center';
  ctx.fillStyle = FADED;
  ctx.font = 'italic 400 22px "Cormorant Garamond"';
  ctx.fillText('Memories do not need to be forgotten for life to continue.', W / 2, y + 44);
  ctx.fillStyle = SOIL;
  ctx.font = '400 26px "Caveat"';
  ctx.fillText('Built with love by Mrigankar', W / 2, y + 86);
  ctx.textAlign = 'left';
}

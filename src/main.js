// The Garden Beyond Seasons — orchestrator.
import { World } from './world.js';
import { AudioManager } from './audio.js';
import * as UI from './ui.js';
import { COPY, ZONES, EMOTIONS } from './config.js';
import { allMemories, putMemory, deleteMemory, newId, loadPrefs, savePrefs } from './db.js';
import { exportSeed, readSeed, restoreSeed } from './seed.js';
import { remoteSave, remoteDelete, remoteAll, remotePlayer } from './api.js';

const $ = (s) => document.querySelector(s);

const dom = {
  loader: $('#loader'), loaderProgress: $('#loader-progress'),
  opening: $('#opening'), lines: [...document.querySelectorAll('.line')], enterCue: $('#enter-cue'),
  credit: $('#opening-credit'),
  firstrun: $('#firstrun'), frSound: $('#fr-sound'), frMotion: $('#fr-motion'), frRemember: $('#fr-remember'), frBegin: $('#fr-begin'),
  whisper: $('#whisper'), prompt: $('#prompt'), controls: $('#controls'), wayfinder: $('#wayfinder'),
  journal: $('#journal'), viewer: $('#viewer'), archive: $('#archive'), access: $('#access'),
  grade: $('#grade'), live: $('#live'),
  ctlSound: $('#ctl-sound'), ctlJournal: $('#ctl-journal'), ctlAccess: $('#ctl-access'),
};

const state = {
  entered: false,
  benchMode: false, benchTimer: null,
  pendingSpot: null,
  memories: [],
  prefs: loadPrefs(),
  playerName: '',
  soundOn: true,
  paused: false,
  dialogOpen: false,
  bridgeShown: false,
  meadowShown: false,
  returning: false,
};

const audio = new AudioManager();
let world;

// ---------------------------------------------------------------- boot
async function boot() {
  world = new World(dom.canvas || $('#scene'));
  applyPrefs(state.prefs);

  world.on('cue', (t) => audio.cue(t));
  world.on('zone', onZoneChange);
  world.on('grade', onGrade);

  state.playerName = state.prefs.playerName || '';

  // load memories — reconcile the database with the local copy
  world.ensureSpots();
  try {
    const local = await allMemories();
    const remote = await remoteAll(); // null if offline
    let list = local;
    if (remote) {
      // union by id; database wins on conflicts, and any local-only memory is pushed up
      const byId = new Map(local.map((m) => [m.id, m]));
      remote.forEach((m) => byId.set(m.id, m));
      list = [...byId.values()];
      // persist reconciled set locally; push local-only rows to the database
      const remoteIds = new Set(remote.map((m) => m.id));
      for (const m of list) {
        await putMemory(m);
        if (!remoteIds.has(m.id)) remoteSave(m, state.playerName);
      }
    }
    state.memories = list;
    state.memories.forEach((m) => world.addFlowerFromRecord(m));
  } catch (e) {
    console.warn('memory load failed', e);
  }

  // render loop
  const loop = () => { world.update(); requestAnimationFrame(loop); };
  loop();

  // reveal
  dom.loaderProgress.textContent = 'The garden is ready.';
  setTimeout(revealOpening, 1600);
}

function revealOpening() {
  dom.loader.style.transition = 'opacity 1.4s ease';
  dom.loader.style.opacity = '0';
  setTimeout(() => dom.loader.classList.add('hidden'), 1500);

  const firstVisit = !state.prefs.visited;
  if (firstVisit) {
    dom.firstrun.classList.remove('hidden');
    state.dialogOpen = true;
    dom.frMotion.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dom.frBegin.onclick = beginFromFirstRun;
  } else {
    startOpeningCinematic(true);
  }
}

function persistPrefs() {
  state.prefs.clientId ||= newId();
  savePrefs(state.prefs);
  remotePlayer(state.prefs.clientId, state.prefs.playerName || '', state.prefs);
}

function beginFromFirstRun() {
  state.soundOn = dom.frSound.checked;
  state.playerName = ($('#fr-name')?.value || '').trim();
  state.prefs.playerName = state.playerName;
  state.prefs.reduceMotion = dom.frMotion.checked;
  state.prefs.remember = dom.frRemember.checked;
  state.prefs.visited = true;
  persistPrefs();
  applyPrefs(state.prefs);
  dom.firstrun.classList.add('hidden');
  state.dialogOpen = false;
  if (state.soundOn) audio.start().then(() => { audio.setEnabled(true); audio.openingNote(); });
  audio.setEnabled(state.soundOn);
  updateSoundGlyph();
  startOpeningCinematic(false);
}

function startOpeningCinematic(skippable) {
  dom.opening.classList.remove('hidden');
  if (state.prefs.reduceMotion) {
    dom.credit.classList.add('show');
    dom.lines.forEach((l) => l.classList.add('show'));
    showEnterCue();
    return;
  }
  // credit card first — a quiet dedication before the poem
  setTimeout(() => dom.credit.classList.add('show'), 500);
  setTimeout(() => dom.credit.classList.add('rest'), 3400);
  const linesStart = 3400;
  dom.lines.forEach((line, i) => setTimeout(() => line.classList.add('show'), linesStart + i * 1500));
  setTimeout(showEnterCue, linesStart + dom.lines.length * 1500 + 400);
}

function showEnterCue() {
  dom.enterCue.classList.add('show');
  const word = dom.enterCue.querySelector('.enter-word');
  word.textContent = matchMedia('(pointer:coarse)').matches ? COPY.enterSwipe : COPY.enterScroll;
  dom.enterCue.onclick = enterGarden;
}

function enterGarden() {
  if (state.entered) return;
  state.entered = true;
  if (state.soundOn && !audio.started) audio.start().then(() => audio.openingNote());
  audio.cue('gate');
  // dissolve opening
  dom.opening.style.transition = 'opacity 2s ease';
  dom.opening.style.opacity = '0';
  setTimeout(() => dom.opening.classList.add('hidden'), 2000);
  // open the gate over ~4s
  const t0 = performance.now();
  const openGate = () => {
    const k = Math.min(1, (performance.now() - t0) / 4000);
    world.setGateOpen(easeInOut(k));
    if (k < 1) requestAnimationFrame(openGate);
  };
  openGate();
  // begin the walk
  world.setTargetTravel(ZONES[1].t);
  dom.controls.classList.remove('hidden');
  dom.wayfinder.classList.remove('hidden');
  buildWayfinder();
  wakeControls();
  const name = state.playerName || state.prefs.playerName;
  if (name) {
    setTimeout(() => whisper({ title: `Welcome, ${name}`, sub: 'The garden has been waiting for you.' }), 2600);
    setTimeout(() => whisper(ZONES[1]), 8600);
  } else {
    setTimeout(() => whisper(ZONES[1]), 2600);
  }
}

// ---------------------------------------------------------------- zones
function onZoneChange(id) {
  const zone = ZONES.find((z) => z.id === id);
  buildWayfinder();
  if (!zone) return;
  if (id === 'bench') { showPrompt('Sit for a while', true, sit); }
  else if (id === 'bridge') { hidePrompt(); showBridge(); }
  else if (id === 'meadow') { hidePrompt(); showMeadow(); }
  else { hidePrompt(); if (zone.title) whisper(zone); }
  world.setWeather(pickWeather(id));
}

function pickWeather(zoneId) {
  if (zoneId === 'pond') return 'mist';
  if (zoneId === 'bridge') return 'wind';
  return Math.random() < 0.25 ? 'mist' : 'clear';
}

function whisper(zone) {
  dom.whisper.innerHTML = '';
  const t = document.createElement('p'); t.className = 'w-title w-item'; t.textContent = zone.title;
  const s = document.createElement('p'); s.className = 'w-sub w-item'; s.textContent = zone.sub;
  dom.whisper.appendChild(t); dom.whisper.appendChild(s);
  requestAnimationFrame(() => { t.classList.add('show'); setTimeout(() => s.classList.add('show'), 400); });
  setTimeout(() => { t.classList.remove('show'); s.classList.remove('show'); }, 5200);
}

function showBridge() {
  if (state.bridgeShown) return; state.bridgeShown = true;
  dom.whisper.innerHTML = '';
  const p = document.createElement('p'); p.className = 'w-title w-item'; p.style.fontStyle = 'italic';
  p.textContent = 'Some roads remain unfinished.';
  dom.whisper.appendChild(p);
  requestAnimationFrame(() => p.classList.add('show'));
  setTimeout(() => {
    p.textContent = 'Not every unfinished road is a failure.';
  }, 5000);
  setTimeout(() => p.classList.remove('show'), 9000);
}

function showMeadow() {
  if (state.meadowShown) return; state.meadowShown = true;
  dom.whisper.innerHTML = '';
  const lines = ['Some stories don’t end.', 'They simply stop being written.', 'That doesn’t make them any less beautiful.'];
  lines.forEach((text, i) => {
    const p = document.createElement('p'); p.className = 'w-title w-item';
    p.style.fontSize = 'clamp(1.4rem,2.4vw,2.2rem)';
    dom.whisper.appendChild(p); p.textContent = text;
    setTimeout(() => p.classList.add('show'), 800 + i * 1400);
  });
  // fade to warm white, return to entrance
  setTimeout(returnToEntrance, 8000);
}

function returnToEntrance() {
  if (state.returning) return; state.returning = true;
  dom.grade.style.transition = 'opacity 3.5s ease, background 3.5s ease';
  dom.grade.style.background = 'rgba(244,230,200,0.96)';
  dom.grade.style.mixBlendMode = 'normal';
  dom.grade.style.opacity = '1';
  setTimeout(() => {
    world.travel = 0; world.targetTravel = ZONES[1].t; world.travelVel = 0;
    world.setTimeMs(world.timeMs + world.dayLength * 0.28); // later time of day
    dom.whisper.innerHTML = '';
    const p = document.createElement('p'); p.className = 'w-sub w-item';
    p.textContent = COPY.remain; dom.whisper.appendChild(p);
    requestAnimationFrame(() => p.classList.add('show'));
    dom.grade.style.background = 'rgba(244,230,200,0)';
    setTimeout(() => {
      dom.grade.style.mixBlendMode = 'multiply';
      dom.grade.style.background = '';
      dom.grade.style.opacity = '';
      p.classList.remove('show');
      state.returning = false; state.meadowShown = false; state.bridgeShown = false;
    }, 3600);
  }, 3600);
}

// ---------------------------------------------------------------- bench
function sit() {
  if (state.benchMode) return;
  state.benchMode = true;
  world.benchFocus(true);
  audio.benchMode(true);
  dom.controls.classList.add('hidden');
  dom.wayfinder.classList.add('hidden');
  hidePrompt();
  dom.whisper.innerHTML = '';
  clearTimeout(state.benchTimer);
  state.benchTimer = setTimeout(() => {
    const stand = () => { showPrompt('Stand and continue', true, standUp); };
    const onceMove = () => { stand(); window.removeEventListener('pointermove', onceMove); };
    window.addEventListener('pointermove', onceMove);
  }, 30000);
}

function standUp() {
  state.benchMode = false;
  world.benchFocus(false);
  audio.benchMode(false);
  dom.controls.classList.remove('hidden');
  dom.wayfinder.classList.remove('hidden');
  hidePrompt();
  world.setTargetTravel(ZONES[5].t);
}

// ---------------------------------------------------------------- planting
function openPlantJournal(spot) {
  state.pendingSpot = spot || world.freeSpot();
  if (!state.pendingSpot) { announce('The soil here is full for now.'); return; }
  state.dialogOpen = true;
  UI.openJournal(dom.journal, null, {
    onClose: () => { UI.closeDialog(dom.journal); state.dialogOpen = false; },
    onSubmit: (data) => submitMemory(data),
  });
}

async function submitMemory(data) {
  const spot = state.pendingSpot;
  const rec = {
    id: newId(),
    ...data,
    photos: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    worldPosition: { zone: 'garden', x: spot.pos.x, y: 0, z: spot.pos.z },
    flowerVariant: Math.floor(Math.random() * 1000),
    privacyMode: 'normal',
  };
  try {
    await putMemory(rec);
    state.memories.push(rec);
  } catch (e) { announce('There is not enough space on this device to keep that.'); }
  remoteSave(rec, state.playerName); // also gather into the database
  UI.closeDialog(dom.journal);
  state.dialogOpen = false;
  // ceremony — ease the camera toward the soil, then plant
  world.approach(spot.pos);
  world.plantMemory(rec, () => {
    dom.whisper.innerHTML = '';
    const p = document.createElement('p'); p.className = 'w-title w-item';
    p.textContent = rec.title; p.style.fontSize = 'clamp(1.4rem,2.4vw,2rem)';
    dom.whisper.appendChild(p);
    requestAnimationFrame(() => p.classList.add('show'));
    setTimeout(() => p.classList.remove('show'), 3000);
    announce(COPY.taken);
  });
}

// ---------------------------------------------------------------- viewer
function openMemory(rec) {
  state.dialogOpen = true;
  UI.openViewer(dom.viewer, rec, {
    onClose: () => { UI.closeDialog(dom.viewer); state.dialogOpen = false; },
    onEdit: () => { UI.closeDialog(dom.viewer); openEdit(rec); },
  });
  audio.cue('open');
}

function openEdit(rec) {
  state.dialogOpen = true;
  UI.openJournal(dom.journal, rec, {
    onClose: () => { UI.closeDialog(dom.journal); state.dialogOpen = false; },
    onSubmit: async (data) => {
      Object.assign(rec, data, { updatedAt: new Date().toISOString() });
      const oldEmotion = world.flowers.get(rec.id)?.userData.record.emotion;
      await putMemory(rec);
      remoteSave(rec, state.playerName);
      if (oldEmotion !== rec.emotion) { world.removeFlower(rec.id); world.addFlowerFromRecord(rec); }
      UI.closeDialog(dom.journal); state.dialogOpen = false;
      announce('Your changes are resting safely here.');
    },
    onDelete: async () => {
      await deleteMemory(rec.id);
      remoteDelete(rec.id);
      world.removeFlower(rec.id);
      state.memories = state.memories.filter((m) => m.id !== rec.id);
      UI.closeDialog(dom.journal); state.dialogOpen = false;
      announce('The memory has returned to the soil.');
    },
  });
}

// ---------------------------------------------------------------- archive
function openArchive() {
  state.dialogOpen = true;
  UI.openArchive(dom.archive, state.memories, {
    onClose: () => { UI.closeDialog(dom.archive); state.dialogOpen = false; },
    onPick: (rec) => { UI.closeDialog(dom.archive); openMemory(rec); },
  });
}

// ---------------------------------------------------------------- access
function openAccess() {
  state.dialogOpen = true;
  UI.openAccess(dom.access, state.prefs, {
    onVolume: (bus, v) => { audio.setVolume(bus, v); (state.prefs.vol ||= {})[bus] = v; persistPrefs(); },
    onToggle: (key, val) => { state.prefs[key] = val; persistPrefs(); applyPrefs(state.prefs); },
    onTextScale: (val) => { state.prefs.textscale = val; persistPrefs(); applyPrefs(state.prefs); },
    onExport: () => doExport(),
    onImport: () => doImport(),
    onClose: () => { UI.closeDialog(dom.access); state.dialogOpen = false; },
  });
}

async function doExport() {
  const pass = prompt('Choose a passphrase for this seed.\nIt cannot be recovered if forgotten.');
  if (!pass) return;
  try { const n = await exportSeed(pass); announce(COPY.gathered + ` (${n} memories)`); }
  catch { announce('The garden could not be gathered just now.'); }
}

function doImport() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.seed';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const pass = prompt('Enter the passphrase for this seed.');
    if (!pass) return;
    try {
      const memories = await readSeed(file, pass);
      const mode = confirm(`This seed holds ${memories.length} memories.\nOK = add them to this garden. Cancel = replace this garden.`) ? 'merge' : 'replace';
      await restoreSeed(memories, mode);
      // reload world flowers
      state.memories.forEach((m) => world.removeFlower(m.id));
      state.memories = await allMemories();
      state.memories.forEach((m) => world.addFlowerFromRecord(m));
      state.memories.forEach((m) => remoteSave(m, state.playerName));
      announce('The seed has taken root here.');
    } catch (e) {
      announce('This seed could not be opened. The file or passphrase may not match.');
    }
  };
  input.click();
}

// ---------------------------------------------------------------- prefs
function applyPrefs(p) {
  document.body.classList.toggle('reduce-motion', !!p.reduceMotion);
  document.body.classList.toggle('high-contrast', !!p.highContrast);
  document.body.classList.toggle('dyslexia', !!p.dyslexia);
  document.body.dataset.textscale = p.textscale || 'normal';
  if (world) world.setReducedMotion(!!p.reduceMotion);
  state.paused = !!p.pauseWorld;
  if (p.vol) for (const k in p.vol) audio.setVolume(k, p.vol[k]);
}

// ---------------------------------------------------------------- input
let idleTimer = null;
function wakeControls() {
  dom.controls.classList.add('awake');
  dom.wayfinder.classList.add('awake');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { dom.controls.classList.remove('awake'); dom.wayfinder.classList.remove('awake'); }, 4000);
}

function setupInput() {
  const canvas = $('#scene');

  window.addEventListener('pointermove', (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -((e.clientY / window.innerHeight) * 2 - 1);
    world.updatePointer(nx, ny);
    wakeControls();
    if (!state.dialogOpen && state.entered && !state.benchMode) updateHoverCursor();
  });

  // scroll travel
  window.addEventListener('wheel', (e) => {
    if (!state.entered || state.dialogOpen || state.benchMode || state.paused) return;
    world.nudgeTravel(e.deltaY * 0.00024);
  }, { passive: true });

  // touch travel
  let touchY = null;
  window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (touchY == null || !state.entered || state.dialogOpen || state.benchMode || state.paused) return;
    const dy = touchY - e.touches[0].clientY;
    world.nudgeTravel(dy * 0.0008);
    touchY = e.touches[0].clientY;
  }, { passive: true });

  // click / tap to interact
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.entered || state.dialogOpen) return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -((e.clientY / window.innerHeight) * 2 - 1);
    world.updatePointer(nx, ny);
    const hit = world.pick();
    handlePick(hit);
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (state.dialogOpen) return; // dialogs trap their own keys
    switch (e.key.toLowerCase()) {
      case 'arrowup': case 'w': world.nudgeTravel(0.02); break;
      case 'arrowdown': case 's': world.nudgeTravel(-0.02); break;
      case 'j': openArchive(); break;
      case 'm': toggleSound(); break;
      case 'a': openAccess(); break;
      case 'escape': if (state.benchMode) standUp(); break;
      case 'enter': case ' ': {
        if (world.hovered) handlePick(world.hovered);
        break;
      }
    }
  });

  dom.ctlSound.onclick = toggleSound;
  dom.ctlJournal.onclick = openArchive;
  dom.ctlAccess.onclick = openAccess;
}

function handlePick(hit) {
  world.setHover(hit);
  switch (hit.type) {
    case 'spot': openPlantJournal(hit.spot); break;
    case 'flower': openMemory(hit.record); break;
    case 'pond': world.pondRipple(hit.point.x, hit.point.z); audio.cue('ripple'); maybeFragment(); break;
    case 'bench': sit(); break;
  }
}

let lastHoverType = 'none';
function updateHoverCursor() {
  const hit = world.pick();
  world.setHover(hit);
  if (hit.type !== lastHoverType) {
    lastHoverType = hit.type;
    document.body.style.cursor = (hit.type === 'spot' || hit.type === 'flower' || hit.type === 'bench') ? 'pointer' : 'default';
    if (hit.type === 'spot') showPrompt('Plant a memory', false);
    else if (hit.type === 'flower') showPrompt(hit.record?.title || 'The garden remembers', false);
    else hidePrompt();
  }
}

function maybeFragment() {
  if (!state.memories.length || Math.random() > 0.5) return;
  const rec = state.memories[Math.floor(Math.random() * state.memories.length)];
  if (rec.privacyMode === 'private-reflection') return;
  setTimeout(() => {
    dom.whisper.innerHTML = '';
    const p = document.createElement('p'); p.className = 'w-sub w-item';
    const frag = (rec.story || rec.title || '').split('.')[0].slice(0, 80);
    p.textContent = '“' + frag + '”';
    dom.whisper.appendChild(p);
    requestAnimationFrame(() => p.classList.add('show'));
    setTimeout(() => p.classList.remove('show'), 3500);
  }, 900);
}

// ---------------------------------------------------------------- prompt/whisper helpers
let promptClick = null;
function showPrompt(text, actionable, onClick) {
  dom.prompt.textContent = text;
  dom.prompt.classList.remove('hidden');
  requestAnimationFrame(() => dom.prompt.classList.add('show'));
  dom.prompt.classList.toggle('act', !!actionable);
  if (promptClick) dom.prompt.removeEventListener('click', promptClick);
  if (actionable && onClick) { promptClick = () => onClick(); dom.prompt.addEventListener('click', promptClick); }
}
function hidePrompt() { dom.prompt.classList.remove('show', 'act'); }

function announce(text) { dom.live.textContent = text; }

// ---------------------------------------------------------------- sound glyph
function toggleSound() {
  state.soundOn = !state.soundOn;
  if (state.soundOn && !audio.started) audio.start();
  audio.setEnabled(state.soundOn);
  updateSoundGlyph();
}
function updateSoundGlyph() { dom.ctlSound.classList.toggle('muted', !state.soundOn); }

// ---------------------------------------------------------------- wayfinder
function buildWayfinder() {
  const cur = world.currentZoneId();
  const zone = ZONES.find((z) => z.id === cur) || ZONES[0];
  dom.wayfinder.innerHTML = '';
  const dots = document.createElement('div'); dots.style.display = 'flex'; dots.style.gap = '6px';
  ZONES.forEach((z) => {
    const d = document.createElement('span');
    d.className = 'wf-dot' + (z.id === cur ? ' on' : '');
    dots.appendChild(d);
  });
  dom.wayfinder.appendChild(dots);
  const name = document.createElement('span'); name.className = 'wf-name'; name.textContent = zone.name;
  dom.wayfinder.appendChild(name);
}

// ---------------------------------------------------------------- grade
function onGrade({ night }) {
  // deepen vignette + cool tint at night
  const o = 0.9 + night * 0.5;
  if (!state.returning) dom.grade.style.opacity = String(Math.min(1, o));
}

// ---------------------------------------------------------------- go
dom.canvas = $('#scene');
setupInput();
boot();

// lightweight handle for local testing / no telemetry, purely in-page
window.__garden = { get world() { return world; }, get state() { return state; }, openPlantJournal, openArchive };

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

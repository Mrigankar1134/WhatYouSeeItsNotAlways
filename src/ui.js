// Overlay UI: memory journal, viewer, archive, accessibility panel.
// Framework-free; each opener renders into a pre-existing container.
import { EMOTIONS, EMOTION_ORDER, COPY } from './config.js';
import { saveDraft, loadDraft, clearDraft } from './db.js';

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function budSwatch(emotion, size = 30) {
  const e = EMOTIONS[emotion];
  const d = el('span', 'bud');
  d.style.width = d.style.height = size + 'px';
  d.style.background = `radial-gradient(circle at 35% 30%, ${e.secondary}, ${e.primary})`;
  d.style.boxShadow = `0 0 12px ${e.glow}66`;
  return d;
}

// ------- focus trap -------
let trapHandler = null;
function trap(container, onEscape) {
  release();
  const focusables = () => [...container.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
  trapHandler = (e) => {
    if (e.key === 'Escape' && onEscape) { onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trapHandler);
  const first = focusables()[0];
  if (first) setTimeout(() => first.focus(), 60);
}
function release() { if (trapHandler) document.removeEventListener('keydown', trapHandler); trapHandler = null; }

export function closeDialog(node) {
  node.classList.add('hidden');
  node.innerHTML = '';
  release();
}

// =====================================================================
// JOURNAL (plant / edit)
// =====================================================================
export function openJournal(container, existing, handlers) {
  const isEdit = !!existing;
  const draft = !isEdit ? (loadDraft() || {}) : existing;
  let emotion = draft.emotion || null;

  const card = el('div', 'parchment journal-card');
  card.setAttribute('id', 'journal-card');

  const head = el('div', 'journal-head');
  head.innerHTML = `<div><h2 id="j-title">${isEdit ? 'Tend this memory' : 'Plant a Memory'}</h2>
    <p>Give it only what you wish to keep.</p></div>`;
  const closeBtn = el('button', 'close-x', '&times;');
  closeBtn.setAttribute('aria-label', 'Close memory journal');
  closeBtn.onclick = () => handlers.onClose();
  head.appendChild(closeBtn);
  card.appendChild(head);

  // Title
  const fTitle = el('div', 'field');
  fTitle.innerHTML = `<label for="m-title">What would you call this memory?</label>
    <input id="m-title" type="text" maxlength="120" placeholder="A quiet afternoon by the river" />
    <div class="hint" id="title-count" style="display:none"></div>`;
  const titleIn = fTitle.querySelector('input');
  titleIn.value = draft.title || '';
  const titleCount = fTitle.querySelector('#title-count');
  titleIn.addEventListener('input', () => {
    if (titleIn.value.length >= 90) { titleCount.style.display = 'block'; titleCount.textContent = `${titleIn.value.length} / 120`; }
    else titleCount.style.display = 'none';
    autosave();
  });
  card.appendChild(fTitle);

  // Date
  const fDate = el('div', 'field');
  fDate.innerHTML = `<span class="label">When did it live?</span>
    <div class="date-row">
      <select id="m-datemode">
        <option value="exact">A day</option>
        <option value="month">A month</option>
        <option value="year">A year</option>
        <option value="unknown">I don’t remember</option>
      </select>
      <input id="m-datevalue" type="text" placeholder="2019, or June 2019…" />
    </div>`;
  const dateMode = fDate.querySelector('#m-datemode');
  const dateVal = fDate.querySelector('#m-datevalue');
  dateMode.value = draft.dateMode || 'exact';
  dateVal.value = draft.dateValue || '';
  const syncDate = () => { dateVal.style.display = dateMode.value === 'unknown' ? 'none' : 'block'; };
  dateMode.addEventListener('change', () => { syncDate(); autosave(); });
  dateVal.addEventListener('input', autosave);
  syncDate();
  card.appendChild(fDate);

  // Place
  const fPlace = el('div', 'field');
  fPlace.innerHTML = `<label for="m-place">Where did it happen?</label>
    <input id="m-place" type="text" placeholder="Pune, the old bridge, home…" />`;
  const placeIn = fPlace.querySelector('input');
  placeIn.value = draft.place || '';
  placeIn.addEventListener('input', autosave);
  card.appendChild(fPlace);

  // Emotion
  const fEmotion = el('div', 'field');
  fEmotion.innerHTML = `<span class="label">What remains when you remember it?</span>`;
  const grid = el('div', 'emotions');
  EMOTION_ORDER.forEach((key) => {
    const e = EMOTIONS[key];
    const btn = el('button', 'emotion');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.appendChild(budSwatch(key));
    btn.appendChild(el('span', 'name', e.label));
    btn.appendChild(el('span', 'whatremains', e.remains));
    if (emotion === key) btn.classList.add('sel');
    btn.onclick = () => {
      emotion = key;
      grid.querySelectorAll('.emotion').forEach((b) => { b.classList.remove('sel'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('sel'); btn.setAttribute('aria-pressed', 'true');
      autosave();
    };
    grid.appendChild(btn);
  });
  fEmotion.appendChild(grid);
  card.appendChild(fEmotion);

  // Story
  const fStory = el('div', 'field');
  fStory.innerHTML = `<label for="m-story">What do you want the garden to remember?</label>
    <textarea id="m-story" maxlength="10000" placeholder="Write as much or as little as feels right."></textarea>`;
  const storyIn = fStory.querySelector('textarea');
  storyIn.value = draft.story || '';
  const autosize = () => { storyIn.style.height = 'auto'; storyIn.style.height = Math.min(storyIn.scrollHeight, 360) + 'px'; };
  storyIn.addEventListener('input', () => { autosize(); autosave(); });
  setTimeout(autosize, 0);
  card.appendChild(fStory);

  // Music reference
  const fMusic = el('div', 'field');
  fMusic.innerHTML = `<label for="m-song">A song connected to this memory</label>
    <div class="date-row">
      <input id="m-song" type="text" placeholder="Song title" />
      <input id="m-artist" type="text" placeholder="Artist" />
    </div>`;
  const songIn = fMusic.querySelector('#m-song');
  const artistIn = fMusic.querySelector('#m-artist');
  songIn.value = draft.musicReference?.title || '';
  artistIn.value = draft.musicReference?.artist || '';
  songIn.addEventListener('input', autosave);
  artistIn.addEventListener('input', autosave);
  card.appendChild(fMusic);

  card.appendChild(el('p', 'privacy-note', COPY.photoPrivacy));

  // Actions
  const actions = el('div', 'form-actions');
  const plantBtn = el('button', 'btn-primary');
  plantBtn.type = 'button';
  plantBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21V9M12 9c0-3 2-5 5-5 0 3-2 5-5 5zM12 12c0-3-2-5-5-5 0 3 2 5 5 5z"/></svg>
    <span>${isEdit ? 'Keep these changes' : 'Plant this memory'}</span>`;
  const savedNote = el('span', 'saved-note', COPY.saved);

  plantBtn.onclick = () => {
    const title = titleIn.value.trim();
    if (!title) { titleIn.focus(); titleIn.style.borderColor = 'var(--error)'; return; }
    if (!emotion) { grid.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const data = {
      title,
      dateMode: dateMode.value,
      dateValue: dateMode.value === 'unknown' ? '' : dateVal.value.trim(),
      place: placeIn.value.trim(),
      emotion,
      story: storyIn.value.trim(),
      musicReference: { title: songIn.value.trim(), artist: artistIn.value.trim() },
    };
    clearDraft();
    handlers.onSubmit(data);
  };
  actions.appendChild(plantBtn);

  if (isEdit) {
    const del = el('button', 'btn-danger', 'Return this memory to the soil');
    del.type = 'button';
    del.onclick = () => handlers.onDelete();
    actions.appendChild(del);
  }
  actions.appendChild(savedNote);
  card.appendChild(actions);

  container.innerHTML = '';
  container.appendChild(card);
  container.classList.remove('hidden');
  trap(container, handlers.onClose);

  let saveTimer = null;
  function autosave() {
    if (isEdit) return; // edits save on confirm
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveDraft({
        title: titleIn.value, dateMode: dateMode.value, dateValue: dateVal.value,
        place: placeIn.value, emotion, story: storyIn.value,
        musicReference: { title: songIn.value, artist: artistIn.value },
      });
      savedNote.classList.add('show');
      setTimeout(() => savedNote.classList.remove('show'), 2200);
    }, 1500);
  }
}

// =====================================================================
// VIEWER
// =====================================================================
export function openViewer(container, rec, handlers) {
  const e = EMOTIONS[rec.emotion];
  const card = el('div', 'parchment viewer-card');
  const dateText = formatDate(rec);
  card.innerHTML = `
    <div class="viewer-eyebrow">The garden remembers</div>
    <h2 id="v-title">${escapeHtml(rec.title)}</h2>
    <div class="viewer-meta">
      <span><span class="flowerdot" style="background:${e.primary}"></span>${e.flower}</span>
      ${dateText ? `<span>${escapeHtml(dateText)}</span>` : ''}
      ${rec.place ? `<span>${escapeHtml(rec.place)}</span>` : ''}
    </div>
    ${rec.story ? `<div class="viewer-story">${escapeHtml(rec.story)}</div>` : '<div class="viewer-story soft"><em>No words were left — only the flower.</em></div>'}
    ${rec.musicReference?.title ? `<div class="viewer-music">♪ ${escapeHtml(rec.musicReference.title)}${rec.musicReference.artist ? ' — ' + escapeHtml(rec.musicReference.artist) : ''}</div>` : ''}
    <div class="viewer-actions">
      <button class="btn-primary" id="v-return"><span>Return to the path</span></button>
      <button class="btn-ghost" id="v-edit">Tend this memory</button>
    </div>`;
  card.querySelector('#v-return').onclick = () => handlers.onClose();
  card.querySelector('#v-edit').onclick = () => handlers.onEdit();
  container.innerHTML = '';
  container.appendChild(card);
  container.classList.remove('hidden');
  trap(container, handlers.onClose);
}

// =====================================================================
// ARCHIVE
// =====================================================================
export function openArchive(container, records, handlers) {
  const card = el('div', 'parchment archive-card');
  let filterEmotion = null, query = '';

  card.innerHTML = `<h2 id="a-title">The Garden Journal</h2>
    <p class="soft" style="font-family:var(--font-poetic);font-style:italic;margin:0 0 0.4rem">Everything you have carried here.</p>
    <input class="archive-search field" id="a-search" type="text" placeholder="Find a memory" />
    <div class="archive-filters" id="a-filters"></div>
    <div class="archive-grid" id="a-grid"></div>`;

  const close = el('button', 'close-x', '&times;');
  close.style.position = 'absolute'; close.style.top = '18px'; close.style.right = '20px';
  close.setAttribute('aria-label', 'Close journal');
  close.onclick = () => handlers.onClose();
  card.appendChild(close);

  const filters = card.querySelector('#a-filters');
  const allChip = el('button', 'chip sel', 'All');
  allChip.onclick = () => { filterEmotion = null; renderChips(); renderGrid(); };
  filters.appendChild(allChip);
  EMOTION_ORDER.forEach((key) => {
    const chip = el('button', 'chip', EMOTIONS[key].label);
    chip.onclick = () => { filterEmotion = key; renderChips(); renderGrid(); };
    chip.dataset.key = key;
    filters.appendChild(chip);
  });
  function renderChips() {
    filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('sel', c.dataset.key === filterEmotion || (!filterEmotion && c === allChip)));
  }

  const grid = card.querySelector('#a-grid');
  const search = card.querySelector('#a-search');
  search.addEventListener('input', () => { query = search.value.toLowerCase(); renderGrid(); });

  function renderGrid() {
    grid.innerHTML = '';
    const items = records.filter((r) => {
      if (filterEmotion && r.emotion !== filterEmotion) return false;
      if (query && !(`${r.title} ${r.place || ''} ${r.story || ''}`.toLowerCase().includes(query))) return false;
      return true;
    });
    if (!items.length) {
      grid.appendChild(el('div', 'archive-empty', records.length ? 'No memory matches that search.' : COPY.emptyArchive));
      return;
    }
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    items.forEach((r) => {
      const e = EMOTIONS[r.emotion];
      const cell = el('div', 'pressed');
      const fl = el('div', 'p-flower');
      fl.style.background = `radial-gradient(circle at 35% 30%, ${e.secondary}, ${e.primary})`;
      fl.style.boxShadow = `0 0 14px ${e.glow}55`;
      cell.appendChild(fl);
      cell.appendChild(el('div', 'p-title', escapeHtml(r.title)));
      const dt = formatDate(r);
      if (dt) cell.appendChild(el('div', 'p-date', escapeHtml(dt)));
      cell.onclick = () => handlers.onPick(r);
      cell.tabIndex = 0;
      cell.onkeydown = (ev) => { if (ev.key === 'Enter') handlers.onPick(r); };
      grid.appendChild(cell);
    });
  }

  renderGrid();
  container.innerHTML = '';
  container.appendChild(card);
  container.classList.remove('hidden');
  trap(container, handlers.onClose);
}

// =====================================================================
// ACCESSIBILITY / COMFORT
// =====================================================================
export function openAccess(container, prefs, handlers) {
  const card = el('div', 'parchment access-card');
  card.innerHTML = `<h2 id="ac-title">Comfort & Access</h2>
    <p class="soft" style="font-family:var(--font-poetic);font-style:italic;margin:0 0 1rem">Shape the garden to how you need to be here.</p>`;

  const sliders = [
    ['master', 'Overall sound'], ['music', 'Music'], ['nature', 'Nature'], ['ui', 'Interaction sounds'],
  ];
  card.appendChild(el('div', 'access-section-title', 'Sound'));
  sliders.forEach(([key, label]) => {
    const row = el('div', 'slider-row');
    row.innerHTML = `<label>${label}<span></span></label><input type="range" min="0" max="100" value="${Math.round((prefs.vol?.[key] ?? (key==='master'?0.66:key==='music'?0.5:key==='nature'?0.8:0.7)) * 100)}" />`;
    const input = row.querySelector('input');
    input.addEventListener('input', () => handlers.onVolume(key, input.value / 100));
    card.appendChild(row);
  });

  card.appendChild(el('div', 'access-section-title', 'Motion & light'));
  const toggles = [
    ['reduceMotion', 'Reduce motion'],
    ['highContrast', 'Higher text contrast'],
    ['dyslexia', 'Dyslexia-friendly text'],
    ['pauseWorld', 'Pause world movement'],
  ];
  toggles.forEach(([key, label]) => {
    const l = el('label', 'switch');
    l.innerHTML = `<input type="checkbox" ${prefs[key] ? 'checked' : ''}/><span>${label}</span>`;
    l.querySelector('input').addEventListener('change', (e) => handlers.onToggle(key, e.target.checked));
    card.appendChild(l);
  });

  // text size
  const sizeRow = el('div', 'slider-row');
  sizeRow.style.marginTop = '1rem';
  sizeRow.innerHTML = `<label>Text size</label>`;
  const seg = el('div', 'archive-filters');
  [['normal', 'Gentle'], ['large', 'Larger'], ['xl', 'Largest']].forEach(([val, label]) => {
    const chip = el('button', 'chip' + ((prefs.textscale || 'normal') === val ? ' sel' : ''), label);
    chip.onclick = () => { seg.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel')); chip.classList.add('sel'); handlers.onTextScale(val); };
    seg.appendChild(chip);
  });
  sizeRow.appendChild(seg);
  card.appendChild(sizeRow);

  card.appendChild(el('div', 'access-section-title', 'The garden elsewhere'));
  const portRow = el('div', 'viewer-actions');
  const exp = el('button', 'btn-ghost', 'Gather the garden into a seed');
  exp.onclick = () => handlers.onExport();
  const imp = el('button', 'btn-ghost', 'Plant an existing seed');
  imp.onclick = () => handlers.onImport();
  portRow.appendChild(exp); portRow.appendChild(imp);
  card.appendChild(portRow);

  const doneRow = el('div', 'viewer-actions');
  const done = el('button', 'btn-primary', 'Return to the garden');
  done.onclick = () => handlers.onClose();
  doneRow.appendChild(done);
  card.appendChild(doneRow);

  const close = el('button', 'close-x', '&times;');
  close.style.position = 'absolute'; close.style.top = '18px'; close.style.right = '20px';
  close.onclick = () => handlers.onClose();
  card.appendChild(close);

  container.innerHTML = '';
  container.appendChild(card);
  container.classList.remove('hidden');
  trap(container, handlers.onClose);
}

// ------- helpers -------
export function formatDate(rec) {
  if (rec.dateMode === 'unknown' || !rec.dateValue) return rec.dateMode === 'unknown' ? 'A time now blurred' : '';
  return rec.dateValue;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

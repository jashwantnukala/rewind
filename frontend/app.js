/* REWIND frontend. All document + history state lives in the C++ backend (singly linked list).
   This file only: (1) turns textarea changes into edit deltas, (2) calls the API, (3) draws what comes back. */
'use strict';
const $ = s => document.querySelector(s);
const ta = $('#editor'), enc = new TextEncoder(), dec = new TextDecoder();

let state = null, lastValue = '', fileName = 'untitled.txt', fileHandle = null, savedText = '';
let breakGroup = false, composing = false, pending = 0, inputType = '';
let chain = Promise.resolve();            // API calls are serialised so the backend sees edits in order

/* ---------- icons ---------- */
const ICONS = {
  new:'<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/>',
  open:'<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  save:'<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
  undo:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo:'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  paste:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  find:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  history:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>'
};
document.querySelectorAll('[data-i]').forEach(el => el.outerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[el.dataset.i]}</svg>`);

/* ---------- helpers ---------- */
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function api(path, body) {
  const p = chain.then(() => fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json()))
    .catch(() => { toast('Cannot reach the C++ backend. Is ./rewind still running?'); return null; });
  chain = p; return p;
}

/* ---------- applying backend state ---------- */
function applyState(s, meta = {}) {
  const prev = state; state = s;
  if (meta.setText) {
    ta.value = s.text; lastValue = s.text;
    if (meta.caret !== false) {
      const idx = dec.decode(enc.encode(s.text).slice(0, s.caret)).length;   // byte offset -> UTF-16 index
      if (meta.focus !== false) ta.focus();
      ta.setSelectionRange(idx, idx);
    }
  } else if (s.text !== ta.value && pending === 0 && !composing) {       // safety net: backend is the source of truth
    ta.value = s.text; lastValue = s.text; toast('Editor re-synced with the backend');
  }
  render(prev, meta);
}

/* ---------- edits: textarea -> delta -> backend ---------- */
const isHigh = c => c >= 0xD800 && c < 0xDC00, isLow = c => c >= 0xDC00 && c < 0xE000;
function classify(type, removed, inserted) {
  if (/Paste|Drop/.test(type) && inserted) return 'paste';
  if (type === 'deleteByCut') return 'cut';
  if (removed && inserted) return 'replace';
  return inserted ? 'type' : 'delete';
}
function handleDiff(forceKind) {
  const ov = lastValue, nv = ta.value;
  if (ov === nv) return;
  const max = Math.min(ov.length, nv.length);
  let a = 0, b = 0;
  while (a < max && ov[a] === nv[a]) a++;                                   // common prefix
  while (b < max - a && ov[ov.length - 1 - b] === nv[nv.length - 1 - b]) b++; // common suffix
  if (a > 0 && isHigh(ov.charCodeAt(a - 1))) a--;                           // never split emoji
  if (b > 0 && isLow(ov.charCodeAt(ov.length - b))) b--;
  const removed = ov.slice(a, ov.length - b), inserted = nv.slice(a, nv.length - b);
  const body = { pos: enc.encode(ov.slice(0, a)).length, removed, inserted,
                 kind: forceKind || classify(inputType, removed, inserted), group: !breakGroup };
  breakGroup = false; lastValue = nv; inputType = '';
  pending++;
  api('/api/edit', body).then(s => {
    pending--;
    if (s) applyState(s, { op: s.op, discardedPrev: s.discarded });
  });
}
ta.addEventListener('beforeinput', e => {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); return; }  // browser history is NOT used
  inputType = e.inputType;
});
ta.addEventListener('input', () => { if (!composing) handleDiff(); });
ta.addEventListener('compositionstart', () => composing = true);
ta.addEventListener('compositionend', () => { composing = false; handleDiff(); });
// moving the caret ends the current typing group
ta.addEventListener('mousedown', () => breakGroup = true);
ta.addEventListener('keydown', e => { if (/^(Arrow|Home|End|Page)/.test(e.key)) breakGroup = true; });
['keyup', 'mouseup', 'select', 'focus', 'input'].forEach(ev => ta.addEventListener(ev, renderStatus));

function replaceSelection(str, kind) {
  ta.focus(); ta.setRangeText(str, ta.selectionStart, ta.selectionEnd, 'end'); breakGroup = true; handleDiff(kind);
}

/* ---------- undo / redo / time travel ---------- */
async function doOp(op) {
  const s = await api('/api/' + op, {});
  if (!s) return;
  if (!s.ok) toast(op === 'undo' ? 'Nothing to undo: current is already the head node' : 'Nothing to redo: current.next is NULL');
  applyState(s, { op, setText: s.ok });
}
let target = null, busy = false;
async function travel(index) {            // latest-wins, so dragging the slider never queues stale jumps
  target = index; if (busy) return; busy = true;
  while (target !== null) {
    const t = target; target = null;
    const before = state ? state.currentIndex : 0;
    const s = await api('/api/goto', { index: t });
    if (s && s.ok) applyState(s, { op: 'goto', steps: Math.abs(t - before), setText: true, focus: false });
  }
  busy = false;
}
$('#slider').addEventListener('input', e => travel(+e.target.value));

/* ---------- rendering ---------- */
const KIND_LABEL = { init: 'start', type: 'type', delete: 'delete', paste: 'paste', cut: 'cut', replace: 'replace' };
function render(prev, meta) {
  const s = state;
  $('#bUndo').disabled = !s.canUndo; $('#bRedo').disabled = !s.canRedo;
  renderTitle(); renderStatus(); renderTimeline(); renderViz(prev, meta); renderStats();
  const sl = $('#slider'), max = s.size - 1;
  sl.max = max; sl.disabled = max < 1;
  if (target === null) sl.value = s.currentIndex;
  sl.style.setProperty('--fill', max ? (s.currentIndex / max * 100) + '%' : '0%');
  $('#stepOut').textContent = `Step ${s.currentIndex} of ${max}`;
  $('#pCount').textContent = plural(s.size, 'node');
}
function renderTitle() {
  const dirty = ta.value !== savedText;
  $('#fname').textContent = fileName; $('#dirty').hidden = !dirty;
  document.title = `${dirty ? '● ' : ''}${fileName} · REWIND`;
}
function renderStatus() {
  const v = ta.value, p = ta.selectionStart, before = v.slice(0, p);
  $('#sPos').textContent = `Ln ${before.split('\n').length}, Col ${p - before.lastIndexOf('\n')}`;
  const n = ta.selectionEnd - p, sel = $('#sSel'); sel.hidden = !n; sel.textContent = `${plural(n, 'char')} selected`;
  if (state) {
    $('#sWords').textContent = plural(state.stats.words, 'word');
    $('#sChars').textContent = plural(state.stats.chars, 'character');
  }
}
function renderTimeline() {
  const ol = $('#timeline'); ol.textContent = '';
  const cur = state.currentIndex;
  state.nodes.forEach(n => {
    const li = el('li', n.index === cur ? 'current' : n.index > cur ? 'future' : '');
    li.dataset.kind = n.kind; li.title = 'Jump to this state';
    const body = el('div', 't-body');
    body.append(el('b', '', n.label),
      el('small', '', n.kind === 'init' ? 'node #0 · head' : `node #${n.id} · ${new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`));
    li.append(el('span', 't-dot'), body);
    li.onclick = () => travel(n.index);
    ol.append(li);
  });
  ol.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}
function stat(v, label) { const d = el('div', 'stat'); d.append(el('b', '', v), el('span', '', label)); return d; }
function renderStats() {
  const s = state, st = s.stats, box = $('#stats'); box.textContent = '';
  const mins = st.words / 200, read = st.words === 0 ? '0 min' : mins < 1 ? '<1 min' : Math.round(mins) + ' min';
  box.append(el('div', 'stat sec', 'Document'), stat(st.words, 'words'), stat(st.chars, 'characters'), stat(st.charsNoSpace, 'no spaces'),
    stat(st.lines, 'lines'), stat(read, 'reading time'), stat(st.words ? (st.charsNoSpace / st.words).toFixed(1) : '0', 'avg word len'),
    el('div', 'stat sec', 'Linked list'), stat(s.size, 'nodes'), stat(s.currentIndex, 'undo steps'), stat(s.size - 1 - s.currentIndex, 'redo steps'),
    stat(s.history.totalEdits, 'edits made'), stat(s.history.grouped, 'grouped keys'), stat(s.history.discardedTotal, 'nodes freed'));
}
function vizNote(prev, meta) {
  const s = state, ids = s.trace.map(i => '#' + i);
  switch (meta.op) {
    case 'undo': return s.ok === false ? '' : `Undo: walked from head through ${ids.length > 6 ? [...ids.slice(0, 3), '…', ...ids.slice(-2)].join(' → ') : ids.join(' → ')} to find the node before the old current (no prev pointer exists). O(n)`;
    case 'redo': return `Redo: followed current.next to ${ids[0]}. O(1)`;
    case 'goto': return `Time travel: moved ${plural(meta.steps || 0, 'step')} along the list.`;
    case 'reset': return 'New list: the head node is the only node.';
    case 'edit': {
      const last = s.nodes[s.nodes.length - 1];
      if (s.merged) return `Grouped into node #${s.nodes[s.currentIndex].id}: continuous typing is one action, no new node.`;
      return s.discarded ? `Branch! ${plural(s.discarded, 'redo node')} freed, then node #${last.id} appended after current.` : `New node #${last.id} appended after current; current moved to it.`;
    }
  }
  return 'Click any node to jump to that state.';
}
function renderViz(prev, meta) {
  const s = state, viz = $('#viz'), cur = s.currentIndex;
  if (meta.op) $('#vizNote').textContent = vizNote(prev, meta) || $('#vizNote').textContent;
  viz.textContent = '';
  const track = el('div', 'track');
  s.nodes.forEach((n, i) => {
    const slot = el('div', 'slot'), node = el('div', 'node' + (i === cur ? ' current' : i > cur ? ' future' : ''));
    node.dataset.id = n.id; node.dataset.kind = n.kind; node.title = `Jump to node #${n.id}`;
    const data = el('div', 'n-data'), top = el('div', 'n-top');
    top.append(el('span', '', n.kind === 'init' ? 'HEAD' : '#' + n.id), el('span', 'n-kind', KIND_LABEL[n.kind]));
    data.append(top, el('div', 'n-label', n.label));
    const ptr = el('div', 'n-ptr'); ptr.append(el('i'));
    node.append(data, ptr); node.onclick = () => travel(n.index);
    if (meta.op === 'edit' && i === s.nodes.length - 1 && !s.merged) node.classList.add('fresh');
    if (meta.op === 'edit' && s.merged && i === cur) node.classList.add('bump');
    slot.append(node);
    if (i === 0) slot.append(Object.assign(el('div', 'tag head'), { innerHTML: '<span>head</span>' }));
    if (i === cur) slot.append(Object.assign(el('div', 'tag cur'), { innerHTML: '<span>current</span>' }));
    track.append(slot, el('div', 'link' + (i < cur || (i === cur && i === s.nodes.length - 1) ? ' live' : ' future')));
  });
  track.append(el('div', 'null', 'NULL'));
  if (meta.discardedPrev && prev) {                       // show the freed nodes dissolving
    prev.nodes.slice(prev.currentIndex + 1, prev.currentIndex + 1 + meta.discardedPrev).forEach(n => {
      const g = el('div', 'node ghost'); g.style.marginLeft = '14px';
      const d = el('div', 'n-data'); d.append(el('div', 'n-top', 'freed'), el('div', 'n-label', n.label));
      g.append(d, Object.assign(el('div', 'n-ptr'), { innerHTML: '<i></i>' })); track.append(g);
    });
  }
  viz.append(track);
  const c = viz.querySelector('.node.current');
  if (c) viz.scrollTo({ left: c.parentElement.offsetLeft + 20 - viz.clientWidth / 2 + c.offsetWidth / 2, behavior: 'smooth' });
  if (meta.op === 'undo' && s.trace.length) {            // animate the head-to-prev traversal
    const step = Math.min(150, 1500 / s.trace.length);
    s.trace.forEach((id, k) => setTimeout(() => {
      const n = viz.querySelector(`.node[data-id="${id}"]`); if (!n) return;
      n.classList.add('visit'); setTimeout(() => n.classList.remove('visit'), 420);
    }, k * step));
  }
  if (meta.discardedPrev) toast(`Branching: ${plural(meta.discardedPrev, 'redo node')} discarded`);
}

/* ---------- files ---------- */
async function resetDoc(text, name) {
  const s = await api('/api/reset', { text: text.replace(/\r\n?/g, '\n') });
  if (!s) return;
  fileName = name; fileHandle = null;
  applyState(s, { op: 'reset', setText: true }); savedText = s.text; renderTitle();
}
const confirmDiscard = () => ta.value === savedText || confirm('You have unsaved changes. Discard them?');
$('#bNew').onclick = () => { if (confirmDiscard()) resetDoc('', 'untitled.txt'); };
$('#bOpen').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f && confirmDiscard()) { await resetDoc(await f.text(), f.name); toast(`Opened ${f.name}`); }
};
async function save() {
  const blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
  try {
    if (window.showSaveFilePicker) {
      fileHandle ??= await showSaveFilePicker({ suggestedName: fileName });
      const w = await fileHandle.createWritable(); await w.write(blob); await w.close(); fileName = fileHandle.name;
    } else throw new Error('fallback');
  } catch (err) {
    if (err.name === 'AbortError') return;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fileName });
    a.click(); URL.revokeObjectURL(a.href);
  }
  savedText = ta.value; renderTitle(); toast(`Saved ${fileName}`);
}
$('#bSave').onclick = save;

/* ---------- clipboard buttons ---------- */
const selected = () => ta.value.slice(ta.selectionStart, ta.selectionEnd);
$('#bCopy').onclick = async () => { if (!selected()) return toast('Select some text first'); await navigator.clipboard.writeText(selected()); toast('Copied'); };
$('#bCut').onclick = async () => { if (!selected()) return toast('Select some text first'); await navigator.clipboard.writeText(selected()); replaceSelection('', 'cut'); };
$('#bPaste').onclick = async () => {
  try { replaceSelection(await navigator.clipboard.readText(), 'paste'); } catch { toast('The browser blocked clipboard access. Use Ctrl+V instead.'); }
};

/* ---------- find & replace (Replace all = ONE history node) ---------- */
function regex() {
  const q = $('#fq').value; if (!q) return null;
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('#fcase').checked ? 'g' : 'gi');
}
function countMatches() { const re = regex(); $('#fcount').textContent = re ? plural((ta.value.match(re) || []).length, 'match') : ''; }
function findNext() {
  const re = regex(); if (!re) return false;
  re.lastIndex = ta.selectionEnd; let m = re.exec(ta.value);
  if (!m) { re.lastIndex = 0; m = re.exec(ta.value); }
  if (!m) { toast('No matches'); return false; }
  ta.focus(); ta.setSelectionRange(m.index, m.index + m[0].length); return true;
}
function replaceOne() {
  const re = regex(); if (!re) return;
  const sel = selected();
  if (sel && new RegExp('^' + re.source + '$', re.flags.replace('g', '')).test(sel)) replaceSelection($('#fr').value, 'replace');
  findNext(); countMatches();
}
function replaceAll() {
  const re = regex(); if (!re) return;
  const n = (ta.value.match(re) || []).length; if (!n) return toast('No matches');
  const r = $('#fr').value; ta.value = ta.value.replace(re, () => r);
  breakGroup = true; handleDiff('replace'); countMatches(); toast(`Replaced ${plural(n, 'match')} as one action`);
}
function toggleFind(show = $('#find').hidden) {
  $('#find').hidden = !show;
  if (show) { const s = selected(); if (s && !s.includes('\n')) $('#fq').value = s; $('#fq').focus(); $('#fq').select(); countMatches(); } else ta.focus();
}
$('#bFind').onclick = () => toggleFind(); $('#fClose').onclick = () => toggleFind(false);
$('#fNext').onclick = findNext; $('#fOne').onclick = replaceOne; $('#fAll').onclick = replaceAll;
$('#fq').oninput = countMatches; $('#fcase').onchange = countMatches;
$('#find').addEventListener('keydown', e => { if (e.key === 'Escape') toggleFind(false); if (e.key === 'Enter' && e.target.id === 'fq') findNext(); });

/* ---------- shortcuts & chrome ---------- */
$('#bUndo').onclick = () => doOp('undo'); $('#bRedo').onclick = () => doOp('redo');
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); doOp(e.shiftKey ? 'redo' : 'undo'); }
  else if (mod && k === 'y') { e.preventDefault(); doOp('redo'); }
  else if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod && k === 'o') { e.preventDefault(); $('#file').click(); }
  else if (mod && k === 'h') { e.preventDefault(); toggleFind(true); }
  else if (e.altKey && k === 'n') { e.preventDefault(); $('#bNew').click(); }
});
const root = document.body;
$('#pClose').onclick = () => root.classList.add('collapsed');
$('#bPanel').onclick = () => { root.classList.toggle('collapsed'); localStorage.setItem('rewind.collapsed', root.classList.contains('collapsed') ? '1' : ''); };
if (localStorage.getItem('rewind.collapsed') === '1' || innerWidth <= 900) root.classList.add('collapsed');
window.addEventListener('beforeunload', e => { if (ta.value !== savedText) e.preventDefault(); });

/* ---------- boot ---------- */
api('/api/state').then(s => { if (s) { applyState(s, { setText: true, caret: false }); savedText = s.text; renderTitle(); ta.focus(); } });

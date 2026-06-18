/* ════════════════════════════════════════
   ReaderApp — app.js
   v2 — Fix: St.PageFlip → SimpleFlip, EPUB DIY fix, PDF background render
   ════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════════
//  SIMPLEPDF VIEWER — pengganti StPageFlip
//  (Swipe canvas-based, tanpa library eksternal)
// ══════════════════════════════════════════════

class SimplePDFViewer {
  constructor(container, { width, height }) {
    this.container = container;
    this.width     = width;
    this.height    = height;
    this.pages     = [];
    this.current   = 0;
    this._handlers = {};

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `display:block;max-width:100%;max-height:100%;
      border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.6);touch-action:pan-y`;
    this.ctx = this.canvas.getContext('2d');
    container.innerHTML = '';
    container.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%';
    container.appendChild(this.canvas);

    // Swipe
    let tx = 0;
    this.canvas.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    this.canvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 50) dx < 0 ? this.flipNext() : this.flipPrev();
    }, { passive: true });
  }

  loadFromImages(images) {
    this.pages = images;
    this._draw(this.current);
  }

  _draw(idx) {
    if (!this.pages[idx]) return;
    const img = new Image();
    img.onload = () => {
      this.canvas.width  = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = this.pages[idx];
  }

  turnToPage(idx) {
    idx = Math.max(0, Math.min(this.pages.length - 1, idx));
    if (idx === this.current) return;
    this.current = idx;
    this._draw(idx);
    this._fire('flip', idx);
  }

  flipNext() { this.turnToPage(this.current + 1); }
  flipPrev() { this.turnToPage(this.current - 1); }

  on(event, fn) { this._handlers[event] = fn; return this; }
  _fire(event, data) { this._handlers[event]?.({ data }); }

  destroy() {
    this.pages = [];
    this.container.innerHTML = '';
  }
}

// ══════════════════════════════════════════════
//  INDEXEDDB
// ══════════════════════════════════════════════

const DB_NAME = 'ReaderAppDB';
const DB_VER  = 1;
let db;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files'))
        d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('history'))
        d.createObjectStore('history', { keyPath: 'id' });
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror   = e => rej(e);
  });
}

function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj).onsuccess = () => res();
    tx.onerror = e => rej(e);
  });
}

function dbGet(store, id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r  = tx.objectStore(store).get(id);
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r  = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e);
  });
}

function dbDel(store, id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id).onsuccess = () => res();
    tx.onerror = e => rej(e);
  });
}

function dbClear(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear().onsuccess = () => res();
    tx.onerror = e => rej(e);
  });
}

// ══════════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════════

let appMode       = null;
let pdfFlip       = null;   // SimplePDFViewer instance
let pdfTotal      = 0;
let pdfCurrent    = 0;
let pdfImages     = [];
let pdfUITimer    = null;
let pdfUIVisible  = true;
let epubFontSize  = 100;
let epubLH        = 'normal';
let epubTheme     = 'sepia';
let cancelLoad    = false;
let currentFileId = null;
let foliateView   = null;
let settingsOpen  = false;

const themes = {
  sepia: { bg:'#faf6ef', surface:'#fff4e6', text:'#3d2b1f', btnBg:'#f0ece4', btnColor:'#444' },
  white: { bg:'#ffffff', surface:'#f5f5f5', text:'#111',    btnBg:'#ebebeb', btnColor:'#333' },
  dark:  { bg:'#1a1a2e', surface:'#16213e', text:'#e0ddd5', btnBg:'#2a2a4a', btnColor:'#bbb' },
};

// ══════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none';
    s.classList.remove('active');
  });
  const el = document.getElementById(id);
  el.style.display = 'flex';
  el.classList.add('active');
}

// ══════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════

let toastTimer;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ══════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════

async function saveHistory(entry) {
  entry.ts = Date.now();
  await dbPut('history', entry);
}

async function renderHistory() {
  const list = document.getElementById('history-list');
  const all  = await dbGetAll('history');
  all.sort((a, b) => b.ts - a.ts);

  if (!all.length) {
    list.innerHTML = '<div class="hist-empty">Belum ada buku yang dibaca</div>';
    return;
  }

  list.innerHTML = '';
  all.slice(0, 8).forEach(h => {
    const pct  = h.type === 'pdf'
      ? Math.round((h.page + 1) / h.total * 100)
      : (h.pct || 0);
    const card = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML = `
      <div class="hist-type hist-type-${h.type}" role="img" aria-label="${h.type.toUpperCase()}">
        ${h.type === 'pdf' ? '📄' : '📖'}
      </div>
      <div class="hist-info">
        <div class="hist-title">${h.title}</div>
        <div class="hist-meta">${h.type.toUpperCase()} · ${pct}% · ${timeAgo(h.ts)}</div>
        <div class="hist-prog-bg">
          <div class="hist-prog-fill hist-prog-${h.type}" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="hist-arrow" aria-hidden="true">›</div>
      <button class="hist-btn-del" data-id="${h.id}" aria-label="Hapus ${h.title}">✕</button>`;

    card.addEventListener('click', e => {
      if (e.target.classList.contains('hist-btn-del')) return;
      openFromHistory(h);
    });

    card.querySelector('.hist-btn-del').addEventListener('click', async e => {
      e.stopPropagation();
      await dbDel('history', h.id);
      await dbDel('files', h.id);
      renderHistory();
    });

    list.appendChild(card);
  });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'Baru saja';
  if (s < 3600)  return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

document.getElementById('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('Hapus semua riwayat & file tersimpan?')) return;
  await dbClear('history');
  await dbClear('files');
  renderHistory();
  toast('Riwayat dihapus');
});

async function openFromHistory(h) {
  const stored = await dbGet('files', h.id);
  if (!stored || !stored.buf) {
    toast('File tidak ditemukan, pilih ulang');
    return;
  }
  currentFileId = h.id;
  if (h.type === 'pdf') {
    await loadPDF(stored.buf, h.title, h.page);
  } else {
    await loadEPUB(stored.buf, h.title, h.cfi);
  }
}

// ══════════════════════════════════════════════
//  FILE INPUT
// ══════════════════════════════════════════════

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  if (e.dataTransfer.files[0]) handleNewFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleNewFile(e.target.files[0]);
});

async function handleNewFile(file) {
  const name = file.name.toLowerCase();
  const type = name.endsWith('.pdf') ? 'pdf'
    : name.endsWith('.epub') ? 'epub'
    : null;

  if (!type) { toast('Format tidak didukung (hanya PDF/EPUB)'); return; }

  try {
    const buf = await file.arrayBuffer();
    const id  = file.name;
    currentFileId = id;
    await dbPut('files', { id, buf, name: file.name });

    if (type === 'pdf') {
      await loadPDF(buf, file.name, 0);
    } else {
      await loadEPUB(buf, file.name, null);
    }
  } catch (err) {
    console.error('handleNewFile error:', err);
    toast('Gagal membuka file: ' + err.message);
    showScreen('screen-home');
  }
}

// ══════════════════════════════════════════════
//  PDF READER — Background render + instant page 1
// ══════════════════════════════════════════════

async function loadPDF(buf, fname, resumePage) {
  appMode    = 'pdf';
  cancelLoad = false;
  pdfImages  = [];
  pdfTotal   = 0;

  // Validasi pdfjsLib
  if (typeof pdfjsLib === 'undefined') {
    toast('PDF.js gagal dimuat. Coba reload halaman.');
    return;
  }

  // Progress screen
  showScreen('screen-progress');
  document.getElementById('prog-label').textContent = fname;
  document.getElementById('prog-sub').textContent   = 'Membuka file…';
  document.getElementById('prog-num').textContent   = '0';
  document.getElementById('prog-fill').className    = 'prog-bar-fill pdf-fill';
  document.getElementById('prog-fill').style.width  = '0%';

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  } catch (err) {
    toast('Gagal membuka PDF: ' + err.message);
    showScreen('screen-home');
    return;
  }

  pdfTotal = pdf.numPages;
  document.getElementById('prog-sub').textContent = 'Merender halaman…';

  // ── Render halaman 1 dulu, langsung tampil ke reader ──
  try {
    const firstSrc = await renderPDFPage(pdf, resumePage + 1 || 1);
    pdfImages[resumePage || 0] = firstSrc;
  } catch (err) {
    toast('Gagal merender halaman pertama: ' + err.message);
    showScreen('screen-home');
    return;
  }

  if (cancelLoad) { showScreen('screen-home'); return; }

  // Simpan history & buka reader dengan halaman 1
  await saveHistory({ id: currentFileId, type: 'pdf', title: fname, page: resumePage || 0, total: pdfTotal, pct: 0 });
  buildPDFReader(fname, resumePage || 0);
  showScreen('screen-pdf');

  // ── Render sisa halaman di background ──
  renderPDFBackground(pdf, fname, resumePage || 0);
}

async function renderPDFBackground(pdf, fname, startPage) {
  const total = pdfTotal;
  // Render semua halaman kecuali yang sudah ada
  for (let i = 1; i <= total; i++) {
    if (cancelLoad) return;
    if (pdfImages[i - 1]) continue; // skip yang sudah dirender

    try {
      pdfImages[i - 1] = await renderPDFPage(pdf, i);
    } catch (e) {
      console.warn('Gagal render halaman', i, e);
      continue;
    }

    // Tambahkan thumbnail saat halaman selesai dirender
    addPDFThumb(i - 1);

    // Update viewer jika halaman ini belum ada di SimplePDFViewer
    if (pdfFlip) {
      pdfFlip.pages = pdfImages.slice(); // update referensi
    }

    await tick();
  }
}

async function renderPDFPage(pdf, n) {
  const page  = await pdf.getPage(n);
  const vp0   = page.getViewport({ scale: 1 });
  const scale = Math.min(
    (window.screen.width * window.devicePixelRatio * .9) / vp0.width,
    2.5
  );
  const vp = page.getViewport({ scale });
  const c  = document.createElement('canvas');
  c.width  = vp.width;
  c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c.toDataURL('image/jpeg', .85);
}

function buildPDFReader(fname, resumePage) {
  const bookEl = document.getElementById('pdf-book');
  const thumbs = document.getElementById('pdf-thumbs');
  bookEl.innerHTML  = '';
  thumbs.innerHTML  = '';

  const bw = Math.min(window.innerWidth - 20, 480);
  const bh = Math.floor(window.innerHeight * 0.82);

  // Init viewer dengan halaman yang sudah ada
  pdfFlip = new SimplePDFViewer(bookEl, { width: bw, height: bh });
  pdfFlip.loadFromImages(pdfImages);
  pdfFlip.current = resumePage;
  pdfFlip._draw(resumePage);
  pdfFlip.on('flip', e => onPDFFlip(e.data));

  // Scrubber
  const sc = document.getElementById('pdf-scrubber');
  sc.max   = pdfTotal - 1;
  sc.value = resumePage;
  sc.addEventListener('input', () => {
    const pg = +sc.value;
    if (pdfImages[pg]) {
      pdfFlip.turnToPage(pg);
    } else {
      // Halaman belum siap, tunggu sebentar
      toast('Halaman sedang dimuat…');
    }
  });

  // Thumbnail halaman pertama
  if (pdfImages[resumePage]) addPDFThumb(resumePage, true);

  document.getElementById('pdf-title').textContent = fname;
  updatePDFUI(resumePage);
}

function addPDFThumb(idx, active = false) {
  // Cek apakah thumbnail sudah ada
  if (document.querySelector(`#pdf-thumbs .thumb[data-i="${idx}"]`)) return;

  const thumbs = document.getElementById('pdf-thumbs');
  const th = document.createElement('div');
  th.className  = 'thumb' + (active ? ' active' : '');
  th.dataset.i  = idx;
  const ti = new Image();
  ti.src = pdfImages[idx];
  ti.alt = `Halaman ${idx + 1}`;
  th.appendChild(ti);
  th.addEventListener('click', () => {
    if (pdfImages[idx]) pdfFlip.turnToPage(idx);
    else toast('Halaman sedang dimuat…');
  });

  // Insert di posisi yang benar (sorted by idx)
  const existing = Array.from(thumbs.children);
  const after = existing.find(el => parseInt(el.dataset.i) > idx);
  if (after) thumbs.insertBefore(th, after);
  else thumbs.appendChild(th);
}

function onPDFFlip(idx) {
  pdfCurrent = idx;
  updatePDFUI(idx);
  const title = document.getElementById('pdf-title').textContent;
  saveHistory({
    id: currentFileId,
    type: 'pdf',
    title,
    page: idx,
    total: pdfTotal,
    pct: Math.round((idx + 1) / pdfTotal * 100),
  });
}

function updatePDFUI(idx) {
  const sc = document.getElementById('pdf-scrubber');
  sc.value = idx;
  document.getElementById('pdf-page-label').innerHTML =
    `Hal <strong>${idx + 1}</strong>/${pdfTotal}`;
  document.getElementById('pdf-top-page').textContent =
    `${idx + 1}/${pdfTotal}`;

  document.querySelectorAll('#pdf-thumbs .thumb').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.i) === idx);
  });
  const at = document.querySelector(`#pdf-thumbs .thumb[data-i="${idx}"]`);
  if (at) at.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

  document.getElementById('pdf-prev').disabled  = idx <= 0;
  document.getElementById('pdf-first').disabled = idx <= 0;
  document.getElementById('pdf-next').disabled  = idx >= pdfTotal - 1;
  document.getElementById('pdf-last').disabled  = idx >= pdfTotal - 1;
}

// PDF nav
document.getElementById('pdf-prev').addEventListener('click', () => {
  if (!pdfImages[pdfFlip.current - 1]) { toast('Halaman sedang dimuat…'); return; }
  pdfFlip?.flipPrev();
});
document.getElementById('pdf-next').addEventListener('click', () => {
  if (!pdfImages[pdfFlip.current + 1]) { toast('Halaman sedang dimuat…'); return; }
  pdfFlip?.flipNext();
});
document.getElementById('pdf-first').addEventListener('click', () => pdfFlip?.turnToPage(0));
document.getElementById('pdf-last').addEventListener('click', () => pdfFlip?.turnToPage(pdfTotal - 1));

document.getElementById('pdf-back').addEventListener('click', () => {
  cancelLoad = true;
  if (pdfFlip) { try { pdfFlip.destroy(); } catch(e) {} pdfFlip = null; }
  pdfImages  = [];
  document.getElementById('pdf-book').innerHTML   = '';
  document.getElementById('pdf-thumbs').innerHTML = '';
  fileInput.value = '';
  renderHistory();
  showScreen('screen-home');
});

// PDF UI auto-hide
function pdfShowUI() {
  pdfUIVisible = true;
  document.getElementById('pdf-topbar').classList.remove('hide');
  document.getElementById('pdf-bottombar').classList.remove('hide');
  clearTimeout(pdfUITimer);
  pdfUITimer = setTimeout(() => {
    document.getElementById('pdf-topbar').classList.add('hide');
    document.getElementById('pdf-bottombar').classList.add('hide');
    pdfUIVisible = false;
  }, 3000);
}

document.getElementById('screen-pdf').addEventListener('click', e => {
  if (e.target.closest('#pdf-back, .btn-nav, .thumb, .scrubber')) return;
  pdfUIVisible ? null : pdfShowUI();
});
document.getElementById('pdf-bottombar').addEventListener('pointerdown', e => {
  e.stopPropagation(); pdfShowUI();
});
document.getElementById('pdf-topbar').addEventListener('pointerdown', e => {
  e.stopPropagation(); pdfShowUI();
});

// Keyboard nav
document.addEventListener('keydown', e => {
  if (appMode === 'pdf') {
    if (e.key === 'ArrowRight') pdfFlip?.flipNext();
    if (e.key === 'ArrowLeft')  pdfFlip?.flipPrev();
  }
  if (appMode === 'epub') {
    if (!foliateView) return;
    if (e.key === 'ArrowRight') foliateView.goRight();
    if (e.key === 'ArrowLeft')  foliateView.goLeft();
  }
});

// ══════════════════════════════════════════════
//  EPUB READER — Fix: loading overlay + DIY fallback
// ══════════════════════════════════════════════

const EPUB_STEPS = ['Membuka file…', 'Membaca isi buku…', 'Menyiapkan tampilan…', 'Sebentar lagi…'];
let epubLoadTimer = null;

function showEpubLoading(msg) {
  let ov = document.getElementById('epub-loading-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'epub-loading-overlay';
    Object.assign(ov.style, {
      position: 'absolute', inset: '0', display: 'flex',
      flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '16px', zIndex: '50',
    });
    ov.innerHTML = `
      <div id="epub-load-msg" style="font-size:15px;font-weight:600">${msg}</div>
      <div style="width:200px;height:4px;background:rgba(0,0,0,.1);border-radius:99px;overflow:hidden">
        <div id="epub-load-bar" style="height:100%;width:0%;background:#5b8dee;transition:width .3s"></div>
      </div>`;
    document.getElementById('epub-area').appendChild(ov);
  }
  const t = themes[epubTheme];
  ov.style.background = t.bg;
  ov.style.color      = t.text;
  const m = document.getElementById('epub-load-msg');
  if (m) { m.textContent = msg; m.style.color = t.text; }
  ov.style.display = 'flex';
}

function updateEpubProgress(pct) {
  const bar = document.getElementById('epub-load-bar');
  if (bar) bar.style.width = pct + '%';
}

function hideEpubLoading() {
  clearInterval(epubLoadTimer);
  epubLoadTimer = null;
  const ov = document.getElementById('epub-loading-overlay');
  if (ov) ov.remove();
}

async function loadEPUB(buf, fname, resumeCfi) {
  appMode = 'epub';
  showScreen('screen-epub');
  applyEPUBThemeColors();
  showEpubLoading(EPUB_STEPS[0]);
  updateEpubProgress(5);

  // Fake progress ticker
  let fakePct = 10;
  epubLoadTimer = setInterval(() => {
    fakePct = Math.min(fakePct + (fakePct < 60 ? 3 : 1), 90);
    const si = fakePct < 35 ? 0 : fakePct < 60 ? 1 : fakePct < 82 ? 2 : 3;
    showEpubLoading(EPUB_STEPS[si]);
    updateEpubProgress(fakePct);
  }, 250);

  try {
    const hasFoliate = typeof customElements !== 'undefined' &&
      customElements.get('foliate-view');

    if (hasFoliate) {
      await loadWithFoliate(buf, fname, resumeCfi);
    } else {
      await loadWithDIY(buf, fname, resumeCfi);
    }

    document.getElementById('epub-title-bar').textContent = fname;
    await saveHistory({ id: currentFileId, type: 'epub', title: fname, cfi: resumeCfi, pct: 0 });
    hideEpubLoading();

  } catch (err) {
    hideEpubLoading();
    console.error('loadEPUB error:', err);
    toast('Gagal membuka EPUB: ' + err.message);
    showScreen('screen-home');
  }
}

async function loadWithFoliate(buf, fname, resumeCfi) {
  const viewerEl = document.getElementById('epub-viewer');
  viewerEl.innerHTML = '';

  foliateView = document.createElement('foliate-view');
  foliateView.style.cssText = 'width:100%;height:100%';
  viewerEl.appendChild(foliateView);

  const blob = new Blob([buf], { type: 'application/epub+zip' });
  const file = new File([blob], fname, { type: 'application/epub+zip' });

  foliateView.addEventListener('load', () => {
    const title = foliateView.book?.metadata?.title;
    if (title) document.getElementById('epub-title-bar').textContent = title;
    applyFoliateSettings();
    if (resumeCfi) {
      try { foliateView.goTo(resumeCfi); } catch (e) {}
    }
  });

  foliateView.addEventListener('relocate', e => {
    const loc = e.detail;
    const pct = Math.round((loc?.fraction ?? 0) * 100);
    document.getElementById('epub-scrubber').value      = pct;
    document.getElementById('epub-page-label').textContent = pct + '%';
    const cfi = loc?.cfi ?? null;
    saveHistory({ id: currentFileId, type: 'epub', title: fname, cfi, pct });
  });

  await foliateView.open(file);
}

// ──────────────────────────────────────────────
//  DIY EPUB loader (tanpa foliate-view)
//  Fix: error handling yang lebih baik, inline style yang benar
// ──────────────────────────────────────────────
async function loadWithDIY(buf, fname, resumeCfi) {
  updateEpubProgress(15);

  const zip = await parseZip(buf);
  if (!zip) throw new Error('Gagal membaca ZIP — file mungkin korup');

  updateEpubProgress(25);

  // Baca container.xml
  const containerXml = await zip.readText('META-INF/container.xml');
  if (!containerXml) throw new Error('META-INF/container.xml tidak ditemukan');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('rootfile tidak ditemukan di container.xml');

  updateEpubProgress(35);

  // Base path untuk OPF
  const opfBase = rootfilePath.includes('/')
    ? rootfilePath.slice(0, rootfilePath.lastIndexOf('/') + 1)
    : '';

  const opfText = await zip.readText(rootfilePath);
  if (!opfText) throw new Error('Gagal membaca OPF: ' + rootfilePath);

  const opfDoc = parser.parseFromString(opfText, 'application/xml');

  // Manifest
  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach(it => {
    manifest[it.getAttribute('id')] = {
      href: opfBase + it.getAttribute('href'),
      type: it.getAttribute('media-type'),
    };
  });

  // Spine
  const spineItems = [];
  opfDoc.querySelectorAll('spine itemref').forEach(ref => {
    const m = manifest[ref.getAttribute('idref')];
    if (m && (m.type === 'application/xhtml+xml' || m.type === 'text/html')) {
      spineItems.push(m);
    }
  });

  if (!spineItems.length) throw new Error('Spine kosong — tidak ada halaman yang bisa dibaca');

  updateEpubProgress(45);

  const t      = themes[epubTheme];
  const viewer = document.getElementById('epub-viewer');
  viewer.innerHTML = '';

  // Container scroll
  const scroller = document.createElement('div');
  scroller.id = 'epub-diy-scroller';
  Object.assign(scroller.style, {
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    background: t.bg,
    color: t.text,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: epubFontSize + '%',
    lineHeight: epubLH === 'normal' ? '1.75' : epubLH,
    padding: '0',
    boxSizing: 'border-box',
    WebkitOverflowScrolling: 'touch',
  });
  viewer.appendChild(scroller);

  // Render setiap chapter
  let loaded = 0;
  for (const item of spineItems) {
    if (cancelLoad) return;

    let text = null;
    try {
      text = await zip.readText(item.href);
    } catch (e) {
      console.warn('Skip chapter (gagal baca):', item.href, e);
      continue;
    }
    if (!text) continue;

    // Parse chapter
    const chDoc = parser.parseFromString(text, 'text/html');

    // Hapus script
    chDoc.querySelectorAll('script, style').forEach(el => el.remove());

    // Section pembungkus
    const section = document.createElement('div');
    Object.assign(section.style, {
      maxWidth: '680px',
      margin: '0 auto',
      padding: '32px 20px 48px',
      borderBottom: `1px solid ${t.text}22`,
    });

    // Inline styling pada elemen
    const styledBody = chDoc.body ? chDoc.body.innerHTML : text;
    section.innerHTML = styledBody;

    // Fix relative image src
    const imgBase = item.href.includes('/')
      ? item.href.slice(0, item.href.lastIndexOf('/') + 1)
      : '';

    for (const img of section.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) continue;
      const cleanSrc = src.replace(/^(\.\/|\.\.\/)+/, '');
      const imgPath  = imgBase + cleanSrc;
      try {
        const blob = await zip.readBlob(imgPath);
        if (blob) img.src = URL.createObjectURL(blob);
        else img.remove();
      } catch (e) {
        img.alt = '[Gambar]';
      }
    }

    // Hapus link internal yang mungkin break layout
    for (const a of section.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href.startsWith('http')) a.removeAttribute('href');
    }

    scroller.appendChild(section);

    loaded++;
    updateEpubProgress(45 + Math.round(loaded / spineItems.length * 45));

    // Yield setiap 3 chapter agar UI tidak freeze
    if (loaded % 3 === 0) await tick();
  }

  if (!scroller.children.length) throw new Error('Tidak ada konten yang berhasil dimuat');

  updateEpubProgress(95);

  // ── Navigasi DIY ──
  const scrollPage = dir => {
    scroller.scrollBy({ top: dir * scroller.clientHeight * 0.88, behavior: 'smooth' });
  };

  // Override nav buttons (remove foliate handlers jika ada)
  const btnNext = document.getElementById('epub-next');
  const btnPrev = document.getElementById('epub-prev');
  const cloneAndReplace = btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    return clone;
  };
  cloneAndReplace(btnNext).addEventListener('click', () => scrollPage(1));
  cloneAndReplace(btnPrev).addEventListener('click', () => scrollPage(-1));

  // Scrubber
  const scrubber = document.getElementById('epub-scrubber');
  scrubber.value = 0;
  document.getElementById('epub-page-label').textContent = '0%';

  scroller.addEventListener('scroll', () => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (!max) return;
    const pct = Math.round(scroller.scrollTop / max * 100);
    scrubber.value = pct;
    document.getElementById('epub-page-label').textContent = pct + '%';
    saveHistory({ id: currentFileId, type: 'epub', title: fname, cfi: null, pct });
  }, { passive: true });

  scrubber.addEventListener('change', e => {
    const pct = +e.target.value / 100;
    scroller.scrollTop = pct * (scroller.scrollHeight - scroller.clientHeight);
  });

  // Swipe
  let ty = 0;
  viewer.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  viewer.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dy) > 60) scrollPage(dy < 0 ? 1 : -1);
  }, { passive: true });

  // Resume posisi
  if (typeof resumeCfi === 'number' && resumeCfi > 0) {
    setTimeout(() => {
      scroller.scrollTop = (resumeCfi / 100) * (scroller.scrollHeight - scroller.clientHeight);
    }, 100);
  }

  // Apply tema ke scroller
  applyDIYTheme = () => {
    const th = themes[epubTheme];
    scroller.style.background = th.bg;
    scroller.style.color      = th.text;
    scroller.style.fontSize   = epubFontSize + '%';
    scroller.style.lineHeight = epubLH === 'normal' ? '1.75' : epubLH;
  };
}

// Referensi fungsi apply tema DIY (diset saat loadWithDIY dipanggil)
let applyDIYTheme = null;

// ──────────────────────────────────────────────
//  ZIP Parser (native DecompressionStream)
// ──────────────────────────────────────────────
async function parseZip(buf) {
  try {
    const view  = new DataView(buf);
    const files = {};
    const td    = new TextDecoder();
    let eocdOffset = -1;

    for (let i = buf.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) return null;

    let pos     = view.getUint32(eocdOffset + 16, true);
    const count = view.getUint16(eocdOffset + 8, true);

    for (let i = 0; i < count; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      const method     = view.getUint16(pos + 10, true);
      const compSize   = view.getUint32(pos + 20, true);
      const uncompSize = view.getUint32(pos + 24, true);
      const fnLen      = view.getUint16(pos + 28, true);
      const exLen      = view.getUint16(pos + 30, true);
      const cmLen      = view.getUint16(pos + 32, true);
      const localOff   = view.getUint32(pos + 42, true);
      const name       = td.decode(new Uint8Array(buf, pos + 46, fnLen));
      files[name]      = { method, compSize, uncompSize, localOff };
      pos += 46 + fnLen + exLen + cmLen;
    }

    const getBytes = async name => {
      const e = files[name];
      if (!e) return null;
      const lv  = new DataView(buf, e.localOff);
      const fnl = lv.getUint16(26, true);
      const exl = lv.getUint16(28, true);
      const data = new Uint8Array(buf, e.localOff + 30 + fnl + exl, e.compSize);

      if (e.method === 0) return data;
      if (e.method === 8) {
        try {
          const ds = new DecompressionStream('deflate-raw');
          const w  = ds.writable.getWriter();
          w.write(data);
          w.close();
          const chunks = [];
          const r = ds.readable.getReader();
          while (true) {
            const { done, value } = await r.read();
            if (done) break;
            chunks.push(value);
          }
          const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.length; }
          return out;
        } catch (e) {
          console.warn('DecompressionStream gagal:', e);
          return null;
        }
      }
      return null;
    };

    return {
      readText: async n => {
        // Coba path langsung dulu, lalu coba variasi
        let d = await getBytes(n);
        if (!d) {
          // Coba tanpa leading slash
          d = await getBytes(n.replace(/^\//, ''));
        }
        if (!d) {
          // Coba cari case-insensitive
          const lower = n.toLowerCase();
          const key = Object.keys(files).find(k => k.toLowerCase() === lower);
          if (key) d = await getBytes(key);
        }
        return d ? new TextDecoder().decode(d) : null;
      },
      readBlob: async n => {
        let d = await getBytes(n);
        if (!d) {
          const lower = n.toLowerCase();
          const key = Object.keys(files).find(k => k.toLowerCase() === lower);
          if (key) d = await getBytes(key);
        }
        if (!d) return null;
        const ext  = n.split('.').pop().toLowerCase();
        const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
          gif:'image/gif', svg:'image/svg+xml', webp:'image/webp' }[ext]
          || 'application/octet-stream';
        return new Blob([d], { type: mime });
      },
      files,
    };
  } catch (e) {
    console.error('parseZip error:', e);
    return null;
  }
}

// ── Foliate settings ──
function applyFoliateSettings() {
  if (!foliateView) return;
  const t = themes[epubTheme];
  try {
    foliateView.renderer?.setStyles?.(`
      body {
        background: ${t.bg} !important;
        color: ${t.text} !important;
        font-size: ${epubFontSize}% !important;
        line-height: ${epubLH === 'normal' ? '1.6' : epubLH} !important;
      }
    `);
  } catch (e) {}
}

// ── EPUB nav buttons (Foliate) ──
document.getElementById('epub-next').addEventListener('click', () => {
  if (foliateView) foliateView.goRight();
});
document.getElementById('epub-prev').addEventListener('click', () => {
  if (foliateView) foliateView.goLeft();
});

document.getElementById('epub-scrubber').addEventListener('change', e => {
  if (foliateView) {
    try { foliateView.goToFraction(+e.target.value / 100); } catch (ex) {}
  }
});

// ── Swipe (Foliate) ──
let etx = 0;
document.getElementById('epub-area').addEventListener('touchstart', e => {
  etx = e.touches[0].clientX;
}, { passive: true });
document.getElementById('epub-area').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - etx;
  if (Math.abs(dx) > 50 && foliateView) {
    dx < 0 ? foliateView.goRight() : foliateView.goLeft();
  }
}, { passive: true });

// ── Back ──
document.getElementById('epub-back').addEventListener('click', () => {
  cancelLoad = true;
  hideEpubLoading();
  if (foliateView) {
    try { foliateView.remove(); } catch (e) {}
    foliateView = null;
  }
  applyDIYTheme = null;
  document.getElementById('epub-viewer').innerHTML = '';
  fileInput.value = '';
  renderHistory();
  showScreen('screen-home');
});

// ── Settings panel ──
document.getElementById('btn-epub-settings').addEventListener('click', e => {
  e.stopPropagation();
  settingsOpen = !settingsOpen;
  document.getElementById('epub-settings').style.display = settingsOpen ? 'block' : 'none';
  document.getElementById('btn-epub-settings').setAttribute('aria-expanded', settingsOpen);
});

document.addEventListener('click', e => {
  if (settingsOpen
    && !document.getElementById('epub-settings').contains(e.target)
    && e.target.id !== 'btn-epub-settings') {
    settingsOpen = false;
    document.getElementById('epub-settings').style.display = 'none';
  }
});

document.getElementById('font-sm').addEventListener('click', () => {
  epubFontSize = Math.max(70, epubFontSize - 10);
  applyFoliateSettings();
  if (applyDIYTheme) applyDIYTheme();
});
document.getElementById('font-lg').addEventListener('click', () => {
  epubFontSize = Math.min(180, epubFontSize + 10);
  applyFoliateSettings();
  if (applyDIYTheme) applyDIYTheme();
});

document.getElementById('lh-normal').addEventListener('click', () => {
  epubLH = 'normal';
  document.getElementById('lh-normal').classList.add('on');
  document.getElementById('lh-wide').classList.remove('on');
  document.getElementById('lh-normal').setAttribute('aria-pressed', 'true');
  document.getElementById('lh-wide').setAttribute('aria-pressed', 'false');
  applyFoliateSettings();
  if (applyDIYTheme) applyDIYTheme();
});
document.getElementById('lh-wide').addEventListener('click', () => {
  epubLH = '1.9';
  document.getElementById('lh-wide').classList.add('on');
  document.getElementById('lh-normal').classList.remove('on');
  document.getElementById('lh-wide').setAttribute('aria-pressed', 'true');
  document.getElementById('lh-normal').setAttribute('aria-pressed', 'false');
  applyFoliateSettings();
  if (applyDIYTheme) applyDIYTheme();
});

['sepia', 'white', 'dark'].forEach(t => {
  document.getElementById('theme-' + t).addEventListener('click', () => {
    epubTheme = t;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('on'));
    document.getElementById('theme-' + t).classList.add('on');
    applyFoliateSettings();
    applyEPUBThemeColors();
    if (applyDIYTheme) applyDIYTheme();
  });
});

function applyEPUBThemeColors() {
  const t = themes[epubTheme];
  document.getElementById('screen-epub').style.background = t.bg;
  document.getElementById('epub-top').style.background    = t.surface;
  document.getElementById('epub-bottom').style.background = t.surface;
  document.getElementById('epub-title-bar').style.color   = t.text;
  document.querySelectorAll('.epub-btn').forEach(b => { b.style.color = t.btnColor; });
  document.querySelectorAll('.epub-nav-btn').forEach(b => {
    b.style.background = t.btnBg;
    b.style.color      = t.btnColor;
  });
  document.getElementById('epub-page-label').style.color = t.btnColor;
}

// ══════════════════════════════════════════════
//  PROGRESS / CANCEL
// ══════════════════════════════════════════════

document.getElementById('btn-cancel').addEventListener('click', () => {
  cancelLoad = true;
  showScreen('screen-home');
});

// ══════════════════════════════════════════════
//  PWA INSTALL
// ══════════════════════════════════════════════

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('btn-install').classList.add('visible');
});

document.getElementById('btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') document.getElementById('btn-install').classList.remove('visible');
  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('btn-install').classList.remove('visible');
  toast('ReaderApp berhasil diinstall!');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('SW registered'))
    .catch(e => console.error('SW error:', e));
}

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════

function tick() { return new Promise(r => setTimeout(r, 0)); }

// ── INIT ──
openDB().then(() => renderHistory());

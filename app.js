/* ════════════════════════════════════════
   ReaderApp — app.js  v3
   PDF: St.PageFlip (embedded) + background render
   EPUB: per-halaman via iframe chapters
   ════════════════════════════════════════ */

'use strict';

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
let pdfFlip       = null;   // St.PageFlip instance
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

// EPUB per-halaman state
let epubChapters  = [];   // array of { html, blobUrls[] }
let epubCurPage   = 0;
let epubTotalPages = 0;
let applyDIYTheme = null;

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
    const pct = h.type === 'pdf'
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
  if (!stored || !stored.buf) { toast('File tidak ditemukan, pilih ulang'); return; }
  currentFileId = h.id;
  if (h.type === 'pdf') {
    await loadPDF(stored.buf, h.title, h.page);
  } else {
    await loadEPUB(stored.buf, h.title, h.page || 0);
  }
}

// ══════════════════════════════════════════════
//  FILE INPUT
// ══════════════════════════════════════════════

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
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
  const type = name.endsWith('.pdf') ? 'pdf' : name.endsWith('.epub') ? 'epub' : null;
  if (!type) { toast('Format tidak didukung (hanya PDF/EPUB)'); return; }
  try {
    const buf = await file.arrayBuffer();
    currentFileId = file.name;
    await dbPut('files', { id: file.name, buf, name: file.name });
    if (type === 'pdf') await loadPDF(buf, file.name, 0);
    else                await loadEPUB(buf, file.name, 0);
  } catch (err) {
    console.error('handleNewFile:', err);
    toast('Gagal membuka file: ' + err.message);
    showScreen('screen-home');
  }
}

// ══════════════════════════════════════════════
//  PDF READER — St.PageFlip + background render
// ══════════════════════════════════════════════

async function loadPDF(buf, fname, resumePage) {
  appMode    = 'pdf';
  cancelLoad = false;
  pdfImages  = [];
  pdfTotal   = 0;

  if (typeof pdfjsLib === 'undefined') {
    toast('PDF.js gagal dimuat. Coba reload halaman.');
    return;
  }

  // Cek St.PageFlip tersedia
  if (typeof St === 'undefined' || !St.PageFlip) {
    toast('pageflip.js gagal dimuat. Coba reload halaman.');
    return;
  }

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
  document.getElementById('prog-sub').textContent = 'Merender halaman pertama…';

  // Render halaman resume dulu — langsung buka reader
  const startIdx = Math.max(0, Math.min(resumePage || 0, pdfTotal - 1));
  try {
    pdfImages[startIdx] = await renderPDFPage(pdf, startIdx + 1);
    // Render halaman sebelah (startIdx+1) juga agar StPageFlip tidak kosong
    if (startIdx + 1 < pdfTotal) {
      pdfImages[startIdx + 1] = await renderPDFPage(pdf, startIdx + 2);
    }
  } catch (err) {
    toast('Gagal merender halaman: ' + err.message);
    showScreen('screen-home');
    return;
  }

  if (cancelLoad) { showScreen('screen-home'); return; }

  await saveHistory({ id: currentFileId, type: 'pdf', title: fname, page: startIdx, total: pdfTotal, pct: 0 });
  buildPDFReader(fname, startIdx);
  showScreen('screen-pdf');

  // Render sisa di background
  renderPDFBackground(pdf, fname);
}

async function renderPDFBackground(pdf, fname) {
  for (let i = 0; i < pdfTotal; i++) {
    if (cancelLoad) return;
    if (pdfImages[i]) continue;
    try {
      pdfImages[i] = await renderPDFPage(pdf, i + 1);
    } catch (e) {
      console.warn('Gagal render hal', i + 1, e);
      // Isi placeholder agar StPageFlip tidak crash
      pdfImages[i] = makePlaceholder(i + 1);
    }
    addPDFThumb(i);
    // Update St.PageFlip dengan gambar baru
    if (pdfFlip) {
      try { pdfFlip.updateFromImages(pdfImages.map(s => s || makePlaceholder('…'))); }
      catch(e) {}
    }
    await tick();
  }
}

function makePlaceholder(n) {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 566;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 400, 566);
  ctx.fillStyle = '#555';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Memuat hal. ' + n + '…', 200, 283);
  return c.toDataURL('image/jpeg', 0.7);
}

async function renderPDFPage(pdf, n) {
  const page  = await pdf.getPage(n);
  const vp0   = page.getViewport({ scale: 1 });
  const scale = Math.min((window.screen.width * window.devicePixelRatio * 0.9) / vp0.width, 2.5);
  const vp = page.getViewport({ scale });
  const c  = document.createElement('canvas');
  c.width  = vp.width;
  c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.85);
}

function buildPDFReader(fname, resumePage) {
  const bookEl = document.getElementById('pdf-book');
  const thumbs = document.getElementById('pdf-thumbs');
  bookEl.innerHTML  = '';
  thumbs.innerHTML  = '';

  // Dimensi: portrait penuh di mobile
  const availH = window.innerHeight - 120; // minus topbar+bottombar
  const bw = Math.min(Math.floor(availH / 1.414), window.innerWidth - 8, 520);
  // bh tetap sesuai rasio A4
  const bh = Math.floor(bw * 1.414);

  // Isi array dengan placeholder untuk halaman yang belum dirender
  const imgList = [];
  for (let i = 0; i < pdfTotal; i++) {
    imgList.push(pdfImages[i] || makePlaceholder(i + 1));
  }

  // Init St.PageFlip dengan loadFromImages (canvas renderer, lebih ringan di mobile)
  pdfFlip = new St.PageFlip(bookEl, {
    width: bw,
    height: bh,
    size: 'fixed',
    showCover: false,
    usePortrait: true,
    autoSize: false,
    drawShadow: true,
    flippingTime: 700,
    mobileScrollSupport: false,
    useMouseEvents: true,
    swipeDistance: 40,
    showPageCorners: true,
    disableFlipByClick: false,
    startZIndex: 1,
  });

  pdfFlip.loadFromImages(imgList);
  pdfFlip.turnToPage(resumePage);

  pdfFlip.on('flip', e => onPDFFlip(e.data));

  // Scrubber
  const sc = document.getElementById('pdf-scrubber');
  sc.max   = pdfTotal - 1;
  sc.value = resumePage;
  sc.addEventListener('input', () => {
    const pg = +sc.value;
    pdfFlip.flip(pg);
  });

  // Thumbnails yang sudah ada
  for (let i = 0; i < pdfImages.length; i++) {
    if (pdfImages[i]) addPDFThumb(i, i === resumePage);
  }

  document.getElementById('pdf-title').textContent = fname;
  updatePDFUI(resumePage);
}

function addPDFThumb(idx, active = false) {
  if (document.querySelector(`#pdf-thumbs .thumb[data-i="${idx}"]`)) return;
  if (!pdfImages[idx]) return;
  const thumbs = document.getElementById('pdf-thumbs');
  const th = document.createElement('div');
  th.className = 'thumb' + (active ? ' active' : '');
  th.dataset.i = idx;
  const ti = new Image();
  ti.src = pdfImages[idx];
  ti.alt = `Halaman ${idx + 1}`;
  th.appendChild(ti);
  th.addEventListener('click', () => pdfFlip?.flip(idx));
  const existing = Array.from(thumbs.children);
  const after = existing.find(el => parseInt(el.dataset.i) > idx);
  if (after) thumbs.insertBefore(th, after);
  else thumbs.appendChild(th);
}

function onPDFFlip(idx) {
  pdfCurrent = idx;
  updatePDFUI(idx);
  const title = document.getElementById('pdf-title').textContent;
  saveHistory({ id: currentFileId, type: 'pdf', title, page: idx, total: pdfTotal,
    pct: Math.round((idx + 1) / pdfTotal * 100) });
}

function updatePDFUI(idx) {
  const sc = document.getElementById('pdf-scrubber');
  sc.value = idx;
  document.getElementById('pdf-page-label').innerHTML = `Hal <strong>${idx + 1}</strong>/${pdfTotal}`;
  document.getElementById('pdf-top-page').textContent = `${idx + 1}/${pdfTotal}`;
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

// PDF nav buttons
document.getElementById('pdf-prev').addEventListener('click',  () => pdfFlip?.flipPrev());
document.getElementById('pdf-next').addEventListener('click',  () => pdfFlip?.flipNext());
document.getElementById('pdf-first').addEventListener('click', () => pdfFlip?.flip(0));
document.getElementById('pdf-last').addEventListener('click',  () => pdfFlip?.flip(pdfTotal - 1));

document.getElementById('pdf-back').addEventListener('click', () => {
  cancelLoad = true;
  if (pdfFlip) { try { pdfFlip.destroy(); } catch(e) {} pdfFlip = null; }
  pdfImages = [];
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
  if (!pdfUIVisible) pdfShowUI();
});
document.getElementById('pdf-bottombar').addEventListener('pointerdown', e => { e.stopPropagation(); pdfShowUI(); });
document.getElementById('pdf-topbar').addEventListener('pointerdown',    e => { e.stopPropagation(); pdfShowUI(); });

// Keyboard
document.addEventListener('keydown', e => {
  if (appMode === 'pdf') {
    if (e.key === 'ArrowRight') pdfFlip?.flipNext();
    if (e.key === 'ArrowLeft')  pdfFlip?.flipPrev();
  }
  if (appMode === 'epub') {
    if (e.key === 'ArrowRight') epubGoTo(epubCurPage + 1);
    if (e.key === 'ArrowLeft')  epubGoTo(epubCurPage - 1);
  }
});

// ══════════════════════════════════════════════
//  EPUB READER — per-halaman (chapter per page)
// ══════════════════════════════════════════════

const EPUB_STEPS = ['Membuka file…', 'Membaca isi buku…', 'Menyiapkan halaman…', 'Sebentar lagi…'];
let epubLoadTimer = null;

function showEpubLoading(msg) {
  let ov = document.getElementById('epub-loading-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'epub-loading-overlay';
    Object.assign(ov.style, {
      position:'absolute', inset:'0', display:'flex',
      flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:'16px', zIndex:'50',
    });
    ov.innerHTML = `
      <div id="epub-load-msg" style="font-size:15px;font-weight:600"></div>
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

async function loadEPUB(buf, fname, resumePage) {
  appMode       = 'epub';
  epubChapters  = [];
  epubCurPage   = 0;
  epubTotalPages = 0;
  applyDIYTheme = null;

  showScreen('screen-epub');
  applyEPUBThemeColors();
  showEpubLoading(EPUB_STEPS[0]);
  updateEpubProgress(5);

  let fakePct = 10;
  epubLoadTimer = setInterval(() => {
    fakePct = Math.min(fakePct + (fakePct < 60 ? 3 : 1), 90);
    showEpubLoading(EPUB_STEPS[fakePct < 35 ? 0 : fakePct < 60 ? 1 : fakePct < 82 ? 2 : 3]);
    updateEpubProgress(fakePct);
  }, 250);

  try {
    const hasFoliate = typeof customElements !== 'undefined' && customElements.get('foliate-view');
    if (hasFoliate) {
      await loadWithFoliate(buf, fname, resumePage);
    } else {
      await loadWithDIY(buf, fname, resumePage);
    }
    document.getElementById('epub-title-bar').textContent = fname;
    await saveHistory({ id: currentFileId, type: 'epub', title: fname, page: resumePage || 0, pct: 0 });
    hideEpubLoading();
  } catch (err) {
    hideEpubLoading();
    console.error('loadEPUB:', err);
    toast('Gagal membuka EPUB: ' + err.message);
    showScreen('screen-home');
  }
}

// ─────────────────────────────────────────────
//  DIY EPUB — per halaman/chapter
// ─────────────────────────────────────────────
async function loadWithDIY(buf, fname, resumePage) {
  updateEpubProgress(15);

  const zip = await parseZip(buf);
  if (!zip) throw new Error('Gagal membaca ZIP');

  const containerXml = await zip.readText('META-INF/container.xml');
  if (!containerXml) throw new Error('container.xml tidak ditemukan');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('rootfile tidak ditemukan');

  const opfBase = rootfilePath.includes('/')
    ? rootfilePath.slice(0, rootfilePath.lastIndexOf('/') + 1) : '';
  const opfText = await zip.readText(rootfilePath);
  if (!opfText) throw new Error('OPF tidak bisa dibaca');

  const opfDoc = parser.parseFromString(opfText, 'application/xml');

  // Manifest
  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach(it => {
    manifest[it.getAttribute('id')] = {
      href: opfBase + it.getAttribute('href'),
      type: it.getAttribute('media-type'),
    };
  });

  // Spine items
  const spineItems = [];
  opfDoc.querySelectorAll('spine itemref').forEach(ref => {
    const m = manifest[ref.getAttribute('idref')];
    if (m && (m.type === 'application/xhtml+xml' || m.type === 'text/html')) {
      spineItems.push(m);
    }
  });

  if (!spineItems.length) throw new Error('Spine kosong');

  updateEpubProgress(30);

  const t = themes[epubTheme];

  // Parse semua chapter, resolve gambar jadi blob URL
  const chapters = [];
  for (let ci = 0; ci < spineItems.length; ci++) {
    if (cancelLoad) return;
    const item = spineItems[ci];
    let text = null;
    try { text = await zip.readText(item.href); } catch(e) {}
    if (!text) continue;

    const chDoc = parser.parseFromString(text, 'text/html');
    chDoc.querySelectorAll('script').forEach(el => el.remove());

    // Resolve images → blob URLs
    const blobUrls = [];
    const imgBase = item.href.includes('/')
      ? item.href.slice(0, item.href.lastIndexOf('/') + 1) : '';
    for (const img of chDoc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) continue;
      const cleanSrc = src.replace(/^(\.\/|\.\.\/)+/, '');
      const imgPath  = imgBase + cleanSrc;
      try {
        const blob = await zip.readBlob(imgPath);
        if (blob) {
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          img.setAttribute('src', url);
        }
      } catch(e) { img.remove(); }
    }

    // Build standalone HTML string
    const bodyHtml = chDoc.body ? chDoc.body.innerHTML : text;
    const fullHtml = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:${t.bg};color:${t.text};
    font-family:Georgia,"Times New Roman",serif;
    font-size:${epubFontSize}%;line-height:${epubLH === 'normal' ? '1.75' : epubLH};
    padding:20px 20px 40px;box-sizing:border-box;word-wrap:break-word;}
  img{max-width:100%;height:auto;display:block;margin:8px auto;}
  a{color:${t.text === '#3d2b1f' ? '#7b5e3a' : '#5b8dee'};}
  h1,h2,h3{margin-top:24px;margin-bottom:12px;}
  p{margin:0 0 1em;}
</style>
</head><body>${bodyHtml}</body></html>`;

    chapters.push({ html: fullHtml, blobUrls });
    updateEpubProgress(30 + Math.round((ci + 1) / spineItems.length * 55));
    if (ci % 5 === 0) await tick();
  }

  if (!chapters.length) throw new Error('Tidak ada konten yang berhasil dimuat');

  epubChapters   = chapters;
  epubTotalPages = chapters.length;

  // Render ke iframe
  setupEpubIframe(chapters);

  // Navigate ke halaman resume
  const startPage = Math.max(0, Math.min(resumePage || 0, chapters.length - 1));
  epubGoTo(startPage, true);

  // Registrasi fungsi apply tema
  applyDIYTheme = () => {
    if (!epubChapters.length) return;
    const th = themes[epubTheme];
    // Rebuild semua HTML dengan tema baru
    for (let ci = 0; ci < epubChapters.length; ci++) {
      epubChapters[ci].html = epubChapters[ci].html
        .replace(/background:[^;]+;/g, `background:${th.bg};`)
        .replace(/color:[^;]+;/g, `color:${th.text};`)
        .replace(/font-size:[^;]+;/, `font-size:${epubFontSize}%;`)
        .replace(/line-height:[^;]+;/, `line-height:${epubLH === 'normal' ? '1.75' : epubLH};`);
    }
    epubGoTo(epubCurPage, true);
  };
}

function setupEpubIframe(chapters) {
  const viewer = document.getElementById('epub-viewer');
  viewer.innerHTML = '';

  // Pakai iframe tunggal, ganti srcDoc saat pindah halaman
  const iframe = document.createElement('iframe');
  iframe.id    = 'epub-iframe';
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  
  viewer.appendChild(iframe);

  // Swipe
  let tx = 0;
  viewer.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) epubGoTo(epubCurPage + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

function epubGoTo(page, force = false) {
  if (!force && page === epubCurPage) return;
  if (page < 0 || page >= epubTotalPages) return;
  epubCurPage = page;

  const iframe = document.getElementById('epub-iframe');
  if (!iframe || !epubChapters[page]) return;

  // Tulis konten ke iframe via srcdoc
  iframe.srcdoc = epubChapters[page].html;
  iframe.onload = () => {
    // Scroll ke atas saat pindah halaman
    try { iframe.contentWindow.scrollTo(0, 0); } catch(e) {}
  };

  updateEpubUI();
  const title = document.getElementById('epub-title-bar').textContent;
  const pct   = Math.round((page + 1) / epubTotalPages * 100);
  saveHistory({ id: currentFileId, type: 'epub', title, page, pct });
}

function updateEpubUI() {
  const pct = Math.round((epubCurPage + 1) / epubTotalPages * 100);
  document.getElementById('epub-scrubber').value        = epubCurPage;
  document.getElementById('epub-page-label').textContent =
    `${epubCurPage + 1} / ${epubTotalPages}`;
  document.getElementById('epub-prev').disabled = epubCurPage <= 0;
  document.getElementById('epub-next').disabled = epubCurPage >= epubTotalPages - 1;
}

// ─────────────────────────────────────────────
//  Foliate (opsional)
// ─────────────────────────────────────────────
async function loadWithFoliate(buf, fname, resumePage) {
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
  });

  foliateView.addEventListener('relocate', e => {
    const loc = e.detail;
    const pct = Math.round((loc?.fraction ?? 0) * 100);
    document.getElementById('epub-scrubber').value      = pct;
    document.getElementById('epub-page-label').textContent = pct + '%';
    saveHistory({ id: currentFileId, type: 'epub', title: fname, page: 0, pct });
  });

  await foliateView.open(file);
}

// ─────────────────────────────────────────────
//  EPUB nav buttons
// ─────────────────────────────────────────────
document.getElementById('epub-next').addEventListener('click', () => {
  if (foliateView) foliateView.goRight();
  else epubGoTo(epubCurPage + 1);
});
document.getElementById('epub-prev').addEventListener('click', () => {
  if (foliateView) foliateView.goLeft();
  else epubGoTo(epubCurPage - 1);
});

document.getElementById('epub-scrubber').addEventListener('change', e => {
  if (foliateView) {
    try { foliateView.goToFraction(+e.target.value / 100); } catch(ex) {}
  } else {
    epubGoTo(+e.target.value);
  }
});

document.getElementById('epub-back').addEventListener('click', () => {
  cancelLoad = true;
  hideEpubLoading();
  if (foliateView) { try { foliateView.remove(); } catch(e) {} foliateView = null; }
  // Revoke blob URLs
  epubChapters.forEach(ch => ch.blobUrls?.forEach(u => URL.revokeObjectURL(u)));
  epubChapters  = [];
  applyDIYTheme = null;
  document.getElementById('epub-viewer').innerHTML = '';
  fileInput.value = '';
  renderHistory();
  showScreen('screen-home');
});

// ─────────────────────────────────────────────
//  Settings panel
// ─────────────────────────────────────────────
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
  applyFoliateSettings(); if (applyDIYTheme) applyDIYTheme();
});
document.getElementById('font-lg').addEventListener('click', () => {
  epubFontSize = Math.min(180, epubFontSize + 10);
  applyFoliateSettings(); if (applyDIYTheme) applyDIYTheme();
});

document.getElementById('lh-normal').addEventListener('click', () => {
  epubLH = 'normal';
  document.getElementById('lh-normal').classList.add('on');
  document.getElementById('lh-wide').classList.remove('on');
  applyFoliateSettings(); if (applyDIYTheme) applyDIYTheme();
});
document.getElementById('lh-wide').addEventListener('click', () => {
  epubLH = '1.9';
  document.getElementById('lh-wide').classList.add('on');
  document.getElementById('lh-normal').classList.remove('on');
  applyFoliateSettings(); if (applyDIYTheme) applyDIYTheme();
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

function applyFoliateSettings() {
  if (!foliateView) return;
  const t = themes[epubTheme];
  try {
    foliateView.renderer?.setStyles?.(`
      body { background:${t.bg}!important; color:${t.text}!important;
             font-size:${epubFontSize}%!important;
             line-height:${epubLH === 'normal' ? '1.6' : epubLH}!important; }
    `);
  } catch(e) {}
}

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
//  ZIP PARSER
// ══════════════════════════════════════════════

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
      const fnLen      = view.getUint16(pos + 28, true);
      const exLen      = view.getUint16(pos + 30, true);
      const cmLen      = view.getUint16(pos + 32, true);
      const localOff   = view.getUint32(pos + 42, true);
      const name       = td.decode(new Uint8Array(buf, pos + 46, fnLen));
      files[name]      = { method, compSize, localOff };
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
          w.write(data); w.close();
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
        } catch(e) { return null; }
      }
      return null;
    };

    const findKey = n => {
      if (files[n]) return n;
      const lo = n.toLowerCase();
      return Object.keys(files).find(k => k.toLowerCase() === lo) || null;
    };

    return {
      readText: async n => {
        const key = findKey(n);
        const d   = key ? await getBytes(key) : null;
        return d ? new TextDecoder().decode(d) : null;
      },
      readBlob: async n => {
        const key = findKey(n);
        const d   = key ? await getBytes(key) : null;
        if (!d) return null;
        const ext  = n.split('.').pop().toLowerCase();
        const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
          gif:'image/gif', svg:'image/svg+xml', webp:'image/webp' }[ext] || 'application/octet-stream';
        return new Blob([d], { type: mime });
      },
      files,
    };
  } catch(e) { console.error('parseZip:', e); return null; }
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
    .catch(e => console.error('SW:', e));
}

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════

function tick() { return new Promise(r => setTimeout(r, 0)); }

// ── Update scrubber EPUB — set max saat halaman siap ──
function syncEpubScrubber() {
  const sc = document.getElementById('epub-scrubber');
  sc.min   = 0;
  sc.max   = Math.max(0, epubTotalPages - 1);
  sc.step  = 1;
  sc.value = epubCurPage;
}

// Panggil syncEpubScrubber setelah epubTotalPages diset
const _origEpubGoTo = epubGoTo;

// ── INIT ──
openDB().then(() => renderHistory());

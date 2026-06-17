// ============================
// 1. Inisialisasi & Variabel Global
// ============================

// Konfigurasi PDF.js worker dari CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentFile = null;          // File object
let currentFileType = null;     // 'pdf' or 'epub'
let pdfDoc = null;
let epubBook = null;
let currentPage = 1;
let totalPages = 1;
let scale = 1.0;
let bookmarkList = [];          // array of {fileName, page, label, timestamp}
let history = [];              // array of {fileName, type, page, timestamp}
let isProgressCanceled = false;

// DOM refs
const screenHome = document.getElementById('screen-home');
const screenProgress = document.getElementById('screen-progress');
const screenPdf = document.getElementById('screen-pdf');
const screenEpub = document.getElementById('screen-epub');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const historyList = document.getElementById('history-list');
const toast = document.getElementById('toast');

// ============================
// 2. Utility Functions
// ============================

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, duration = 2000) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function getFileExtension(name) {
  return name.split('.').pop().toLowerCase();
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

// ============================
// 3. Manajemen Riwayat (History)
// ============================

function loadHistory() {
  try {
    const data = localStorage.getItem('readerapp_history');
    history = data ? JSON.parse(data) : [];
  } catch {
    history = [];
  }
  renderHistory();
}

function saveHistory() {
  localStorage.setItem('readerapp_history', JSON.stringify(history));
  renderHistory();
}

function addHistory(fileName, type, page) {
  // Hapus entri duplikat jika sudah ada
  history = history.filter(item => item.fileName !== fileName);
  history.unshift({ fileName, type, page, timestamp: Date.now() });
  // Batasi jumlah riwayat (misal 50)
  if (history.length > 50) history.pop();
  saveHistory();
}

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = `<div class="hist-empty">Belum ada buku yang dibaca</div>`;
    return;
  }
  let html = '';
  history.forEach((item, index) => {
    const typeClass = item.type === 'pdf' ? 'hist-type-pdf' : 'hist-type-epub';
    const icon = item.type === 'pdf' ? '📄' : '📘';
    const progClass = item.type === 'pdf' ? 'hist-prog-pdf' : 'hist-prog-epub';
    html += `
      <div class="hist-card" data-index="${index}">
        <div class="hist-type ${typeClass}">${icon}</div>
        <div class="hist-info">
          <div class="hist-title">${escapeHtml(item.fileName)}</div>
          <div class="hist-meta">Halaman ${item.page} • ${formatDate(item.timestamp)}</div>
        </div>
        <button class="hist-btn-del" data-index="${index}" aria-label="Hapus riwayat">✕</button>
        <div class="hist-arrow">›</div>
      </div>
    `;
  });
  historyList.innerHTML = html;

  // Event listener untuk membuka riwayat
  historyList.querySelectorAll('.hist-card').forEach(card => {
    card.addEventListener('click', function(e) {
      if (e.target.closest('.hist-btn-del')) return;
      const idx = parseInt(this.dataset.index);
      const item = history[idx];
      if (item) openHistoryItem(item);
    });
  });

  // Event listener untuk tombol hapus
  historyList.querySelectorAll('.hist-btn-del').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.index);
      history.splice(idx, 1);
      saveHistory();
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================
// 4. Manajemen Bookmark
// ============================

function loadBookmarks() {
  try {
    const data = localStorage.getItem('readerapp_bookmarks');
    bookmarkList = data ? JSON.parse(data) : [];
  } catch {
    bookmarkList = [];
  }
}

function saveBookmarks() {
  localStorage.setItem('readerapp_bookmarks', JSON.stringify(bookmarkList));
}

function addBookmark(fileName, page, label = '') {
  // Cek apakah sudah ada bookmark untuk halaman ini
  const existing = bookmarkList.findIndex(b => b.fileName === fileName && b.page === page);
  if (existing !== -1) {
    // Jika sudah ada, hapus (toggle)
    bookmarkList.splice(existing, 1);
    showToast('Bookmark dihapus');
  } else {
    bookmarkList.push({ fileName, page, label, timestamp: Date.now() });
    showToast('Bookmark ditambahkan');
  }
  saveBookmarks();
}

function isBookmarked(fileName, page) {
  return bookmarkList.some(b => b.fileName === fileName && b.page === page);
}

// ============================
// 5. PDF Functions (dengan Zoom & Bookmark)
// ============================

let pdfRenderTask = null;
let pdfCurrentPage = 1;

function openPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;
        scale = 1.0;
        currentFileType = 'pdf';
        currentFile = file;
        addHistory(file.name, 'pdf', 1);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function renderPDFPage(pageNum) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const container = document.getElementById('pdf-book');
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  container.appendChild(canvas);
  const renderContext = { canvasContext: context, viewport };
  if (pdfRenderTask) {
    pdfRenderTask.cancel();
  }
  pdfRenderTask = page.render(renderContext);
  await pdfRenderTask.promise;
  pdfRenderTask = null;

  // Update UI
  document.getElementById('pdf-title').textContent = currentFile.name;
  document.getElementById('pdf-top-page').textContent = `${pageNum}/${totalPages}`;
  document.getElementById('pdf-page-label').innerHTML = `Hal <strong>${pageNum}</strong>/${totalPages}`;
  document.getElementById('pdf-scrubber').value = pageNum;
  document.getElementById('pdf-scrubber').max = totalPages;
  document.getElementById('pdf-first').disabled = (pageNum === 1);
  document.getElementById('pdf-prev').disabled = (pageNum === 1);
  document.getElementById('pdf-next').disabled = (pageNum === totalPages);
  document.getElementById('pdf-last').disabled = (pageNum === totalPages);

  // Tampilkan status bookmark
  const bookmarkBtn = document.getElementById('pdf-bookmark');
  if (isBookmarked(currentFile.name, pageNum)) {
    bookmarkBtn.textContent = '★';
  } else {
    bookmarkBtn.textContent = '☆';
  }

  // Generate thumbnails (sederhana: hanya generate ulang jika belum ada)
  generateThumbnails();
}

async function generateThumbnails() {
  const container = document.getElementById('pdf-thumbs');
  container.innerHTML = '';
  // Tampilkan maksimal 10 thumbnail (halaman pertama, terakhir, dan sekitar halaman aktif)
  const pages = [];
  const total = totalPages;
  const current = currentPage;
  if (total <= 10) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    for (let i = Math.max(2, current-3); i <= Math.min(total-1, current+3); i++) pages.push(i);
    pages.push(total);
  }
  // Hapus duplikat dan urutkan
  const unique = [...new Set(pages)].sort((a,b)=>a-b);

  for (const p of unique) {
    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 0.2 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const thumb = document.createElement('div');
    thumb.className = 'thumb' + (p === currentPage ? ' active' : '');
    const img = document.createElement('img');
    img.src = canvas.toDataURL();
    thumb.appendChild(img);
    thumb.addEventListener('click', () => {
      goToPDFPage(p);
    });
    container.appendChild(thumb);
  }
}

function goToPDFPage(pageNum) {
  if (pageNum < 1 || pageNum > totalPages) return;
  currentPage = pageNum;
  renderPDFPage(pageNum);
  // Update history page
  const historyItem = history.find(h => h.fileName === currentFile.name);
  if (historyItem) {
    historyItem.page = pageNum;
    saveHistory();
  }
}

// Navigasi PDF
function pdfPrev() { if (currentPage > 1) goToPDFPage(currentPage - 1); }
function pdfNext() { if (currentPage < totalPages) goToPDFPage(currentPage + 1); }
function pdfFirst() { goToPDFPage(1); }
function pdfLast() { goToPDFPage(totalPages); }
function pdfZoomIn() { scale = Math.min(3.0, scale + 0.25); renderPDFPage(currentPage); }
function pdfZoomOut() { scale = Math.max(0.5, scale - 0.25); renderPDFPage(currentPage); }
function pdfToggleBookmark() {
  if (!currentFile) return;
  addBookmark(currentFile.name, currentPage);
  // Update tombol
  const btn = document.getElementById('pdf-bookmark');
  if (isBookmarked(currentFile.name, currentPage)) {
    btn.textContent = '★';
  } else {
    btn.textContent = '☆';
  }
}

// ============================
// 6. EPUB Functions (dengan Bookmark)
// ============================

let epubRendition = null;

function openEPUB(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const blob = new Blob([e.target.result], { type: 'application/epub+zip' });
        const url = URL.createObjectURL(blob);
        epubBook = ePub(url);
        epubBook.ready.then(() => {
          totalPages = epubBook.settings.pageCount || 1; // perkiraan
          currentPage = 1;
          currentFileType = 'epub';
          currentFile = file;
          addHistory(file.name, 'epub', 1);
          resolve();
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function renderEPUBPage() {
  if (!epubBook) return;
  const container = document.getElementById('epub-viewer');
  container.innerHTML = '';
  if (!epubRendition) {
    epubRendition = epubBook.renderTo(container, { width: '100%', height: '100%' });
  }
  // Tampilkan lokasi saat ini (gunakan lokasi tersimpan atau awal)
  const location = epubRendition.currentLocation();
  if (location && location.start) {
    // sudah ada
  } else {
    epubRendition.display();
  }
  epubRendition.on('rendered', (section) => {
    // Update page info
    const currentLocation = epubRendition.currentLocation();
    if (currentLocation) {
      const cfi = currentLocation.start.cfi;
      const page = Math.floor(currentLocation.start.index / 10) + 1; // perkiraan
      document.getElementById('epub-page-label').textContent = `Halaman ${page}`;
      // Update scrubber
      const total = epubBook.settings.pageCount || 100;
      const progress = (page / total) * 100;
      document.getElementById('epub-scrubber').value = progress;
      // Update bookmark status
      const btn = document.getElementById('epub-bookmark');
      if (isBookmarked(currentFile.name, page)) {
        btn.textContent = '★';
      } else {
        btn.textContent = '☆';
      }
    }
  });
}

function epubPrev() {
  if (epubRendition) epubRendition.prev();
}
function epubNext() {
  if (epubRendition) epubRendition.next();
}
function epubToggleBookmark() {
  if (!currentFile || !epubRendition) return;
  const loc = epubRendition.currentLocation();
  if (!loc) return;
  const page = Math.floor(loc.start.index / 10) + 1;
  addBookmark(currentFile.name, page);
  const btn = document.getElementById('epub-bookmark');
  if (isBookmarked(currentFile.name, page)) {
    btn.textContent = '★';
  } else {
    btn.textContent = '☆';
  }
}

// ============================
// 7. Pencarian Teks (PDF)
// ============================

async function searchPDF(query) {
  if (!pdfDoc) return [];
  const results = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ');
    if (text.toLowerCase().includes(query.toLowerCase())) {
      results.push({ page: i, preview: text.substring(0, 80) + '...' });
    }
  }
  return results;
}

// ============================
// 8. Pencarian Teks (EPUB)
// ============================

async function searchEPUB(query) {
  if (!epubBook) return [];
  // EPUB.js tidak memiliki built-in search, kita bisa baca semua item
  const results = [];
  const items = await epubBook.locations.generate(1000); // atau menggunakan spine
  // Pendekatan sederhana: baca semua section (spine)
  const spine = epubBook.spine;
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    try {
      const data = await epubBook.get(item.href);
      const text = data.textContent || data;
      if (text.toLowerCase().includes(query.toLowerCase())) {
        results.push({ page: i+1, preview: text.substring(0, 80) + '...' });
      }
    } catch(e) {}
  }
  return results;
}

// ============================
// 9. Fungsi untuk Membuka File (dengan Progress)
// ============================

async function openFile(file) {
  try {
    showScreen('screen-progress');
    document.getElementById('prog-label').textContent = 'Memproses…';
    document.getElementById('prog-sub').textContent = 'Mohon tunggu';
    document.getElementById('prog-fill').style.width = '0%';
    isProgressCanceled = false;

    const ext = getFileExtension(file.name);
    if (ext === 'pdf') {
      await openPDF(file);
      showScreen('screen-pdf');
      await renderPDFPage(1);
    } else if (ext === 'epub') {
      await openEPUB(file);
      showScreen('screen-epub');
      renderEPUBPage();
    } else {
      throw new Error('Format file tidak didukung');
    }
  } catch (err) {
    console.error(err);
    showToast('Gagal membuka file: ' + err.message);
    showScreen('screen-home');
  }
}

function openHistoryItem(item) {
  // Kita hanya bisa membuka ulang dari file asli? Tidak, kita hanya simpan nama.
  // Untuk demo, kita tampilkan pesan bahwa kita perlu memuat ulang file.
  // Lebih baik kita simpan file di IndexedDB, tapi untuk sederhana kita minta user memilih ulang.
  showToast(`Buka "${item.fileName}" secara manual dari perangkat Anda.`);
  // Atau kita bisa mencoba membuka dari localStorage jika kita simpan data file.
}

// ============================
// 10. Event Listeners
// ============================

// File input
fileInput.addEventListener('change', function(e) {
  if (this.files.length > 0) {
    openFile(this.files[0]);
  }
  this.value = ''; // reset
});

// Drop zone
dropZone.addEventListener('dragover', function(e) {
  e.preventDefault();
  this.classList.add('over');
});
dropZone.addEventListener('dragleave', function(e) {
  e.preventDefault();
  this.classList.remove('over');
});
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  this.classList.remove('over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    openFile(files[0]);
  }
});

// Tombol batal proses
document.getElementById('btn-cancel').addEventListener('click', function() {
  isProgressCanceled = true;
  showScreen('screen-home');
  showToast('Pemrosesan dibatalkan');
});

// Tombol kembali PDF
document.getElementById('pdf-back').addEventListener('click', function() {
  // Cleanup
  if (pdfRenderTask) {
    pdfRenderTask.cancel();
    pdfRenderTask = null;
  }
  pdfDoc = null;
  currentFile = null;
  showScreen('screen-home');
});

// Navigasi PDF
document.getElementById('pdf-first').addEventListener('click', pdfFirst);
document.getElementById('pdf-prev').addEventListener('click', pdfPrev);
document.getElementById('pdf-next').addEventListener('click', pdfNext);
document.getElementById('pdf-last').addEventListener('click', pdfLast);
document.getElementById('pdf-zoom-in').addEventListener('click', pdfZoomIn);
document.getElementById('pdf-zoom-out').addEventListener('click', pdfZoomOut);
document.getElementById('pdf-bookmark').addEventListener('click', pdfToggleBookmark);
document.getElementById('pdf-scrubber').addEventListener('input', function() {
  const val = parseInt(this.value);
  if (!isNaN(val) && val >=1 && val <= totalPages) {
    goToPDFPage(val);
  }
});

// Tombol kembali EPUB
document.getElementById('epub-back').addEventListener('click', function() {
  if (epubRendition) {
    epubRendition.destroy();
    epubRendition = null;
  }
  epubBook = null;
  currentFile = null;
  showScreen('screen-home');
});

// Navigasi EPUB
document.getElementById('epub-prev').addEventListener('click', epubPrev);
document.getElementById('epub-next').addEventListener('click', epubNext);
document.getElementById('epub-bookmark').addEventListener('click', epubToggleBookmark);
document.getElementById('epub-scrubber').addEventListener('input', function() {
  // Perkiraan navigasi berdasarkan persentase (tidak presisi)
  const percent = parseFloat(this.value) / 100;
  if (epubRendition) {
    epubRendition.display(percent);
  }
});

// Pengaturan EPUB
document.getElementById('btn-epub-settings').addEventListener('click', function() {
  const panel = document.getElementById('epub-settings');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
});
document.getElementById('font-sm').addEventListener('click', function() {
  const viewer = document.getElementById('epub-viewer');
  let size = parseFloat(window.getComputedStyle(viewer).fontSize) || 16;
  size = Math.max(10, size - 2);
  viewer.style.fontSize = size + 'px';
});
document.getElementById('font-lg').addEventListener('click', function() {
  const viewer = document.getElementById('epub-viewer');
  let size = parseFloat(window.getComputedStyle(viewer).fontSize) || 16;
  size = Math.min(30, size + 2);
  viewer.style.fontSize = size + 'px';
});
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('on'));
    this.classList.add('on');
    const bg = this.style.backgroundColor;
    document.getElementById('screen-epub').style.background = bg;
    document.getElementById('epub-top').style.background = bg;
    document.getElementById('epub-bottom').style.background = bg;
    // sesuaikan warna teks
    const viewer = document.getElementById('epub-viewer');
    if (bg === '#1a1a2e') {
      viewer.style.color = '#eee';
    } else {
      viewer.style.color = '#3d2b1f';
    }
  });
});
document.querySelectorAll('.setting-btn.lh').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.setting-btn.lh').forEach(b => b.classList.remove('on'));
    this.classList.add('on');
    const viewer = document.getElementById('epub-viewer');
    if (this.id === 'lh-normal') viewer.style.lineHeight = '1.6';
    else viewer.style.lineHeight = '2.2';
  });
});

// Tombol hapus semua riwayat
document.getElementById('btn-clear-all').addEventListener('click', function() {
  if (confirm('Hapus semua riwayat?')) {
    history = [];
    saveHistory();
  }
});

// PWA install
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('btn-install').classList.add('visible');
});
document.getElementById('btn-install').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      showToast('Aplikasi terinstal!');
    }
    deferredPrompt = null;
    document.getElementById('btn-install').classList.remove('visible');
  }
});

// ============================
// 11. Inisialisasi
// ============================

loadHistory();
loadBookmarks();
showScreen('screen-home');

// Tampilkan toast selamat datang
showToast('Selamat datang di ReaderApp!', 3000);
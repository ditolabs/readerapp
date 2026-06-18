/**
 * ReaderApp — Aplikasi Pembaca PDF & EPUB
 * Menggunakan PDF.js via CDN, pengelolaan memori otomatis
 */

(function () {
  'use strict';

  // ============================================================
  // 1. REFERENSI DOM
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    home: $('#screen-home'),
    progress: $('#screen-progress'),
    pdf: $('#screen-pdf'),
    epub: $('#screen-epub'),
  };

  const dom = {
    fileInput: $('#file-input'),
    dropZone: $('#drop-zone'),
    historyList: $('#history-list'),
    btnClearAll: $('#btn-clear-all'),
    btnInstall: $('#btn-install'),

    // Progress
    progNum: $('#prog-num'),
    progLabel: $('#prog-label'),
    progSub: $('#prog-sub'),
    progFill: $('#prog-fill'),
    btnCancel: $('#btn-cancel'),

    // PDF
    pdfBack: $('#pdf-back'),
    pdfTitle: $('#pdf-title'),
    pdfTopPage: $('#pdf-top-page'),
    pdfBook: $('#pdf-book'),
    pdfThumbs: $('#pdf-thumbs'),
    pdfScrubber: $('#pdf-scrubber'),
    pdfPageLabel: $('#pdf-page-label'),
    pdfFirst: $('#pdf-first'),
    pdfPrev: $('#pdf-prev'),
    pdfNext: $('#pdf-next'),
    pdfLast: $('#pdf-last'),
    pdfTopbar: $('#pdf-topbar'),
    pdfBottombar: $('#pdf-bottombar'),

    // EPUB
    epubBack: $('#epub-back'),
    epubTitle: $('#epub-title-bar'),
    epubViewer: $('#epub-viewer'),
    epubScrubber: $('#epub-scrubber'),
    epubPageLabel: $('#epub-page-label'),
    epubPrev: $('#epub-prev'),
    epubNext: $('#epub-next'),
    epubSettings: $('#epub-settings'),
    btnEpubSettings: $('#btn-epub-settings'),
    fontSm: $('#font-sm'),
    fontLg: $('#font-lg'),
    themeSepia: $('#theme-sepia'),
    themeWhite: $('#theme-white'),
    themeDark: $('#theme-dark'),
    lhNormal: $('#lh-normal'),
    lhWide: $('#lh-wide'),

    toast: $('#toast'),
  };

  // ============================================================
  // 2. STATE
  // ============================================================
  const state = {
    currentFile: null, // { name, data, type, size }
    pdfDoc: null,
    pdfPageCount: 0,
    pdfCurrentPage: 1,
    pdfScale: 1.2,
    pdfRenderTask: null,
    epubBook: null,
    epubCurrentLocation: null,
    epubRendition: null,
    isPdf: false,
    isEpub: false,
    cancelFlag: false,
    history: [],
  };

  // ============================================================
  // 3. UTILITY
  // ============================================================
  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].classList.toggle('active', key === name);
    });
  }

  function showToast(msg, duration = 2500) {
    const t = dom.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove('show'), duration);
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function getFileExtension(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  // ============================================================
  // 4. HISTORY (localStorage)
  // ============================================================
  function loadHistory() {
    try {
      const raw = localStorage.getItem('readerapp_history');
      state.history = raw ? JSON.parse(raw) : [];
    } catch {
      state.history = [];
    }
    renderHistory();
  }

  function saveHistory() {
    try {
      localStorage.setItem('readerapp_history', JSON.stringify(state.history));
    } catch (e) { /* ignore */ }
    renderHistory();
  }

  function addHistory(file) {
    // Hapus duplikat berdasarkan nama & ukuran
    state.history = state.history.filter(
      (h) => !(h.name === file.name && h.size === file.size)
    );
    state.history.unshift({
      name: file.name,
      type: file.type,
      size: file.size,
      date: new Date().toISOString(),
      progress: 0,
    });
    if (state.history.length > 50) state.history.pop();
    saveHistory();
  }

  function updateHistoryProgress(name, progress) {
    const item = state.history.find((h) => h.name === name);
    if (item) {
      item.progress = Math.min(100, Math.round(progress));
      saveHistory();
    }
  }

  function renderHistory() {
    const list = dom.historyList;
    if (!state.history.length) {
      list.innerHTML = `<div class="hist-empty">Belum ada file yang dibaca</div>`;
      return;
    }
    list.innerHTML = state.history
      .map(
        (h, idx) => `
        <div class="hist-card" data-idx="${idx}" role="listitem">
          <div class="hist-type ${h.type === 'pdf' ? 'hist-type-pdf' : 'hist-type-epub'}">
            ${h.type === 'pdf' ? '📄' : '📖'}
          </div>
          <div class="hist-info">
            <div class="hist-title">${escapeHtml(h.name)}</div>
            <div class="hist-meta">${formatFileSize(h.size)} • ${new Date(h.date).toLocaleDateString()}</div>
            ${h.progress > 0 ? `<div class="hist-prog-bg"><div class="hist-prog-fill ${h.type === 'pdf' ? 'hist-prog-pdf' : 'hist-prog-epub'}" style="width:${h.progress}%"></div></div>` : ''}
          </div>
          <button class="hist-btn-del" data-idx="${idx}" aria-label="Hapus dari riwayat">✕</button>
          <span class="hist-arrow">›</span>
        </div>
      `
      )
      .join('');

    // Event listener untuk klik card
    list.querySelectorAll('.hist-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.hist-btn-del')) return;
        const idx = parseInt(card.dataset.idx, 10);
        const item = state.history[idx];
        if (item) openFileFromHistory(item);
      });
    });

    // Event listener untuk tombol hapus
    list.querySelectorAll('.hist-btn-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        state.history.splice(idx, 1);
        saveHistory();
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // 5. OPEN FILE FROM HISTORY
  // ============================================================
  async function openFileFromHistory(item) {
    // Coba baca ulang file dari localStorage? Tidak feasible untuk file besar.
    // Kita hanya bisa membuka ulang jika file masih ada di memori atau kita simpan referensi.
    // Untuk demo, kita tampilkan toast dan minta user memilih ulang.
    showToast('Silakan pilih ulang file: ' + item.name);
    // Trigger file input
    dom.fileInput.click();
  }

  // ============================================================
  // 6. FILE HANDLING
  // ============================================================
  function handleFile(file) {
    if (!file) return;
    const ext = getFileExtension(file.name);
    if (ext === 'pdf') {
      state.isPdf = true;
      state.isEpub = false;
      state.currentFile = file;
      addHistory(file);
      loadPdf(file);
    } else if (ext === 'epub') {
      state.isPdf = false;
      state.isEpub = true;
      state.currentFile = file;
      addHistory(file);
      loadEpub(file);
    } else {
      showToast('Format tidak didukung. Gunakan PDF atau EPUB.');
    }
  }

  // ============================================================
  // 7. PDF LOADER (menggunakan PDF.js dari CDN)
  // ============================================================
  async function loadPdf(file) {
    showScreen('progress');
    dom.progNum.textContent = '0';
    dom.progFill.style.width = '0%';
    dom.progLabel.textContent = 'Memuat PDF...';
    dom.progSub.textContent = 'Mengurai dokumen';
    state.cancelFlag = false;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      loadingTask.onProgress = (progress) => {
        if (state.cancelFlag) {
          loadingTask.destroy();
          return;
        }
        const pct = Math.round((progress.loaded / progress.total) * 100);
        dom.progNum.textContent = pct;
        dom.progFill.style.width = pct + '%';
        dom.progSub.textContent = `Memuat halaman... ${pct}%`;
        updateHistoryProgress(file.name, pct);
      };

      state.pdfDoc = await loadingTask.promise;
      if (state.cancelFlag) {
        state.pdfDoc.destroy();
        showScreen('home');
        return;
      }

      state.pdfPageCount = state.pdfDoc.numPages;
      state.pdfCurrentPage = 1;
      dom.progNum.textContent = '100';
      dom.progFill.style.width = '100%';
      dom.progSub.textContent = 'Siap dibaca';
      updateHistoryProgress(file.name, 100);

      // Setup PDF viewer
      setupPdfViewer(file.name);
      showScreen('pdf');
      renderPdfPage(1);
    } catch (err) {
      console.error('PDF Load Error:', err);
      showToast('Gagal memuat PDF: ' + err.message);
      showScreen('home');
    }
  }

  // ============================================================
  // 8. PDF VIEWER
  // ============================================================
  function setupPdfViewer(filename) {
    dom.pdfTitle.textContent = filename;
    dom.pdfTopPage.textContent = `1/${state.pdfPageCount}`;
    dom.pdfPageLabel.innerHTML = `Hal <strong>1</strong>/${state.pdfPageCount}`;
    dom.pdfScrubber.max = state.pdfPageCount - 1;
    dom.pdfScrubber.value = 0;
    dom.pdfFirst.disabled = true;
    dom.pdfPrev.disabled = true;

    // Render thumbnails
    renderPdfThumbs();

    // Event listeners
    dom.pdfBack.onclick = () => {
      cleanupPdf();
      showScreen('home');
    };

    dom.pdfScrubber.oninput = () => {
      const page = Math.floor(parseFloat(dom.pdfScrubber.value)) + 1;
      goToPdfPage(page);
    };

    dom.pdfFirst.onclick = () => goToPdfPage(1);
    dom.pdfPrev.onclick = () => goToPdfPage(state.pdfCurrentPage - 1);
    dom.pdfNext.onclick = () => goToPdfPage(state.pdfCurrentPage + 1);
    dom.pdfLast.onclick = () => goToPdfPage(state.pdfPageCount);

    // Keyboard navigation
    document.addEventListener('keydown', pdfKeyHandler);

    // Auto-hide bars on idle
    let hideTimer;
    const resetHideTimer = () => {
      clearTimeout(hideTimer);
      dom.pdfTopbar.classList.remove('hide');
      dom.pdfBottombar.classList.remove('hide');
      hideTimer = setTimeout(() => {
        dom.pdfTopbar.classList.add('hide');
        dom.pdfBottombar.classList.add('hide');
      }, 3000);
    };
    dom.pdfBook.addEventListener('click', resetHideTimer);
    dom.pdfBook.addEventListener('mousemove', resetHideTimer);
    resetHideTimer();
  }

  function pdfKeyHandler(e) {
    if (!screens.pdf.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToPdfPage(state.pdfCurrentPage - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToPdfPage(state.pdfCurrentPage + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToPdfPage(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToPdfPage(state.pdfPageCount);
    }
  }

  function goToPdfPage(page) {
    if (page < 1 || page > state.pdfPageCount) return;
    state.pdfCurrentPage = page;
    renderPdfPage(page);
    dom.pdfScrubber.value = page - 1;
    dom.pdfTopPage.textContent = `${page}/${state.pdfPageCount}`;
    dom.pdfPageLabel.innerHTML = `Hal <strong>${page}</strong>/${state.pdfPageCount}`;
    dom.pdfFirst.disabled = page <= 1;
    dom.pdfPrev.disabled = page <= 1;
    dom.pdfNext.disabled = page >= state.pdfPageCount;
    dom.pdfLast.disabled = page >= state.pdfPageCount;

    // Highlight thumbnail
    dom.pdfThumbs.querySelectorAll('.thumb').forEach((el, idx) => {
      el.classList.toggle('active', idx === page - 1);
    });
    // Scroll thumbnail into view
    const thumb = dom.pdfThumbs.querySelector(`.thumb[data-page="${page}"]`);
    if (thumb) thumb.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  async function renderPdfPage(page) {
    if (!state.pdfDoc) return;
    try {
      if (state.pdfRenderTask) {
        state.pdfRenderTask.cancel();
        state.pdfRenderTask = null;
      }
      const scale = state.pdfScale;
      const viewport = state.pdfDoc.getPage(page).then((p) => p.getViewport({ scale }));
      const pageObj = await state.pdfDoc.getPage(page);
      const vp = pageObj.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '90vh';
      canvas.style.objectFit = 'contain';

      const ctx = canvas.getContext('2d');
      const renderTask = pageObj.render({
        canvasContext: ctx,
        viewport: vp,
      });
      state.pdfRenderTask = renderTask;
      await renderTask.promise;
      state.pdfRenderTask = null;

      // Replace content
      dom.pdfBook.innerHTML = '';
      dom.pdfBook.appendChild(canvas);
    } catch (err) {
      if (err.name === 'RenderingCancelledException') {
        // Diabaikan
      } else {
        console.error('Render page error:', err);
        showToast('Gagal render halaman');
      }
    }
  }

  async function renderPdfThumbs() {
    const container = dom.pdfThumbs;
    container.innerHTML = '';
    const count = Math.min(state.pdfPageCount, 20); // Batas thumbnail
    for (let i = 1; i <= count; i++) {
      const thumb = document.createElement('div');
      thumb.className = 'thumb' + (i === 1 ? ' active' : '');
      thumb.dataset.page = i;
      thumb.addEventListener('click', () => goToPdfPage(i));

      try {
        const page = await state.pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        thumb.appendChild(canvas);
      } catch {
        // Jika gagal, tampilkan placeholder
        thumb.textContent = i;
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
        thumb.style.color = '#fff';
        thumb.style.fontSize = '12px';
      }
      container.appendChild(thumb);
    }
  }

  function cleanupPdf() {
    if (state.pdfRenderTask) {
      try { state.pdfRenderTask.cancel(); } catch (e) {}
      state.pdfRenderTask = null;
    }
    if (state.pdfDoc) {
      try { state.pdfDoc.destroy(); } catch (e) {}
      state.pdfDoc = null;
    }
    dom.pdfBook.innerHTML = '';
    dom.pdfThumbs.innerHTML = '';
    document.removeEventListener('keydown', pdfKeyHandler);
    state.isPdf = false;
    state.currentFile = null;
  }

// ============================================================
// 9. EPUB LOADER (Fix 90% Hang)
// ============================================================
async function loadEpub(file) {
  showScreen('progress');
  dom.progNum.textContent = '0';
  dom.progFill.style.width = '0%';
  dom.progLabel.textContent = 'Memuat EPUB...';
  dom.progSub.textContent = 'Mengekstrak dokumen...';
  state.cancelFlag = false;

  // Jeda sesaat agar UI Loading muncul
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    // Ambil buffer mentah dari file
    const arrayBuffer = await file.arrayBuffer();

    // PENTING: Langsung gunakan ArrayBuffer, JANGAN gunakan Blob URL
    // Ini menghindari pemblokiran internal oleh Brave Shields / ekstensi keamanan
    const book = ePub(arrayBuffer);
    state.epubBook = book;

    // Simulasi progress bar (mentok di 90% sampai book.ready selesai)
    let simProgress = 0;
    const simInterval = setInterval(() => {
      if (simProgress < 90) {
        simProgress += Math.floor(Math.random() * 10) + 5;
        if (simProgress > 90) simProgress = 90;
        dom.progNum.textContent = simProgress;
        dom.progFill.style.width = simProgress + '%';
      }
    }, 200);

    // Tunggu ekstraksi JSZip selesai
    await book.ready;

    // Ekstraksi sukses! Hentikan simulasi dan set ke 100%
    clearInterval(simInterval);
    dom.progNum.textContent = '100';
    dom.progFill.style.width = '100%';
    dom.progSub.textContent = 'Menata halaman...';
    updateHistoryProgress(file.name, 100);

    // Tampilkan layar EPUB sekarang sebelum proses render dilakukan
    // Mencegah error pembacaan dimensi iframe menjadi 0x0
    showScreen('epub');
    dom.epubViewer.style.opacity = '0'; // Sembunyikan sejenak

    const rendition = book.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      manager: 'default',
    });
    state.epubRendition = rendition;

    // Render buku
    await rendition.display();

    // Tampilkan layar yang sudah dirender
    dom.epubViewer.style.opacity = '1';

    // Set informasi judul dan total halaman
    dom.epubTitle.textContent = file.name;
    dom.epubPageLabel.textContent = '1 / ' + (book.navigation ? book.navigation.length : '?');
    state.epubCurrentLocation = rendition.currentLocation();

    // Event listener navigasi halaman
    rendition.on('relocated', (location) => {
      state.epubCurrentLocation = location;
      const total = book.navigation ? book.navigation.length : 1;
      const current = location.start ? location.start.displayed.page : 1;
      dom.epubPageLabel.textContent = `${current} / ${total}`;
      const progress = (current / total) * 100;
      dom.epubScrubber.value = progress;
      updateHistoryProgress(file.name, progress);
    });

    dom.epubPrev.onclick = () => rendition.prev();
    dom.epubNext.onclick = () => rendition.next();

    dom.epubScrubber.oninput = () => {
      const pct = parseFloat(dom.epubScrubber.value) / 100;
      const total = book.navigation ? book.navigation.length : 1;
      const targetPage = Math.round(pct * total);
      if (targetPage >= 1 && targetPage <= total) {
        const nav = book.navigation[targetPage - 1];
        if (nav) rendition.display(nav.href);
      }
    };

    dom.epubBack.onclick = () => {
      cleanupEpub();
      showScreen('home');
    };

    // Event listener menu pengaturan
    dom.fontSm.onclick = () => {
      const current = rendition.themes.get('fontSize') || '1em';
      const size = parseFloat(current) - 0.1;
      if (size > 0.5) rendition.themes.update({ fontSize: size + 'em' });
    };
    dom.fontLg.onclick = () => {
      const current = rendition.themes.get('fontSize') || '1em';
      const size = parseFloat(current) + 0.1;
      if (size < 2.5) rendition.themes.update({ fontSize: size + 'em' });
    };
    dom.themeSepia.onclick = () => {
      rendition.themes.update({ background: '#faf6ef', color: '#3d2b1f' });
      setThemeActive('theme-sepia');
    };
    dom.themeWhite.onclick = () => {
      rendition.themes.update({ background: '#ffffff', color: '#000000' });
      setThemeActive('theme-white');
    };
    dom.themeDark.onclick = () => {
      rendition.themes.update({ background: '#1a1a2e', color: '#e0e0e0' });
      setThemeActive('theme-dark');
    };
    dom.lhNormal.onclick = () => {
      rendition.themes.update({ lineHeight: '1.5' });
      setLhActive('lh-normal');
    };
    dom.lhWide.onclick = () => {
      rendition.themes.update({ lineHeight: '2' });
      setLhActive('lh-wide');
    };
    dom.btnEpubSettings.onclick = () => {
      dom.epubSettings.style.display = dom.epubSettings.style.display === 'block' ? 'none' : 'block';
    };

    state.isEpub = true;

  } catch (err) {
    console.error('EPUB Load Error:', err);
    showToast('Gagal memuat EPUB: ' + err.message);
    showScreen('home');
  }
}

function setThemeActive(id) {
  [dom.themeSepia, dom.themeWhite, dom.themeDark].forEach((el) =>
    el.classList.toggle('on', el.id === id)
  );
}

function setLhActive(id) {
  [dom.lhNormal, dom.lhWide].forEach((el) =>
    el.classList.toggle('on', el.id === id)
  );
}

function cleanupEpub() {
  if (state.epubRendition) {
    state.epubRendition.destroy();
    state.epubRendition = null;
  }
  if (state.epubBook) {
    state.epubBook.destroy();
    state.epubBook = null;
  }
  dom.epubViewer.innerHTML = '';
  dom.epubSettings.style.display = 'none';
  state.isEpub = false;
  state.currentFile = null;
}

  // ============================================================
  // 10. PROGRESS CANCEL
  // ============================================================
  dom.btnCancel.addEventListener('click', () => {
    state.cancelFlag = true;
    if (state.isPdf && state.pdfDoc) {
      try { state.pdfDoc.destroy(); } catch (e) {}
      state.pdfDoc = null;
    }
    showToast('Pemuatan dibatalkan');
    showScreen('home');
  });

  // ============================================================
  // 11. DROP ZONE & FILE INPUT
  // ============================================================
  dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropZone.classList.add('over');
  });
  dom.dropZone.addEventListener('dragleave', () => {
    dom.dropZone.classList.remove('over');
  });
  dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('over');
    const files = e.dataTransfer.files;
    if (files.length) handleFile(files[0]);
  });

  dom.fileInput.addEventListener('change', () => {
    if (dom.fileInput.files.length) {
      handleFile(dom.fileInput.files[0]);
      dom.fileInput.value = '';
    }
  });

  // ============================================================
  // 12. CLEAR HISTORY
  // ============================================================
  dom.btnClearAll.addEventListener('click', () => {
    if (confirm('Hapus semua riwayat?')) {
      state.history = [];
      saveHistory();
      showToast('Riwayat dibersihkan');
    }
  });

  // ============================================================
  // 13. PWA INSTALL
  // ============================================================
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    dom.btnInstall.classList.add('visible');
  });

  dom.btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        showToast('Aplikasi terinstal!');
      }
      deferredPrompt = null;
      dom.btnInstall.classList.remove('visible');
    }
  });

  // ============================================================
  // 14. INIT
  // ============================================================
  loadHistory();
  showScreen('home');

  // Override PDF.js worker jika diperlukan (gunakan CDN)
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  console.log('📚 ReaderApp siap digunakan');
})();
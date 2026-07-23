/**
 * Antigravity PDF Studio - Core PDF.js Rendering Engine
 * 60fps GPU Pinch Zoom, Double-Tap One-Touch Reset, Guaranteed 100% Fit-to-Screen
 */

export class PDFViewer {
  constructor(containerElement, spreadViewElement) {
    this.container = containerElement;
    this.spreadView = spreadViewElement;

    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;

    // View state
    this.viewMode = 'spread';     // 'spread' or 'single'
    this.bindingMode = 'rtl';      // 'rtl' (右綴じ) or 'ltr' (左綴じ)
    this.hasCoverPage = true;     // true: P1 single cover, false: P1+P2 spread
    this.scaleMode = 'fit-height'; // 'fit-height', 'fit-width', '100', or 'custom'
    this.customScale = 1.0;
    this.lastComputedScale = 1.0;

    // Smooth Pinch State
    this.currentCssScale = 1.0;

    // Theme & Filter States
    this.themeMode = 'normal';     // 'normal', 'dark', 'sepia'
    this.brightness = 100;         // 50% ~ 150%
    this.contrast = 100;           // 50% ~ 150%

    // Event Handlers
    this.onPageChange = null;
    this.onZoomChange = null;

    this.initMouseWheelEvents();
    this.initTouchEvents();
  }

  async loadDocument(dataBuffer, initialPage = 1) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library is not loaded');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const loadingTask = window.pdfjsLib.getDocument({ data: dataBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.totalPages = this.pdfDoc.numPages;
    this.currentPage = Math.min(Math.max(1, initialPage), this.totalPages);

    await this.render();
  }

  async render() {
    if (!this.pdfDoc) return;

    // Reset CSS scale transform
    this.currentCssScale = 1.0;
    this.spreadView.style.transform = 'scale(1)';

    this.spreadView.innerHTML = '';
    const pagesToRender = this.calculatePagesForCurrentView();

    for (const pageNum of pagesToRender) {
      const card = await this.renderSinglePageCard(pageNum, pagesToRender.length);
      this.spreadView.appendChild(card);
    }

    this.applyThemeFilters();

    if (this.onPageChange) {
      this.onPageChange(this.currentPage, this.totalPages);
    }
  }

  calculatePagesForCurrentView() {
    if (this.viewMode === 'single') {
      return [this.currentPage];
    }

    if (this.hasCoverPage && this.currentPage === 1) {
      return [1];
    }

    let p1, p2;
    if (this.hasCoverPage) {
      const pairIndex = Math.floor((this.currentPage - 2) / 2);
      p1 = 2 + pairIndex * 2;
      p2 = p1 + 1;
    } else {
      const pairIndex = Math.floor((this.currentPage - 1) / 2);
      p1 = 1 + pairIndex * 2;
      p2 = p1 + 1;
    }

    let result = [];
    if (p1 <= this.totalPages) result.push(p1);
    if (p2 <= this.totalPages) result.push(p2);

    if (this.bindingMode === 'rtl' && result.length === 2) {
      result.reverse();
    }

    return result;
  }

  async renderSinglePageCard(pageNum, visiblePagesCount = 1) {
    const page = await this.pdfDoc.getPage(pageNum);

    const baseViewport = page.getViewport({ scale: 1.0 });
    const computedScale = this.calculateScale(baseViewport, visiblePagesCount);
    this.lastComputedScale = computedScale;

    const viewport = page.getViewport({ scale: computedScale });

    const cardDiv = document.createElement('div');
    cardDiv.className = 'pdf-page-card';
    cardDiv.dataset.pageNum = pageNum;
    cardDiv.style.width = `${Math.floor(viewport.width)}px`;
    cardDiv.style.height = `${Math.floor(viewport.height)}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const ctx = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;
    cardDiv.appendChild(canvas);

    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annotation-layer-canvas';
    annotCanvas.width = Math.floor(viewport.width);
    annotCanvas.height = Math.floor(viewport.height);
    cardDiv.appendChild(annotCanvas);

    return cardDiv;
  }

  calculateScale(baseViewport, visiblePagesCount = 1) {
    if (this.scaleMode === 'custom') {
      return this.customScale;
    }
    if (this.scaleMode === '100') {
      return 1.0;
    }

    // Absolute zero-clipping bounds calculation
    const containerWidth = Math.max(200, this.container.clientWidth);
    const containerHeight = Math.max(200, this.container.clientHeight);

    // Padding & gap margins
    const padX = 16;
    const padY = 16;
    const gapX = (visiblePagesCount > 1) ? 8 : 0;

    const availWidth = Math.max(100, containerWidth - padX - gapX);
    const availHeight = Math.max(100, containerHeight - padY);

    const targetWidth = baseViewport.width * visiblePagesCount;
    const targetHeight = baseViewport.height;

    const scaleW = availWidth / targetWidth;
    const scaleH = availHeight / targetHeight;

    if (this.scaleMode === 'fit-width') {
      // Fit to width without overflow
      return scaleW;
    } else {
      // Fit Height / Entire Page (Guaranteed 100% visible on screen without any clipping)
      return Math.min(scaleW, scaleH);
    }
  }

  setThemeMode(mode) {
    this.themeMode = mode;
    this.applyThemeFilters();
  }

  setBrightness(val) {
    this.brightness = val;
    this.applyThemeFilters();
  }

  setContrast(val) {
    this.contrast = val;
    this.applyThemeFilters();
  }

  applyThemeFilters() {
    const pageCards = this.container.querySelectorAll('.pdf-page-card');
    
    let baseFilter = '';
    if (this.themeMode === 'dark') {
      baseFilter = `invert(0.88) hue-rotate(180deg) contrast(92%) brightness(95%)`;
    } else if (this.themeMode === 'sepia') {
      baseFilter = `sepia(0.35) contrast(95%) brightness(95%)`;
    }

    const bFilter = `brightness(${this.brightness}%)`;
    const cFilter = `contrast(${this.contrast}%)`;

    const combinedFilter = `${baseFilter} ${bFilter} ${cFilter}`.trim();

    pageCards.forEach(card => {
      card.style.filter = combinedFilter;
      if (this.themeMode === 'dark') {
        card.style.background = '#161c28';
        card.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.12)';
      } else {
        card.style.background = '#ffffff';
        card.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)';
      }
    });
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.render();
  }

  setBindingMode(mode) {
    this.bindingMode = mode;
    this.render();
  }

  setHasCoverPage(hasCover) {
    this.hasCoverPage = hasCover;
    this.render();
  }

  setScaleMode(mode, customVal = 1.0) {
    this.scaleMode = mode;
    if (mode === 'custom') this.customScale = customVal;
    this.render();

    if (this.onZoomChange) {
      this.onZoomChange(this.scaleMode, Math.round(this.lastComputedScale * 100));
    }
  }

  resetZoomToOneTouch() {
    this.setScaleMode('fit-height');
  }

  goToPage(pageNum) {
    if (!this.pdfDoc) return;
    const target = Math.min(Math.max(1, pageNum), this.totalPages);
    if (target !== this.currentPage) {
      this.currentPage = target;
      this.render();
    }
  }

  nextPage() {
    if (!this.pdfDoc) return;
    let step = 1;
    if (this.viewMode === 'spread') {
      step = (this.hasCoverPage && this.currentPage === 1) ? 1 : 2;
    }
    this.goToPage(this.currentPage + step);
  }

  prevPage() {
    if (!this.pdfDoc) return;
    let step = 1;
    if (this.viewMode === 'spread') {
      step = 2;
    }
    this.goToPage(this.currentPage - step);
  }

  initMouseWheelEvents() {
    let lastWheelTime = 0;
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.ctrlKey) {
        const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
        const newScale = Math.min(Math.max(0.3, (this.scaleMode === 'custom' ? this.customScale : this.lastComputedScale) + zoomDelta), 3.0);
        this.setScaleMode('custom', newScale);
        return;
      }

      const now = Date.now();
      if (now - lastWheelTime < 250) return;
      lastWheelTime = now;

      if (e.deltaY > 0) {
        this.nextPage();
      } else if (e.deltaY < 0) {
        this.prevPage();
      }
    }, { passive: false });
  }

  initTouchEvents() {
    let initialPinchDist = 0;
    let pinchStartCssScale = 1.0;

    let lastTapTime = 0;

    const getPinchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    // 60fps GPU Pinch Zoom Acceleration via CSS Transform
    this.container.addEventListener('touchstart', (e) => {
      // Check Double Tap to One-Touch Reset
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTime < 300) {
          // Double Tap Detected -> Reset to Fit Height!
          this.resetZoomToOneTouch();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
      }

      if (e.touches.length === 2) {
        initialPinchDist = getPinchDistance(e.touches);
        pinchStartCssScale = this.currentCssScale;
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialPinchDist > 0) {
        e.preventDefault();
        const currentDist = getPinchDistance(e.touches);
        const factor = currentDist / initialPinchDist;
        
        this.currentCssScale = Math.min(Math.max(0.4, pinchStartCssScale * factor), 3.5);
        this.spreadView.style.transform = `scale(${this.currentCssScale})`;
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2 && initialPinchDist > 0) {
        // Pinch ended -> Re-render at sharp crisp scale
        const finalScale = (this.scaleMode === 'custom' ? this.customScale : this.lastComputedScale) * this.currentCssScale;
        initialPinchDist = 0;
        this.setScaleMode('custom', Math.min(Math.max(0.3, finalScale), 3.0));
      }
    }, { passive: true });
  }
}

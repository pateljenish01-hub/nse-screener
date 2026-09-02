// chartRenderer.js â€” TradingView-Style Candlestick Chart Engine
// Renders interactive candlestick charts on HTML5 Canvas

class CandlestickChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.candles = [];
    this.sma20 = [];
    this.sma50 = [];
    this.highlightIndices = []; // Indices of C1, C2... in candles array
    this.symbol = '';
    this.companyName = '';
    this.trend = '';
    this.matchResult = null;
    this.rawCandles = [];  // Original OHLCV (kept for stats reference)

    // Layout
    this.padding = { top: 50, right: 80, bottom: 60, left: 10 };
    this.volumePaneHeight = 60;
    this.priceAxisWidth = 75;

    // State
    this.viewStart = 0;      // Index of first visible candle
    this.viewCount = 60;     // Number of visible candles
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartViewStart = 0;
    this.crosshairX = -1;
    this.crosshairY = -1;
    this.animFrame = null;

    this._bindEvents();
    this._startResizeObserver();
  }

  // â”€â”€ Load Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  load(candles, options = {}) {
    // candles passed here MUST already be Heikin-Ashi (converted by filterEngine/app.js)
    this.candles = candles || [];
    this.rawCandles = options.rawCandles || [];
    this.symbol = options.symbol || '';
    this.companyName = options.companyName || '';
    this.trend = options.trend || '';
    this.matchResult = options.matchResult || null;
    this.sma20 = options.sma20 || [];
    this.sma50 = options.sma50 || [];
    this.highlightIndices = options.highlightIndices || [];

    // Start view at last N candles
    this.viewCount = Math.min(60, this.candles.length);
    this.viewStart = Math.max(0, this.candles.length - this.viewCount);

    this._render();
  }

  // â”€â”€ Resize Canvas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
    this._render();
  }

  _startResizeObserver() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);
    setTimeout(() => this._resize(), 50);
  }

  // ── Coordinate Helpers ─────────────────────────────────────────────
  get isSmall() {
    return this.totalH < 420 || this.totalW < 600;
  }
  get padTop() {
    return this.isSmall ? 28 : 46;
  }
  get padBottom() {
    return this.isSmall ? 22 : 45;
  }
  get volHeight() {
    return this.isSmall ? 24 : 50;
  }
  get chartW() {
    return this.totalW - this.padding.left - this.priceAxisWidth;
  }
  get chartH() {
    return Math.max(100, this.totalH - this.padTop - this.padBottom - this.volHeight - 4);
  }
  get totalW() { return this.canvas.width / (window.devicePixelRatio || 1); }
  get totalH() { return this.canvas.height / (window.devicePixelRatio || 1); }

  _xForIndex(i) {
    const relIdx = i - this.viewStart;
    const candleW = this.chartW / this.viewCount;
    return this.padding.left + relIdx * candleW + candleW / 2;
  }

  _yForPrice(price, minPrice, maxPrice) {
    return this.padTop + this.chartH * (1 - (price - minPrice) / (maxPrice - minPrice));
  }

  _getVisibleCandles() {
    const end = Math.min(this.viewStart + this.viewCount, this.candles.length);
    return { start: this.viewStart, end, candles: this.candles.slice(this.viewStart, end) };
  }

  _getPriceRange(visCandles) {
    let min = Infinity, max = -Infinity;
    for (const c of visCandles) {
      if (c.high > max) max = c.high;
      if (c.low < min) min = c.low;
    }
    if (this.matchResult && this.matchResult.levels) {
      const { sl, t1, t2, entry } = this.matchResult.levels;
      [sl, t1, t2, entry].forEach(p => {
        if (p && !isNaN(p)) {
          if (p > max) max = p;
          if (p < min) min = p;
        }
      });
    }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }

  _getVolumeMax(visCandles) {
    return Math.max(...visCandles.map(c => c.volume)) || 1;
  }

  // â”€â”€ Main Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _render() {
    const ctx = this.ctx;
    const W = this.totalW, H = this.totalH;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (!this.candles.length) {
      this._drawEmpty();
      return;
    }

    const { start, end, candles: vis } = this._getVisibleCandles();
    if (!vis.length) return;

    const { min: priceMin, max: priceMax } = this._getPriceRange(vis);
    const volMax = this._getVolumeMax(vis);
    const candleW = this.chartW / this.viewCount;
    const bodyW = Math.max(1, candleW * 0.6);

    this._drawGrid(priceMin, priceMax);
    this._drawSMA(start, end, priceMin, priceMax, candleW);
    this._drawCandles(start, end, vis, priceMin, priceMax, candleW, bodyW);
    this._drawVolume(start, end, vis, volMax, candleW);
    this._drawPriceAxis(priceMin, priceMax);
    this._drawTimeAxis(start, end, vis, candleW);
    this._drawHeader();
    this._drawHighlightAnnotations(start, end, priceMin, priceMax, candleW);
    this._drawTradeLevels(priceMin, priceMax);
    if (this.crosshairX >= 0) this._drawCrosshair(priceMin, priceMax);
  }

  // ── Draw: Empty State ─────────────────────────────────────────────
  _drawEmpty() {
    const ctx = this.ctx;
    ctx.fillStyle = '#64748b';
    ctx.font = '16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a stock to view chart', this.totalW / 2, this.totalH / 2);
  }

  // ── Draw: Grid Lines ─────────────────────────────────────────────
  _drawGrid(priceMin, priceMax) {
    const ctx = this.ctx;
    const steps = this.isSmall ? 4 : 6;
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let i = 0; i <= steps; i++) {
      const y = this.padTop + (this.chartH / steps) * i;
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(this.padding.left + this.chartW, y);
      ctx.stroke();
    }
  }

  // ── Draw: SMA Overlays ────────────────────────────────────────────
  _drawSMA(start, end, priceMin, priceMax, candleW) {
    const ctx = this.ctx;
    const drawLine = (smaArr, color) => {
      if (!smaArr || !smaArr.length) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      let started = false;
      for (let i = start; i < end; i++) {
        const val = smaArr[i];
        if (val == null) continue;
        const x = this._xForIndex(i);
        const y = this._yForPrice(val, priceMin, priceMax);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawLine(this.sma20, '#f6c90e');
    drawLine(this.sma50, '#2196F3');
  }

  // ── Draw: Candlesticks ────────────────────────────────────────────
  _drawCandles(start, end, vis, priceMin, priceMax, candleW, bodyW) {
    const ctx = this.ctx;
    for (let i = start; i < end; i++) {
      const c = this.candles[i];
      const x = this._xForIndex(i);
      const isHighlight = this.highlightIndices.includes(i);
      const isBull = c.close >= c.open;
      const color = isBull ? '#26a69a' : '#ef5350';
      const bodyTop = Math.min(
        this._yForPrice(c.open, priceMin, priceMax),
        this._yForPrice(c.close, priceMin, priceMax)
      );
      const bodyBot = Math.max(
        this._yForPrice(c.open, priceMin, priceMax),
        this._yForPrice(c.close, priceMin, priceMax)
      );
      const highY = this._yForPrice(c.high, priceMin, priceMax);
      const lowY = this._yForPrice(c.low, priceMin, priceMax);
      const bodyHeight = Math.max(1, bodyBot - bodyTop);

      // Highlight glow for pattern candles
      if (isHighlight) {
        ctx.save();
        ctx.shadowColor = isBull ? '#26a69a' : '#ef5350';
        ctx.shadowBlur = 12;
      }

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = isHighlight ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);

      if (isHighlight) {
        ctx.restore();
        // Draw highlight ring
        const labelIdx = this.highlightIndices.indexOf(i);
        const label = labelIdx >= 0 ? 'C' + (labelIdx + 1) : '';
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, highY - 6);
      }
    }
  }

  // ── Draw: Volume Sub-pane ─────────────────────────────────────────
  _drawVolume(start, end, vis, volMax, candleW) {
    const ctx = this.ctx;
    const volTop = this.padTop + this.chartH + 4;
    const volH = this.volHeight;
    const bodyW = Math.max(1, candleW * 0.6);

    // Volume separator line
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.padding.left, volTop);
    ctx.lineTo(this.padding.left + this.chartW, volTop);
    ctx.stroke();

    for (let i = start; i < end; i++) {
      const c = this.candles[i];
      const x = this._xForIndex(i);
      const isBull = c.close >= c.open;
      const barH = Math.max(1, (c.volume / volMax) * volH * 0.85);
      ctx.fillStyle = isBull ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
      ctx.fillRect(x - bodyW / 2, volTop + volH - barH, bodyW, barH);
    }

    // Vol label
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', this.padding.left + 4, volTop + 10);
  }

  // ── Draw: Price Axis ──────────────────────────────────────────────
  _drawPriceAxis(priceMin, priceMax) {
    const ctx = this.ctx;
    const axisX = this.padding.left + this.chartW;
    const steps = this.isSmall ? 4 : 6;
    ctx.fillStyle = '#64748b';
    ctx.font = `${this.isSmall ? 9.5 : 11}px Inter, sans-serif`;
    ctx.textAlign = 'left';

    for (let i = 0; i <= steps; i++) {
      const price = priceMin + ((priceMax - priceMin) / steps) * (steps - i);
      const y = this.padTop + (this.chartH / steps) * i;

      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisX, y);
      ctx.lineTo(axisX + 6, y);
      ctx.stroke();

      ctx.fillText(this._formatPrice(price), axisX + 6, y + 3.5);
    }

    // Latest price badge (like TradingView)
    if (this.candles.length > 0) {
      const latest = this.candles[this.candles.length - 1];
      const latestY = this._yForPrice(latest.close, priceMin, priceMax);
      const isBull = latest.close >= (this.candles[this.candles.length - 2]?.close || latest.open);

      ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
      const badgeW = this.priceAxisWidth - 6;
      const badgeH = 16;
      ctx.beginPath();
      ctx.roundRect(axisX + 2, latestY - badgeH / 2, badgeW, badgeH, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9.5px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this._formatPrice(latest.close), axisX + 5, latestY + 3.5);

      // Dashed line to latest price
      ctx.strokeStyle = isBull ? '#26a69a' : '#ef5350';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(this.padding.left, latestY);
      ctx.lineTo(axisX, latestY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── Draw: Time Axis ───────────────────────────────────────────────
  _drawTimeAxis(start, end, vis, candleW) {
    const ctx = this.ctx;
    const y = this.padTop + this.chartH + this.volHeight + 14;
    const step = Math.max(1, Math.floor(this.viewCount / (this.isSmall ? 5 : 8)));
    ctx.fillStyle = '#64748b';
    ctx.font = '9.5px Inter, sans-serif';
    ctx.textAlign = 'center';

    for (let i = start; i < end; i += step) {
      const c = this.candles[i];
      const x = this._xForIndex(i);
      const label = this._formatDateLabel(c, false);
      ctx.fillText(label, x, y);
    }
  }

  _formatDateLabel(c, full = false) {
    if (c && c.date) {
      const parts = c.date.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthIndex = parseInt(parts[1], 10) - 1;
        const day = parts[2];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[monthIndex] || parts[1];
        return full ? `${day} ${monthName} ${year}` : `${day} ${monthName}`;
      }
    }
    return new Date(c.time).toLocaleDateString('en-IN', full ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' });
  }

  // ── Draw: OHLC Header ─────────────────────────────────────────────
  _drawHeader() {
    const ctx = this.ctx;
    const latest = this.candles[this.candles.length - 1];
    if (!latest) return;

    const prev = this.candles[this.candles.length - 2];
    const change = prev ? latest.close - prev.close : 0;
    const changePct = prev ? (change / prev.close * 100) : 0;
    const isBull = change >= 0;
    const isSmall = this.isSmall;

    const headerY = isSmall ? 15 : 20;

    // Symbol title
    ctx.fillStyle = '#0f172a';
    ctx.font = isSmall ? 'bold 11px Inter, sans-serif' : 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'left';
    const title = `${this.symbol.replace('.NS', '')} · 1D · NSE`;
    ctx.fillText(title, this.padding.left + 4, headerY);

    if (!isSmall) {
      // OHLC values on larger screens
      const ohlcParts = [
        { label: 'haO', val: this._formatPrice(latest.open) },
        { label: 'haH', val: this._formatPrice(latest.high) },
        { label: 'haL', val: this._formatPrice(latest.low) },
        { label: 'haC', val: this._formatPrice(latest.close) },
      ];
      let xOff = this.padding.left + ctx.measureText(title).width + 16;
      ctx.font = '11px Inter, sans-serif';
      for (const part of ohlcParts) {
        ctx.fillStyle = '#64748b';
        ctx.fillText(part.label, xOff, headerY);
        xOff += ctx.measureText(part.label).width + 3;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(part.val + '  ', xOff, headerY);
        xOff += ctx.measureText(part.val + '  ').width + 2;
      }

      // Change badge
      ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
      const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
      ctx.fillText(changeStr, xOff, headerY);
    }

    // Trend badge
    if (this.trend) {
      const badgeW = isSmall ? 56 : 70;
      const badgeH = isSmall ? 16 : 18;
      const badgeX = this.totalW - this.priceAxisWidth - badgeW - 6;
      ctx.fillStyle = this.trend === 'bullish' ? '#26a69a' : '#ef5350';
      ctx.beginPath();
      ctx.roundRect(badgeX, isSmall ? 4 : 7, badgeW, badgeH, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${isSmall ? 9 : 10}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(this.trend.toUpperCase(), badgeX + badgeW / 2, isSmall ? 15 : 20);
    }

    if (!isSmall) {
      // Company name subtitle
      ctx.fillStyle = '#64748b';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.companyName, this.padding.left + 4, 34);
    }
  }

  // ── Draw: Pattern Highlight Annotations ───────────────────────────
  _drawHighlightAnnotations(start, end, priceMin, priceMax, candleW) {
    if (!this.highlightIndices.length || !this.matchResult) return;
    const ctx = this.ctx;
    const colors = ['#f6c90e', '#2196F3', '#26a69a'];

    this.highlightIndices.forEach((idx, labelIdx) => {
      if (idx < start || idx >= end) return;
      const c = this.candles[idx];
      const x = this._xForIndex(idx);
      const color = colors[labelIdx];

      // Vertical bracket line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, this.padTop);
      ctx.lineTo(x, this.padTop + this.chartH);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // ── Draw: Trade Levels (Entry, Stop Loss, Target 1, Target 2) ──────
  _drawTradeLevels(priceMin, priceMax) {
    if (!this.matchResult || !this.matchResult.levels) return;
    const { entry, sl, t1, t2, slRef } = this.matchResult.levels;
    const ctx = this.ctx;
    const axisX = this.padding.left + this.chartW;

    const levels = [
      { label: `SL (${slRef || 'C1'})`, price: sl, color: '#ef5350', bg: 'rgba(239, 83, 80, 0.9)' },
      { label: 'Entry', price: entry, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.9)' },
      { label: 'TGT 1 (1:1.5)', price: t1, color: '#10b981', bg: 'rgba(16, 185, 129, 0.9)' },
      { label: 'TGT 2 (1:2)', price: t2, color: '#059669', bg: 'rgba(5, 150, 105, 0.9)' },
    ];

    levels.forEach(lvl => {
      if (!lvl.price || isNaN(lvl.price)) return;
      const y = this._yForPrice(lvl.price, priceMin, priceMax);
      if (y < this.padTop - 5 || y > this.padTop + this.chartH + 5) return;

      // Dashed horizontal price line across chart
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Level pill badge on right axis
      const badgeW = this.priceAxisWidth - 4;
      const badgeH = 16;
      ctx.fillStyle = lvl.bg;
      ctx.beginPath();
      ctx.roundRect(axisX + 2, y - badgeH / 2, badgeW, badgeH, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${lvl.label}: ${this._formatPrice(lvl.price)}`, axisX + 4, y + 3.5);
    });
  }

  // ── Draw: Crosshair ───────────────────────────────────────────────
  _drawCrosshair(priceMin, priceMax) {
    const ctx = this.ctx;
    const x = this.crosshairX;
    const y = this.crosshairY;

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(this.padding.left, y);
    ctx.lineTo(this.padding.left + this.chartW, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, this.padTop);
    ctx.lineTo(x, this.padTop + this.chartH);
    ctx.stroke();

    ctx.setLineDash([]);

    // Price label on axis
    const price = priceMin + (priceMax - priceMin) * (1 - (y - this.padTop) / this.chartH);
    if (price > 0) {
      const axisX = this.padding.left + this.chartW + 2;
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.roundRect(axisX, y - 9, 68, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this._formatPrice(price), axisX + 4, y + 4);
    }

    // OHLC tooltip for hovered candle
    const candleW = this.chartW / this.viewCount;
    const hovIdx = this.viewStart + Math.floor((x - this.padding.left) / candleW);
    if (hovIdx >= 0 && hovIdx < this.candles.length) {
      const c = this.candles[hovIdx];
      this._drawTooltip(c, x, y);
    }
  }

  _drawTooltip(c, x, y) {
    const ctx = this.ctx;
    const date = this._formatDateLabel(c, true);
    const lines = [
      date,
      `O: ${this._formatPrice(c.open)}  H: ${this._formatPrice(c.high)}`,
      `L: ${this._formatPrice(c.low)}  C: ${this._formatPrice(c.close)}`,
      `Vol: ${this._formatVolume(c.volume)}`,
    ];

    const tw = 180, th = 72, pad = 8;
    let tx = x + 12, ty = Math.max(this.padding.top, y - th / 2);
    if (tx + tw > this.totalW - this.priceAxisWidth) tx = x - tw - 12;

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      if (i === 0) { ctx.fillStyle = '#64748b'; }
      else { ctx.fillStyle = '#0f172a'; }
      ctx.fillText(line, tx + pad, ty + pad + 12 + i * 15);
    });
  }

  // â”€â”€ Format Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _formatPrice(p) {
    if (p >= 1000) return p.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return p.toFixed(2);
  }
  _formatVolume(v) {
    if (v >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(2) + ' L';
    return v.toLocaleString('en-IN');
  }

  // â”€â”€ Event Binding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.crosshairX = e.clientX - rect.left;
      this.crosshairY = e.clientY - rect.top;
      if (this.isDragging) {
        const dx = this.dragStartX - this.crosshairX;
        const candleW = this.chartW / this.viewCount;
        const shift = Math.round(dx / candleW);
        this.viewStart = Math.max(0, Math.min(
          this.candles.length - this.viewCount,
          this.dragStartViewStart + shift
        ));
      }
      this._render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.crosshairX = -1;
      this.crosshairY = -1;
      this.isDragging = false;
      this._render();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      const rect = this.canvas.getBoundingClientRect();
      this.dragStartX = e.clientX - rect.left;
      this.dragStartViewStart = this.viewStart;
    });

    this.canvas.addEventListener('mouseup', () => { this.isDragging = false; });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 5 : -5;
      this.viewCount = Math.max(15, Math.min(this.candles.length, this.viewCount + delta));
      this.viewStart = Math.max(0, Math.min(
        this.candles.length - this.viewCount,
        this.viewStart
      ));
      this._render();
    }, { passive: false });
  }
}



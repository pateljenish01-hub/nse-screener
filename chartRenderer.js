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

  // â”€â”€ Coordinate Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get chartW() {
    return (this.canvas.width / (window.devicePixelRatio || 1)) - this.padding.left - this.priceAxisWidth;
  }
  get chartH() {
    return (this.canvas.height / (window.devicePixelRatio || 1)) - this.padding.top - this.padding.bottom - this.volumePaneHeight - 8;
  }
  get totalW() { return this.canvas.width / (window.devicePixelRatio || 1); }
  get totalH() { return this.canvas.height / (window.devicePixelRatio || 1); }

  _xForIndex(i) {
    const relIdx = i - this.viewStart;
    const candleW = this.chartW / this.viewCount;
    return this.padding.left + relIdx * candleW + candleW / 2;
  }

  _yForPrice(price, minPrice, maxPrice) {
    return this.padding.top + this.chartH * (1 - (price - minPrice) / (maxPrice - minPrice));
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
    const pad = (max - min) * 0.06;
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
    if (this.crosshairX >= 0) this._drawCrosshair(priceMin, priceMax);
  }

  // â”€â”€ Draw: Empty State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawEmpty() {
    const ctx = this.ctx;
    ctx.fillStyle = '#64748b';
    ctx.font = '16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a stock to view chart', this.totalW / 2, this.totalH / 2);
  }

  // â”€â”€ Draw: Grid Lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawGrid(priceMin, priceMax) {
    const ctx = this.ctx;
    const steps = 6;
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let i = 0; i <= steps; i++) {
      const y = this.padding.top + (this.chartH / steps) * i;
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(this.padding.left + this.chartW, y);
      ctx.stroke();
    }
  }

  // â”€â”€ Draw: SMA Overlays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Draw: Candlesticks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Draw: Volume Sub-pane â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawVolume(start, end, vis, volMax, candleW) {
    const ctx = this.ctx;
    const volTop = this.padding.top + this.chartH + 8;
    const volH = this.volumePaneHeight;
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
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', this.padding.left + 4, volTop + 12);
  }

  // â”€â”€ Draw: Price Axis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawPriceAxis(priceMin, priceMax) {
    const ctx = this.ctx;
    const axisX = this.padding.left + this.chartW;
    const steps = 6;
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';

    for (let i = 0; i <= steps; i++) {
      const price = priceMin + ((priceMax - priceMin) / steps) * (steps - i);
      const y = this.padding.top + (this.chartH / steps) * i;

      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisX, y);
      ctx.lineTo(axisX + 6, y);
      ctx.stroke();

      ctx.fillText(this._formatPrice(price), axisX + 8, y + 4);
    }

    // Latest price badge (like TradingView)
    if (this.candles.length > 0) {
      const latest = this.candles[this.candles.length - 1];
      const latestY = this._yForPrice(latest.close, priceMin, priceMax);
      const isBull = latest.close >= (this.candles[this.candles.length - 2]?.close || latest.open);

      ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
      const badgeW = 68;
      const badgeH = 18;
      ctx.beginPath();
      ctx.roundRect(axisX + 2, latestY - badgeH / 2, badgeW, badgeH, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this._formatPrice(latest.close), axisX + 6, latestY + 4);

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

  // â”€â”€ Draw: Time Axis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawTimeAxis(start, end, vis, candleW) {
    const ctx = this.ctx;
    const y = this.padding.top + this.chartH + this.volumePaneHeight + 18;
    const step = Math.max(1, Math.floor(this.viewCount / 8));
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';

    for (let i = start; i < end; i += step) {
      const c = this.candles[i];
      const x = this._xForIndex(i);
      const label = new Date(c.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      ctx.fillText(label, x, y);
    }
  }

  // â”€â”€ Draw: OHLC Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawHeader() {
    const ctx = this.ctx;
    const latest = this.candles[this.candles.length - 1];
    if (!latest) return;

    const prev = this.candles[this.candles.length - 2];
    const change = prev ? latest.close - prev.close : 0;
    const changePct = prev ? (change / prev.close * 100) : 0;
    const isBull = change >= 0;

    // Symbol title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'left';
    const title = `${this.symbol.replace('.NS', '')} Â· 1D Â· NSE`;
    ctx.fillText(title, this.padding.left + 4, 22);

    // OHLC values
    const ohlcParts = [
      { label: 'haO', val: this._formatPrice(latest.open) },
      { label: 'haH', val: this._formatPrice(latest.high) },
      { label: 'haL', val: this._formatPrice(latest.low) },
      { label: 'haC', val: this._formatPrice(latest.close) },
    ];
    let xOff = this.padding.left + ctx.measureText(title).width + 20;
    ctx.font = '11px Inter, sans-serif';
    for (const part of ohlcParts) {
      ctx.fillStyle = '#64748b';
      ctx.fillText(part.label, xOff, 22);
      xOff += ctx.measureText(part.label).width + 3;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(part.val + '  ', xOff, 22);
      xOff += ctx.measureText(part.val + '  ').width + 2;
    }

    // Change badge
    ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
    const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    ctx.fillText(changeStr, xOff, 22);

    // Trend badge
    if (this.trend) {
      const badgeX = this.totalW - this.priceAxisWidth - 80;
      ctx.fillStyle = this.trend === 'bullish' ? '#26a69a' : '#ef5350';
      ctx.beginPath();
      ctx.roundRect(badgeX, 8, 72, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.trend.toUpperCase(), badgeX + 36, 21);
    }

    // Company name subtitle
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.companyName, this.padding.left + 4, 36);
  }

  // â”€â”€ Draw: Pattern Highlight Annotations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _drawHighlightAnnotations(start, end, priceMin, priceMax, candleW) {
    if (!this.highlightIndices.length || !this.matchResult) return;
    const ctx = this.ctx;
    const labels = ['Candle 1\n(Both Wicks)', 'Candle 2\n(Directional)', 'Candle 3\n(Body Cross)'];
    const colors = ['#f6c90e', '#2196F3', '#26a69a'];

    this.highlightIndices.forEach((idx, labelIdx) => {
      if (idx < start || idx >= end) return;
      const c = this.candles[idx];
      const x = this._xForIndex(idx);
      const highY = this._yForPrice(c.high, priceMin, priceMax);
      const color = colors[labelIdx];

      // Vertical bracket line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, this.padding.top);
      ctx.lineTo(x, this.padding.top + this.chartH);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // â”€â”€ Draw: Crosshair â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    ctx.moveTo(x, this.padding.top);
    ctx.lineTo(x, this.padding.top + this.chartH);
    ctx.stroke();

    ctx.setLineDash([]);

    // Price label on axis
    const price = priceMin + (priceMax - priceMin) * (1 - (y - this.padding.top) / this.chartH);
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
    const date = new Date(c.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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



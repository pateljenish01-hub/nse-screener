// app.js  NSE 500 Screener Application Orchestrator

const App = (() => {
  //  State 
  const state = {
    allResults: [],      // All fetch + filter results
    matched: [],         // Stocks passing all 3 conditions
    failed: [],          // Stocks that did NOT pass
    filtered: [],        // After sidebar search/filter
    activeSymbol: null,  // Currently charted symbol
    trendFilter: 'all',  // 'all' | 'bullish' | 'bearish'
    searchQuery: '',
    showSMA20: true,
    showSMA50: true,
    scanning: false,
    lastScanTime: null,
  };

  let chart = null;

  //  DOM References 
  const dom = {
    overlay: () => document.getElementById('scan-overlay'),
    progressFill: () => document.getElementById('progress-fill'),
    progressPct: () => document.getElementById('progress-pct'),
    progressSub: () => document.getElementById('progress-sub'),
    matchedCount: () => document.getElementById('matched-count'),
    screenerList: () => document.getElementById('screener-list'),
    searchInput:  () => document.getElementById('search-input'),
    statMatched:  () => document.getElementById('stat-matched'),
    statFailed:   () => document.getElementById('stat-failed'),
    statTotal:    () => document.getElementById('stat-total'),
    statTime:     () => document.getElementById('stat-time'),
    scanBtn:      () => document.getElementById('scan-btn'),
    refreshBtn:   () => document.getElementById('refresh-btn'),
    exportBtn:    () => document.getElementById('export-btn'),
    filterAll:    () => document.getElementById('filter-all'),
    filterBull:   () => document.getElementById('filter-bull'),
    filterBear:   () => document.getElementById('filter-bear'),
    condBox:     (n) => document.getElementById('cond-box-' + n),
    lastScan:     () => document.getElementById('last-scan-time'),
    noChart:      () => document.getElementById('no-chart-state'),
    chartArea:    () => document.getElementById('chart-canvas-container'),
    conditionStrip: () => document.getElementById('condition-strip'),
    legendPanel:  () => document.getElementById('pattern-legend'),
    sma20Toggle:  () => document.getElementById('toggle-sma20'),
    sma50Toggle:  () => document.getElementById('toggle-sma50'),
    // Failed log
    failedPanel:  () => document.getElementById('failed-log-panel'),
    failedToggle: () => document.getElementById('failed-log-toggle'),
    failedBody:   () => document.getElementById('failed-log-body'),
    failedCount:  () => document.getElementById('failed-log-count'),
    failedArrow:  () => document.getElementById('failed-log-arrow'),
  };

  //  Toast Notifications 
  function toast(message, type = 'info', durationMs = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type} fade-in`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slide-out 0.3s ease forwards';
      setTimeout(() => el.remove(), 300);
    }, durationMs);
  }

  //  Format Helpers 
  function fmtPrice(p) {
    return p >= 1000
      ? p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.toFixed(2);
  }

  function fmtTime(date) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  //  Progress Update 
  function updateProgress({ completed, total, failed, percent }) {
    dom.progressFill().style.width = percent + '%';
    dom.progressPct().textContent = `${percent}%`;
    dom.progressSub().innerHTML =
      `Scanning ${completed}/${total} stocks &nbsp;&nbsp; ` +
      `<span class="scan-match-count">${state.matched.length} matched</span> &nbsp;&nbsp; ${failed} failed`;
  }

  //  Run Scan 
  async function runScan(forceRefresh = false) {
    if (state.scanning) return;
    state.scanning = true;
    state.matched = [];
    state.failed = [];
    state.allResults = [];
    DataFetcher.clearFailedLog();

    dom.scanBtn().disabled = true;
    dom.refreshBtn().disabled = true;
    dom.overlay().classList.remove('hidden');
    dom.matchedCount().textContent = '0';
    dom.progressFill().style.width = '0%';
    dom.progressPct().textContent = '0%';
    dom.screenerList().innerHTML = '';

    const symbols = NSE500;

    // Accumulate results as they stream in from fetchAll
    const streamedResults = [];

    try {
      const { results, failed: fetchFailed } = await DataFetcher.fetchAll(
        symbols,
        (progress, latestBatch) => {
          // Evaluate any new results since last progress call
          if (latestBatch && latestBatch.length) {
            for (const res of latestBatch) {
              const evalResult = FilterEngine.evaluate(
                res.symbol, res.candles, res.meta
              );
              streamedResults.push(evalResult);
              if (evalResult.pass) {
                state.matched.push(evalResult);
                appendMatchedItem(evalResult);
              } else {
                state.failed.push(evalResult);
              }
            }
          }
          updateProgress({ ...progress, failed: state.failed.length });
        }
      );

      // Final evaluation pass for any symbols not yet processed
      const evaluatedSymbols = new Set(streamedResults.map(r => r.symbol));
      for (const res of results) {
        if (!evaluatedSymbols.has(res.symbol)) {
          const evalResult = FilterEngine.evaluate(res.symbol, res.candles, res.meta);
          if (evalResult.pass) {
            state.matched.push(evalResult);
            appendMatchedItem(evalResult);
          } else {
            state.failed.push(evalResult);
          }
        }
      }

      state.lastScanTime = new Date();
      state.allResults = results;

      // Sort matched
      state.matched.sort((a, b) => {
        if (a.trend !== b.trend) return a.trend === 'bullish' ? -1 : 1;
        return Math.abs(b.stats.changePct) - Math.abs(a.stats.changePct);
      });

      // Update header stats
      dom.statMatched().textContent = state.matched.length;
      dom.statFailed().textContent = state.failed.length;
      dom.statTotal().textContent = results.length;
      dom.lastScan().textContent = `Last scan: ${fmtTime(state.lastScanTime)}`;

      // Re-render list
      applyFilter();

      // Populate failed tickers log
      renderFailedLog();

      // Auto-select first matched stock
      if (state.matched.length > 0 && !state.activeSymbol) {
        selectStock(state.matched[0]);
      }

      toast(
        state.matched.length > 0
          ? '\u2705 ' + state.matched.length + ' stock' + (state.matched.length !== 1 ? 's' : '') + ' matched the 3-candle pattern'
          : '\u26a0\ufe0f No stocks matched the pattern today',
        state.matched.length > 0 ? 'success' : 'info'
      );

    } catch (err) {
      console.error('Scan error:', err);
      toast('Scan failed: ' + err.message, 'error');
    } finally {
      state.scanning = false;
      dom.scanBtn().disabled = false;
      dom.refreshBtn().disabled = false;
      setTimeout(() => dom.overlay().classList.add('hidden'), 600);
    }
  }

  //  Append Matched Item to Screener (live, during scan) 
  function appendMatchedItem(result) {
    const list = dom.screenerList();
    // Remove empty state if present
    const empty = list.querySelector('.screener-empty');
    if (empty) empty.remove();

    const item = buildScreenerItem(result);
    list.appendChild(item);
    dom.matchedCount().textContent = state.matched.length;
  }

  //  Build Screener List Item 
  function buildScreenerItem(result) {
    const { symbol, trend, stats, meta } = result;
    const shortSym = symbol.replace('.NS', '');
    const isBull = trend === 'bullish';
    const changeCls = stats.changePct >= 0 ? 'bull' : 'bear';
    const changeStr = `${stats.changePct >= 0 ? '+' : ''}${stats.changePct}%`;
    const lvl = result.levels || {};
    const levelsHtml = lvl.sl ? `
      <div class="item-levels">
        <span class="lvl-tag lvl-sl">SL: ₹${lvl.sl}</span>
        <span class="lvl-tag lvl-tgt">TGT: ₹${lvl.t2}</span>
        <span class="lvl-tag lvl-rr">1:2</span>
      </div>` : '';

    const item = document.createElement('div');
    item.className = 'screener-item fade-in';
    item.dataset.symbol = symbol;
    item.innerHTML = `
      <div class="item-left">
        <div class="item-symbol">${shortSym}</div>
        <div class="item-name">${meta.name || shortSym}</div>
        <div class="badge-sector">${meta.sector || ''}</div>
        ${levelsHtml}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
        <span class="item-badge ${isBull ? 'badge-bull' : 'badge-bear'}">${trend.toUpperCase()}</span>
        <div class="item-right">
          <div class="item-price">${fmtPrice(stats.latestClose)}</div>
          <div class="item-change ${changeCls}">${changeStr}</div>
        </div>
      </div>
    `;
    item.addEventListener('click', () => selectStock(result));
    return item;
  }

  //  Render Full Screener List 
  function renderScreenerList(results) {
    const list = dom.screenerList();
    list.innerHTML = '';

    if (!results.length) {
      list.innerHTML = `
        <div class="screener-empty">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>No stocks matched the 3-candle pattern</p>
        </div>
      `;
      return;
    }

    results.forEach(r => list.appendChild(buildScreenerItem(r)));
  }

  //  Apply Search + Trend Filter 
  function applyFilter() {
    let results = [...state.matched];

    if (state.trendFilter !== 'all') {
      results = results.filter(r => r.trend === state.trendFilter);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      results = results.filter(r =>
        r.symbol.toLowerCase().includes(q) ||
        (r.meta.name || '').toLowerCase().includes(q) ||
        (r.meta.sector || '').toLowerCase().includes(q)
      );
    }

    state.filtered = results;
    renderScreenerList(results);

    // Restore active class
    if (state.activeSymbol) {
      const el = dom.screenerList().querySelector(`[data-symbol="${state.activeSymbol}"]`);
      if (el) el.classList.add('active');
    }
  }

  //  Select and Chart a Stock 
  function selectStock(result) {
    state.activeSymbol = result.symbol;

    // Update active classes
    dom.screenerList().querySelectorAll('.screener-item').forEach(el => {
      el.classList.toggle('active', el.dataset.symbol === result.symbol);
    });

    // Show chart area
    dom.noChart().style.display = 'none';
    dom.chartArea().style.display = 'block';
    dom.conditionStrip().style.display = 'flex';
    if (dom.legendPanel()) dom.legendPanel().classList.add('visible');

    // Use Heikin-Ashi candles for chart (filter engine evaluated on HA)
    const haCandles  = result.allHACandles || FilterEngine.convertToHeikinAshi(result.allCandles || []);
    const rawCandles = result.allCandles || [];

    // Compute SMA on HA closes for accurate overlay
    const sma20 = FilterEngine.computeSMA(haCandles, 20);
    const sma50 = FilterEngine.computeSMA(haCandles, 50);

    // Highlight the last 3 HA candles (C1, C2, C3)
    const len = haCandles.length;
    const highlightIndices = (result.sequenceIndices && result.sequenceIndices.length > 0) ? result.sequenceIndices : [len - 3, len - 2, len - 1];

    chart.load(haCandles, {
      symbol: result.symbol,
      companyName: result.meta.name || '',
      trend: result.trend,
      matchResult: result,
      rawCandles,
      sma20: state.showSMA20 ? sma20 : [],
      sma50: state.showSMA50 ? sma50 : [],
      highlightIndices,
    });

    // Update condition strip
    updateConditionStrip(result);
  }

  //  Update Condition Detail Strip 
  function updateConditionStrip(result) {
    const { conditions, trend } = result;
    const conds = [
      {
        id: 1,
        label: 'Candle 1  Both-Side Wicks',
        rule: 'HA_High > max(HA_Open,HA_Close) AND HA_Low < min(HA_Open,HA_Close)',
        result: conditions.c1,
      },
      {
        id: 2,
        label: `Candle 2  ${trend === 'bearish' ? 'Lower' : 'Upper'} Wick Only`,
        rule: trend === 'bearish' ? 'No upper wick, lower wick present' : 'No lower wick, upper wick present',
        result: conditions.c2,
      },
      {
        id: 3,
        label: 'Candle 3  Body Crosses C2',
        rule: trend === 'bearish' ? 'C3 body goes below C2 body' : 'C3 body goes above C2 body',
        result: conditions.c3,
      },
    ];

    conds.forEach(({ id, label, rule, result: r }) => {
      const box = dom.condBox(id);
      if (!box) return;
      const passClass = r.pass ? 'cond-pass' : 'cond-fail';
      const icon = r.pass ? '' : '';
      box.innerHTML = `
        <div class="cond-label">${label}</div>
        <div class="cond-value ${passClass}">
          <span class="cond-icon">${icon}</span>${rule}
        </div>
        <div class="cond-value" style="font-size:9px;margin-top:2px;color:var(--text-muted)">
          ${r.reason}
        </div>
      `;
    });

    const planBox = document.getElementById('cond-plan-value');
    if (planBox && result.levels) {
      const lvl = result.levels;
      planBox.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
          <span class="plan-pill entry">Entry: ₹${lvl.entry}</span>
          <span class="plan-pill sl">SL (${lvl.slRef}): ₹${lvl.sl} (-${lvl.riskPct}%)</span>
          <span class="plan-pill tgt">TGT 1 (1:1.5): ₹${lvl.t1}</span>
          <span class="plan-pill tgt">TGT 2 (1:2): ₹${lvl.t2}</span>
        </div>
      `;
    }
  }

  // ── Export Matched to CSV ─────────────────────────────────────────
  function exportCSV() {
    if (!state.matched.length) { toast('No results to export', 'error'); return; }
    
    const bullish = state.matched.filter(r => r.trend === 'bullish');
    const bearish = state.matched.filter(r => r.trend === 'bearish');

    let csv = "BULLISH,,,,,,,,BEARISH,,,,,,,\n";
    csv += "Sr.no,Script,LTP,Lot size,Stop Loss,Target 1 (1:1.5),Target 2 (1:2),Risk %,Sr.no,Script,LTP,Lot size,Stop Loss,Target 1 (1:1.5),Target 2 (1:2),Risk %\n";

    const maxLen = Math.max(bullish.length, bearish.length);
    
    for (let i = 0; i < maxLen; i++) {
        let row = [];
        
        // Bullish Side
        if (i < bullish.length) {
            const b = bullish[i];
            const lot = (typeof LOT_SIZES !== 'undefined' && LOT_SIZES[b.symbol]) ? LOT_SIZES[b.symbol] : '';
            const ltp = fmtPrice(b.stats.latestClose);
            const shortSym = b.symbol.replace('.NS', '');
            const lvl = b.levels || {};
            row.push(i + 1, shortSym, ltp, lot, lvl.sl || '', lvl.t1 || '', lvl.t2 || '', lvl.riskPct ? `${lvl.riskPct}%` : '');
        } else {
            row.push('', '', '', '', '', '', '', '');
        }

        // Bearish Side
        if (i < bearish.length) {
            const b = bearish[i];
            const lot = (typeof LOT_SIZES !== 'undefined' && LOT_SIZES[b.symbol]) ? LOT_SIZES[b.symbol] : '';
            const ltp = fmtPrice(b.stats.latestClose);
            const shortSym = b.symbol.replace('.NS', '');
            const lvl = b.levels || {};
            row.push(i + 1, shortSym, ltp, lot, lvl.sl || '', lvl.t1 || '', lvl.t2 || '', lvl.riskPct ? `${lvl.riskPct}%` : '');
        } else {
            row.push('', '', '', '', '', '', '', '');
        }

        csv += row.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(",") + "\n";
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HeikinAshi_Scan.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported CSV successfully!`, 'success');
  }

  //  Schedule Daily Auto-Refresh 
  function scheduleAutoRefresh() {
    // Calculate time until next NSE market close (3:30 PM IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);
    const closeIST = new Date(nowIST);
    closeIST.setHours(15, 35, 0, 0); // 3:35 PM IST (5 min after close)

    if (nowIST > closeIST) closeIST.setDate(closeIST.getDate() + 1);

    const msUntilClose = closeIST - nowIST;
    console.log(`[AutoRefresh] Next scan scheduled in ${Math.round(msUntilClose / 60000)} minutes`);

    setTimeout(() => {
      toast(' Auto-refreshing data (NSE market close)', 'info');
      DataFetcher.clearCache();
      runScan(true);
      // Re-schedule for next day
      scheduleAutoRefresh();
    }, msUntilClose);
  }

  // ── Render Failed Tickers Log ─────────────────────────────────────
  function renderFailedLog() {
    const body = dom.failedBody ? dom.failedBody() : null;
    const countEl = dom.failedCount ? dom.failedCount() : null;
    if (countEl) countEl.textContent = state.failed.length;
    if (!body) return;

    if (!state.failed.length) {
      body.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:11px">No failed tickers</div>';
      return;
    }

    body.innerHTML = state.failed.map(r => `
      <div class="failed-log-item">
        <span class="failed-log-sym">${r.symbol.replace('.NS', '')}</span>
        <span class="failed-log-reason">${r.reason || 'Pattern conditions not met'}</span>
      </div>
    `).join('');
  }

  function toggleFailedLog() {
    const p = dom.failedPanel();
    const a = dom.failedArrow();
    const b = dom.failedBody();
    if (p && a && b) {
      if (b.classList.contains('open')) {
        b.classList.remove('open');
        a.textContent = '▼';
      } else {
        b.classList.add('open');
        a.textContent = '▲';
      }
    }
  }

  //  Init 
  function init() {
    // Init chart
    chart = new CandlestickChart('chart-canvas');

    // Scan button
    dom.scanBtn().addEventListener('click', () => {
      DataFetcher.clearCache();
      runScan(true);
    });

    // Refresh button logic removed, now handled by HTML onclick

    // Export button
    dom.exportBtn().addEventListener('click', exportCSV);

    // Search
    dom.searchInput().addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      applyFilter();
    });

    // Trend filter tags
    dom.filterAll().addEventListener('click', () => setTrendFilter('all'));
    dom.filterBull().addEventListener('click', () => setTrendFilter('bullish'));
    dom.filterBear().addEventListener('click', () => setTrendFilter('bearish'));

    // SMA toggles
    dom.sma20Toggle().addEventListener('click', () => {
      state.showSMA20 = !state.showSMA20;
      dom.sma20Toggle().classList.toggle('active', state.showSMA20);
      if (state.activeSymbol) {
        const r = state.matched.find(r => r.symbol === state.activeSymbol);
        if (r) selectStock(r);
      }
    });
    dom.sma50Toggle().addEventListener('click', () => {
      state.showSMA50 = !state.showSMA50;
      dom.sma50Toggle().classList.toggle('active', state.showSMA50);
      if (state.activeSymbol) {
        const r = state.matched.find(r => r.symbol === state.activeSymbol);
        if (r) selectStock(r);
      }
    });

    // Failed log toggle
    const failedToggleEl = dom.failedToggle();
    if (failedToggleEl) failedToggleEl.addEventListener('click', toggleFailedLog);

    // Schedule daily auto-refresh
    scheduleAutoRefresh();

    // Check cache stats
    const cacheStats = DataFetcher.getCacheStats();
    console.log('[Cache]', cacheStats);

    // Initial scan
    runScan(false);
  }

  function setTrendFilter(filter) {
    state.trendFilter = filter;
    ['all', 'bull', 'bear'].forEach(f => {
      const el = dom[`filter${f.charAt(0).toUpperCase() + f.slice(1)}`]();
      if (el) el.classList.toggle('active', (f === 'all' ? 'all' : f + 'ish') === filter || (f === 'all' && filter === 'all'));
    });
    dom.filterAll().classList.toggle('active', filter === 'all');
    dom.filterBull().classList.toggle('active', filter === 'bullish');
    dom.filterBear().classList.toggle('active', filter === 'bearish');
    applyFilter();
  }
  return { init };
})();

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', App.init);










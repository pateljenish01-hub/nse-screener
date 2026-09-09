/**
 * Heikin-Ashi Pro Main Application Controller
 */

(() => {
  let chart = null;
  const state = {
    results: [],
    matched: [],
    selectedResult: null,
    trendFilter: 'all',          // 'all', 'bullish', 'bearish'
    smaTrendFilter: 'all',       // 'all', 'above_sma20', 'above_sma50'
    qualityFilter: 'all',        // 'all', 'top_picks', 'grade_b'
    minMomentum: 1.0,
    searchQuery: '',
    activeView: 'screener'       // 'screener', 'backtest'
  };

  document.addEventListener('DOMContentLoaded', () => {
    initChart();
    bindEvents();
    runScan();
    scheduleAutoRefresh();
  });

  function initChart() {
    chart = new CandlestickChart('chart-canvas');
  }

  function bindEvents() {
    // Navigation Tabs (Screener vs Backtest)
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetView = btn.dataset.view;
        switchView(targetView);
      });
    });

    // Trend Direction Filter Tags (All / Bullish / Bearish)
    document.querySelectorAll('.filter-tags .tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tags .tag-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.trendFilter = btn.dataset.trend;
        renderScreenerList();
      });
    });

    // Quality Filter Tags (All / Top Picks A+ / Grade B+)
    document.querySelectorAll('.quality-filter-tags .quality-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-filter-tags .quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.qualityFilter = btn.dataset.quality;
        renderScreenerList();
      });
    });

    // SMA Trend Filter Dropdown
    const smaSelect = document.getElementById('sma-filter-select');
    if (smaSelect) {
      smaSelect.addEventListener('change', (e) => {
        state.smaTrendFilter = e.target.value;
        renderScreenerList();
      });
    }

    // Search Input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim().toLowerCase();
        renderScreenerList();
      });
    }

    // Refresh & Scan Buttons
    document.getElementById('refresh-btn')?.addEventListener('click', () => runScan(true));
    document.getElementById('scan-btn')?.addEventListener('click', () => runScan(true));
    document.getElementById('export-btn')?.addEventListener('click', exportCSV);
    document.getElementById('run-bt-btn')?.addEventListener('click', runBacktestDashboard);
    document.getElementById('chart-export-bt-btn')?.addEventListener('click', exportBacktestCSV);
    document.getElementById('bt-export-csv-btn')?.addEventListener('click', exportBacktestCSV);

    // Indicator Toggles
    document.getElementById('toggle-sma20')?.addEventListener('click', (e) => {
      chart.showSMA20 = !chart.showSMA20;
      e.currentTarget.classList.toggle('active', chart.showSMA20);
      chart._render();
    });
    document.getElementById('toggle-sma50')?.addEventListener('click', (e) => {
      chart.showSMA50 = !chart.showSMA50;
      e.currentTarget.classList.toggle('active', chart.showSMA50);
      chart._render();
    });

    bindContingencyEvents();
  }

  function switchView(viewName) {
    state.activeView = viewName;
    const screenerContainer = document.getElementById('screener-main-view');
    const backtestContainer = document.getElementById('backtest-main-view');
    const contingencyContainer = document.getElementById('contingency-main-view');
    const sidebar = document.querySelector('.sidebar');

    if (viewName === 'screener') {
      screenerContainer.style.display = 'flex';
      backtestContainer.classList.remove('active');
      if (contingencyContainer) contingencyContainer.style.display = 'none';
      sidebar.style.display = 'flex';
      if (chart) chart._resize();
    } else if (viewName === 'backtest') {
      screenerContainer.style.display = 'none';
      backtestContainer.classList.add('active');
      if (contingencyContainer) contingencyContainer.style.display = 'none';
      sidebar.style.display = 'none';
      runBacktestDashboard();
    } else if (viewName === 'contingency') {
      screenerContainer.style.display = 'none';
      backtestContainer.classList.remove('active');
      if (contingencyContainer) contingencyContainer.style.display = 'block';
      sidebar.style.display = 'none';
      renderContingencyDashboard();
    }
  }

  // ── Run Screener Scan ─────────────────────────────────────────────
  async function runScan(forceRefresh = false) {
    showOverlay(true);
    updateProgress(0, 'Loading NSE 500 Market Data...');

    let data = window.MARKET_DATA;
    if (!data || forceRefresh) {
      try {
        data = await DataFetcher.fetchAll(updateProgress);
      } catch (e) {
        toast('Using embedded market dataset', 'info');
        data = window.MARKET_DATA;
      }
    }

    updateProgress(80, 'Applying Pro Pattern, Volume & Quality Filters...');
    state.results = [];
    state.matched = [];

    const symbols = Object.keys(data);
    symbols.forEach(sym => {
      const raw = data[sym];
      const res = FilterEngine.evaluate(sym, raw);
      state.results.push(res);
      if (res.pass) state.matched.push(res);
    });

    // Auto-Rank: Highest Quality Score (Grade A+ Top Picks) at the very top!
    state.matched.sort((a, b) => {
      const scoreA = a.levels?.qualityScore || 0;
      const scoreB = b.levels?.qualityScore || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.symbol.localeCompare(b.symbol);
    });

    updateHeaderStats();
    renderScreenerList();
    renderContingencyDashboard();

    showOverlay(false);
    const topCount = state.matched.filter(m => m.levels?.grade === 'A+').length;
    toast(`Scan complete: ${state.matched.length} Setups (${topCount} 🌟 Top Picks)`, 'success');
  }

  function updateHeaderStats() {
    const topPicksCount = state.matched.filter(r => r.levels?.grade === 'A+').length;
    document.getElementById('stat-matched').textContent = state.matched.length;
    document.getElementById('stat-scanned').textContent = state.results.length;
    document.getElementById('stat-failed').textContent = state.results.length - state.matched.length;
    
    const now = new Date();
    document.getElementById('last-scan-time').textContent = `Last scan: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${topPicksCount} Top Picks`;
  }

  function renderScreenerList() {
    const listEl = document.getElementById('screener-list');
    listEl.innerHTML = '';

    let filtered = state.matched.filter(r => {
      // Trend Filter
      if (state.trendFilter !== 'all' && r.trend !== state.trendFilter) return false;
      // SMA Filter
      if (state.smaTrendFilter === 'above_sma20' && (!r.levels.isAboveSMA20 || r.trend !== 'bullish')) return false;
      if (state.smaTrendFilter === 'above_sma50' && (!r.levels.isAboveSMA50 || r.trend !== 'bullish')) return false;
      // Quality Filter
      if (state.qualityFilter === 'top_picks' && r.levels.grade !== 'A+') return false;
      if (state.qualityFilter === 'grade_b' && r.levels.grade !== 'A+' && r.levels.grade !== 'B') return false;
      // Search
      if (state.searchQuery) {
        const sym = r.symbol.toLowerCase();
        if (!sym.includes(state.searchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">No stocks match the selected Pro filters</div>`;
      return;
    }

    // Ensure selectedResult is set and matches first item if null or not in filtered
    if (!state.selectedResult || !filtered.includes(state.selectedResult)) {
      selectStock(filtered[0]);
    }

    filtered.forEach(res => {
      const isSelected = state.selectedResult && state.selectedResult.symbol === res.symbol;
      const lvl = res.levels;
      const isTopPick = lvl.grade === 'A+';
      const isGradeB = lvl.grade === 'B';

      const item = document.createElement('div');
      item.className = `screener-item ${isSelected ? 'selected' : ''} ${isTopPick ? 'card-top-pick' : ''}`;
      item.dataset.symbol = res.symbol;
      
      const shortSym = res.symbol.replace('.NS', '');
      const isBull = res.trend === 'bullish';
      const badgeClass = isBull ? 'badge-bull' : 'badge-bear';
      const chgClass = res.stats.changePct >= 0 ? 'chg-up' : 'chg-down';
      const chgSign = res.stats.changePct >= 0 ? '+' : '';
      
      const gradeBadgeClass = isTopPick ? 'badge-grade-a' : (isGradeB ? 'badge-grade-b' : 'badge-grade-c');
      const volSurgeBadge = lvl.volSurgeRatio >= 1.2 ? `<span class="badge-vol">⚡${lvl.volSurgeRatio}x Vol</span>` : '';

      item.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-symbol" style="display:flex;align-items:center;gap:5px;">
              ${shortSym}
              ${isTopPick ? '<span title="Top Pick (Grade A+)" style="font-size:11px;">🌟</span>' : ''}
            </div>
            <div class="item-company">${res.symbol}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
            <span class="item-badge ${badgeClass}">${res.trend.toUpperCase()}</span>
            <span class="item-grade-badge ${gradeBadgeClass}">${lvl.grade} (${lvl.qualityScore}/10)</span>
          </div>
        </div>
        <div class="item-bottom">
          <div class="item-price">₹${res.stats.latestClose.toFixed(2)}</div>
          <div class="item-chg ${chgClass}">
            ${chgSign}${res.stats.changePct}%
            ${volSurgeBadge}
          </div>
        </div>
        <div class="item-levels">
          <span class="lvl-sl">SL: ₹${lvl.sl}</span>
          <span class="lvl-tgt">TGT: ₹${lvl.t2}</span>
          <span class="lvl-pro">${lvl.tierLabel ? lvl.tierLabel.split(' ')[0] : 'Pro'} · 1:${lvl.t2Mult}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        selectStock(res);
      });

      listEl.appendChild(item);
    });
  }

  function selectStock(result) {
    state.selectedResult = result;
    if (!result || !result.allHACandles) return;

    // Highlight selected card in sidebar
    document.querySelectorAll('.screener-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.symbol === result.symbol);
    });

    chart.load(result.allHACandles, {
      rawCandles: result.allCandles,
      symbol: result.symbol,
      trend: result.trend,
      matchResult: result,
      sma20: result.sma20,
      sma50: result.sma50,
      highlightIndices: result.sequenceIndices
    });

    renderConditionStrip(result);
  }

  function renderConditionStrip(result) {
    const strip = document.getElementById('condition-strip');
    if (!strip) return;
    strip.style.display = 'flex';

    const qualityBox = document.getElementById('cond-quality-value');
    if (qualityBox && result.levels) {
      const lvl = result.levels;
      const isA = lvl.grade === 'A+';
      const col = isA ? '#f59e0b' : (lvl.grade === 'B' ? '#10b981' : '#94a3b8');
      qualityBox.innerHTML = `
        <span style="font-weight:800;color:${col};font-size:12px;">${lvl.grade} (${lvl.qualityScore}/10)</span>
        <div style="font-size:10px;color:var(--text-muted);">${lvl.volSurgeRatio}x 20D Vol</div>
      `;
    }

    ['c1', 'c2', 'c3'].forEach((k, idx) => {
      const box = document.getElementById(`cond-box-${idx + 1}`);
      const r = result.conditions[k];
      if (!box || !r) return;
      box.querySelector('.cond-value').textContent = r.pass ? 'PASSED' : 'FAILED';
      box.querySelector('.cond-value').style.color = r.pass ? 'var(--bull)' : 'var(--bear)';
    });

    const planBox = document.getElementById('cond-plan-value');
    if (planBox && result.levels) {
      const lvl = result.levels;
      planBox.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
          <span class="plan-pill entry">Entry: ₹${lvl.entry}</span>
          <span class="plan-pill sl">SL (${lvl.slRef}): ₹${lvl.sl} (-${lvl.currentRiskPct}%)</span>
          <span class="plan-pill tgt">T1 (1:${lvl.t1Mult || '1.0'}): ₹${lvl.t1}</span>
          <span class="plan-pill tgt">T2 (1:${lvl.t2Mult || '1.2'}): ₹${lvl.t2}</span>
          <span class="plan-pill pro">${lvl.tierLabel || 'Pro'}: 50-60% @ T1 ➔ BE SL (₹0 Risk) ➔ T2</span>
        </div>
      `;
    }
  }

  // ── Interactive Backtest Dashboard ────────────────────────────────
  function runBacktestDashboard() {
    const data = window.MARKET_DATA;
    if (!data) return;

    const trendFilter = document.getElementById('bt-trend-filter')?.value || 'all';
    const momMin = parseFloat(document.getElementById('bt-mom-filter')?.value || 1.0);

    const stats = BacktestEngine.runSimulation(data, {
      trendFilter,
      momentumMin: momMin,
      useTrailingSL: true,
      partialExitAtT1: true
    });

    // Populate Cards
    document.getElementById('bt-total-trades').textContent = stats.total;
    document.getElementById('bt-win-rate').textContent = `${stats.winRate}%`;
    document.getElementById('bt-profit-factor').textContent = stats.profitFactor;
    document.getElementById('bt-t1-rate').textContent = `${stats.t1HitRate}%`;
    document.getElementById('bt-avg-win').textContent = `+${stats.avgWin}%`;
    document.getElementById('bt-avg-loss').textContent = `-${stats.avgLoss}%`;

    // Populate Top Performing Stocks
    const topContainer = document.getElementById('bt-top-stocks');
    if (topContainer) {
      topContainer.innerHTML = stats.topStocks.map(s => `
        <span style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;font-size:11px;font-weight:700;">
          ${s.symbol}: <span style="color:var(--bull);">+${s.totalPnl}%</span>
        </span>
      `).join('');
    }

    // Populate Table
    const tbody = document.getElementById('bt-trades-tbody');
    if (tbody) {
      tbody.innerHTML = stats.trades.slice(0, 30).map((t, idx) => {
        const isWin = t.pnlPct > 0;
        const color = isWin ? 'var(--bull)' : 'var(--bear)';
        return `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${t.symbol}</strong></td>
            <td><span class="item-badge ${t.trend === 'bullish' ? 'badge-bull' : 'badge-bear'}">${t.trend.toUpperCase()}</span></td>
            <td>${t.entryDate}</td>
            <td>₹${t.entryPrice}</td>
            <td>₹${t.exitPrice}</td>
            <td><span style="font-weight:700;color:${color}">${t.pnlPct > 0 ? '+' : ''}${t.pnlPct}%</span></td>
            <td>${t.outcome}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // ── CSV Export ────────────────────────────────────────────────────
  function exportCSV() {
    if (!state.matched.length) { toast('No results to export', 'error'); return; }

    const bullish = state.matched.filter(r => r.trend === 'bullish');
    const bearish = state.matched.filter(r => r.trend === 'bearish');

    let csv = "BULLISH,,,,,,,,,,BEARISH,,,,,,,,,\n";
    csv += "Sr,Script,LTP,Lot size,Stop Loss,Target 1,Target 2,Risk %,Mom,Trend,Sr,Script,LTP,Lot size,Stop Loss,Target 1,Target 2,Risk %,Mom,Trend\n";

    const maxLen = Math.max(bullish.length, bearish.length);
    for (let i = 0; i < maxLen; i++) {
      let row = [];
      if (i < bullish.length) {
        const b = bullish[i];
        const lot = (typeof LOT_SIZES !== 'undefined' && LOT_SIZES[b.symbol]) ? LOT_SIZES[b.symbol] : '';
        const lvl = b.levels || {};
        row.push(i + 1, b.symbol.replace('.NS',''), b.stats.latestClose, lot, lvl.sl, lvl.t1, lvl.t2, `${lvl.currentRiskPct}%`, `${lvl.momentumRatio}x`, lvl.isAboveSMA20 ? 'Above 20 SMA' : 'Below 20 SMA');
      } else {
        row.push('', '', '', '', '', '', '', '', '', '');
      }

      if (i < bearish.length) {
        const b = bearish[i];
        const lot = (typeof LOT_SIZES !== 'undefined' && LOT_SIZES[b.symbol]) ? LOT_SIZES[b.symbol] : '';
        const lvl = b.levels || {};
        row.push(i + 1, b.symbol.replace('.NS',''), b.stats.latestClose, lot, lvl.sl, lvl.t1, lvl.t2, `${lvl.currentRiskPct}%`, `${lvl.momentumRatio}x`, lvl.isAboveSMA20 ? 'Above 20 SMA' : 'Below 20 SMA');
      } else {
        row.push('', '', '', '', '', '', '', '', '', '');
      }
      csv += row.join(',') + "\n";
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NSE_Pro_Screener_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast('Exported Pro CSV successfully!', 'success');
  }

  // ── Export Backtest Historical Trades to CSV ──────────────────────
  function exportBacktestCSV() {
    const data = window.MARKET_DATA;
    if (!data) { toast('Market data not loaded', 'error'); return; }

    const trendFilter = document.getElementById('bt-trend-filter')?.value || 'all';
    const momMin = parseFloat(document.getElementById('bt-mom-filter')?.value || 1.0);

    toast('Generating Backtest CSV...', 'info');

    const stats = BacktestEngine.runSimulation(data, {
      trendFilter,
      momentumMin: momMin,
      useTrailingSL: true,
      partialExitAtT1: true
    });

    if (!stats.trades || stats.trades.length === 0) {
      toast('No backtest trades found to export', 'error');
      return;
    }

    let csv = "Sr,Symbol,Trend,Entry Date,Exit Date,Entry Price,Initial SL,Target 1,Target 2,Exit Price,P&L %,Outcome,Bars Held,Momentum\n";

    stats.trades.forEach((t, idx) => {
      csv += [
        idx + 1,
        t.symbol,
        t.trend.toUpperCase(),
        t.entryDate,
        t.exitDate,
        t.entryPrice,
        t.initialSL,
        t.t1,
        t.t2,
        t.exitPrice,
        `${t.pnlPct}%`,
        t.outcome,
        t.barsHeld,
        `${t.momentum}x`
      ].join(',') + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NSE_Pro_Backtest_Trades_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast(`Exported ${stats.trades.length} Backtest Trades to CSV!`, 'success');
  }

  // ── Auto Refresh at 4:30 PM IST ──────────────────────────────────
  function scheduleAutoRefresh() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);
    const closeIST = new Date(nowIST);
    closeIST.setHours(16, 30, 0, 0); // 4:30 PM IST

    if (nowIST > closeIST) closeIST.setDate(closeIST.getDate() + 1);
    const msUntil = closeIST - nowIST;

    setTimeout(() => {
      toast('🔔 Auto-refreshing 4:30 PM IST data...', 'info');
      runScan(true);
      scheduleAutoRefresh();
    }, msUntil);
  }

  function showOverlay(show) {
    const ov = document.getElementById('scan-overlay');
    if (ov) ov.classList.toggle('hidden', !show);
  }

  function updateProgress(pct, msg) {
    const bar = document.getElementById('progress-bar');
    const txt = document.getElementById('progress-text');
    const ptxt = document.getElementById('progress-percent');
    if (bar) bar.style.width = `${pct}%`;
    if (txt) txt.textContent = msg;
    if (ptxt) ptxt.textContent = `${pct}% complete`;
  }

  // ── 9:10 AM Asymmetric Strategy Matrix Controller ─────────────
  function bindContingencyEvents() {
    const prevCloseInput = document.getElementById('matrix-prev-close');
    const niftyOpenInput = document.getElementById('matrix-nifty-open');
    const recalcBtn = document.getElementById('btn-recalc-matrix');

    prevCloseInput?.addEventListener('input', renderContingencyDashboard);
    niftyOpenInput?.addEventListener('input', renderContingencyDashboard);
    recalcBtn?.addEventListener('click', renderContingencyDashboard);

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const gap = parseFloat(btn.dataset.gap || 0);
        const prevCl = parseFloat(prevCloseInput?.value || 23431.50);
        if (niftyOpenInput) {
          niftyOpenInput.value = (prevCl + gap).toFixed(2);
          renderContingencyDashboard();
        }
      });
    });
  }

  function renderContingencyDashboard() {
    const prevClose = parseFloat(document.getElementById('matrix-prev-close')?.value || 23431.50);
    const niftyOpen = parseFloat(document.getElementById('matrix-nifty-open')?.value || 23431.50);
    const gapPts = parseFloat((niftyOpen - prevClose).toFixed(2));
    const gapPct = prevClose > 0 ? parseFloat(((gapPts / prevClose) * 100).toFixed(2)) : 0;

    const gapDisplay = document.getElementById('matrix-gap-display');
    if (gapDisplay) {
      const sign = gapPts >= 0 ? '+' : '';
      gapDisplay.textContent = `${sign}${gapPts.toFixed(2)} pts (${sign}${gapPct.toFixed(2)}%)`;
      gapDisplay.style.color = gapPts > 0 ? 'var(--bull)' : (gapPts < 0 ? 'var(--bear)' : 'var(--text-primary)');
    }

    if (!FilterEngine.getContingencyBasket) return;
    const matrix = FilterEngine.getContingencyBasket(gapPts, state.matched);

    // Update Banner
    const badge = document.getElementById('matrix-zone-badge');
    const title = document.getElementById('matrix-zone-title');
    const desc = document.getElementById('matrix-zone-desc');
    const alloc = document.getElementById('matrix-allocation-chip');

    if (badge) {
      badge.textContent = `ZONE ${matrix.zoneId}`;
      if (matrix.zoneId === 1) {
        badge.style.background = '#475569';
      } else if (matrix.zoneId === 2) {
        badge.style.background = '#ea580c';
      } else if (matrix.zoneId === 3) {
        badge.style.background = '#dc2626';
      } else if (matrix.zoneId === 4) {
        badge.style.background = '#0284c7';
      } else {
        badge.style.background = '#16a34a';
      }
    }

    if (title) title.textContent = matrix.zoneName;
    if (desc) desc.textContent = matrix.zoneDesc;
    if (alloc) alloc.textContent = `Allocation: ${matrix.allocation}`;

    // Render Orders Table
    const tbody = document.getElementById('matrix-orders-tbody');
    const countSpan = document.getElementById('matrix-orders-count');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countSpan) countSpan.textContent = `${matrix.basket.length} Orders Prepared`;

    if (matrix.basket.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--text-muted);">No setups qualified for today's market condition. Stand down in Cash.</td></tr>`;
      return;
    }

    matrix.basket.forEach((item, idx) => {
      const isBuy = item.trend === 'bullish';
      const isHedge = item.basketRole === 'hedge';
      const lvl = item.levels || {};
      const stats = item.stats || {};
      const meta = item.meta || { name: item.symbol, sector: 'NSE' };

      const tr = document.createElement('tr');
      tr.style.background = isHedge ? 'rgba(251,191,36,0.08)' : (idx % 2 === 0 ? '#ffffff' : 'var(--bg-tertiary)');

      tr.innerHTML = `
        <td style="font-weight:800;color:var(--text-primary);">${item.symbol.replace('.NS','')}</td>
        <td style="color:var(--text-secondary);">${meta.name || ''}</td>
        <td>
          <span style="font-weight:800;padding:2px 8px;border-radius:4px;font-size:11px;background:${isBuy ? 'rgba(16,185,129,0.15)' : 'rgba(239,83,80,0.15)'};color:${isBuy ? 'var(--bull)' : 'var(--bear)'};">
            ${isBuy ? 'BUY' : 'SELL'}
          </span>
        </td>
        <td>
          <span style="font-weight:700;font-size:11px;${isHedge ? 'color:#d97706;' : 'color:var(--text-primary);'}">
            ${isHedge ? '🛡️ ' + item.role : item.role}
          </span>
        </td>
        <td style="text-align:center;font-weight:700;">${item.qualityScore || 8}/10</td>
        <td style="text-align:center;">
          <span style="font-size:11px;font-weight:700;color:${FilterEngine.isSweetSpotSetup(item) ? '#d97706' : 'var(--text-secondary)'};">
            ${stats.volSurgeRatio ? stats.volSurgeRatio + 'x' : '1.0x'} ${FilterEngine.isSweetSpotSetup(item) ? '⚡ SS' : ''}
          </span>
        </td>
        <td style="font-weight:800;color:var(--text-primary);">₹${(lvl.entry || 0).toFixed(2)}</td>
        <td style="font-weight:700;color:var(--bear);">₹${(lvl.sl || 0).toFixed(2)}</td>
        <td style="font-weight:700;color:var(--bull);">₹${(lvl.t1 || 0).toFixed(2)}</td>
        <td style="font-weight:700;color:var(--bull);">₹${(lvl.t2 || 0).toFixed(2)}</td>
        <td style="text-align:center;font-weight:700;color:var(--bear);">${(lvl.currentRiskPct || 1.5).toFixed(2)}%</td>
        <td style="text-align:center;font-weight:700;color:var(--text-muted);">${lvl.rr || '1:1.5'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.style.cssText = `
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef5350' : '#3b82f6'};
      color: #ffffff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 6px; transition: all 0.2s;
    `;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }

})();

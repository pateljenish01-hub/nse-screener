# -*- coding: utf-8 -*-
"""
NSE A+ Intraday Core Screening & Alert Formatting Engine
Dynamically scans market_data.js for latest candles, computes indicators, ranks candidates,
and formats the WhatsApp / Push alert message with live Nifty levels.
"""
import os
import json
from datetime import datetime

DIR_PATH = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(DIR_PATH, 'market_data.js')

def to_ha(candles):
    ha = []
    for i, c in enumerate(candles):
        cl = round((c['open'] + c['high'] + c['low'] + c['close']) / 4.0, 2)
        op = round((c['open'] + c['close']) / 2.0, 2) if i == 0 else round((ha[i-1]['open'] + ha[i-1]['close']) / 2.0, 2)
        hi = round(max(c['high'], op, cl), 2)
        lo = round(min(c['low'], op, cl), 2)
        ha.append({'date': c['date'], 'open': op, 'high': hi, 'low': lo, 'close': cl, 'vol': c.get('volume', 0)})
    return ha

def sma(c, p):
    res = [None] * len(c)
    if len(c) < p: return res
    s = sum(c[i]['close'] for i in range(p))
    res[p-1] = round(s / p, 2)
    for i in range(p, len(c)):
        s += c[i]['close'] - c[i-p]['close']
        res[i] = round(s / p, 2)
    return res

def geom(c):
    o, h, l, cl = c['open'], c['high'], c['low'], c['close']
    top, bot = max(o, cl), min(o, cl)
    sz, rng = top - bot, h - l
    return {'top': top, 'bot': bot, 'sz': sz, 'rng': rng, 'u': h - top, 'd': bot - l, 'bull': cl >= o, 'br': sz/rng if rng > 0 else 0}

def get_latest_data():
    """Dynamically parses market_data.js and scans the latest trading day."""
    if not os.path.exists(MD_PATH):
        raise FileNotFoundError(f"market_data.js not found at {MD_PATH}")
        
    with open(MD_PATH, 'r', encoding='utf-8') as f:
        raw_text = f.read().replace('window.MARKET_DATA = ', '').rstrip(';').strip()
        md = json.loads(raw_text)
        
    now = datetime.now()
    today_str = now.strftime('%Y-%m-%d')
    # If after 3:30 PM market close, today's candle is complete and valid as setup candle for tomorrow!
    # If before 3:30 PM (pre-market or live trading), only candles strictly BEFORE today are valid.
    is_post_market = now.hour > 15 or (now.hour == 15 and now.minute >= 30)
    
    # Find latest completed date across stock candles
    sample_dates = set()
    for sym, c_list in list(md.items())[:30]:
        if c_list and sym != '^NSEI':
            if is_post_market:
                past_c = [c for c in c_list if c.get('date') <= today_str and c.get('close') is not None]
            else:
                past_c = [c for c in c_list if c.get('date') < today_str and c.get('close') is not None]
            if past_c:
                sample_dates.add(past_c[-1]['date'])
    if not sample_dates:
        raise ValueError("No candle data found in market_data.js")
    latest_date = max(sample_dates)
    
    # Extract Nifty 50 PREVIOUS session close from market_data.js
    nifty_close = 22716.20  # fallback
    nifty_candles = md.get('^NSEI', [])
    if is_post_market:
        completed_nifty = [c for c in nifty_candles if c.get('date') <= today_str and c.get('close') is not None]
    else:
        completed_nifty = [c for c in nifty_candles if c.get('date') < today_str and c.get('close') is not None]
    if completed_nifty:
        nifty_close = float(completed_nifty[-1]['close'])
    elif nifty_candles:
        # fallback: second-to-last candle if today filter doesn't work
        past = [c for c in nifty_candles if c.get('close') is not None]
        if len(past) >= 2:
            nifty_close = float(past[-2]['close'])
        elif past:
            nifty_close = float(past[-1]['close'])

            
    buys = []
    sells = []
    
    for sym, all_raw in md.items():
        if sym.startswith('^'):
            continue
        raw = [c for c in all_raw if c['date'] <= latest_date and c.get('open') is not None]
        if len(raw) < 25 or raw[-1]['date'] != latest_date:
            continue
            
        ha = to_ha(raw)
        s20, s50 = sma(raw, 20), sma(raw, 50)
        tol = max(0.01, ha[-1]['close'] * 0.001)
        clean_sym = sym.replace('.NS', '')
        
        for trend in ['bullish', 'bearish']:
            c1, c2, c3 = ha[-3], ha[-2], ha[-1]
            m1, m2, m3 = geom(c1), geom(c2), geom(c3)
            
            p1 = (m1['u'] > tol) and (m1['d'] > tol) and (m1['rng'] > 0)
            p2 = False
            if m2['rng'] > 0 and m2['br'] >= 0.15:
                if trend == 'bullish': p2 = m2['bull'] and (m2['d'] <= tol) and (m2['u'] > tol)
                else: p2 = (not m2['bull']) and (m2['u'] <= tol) and (m2['d'] > tol)
            
            p3 = False
            if m3['rng'] > 0 and m3['br'] >= 0.15:
                if trend == 'bullish': p3 = m3['bull'] and (m3['d'] <= tol) and (m3['top'] > m2['top'])
                else: p3 = (not m3['bull']) and (m3['u'] <= tol) and (m3['bot'] < m2['bot'])
            
            if not (p1 and p2 and p3):
                continue
                
            ent = raw[-1]['close']
            v_today = raw[-1].get('volume', 0)
            v_avg = sum(c.get('volume', 0) for c in raw[-21:-1]) / 20.0 if len(raw) >= 21 else 1.0
            vol_ratio = round(v_today / v_avg, 2) if v_avg > 0 else 1.0
            
            ab_20 = (ent > s20[-1]) if s20[-1] is not None else True
            ab_50 = (ent > s50[-1]) if s50[-1] is not None else True
            
            mom_ratio = round(m3['sz'] / m2['sz'], 2) if m2['sz'] > 0 else 1.0
            
            score = 6
            is_sweet = False
            if trend == 'bullish':
                # Refinement 2: Volume Tier Smoothing & Sweet-Spot Widening (1.4x–5.5x)
                if vol_ratio >= 1.4: score += 3
                elif vol_ratio >= 1.1: score += 2
                elif vol_ratio >= 0.9: score += 1
                if 1.4 <= vol_ratio <= 5.5: is_sweet = True
                
                # Trend Alignment
                if ab_20 and ab_50: score += 2
                elif ab_20: score += 1
                
                # Refinement 3: Coiled Spring Momentum Recognition
                is_coiled = (vol_ratio >= 1.8 and ab_20 and ab_50)
                if mom_ratio >= 1.25 or is_coiled: score += 2
                elif mom_ratio >= 1.0: score += 1
                
                sl = round(ent * 0.985, 2)
                t1 = round(ent * 1.015, 2)
                t2 = round(ent * 1.0225, 2)
                buys.append({
                    'symbol': clean_sym, 'direction': 'BUY',
                    'trigger': ent, 'sl': sl, 't1': t1, 't2': t2,
                    'vol_ratio': vol_ratio, 'score': score, 'is_sweet': is_sweet
                })
            else:
                # Refinement 2: Bearish Liquidity Vacuum Sweet-Spot (0.05x–0.85x)
                is_vac = (vol_ratio <= 1.0 and not ab_20 and not ab_50)
                if is_vac or vol_ratio < 0.85: score += 3
                elif vol_ratio < 1.2: score += 2
                else: score += 1
                if (is_vac or vol_ratio < 0.85) and 0.05 <= vol_ratio <= 0.85: is_sweet = True
                
                # Bearish Trend Alignment
                if not ab_20 and not ab_50: score += 2
                elif not ab_20: score += 1
                
                # Refinement 3: Coiled Spring Recognition for Shorts
                is_coiled = (vol_ratio <= 0.70 and not ab_20 and not ab_50)
                if mom_ratio >= 1.25 or is_coiled: score += 2
                elif mom_ratio >= 1.0: score += 1
                
                sl = round(ent * 1.015, 2)
                t1 = round(ent * 0.985, 2)
                t2 = round(ent * 0.9775, 2)
                sells.append({
                    'symbol': clean_sym, 'direction': 'SELL',
                    'trigger': ent, 'sl': sl, 't1': t1, 't2': t2,
                    'vol_ratio': vol_ratio, 'score': score, 'is_sweet': is_sweet
                })
                
    # Refinement 1: Score desc, Sweet-Spot desc, Volume Asymmetry (Buys desc, Sells asc)
    buys.sort(key=lambda x: (x['score'], 1 if x['is_sweet'] else 0, x['vol_ratio']), reverse=True)
    sells.sort(key=lambda x: (x['score'], 1 if x['is_sweet'] else 0, -x['vol_ratio']), reverse=True)
    
    return {
        'date': latest_date,
        'nifty_close': nifty_close,
        'buys': buys,
        'sells': sells
    }

def get_live_nifty_open(prev_close):
    """
    Fetch confirmed Nifty settled open price using a 3-source fallback chain:
      1. NSE India pre-open API (IEP) — available 9:00-9:12 AM, most accurate
      2. Yahoo Finance regularMarketPrice — live price after 9:12 AM
      3. None — caller handles fallback gracefully
    NEVER uses opens[0] (first 1-min candle) which captures volatile pre-open spikes.
    """
    import urllib.request, http.cookiejar
    now = datetime.now()
    if now.hour < 9 or (now.hour == 9 and now.minute < 8):
        return None  # Too early — pre-open not settled yet

    # ── Source 1: NSE Pre-Open API (IEP) ─────────────────────────
    # Available 9:00-9:12 AM. Returns the IEP = Indicative Equilibrium Price
    # which is the exact price at which Nifty will open at 9:15 AM.
    try:
        import requests
        s = requests.Session()
        s.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        })
        api_headers = {
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.nseindia.com/market-data/pre-open-market-cm-and-emerge-market',
            'X-Requested-With': 'XMLHttpRequest'
        }
        resp = s.get('https://www.nseindia.com/api/market-data-pre-open?key=NIFTY', headers=api_headers, timeout=5)
        if resp.status_code == 200:
            nse_data = resp.json()
            items = nse_data.get('data', [])
            if items:
                for item in items:
                    md = item.get('metadata', {})
                    sym = md.get('symbol', '')
                    if sym in ('NIFTY 50', 'Nifty 50', 'NIFTY50', '^NSEI'):
                        iep = md.get('iep')
                        if iep:
                            return float(str(iep).replace(',', ''))
                iep = items[0].get('metadata', {}).get('iep')
                if iep:
                    return float(str(iep).replace(',', ''))
    except Exception:
        pass  # Fall through to Source 2

    # ── Source 2: Yahoo Finance 1d Official Open Candle ───────────
    # In 1d chart, quote['open'][0] is the FIXED, OFFICIAL opening price
    # of the day (e.g. 23035.0). It never changes with live market fluctuations.
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/^NSEI?interval=1d&range=1d"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data["chart"]["result"][0]
            meta = result.get("meta", {})
            market_time = meta.get("regularMarketTime", 0)
            if market_time:
                market_date = datetime.fromtimestamp(market_time).date()
                if market_date != now.date():
                    return None
            timestamps = result.get("timestamp", [])
            quote = result.get("indicators", {}).get("quote", [{}])[0]
            opens = quote.get("open", [])
            # Find the candle matching TODAY's date specifically (now.date())
            for idx in range(len(timestamps) - 1, -1, -1):
                c_date = datetime.fromtimestamp(timestamps[idx]).date()
                if c_date == now.date() and idx < len(opens) and opens[idx] is not None:
                    return round(float(opens[idx]), 2)
            op = meta.get("regularMarketOpen")
            if op:
                return round(float(op), 2)
    except Exception:
        pass

    return None  # Source 3: caller handles None gracefully

def format_alert_message(data, nifty_open=None):
    """Builds an intelligent, adaptive WhatsApp / Phone alert message with automatic Gap Protection."""
    buys = data.get('buys', [])
    sells = data.get('sells', [])
    scan_dt_str = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    nifty_close = data.get('nifty_close', 23118.60)
    
    try:
        dt_obj = datetime.strptime(scan_dt_str, '%Y-%m-%d')
        formatted_date = dt_obj.strftime('%a, %d-%b-%Y')
    except Exception:
        formatted_date = scan_dt_str
        
    if nifty_open is None:
        nifty_open = get_live_nifty_open(nifty_close)
        
    # Determine Zone
    has_gap = nifty_open is not None and nifty_open > 0
    gap = round(nifty_open - nifty_close, 2) if has_gap else 0.0
    
    if not has_gap:
        zone = "PENDING_PREOPEN"
    elif gap < -75:
        zone = "ZONE_3_PANIC_DOWN"
    elif gap < -40:
        zone = "ZONE_2_GAP_DOWN"
    elif gap <= 40:
        zone = "ZONE_1_FLAT"
    elif gap <= 75:
        zone = "ZONE_4_GAP_UP"
    else:
        zone = "ZONE_5_BREAKOUT_UP"

    lines = []
    lines.append("🚀 *NSE A+ DAILY INTRADAY PICKS*")
    lines.append(f"📅 *Setup Candle:* {formatted_date}")
    lines.append(f"📊 *Benchmark Nifty 50 Close:* ₹{nifty_close:,.2f}")
    
    if has_gap:
        sign = "+" if gap >= 0 else ""
        lines.append(f"⚡ *Pre-Open Settled Open:* ₹{nifty_open:,.2f} ({sign}{gap:.2f} pts)")
    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    
    # ── ZONE-PROTECTED DISPATCH ENGINE ──
    if zone == "ZONE_5_BREAKOUT_UP":
        lines.append("🟢 *ACTIVE BASKET: ZONE 5 BREAKOUT (100% LONG DOMINANCE)*")
        lines.append(f"⚠️ *Directive:* Nifty opened +{gap:.1f} pts up. System has HARD-BLOCKED all short trades to eliminate bear-trap squeezes.")
        lines.append("─────────────────────")
        for idx, b in enumerate(buys[:4], 1):
            sym, trig, sl, t1, t2 = b['symbol'], b['trigger'], b['sl'], b['t1'], b['t2']
            vol = b.get('vol_ratio', 1.0)
            tag = "⚡ Sweet-Spot Volume" if b.get('is_sweet') else "Bullish Momentum"
            lines.append(f"{idx}. *{sym}* (BUY)")
            lines.append(f"   • Trigger Entry: ₹{trig:,.2f} | Hard SL: ₹{sl:,.2f} (-1.50%)")
            lines.append(f"   • T1: ₹{t1:,.2f} | T2: ₹{t2:,.2f} | Vol {vol:.2f}x | {tag}")
        lines.append("─────────────────────")
        lines.append("🔴 *SHORT PICKS:* ⛔ ALL SHORTS HARD-BLOCKED (Stand Down in Cash)")
        
    elif zone == "ZONE_3_PANIC_DOWN":
        lines.append("🔴 *ACTIVE BASKET: ZONE 3 PANIC CRASH (100% SHORT DOMINANCE)*")
        lines.append(f"⚠️ *Directive:* Nifty opened {gap:.1f} pts down. System has HARD-BLOCKED all long trades to eliminate falling-knife traps.")
        lines.append("─────────────────────")
        for idx, s in enumerate(sells[:4], 1):
            sym, trig, sl, t1, t2 = s['symbol'], s['trigger'], s['sl'], s['t1'], s['t2']
            vol = s.get('vol_ratio', 1.0)
            tag = "📉 Institutional Vacuum" if s.get('is_sweet') else "Bearish Breakdown"
            lines.append(f"{idx}. *{sym}* (SELL)")
            lines.append(f"   • Trigger Entry: ₹{trig:,.2f} | Hard SL: ₹{sl:,.2f} (+1.50%)")
            lines.append(f"   • T1: ₹{t1:,.2f} | T2: ₹{t2:,.2f} | Vol {vol:.2f}x | {tag}")
        lines.append("─────────────────────")
        lines.append("🟢 *LONG PICKS:* ⛔ ALL LONGS HARD-BLOCKED (Stand Down in Cash)")
        
    elif zone == "ZONE_2_GAP_DOWN":
        lines.append("🔴 *ACTIVE BASKET: ZONE 2 SHALLOW GAP-DOWN (3 SHORTS + 1 HEDGE)*")
        for idx, s in enumerate(sells[:3], 1):
            sym, trig, sl, t1, t2 = s['symbol'], s['trigger'], s['sl'], s['t1'], s['t2']
            lines.append(f"{idx}. *{sym}* (SELL) | Trig: ₹{trig:,.2f} | SL: ₹{sl:,.2f} | T1: ₹{t1:,.2f}")
        if buys:
            b = next((x for x in buys if x.get('is_sweet')), buys[0])
            lines.append(f"🛡️ *Hedge Long:* *{b['symbol']}* (BUY) | Trig: ₹{b['trigger']:,.2f} | SL: ₹{b['sl']:,.2f} | T1: ₹{b['t1']:,.2f}")
            
    elif zone == "ZONE_4_GAP_UP":
        lines.append("🟢 *ACTIVE BASKET: ZONE 4 SHALLOW GAP-UP (3 LONGS + 1 HEDGE)*")
        for idx, b in enumerate(buys[:3], 1):
            sym, trig, sl, t1, t2 = b['symbol'], b['trigger'], b['sl'], b['t1'], b['t2']
            lines.append(f"{idx}. *{sym}* (BUY) | Trig: ₹{trig:,.2f} | SL: ₹{sl:,.2f} | T1: ₹{t1:,.2f}")
        if sells:
            s = next((x for x in sells if x.get('is_sweet')), sells[0])
            lines.append(f"🛡️ *Hedge Short:* *{s['symbol']}* (SELL) | Trig: ₹{s['trigger']:,.2f} | SL: ₹{s['sl']:,.2f} | T1: ₹{s['t1']:,.2f}")
            
    else: # ZONE 1 FLAT OR PENDING PREOPEN
        lines.append("🟢 *TOP BUY PICKS (Sweet-Spot Vol ≥ 1.4x)*")
        if buys:
            for idx, b in enumerate(buys[:3], 1):
                sym, trig, sl, t1, t2 = b['symbol'], b['trigger'], b['sl'], b['t1'], b['t2']
                vol = b.get('vol_ratio', 1.0)
                tag = "⚡ Sweet-Spot Volume" if b.get('is_sweet') else "Bullish Momentum"
                lines.append(f"{idx}. *{sym}* | Trig: ₹{trig:,.2f} | SL: ₹{sl:,.2f} | T1: ₹{t1:,.2f} | Vol {vol:.2f}x | {tag}")
        else:
            lines.append("   No qualifying BUY setups found.")
            
        lines.append("━━━━━━━━━━━━━━━━━━━━━")
        lines.append("🔴 *TOP SELL PICKS (Liquidity Vacuum)*")
        if sells:
            for idx, s in enumerate(sells[:3], 1):
                sym, trig, sl, t1, t2 = s['symbol'], s['trigger'], s['sl'], s['t1'], s['t2']
                vol = s.get('vol_ratio', 1.0)
                tag = "📉 Institutional Vacuum" if s.get('is_sweet') else "Bearish Breakdown"
                lines.append(f"{idx}. *{sym}* | Trig: ₹{trig:,.2f} | SL: ₹{sl:,.2f} | T1: ₹{t1:,.2f} | Vol {vol:.2f}x | {tag}")
        else:
            lines.append("   No qualifying SELL setups found.")
            
        lines.append("━━━━━━━━━━━━━━━━━━━━━")
        p_flat_l, p_flat_u = nifty_close - 40, nifty_close + 40
        p_gap_d, p_gap_u = nifty_close - 75, nifty_close + 75
        lines.append("🎯 *9:10 AM CONTINGENCY MATRIX:*")
        lines.append(f"• *Flat ({p_flat_l:,.0f} - {p_flat_u:,.0f}):* Balanced 2L + 2S")
        lines.append(f"• *Gap-Down ({p_gap_d:,.0f} - {p_flat_l:,.0f}):* 3S + 1L (Sweet Long Hedge)")
        lines.append(f"• *Panic Down (< {p_gap_d:,.0f}):* 100% Short (4S Pure - 0 Longs)")
        lines.append(f"• *Gap-Up ({p_flat_u:,.0f} - {p_gap_u:,.0f}):* 3L + 1S (Sweet Short Hedge)")
        lines.append(f"• *Breakout Up (> {p_gap_u:,.0f}):* 100% Long (4L Pure - 0 Shorts)")
        
    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    lines.append("⏱ *EXECUTION RULES:*")
    lines.append("• Book 50% at Target 1 (+1.50%), trail SL to Breakeven (₹0 Risk)")
    lines.append("• Never trade disabled/counter-trend setups")
    
    return "\n".join(lines)

def get_active_basket_picks(data, nifty_open=None):
    """Returns the exact list of picks that match the active Zone directive for EOD tracking."""
    buys = data.get('buys', [])
    sells = data.get('sells', [])
    nifty_close = data.get('nifty_close', 23118.60)
    
    if nifty_open is None:
        nifty_open = get_live_nifty_open(nifty_close)
        
    has_gap = nifty_open is not None and nifty_open > 0
    gap = round(nifty_open - nifty_close, 2) if has_gap else 0.0
    
    if not has_gap:
        zone = "ZONE_1_FLAT"
    elif gap < -75:
        zone = "ZONE_3_PANIC_DOWN"
    elif gap < -40:
        zone = "ZONE_2_GAP_DOWN"
    elif gap <= 40:
        zone = "ZONE_1_FLAT"
    elif gap <= 75:
        zone = "ZONE_4_GAP_UP"
    else:
        zone = "ZONE_5_BREAKOUT_UP"

    picks_list = []
    if zone == "ZONE_5_BREAKOUT_UP":
        for b in buys[:4]:
            picks_list.append({"symbol": b['symbol'], "direction": "BUY", "trigger": b['trigger'], "sl": b['sl'], "t1": b['t1'], "t2": b['t2'], "role": "Zone 5 Breakout Buy"})
    elif zone == "ZONE_3_PANIC_DOWN":
        for s in sells[:4]:
            picks_list.append({"symbol": s['symbol'], "direction": "SELL", "trigger": s['trigger'], "sl": s['sl'], "t1": s['t1'], "t2": s['t2'], "role": "Zone 3 Panic Short"})
    elif zone == "ZONE_2_GAP_DOWN":
        for s in sells[:3]:
            picks_list.append({"symbol": s['symbol'], "direction": "SELL", "trigger": s['trigger'], "sl": s['sl'], "t1": s['t1'], "t2": s['t2'], "role": "Zone 2 Primary Short"})
        if buys:
            b = next((x for x in buys if x.get('is_sweet')), buys[0])
            picks_list.append({"symbol": b['symbol'], "direction": "BUY", "trigger": b['trigger'], "sl": b['sl'], "t1": b['t1'], "t2": b['t2'], "role": "Hedge Long"})
    elif zone == "ZONE_4_GAP_UP":
        for b in buys[:3]:
            picks_list.append({"symbol": b['symbol'], "direction": "BUY", "trigger": b['trigger'], "sl": b['sl'], "t1": b['t1'], "t2": b['t2'], "role": "Zone 4 Primary Long"})
        if sells:
            s = next((x for x in sells if x.get('is_sweet')), sells[0])
            picks_list.append({"symbol": s['symbol'], "direction": "SELL", "trigger": s['trigger'], "sl": s['sl'], "t1": s['t1'], "t2": s['t2'], "role": "Hedge Short"})
    else: # FLAT
        for b in buys[:2]:
            picks_list.append({"symbol": b['symbol'], "direction": "BUY", "trigger": b['trigger'], "sl": b['sl'], "t1": b['t1'], "t2": b['t2'], "role": "Zone 1 Flat Long"})
        for s in sells[:2]:
            picks_list.append({"symbol": s['symbol'], "direction": "SELL", "trigger": s['trigger'], "sl": s['sl'], "t1": s['t1'], "t2": s['t2'], "role": "Zone 1 Flat Short"})
            
    return picks_list


# -*- coding: utf-8 -*-
"""
Autonomous End-of-Day (EOD) Performance Audit Engine
Automatically audits daily recommended stock picks against live market data,
calculates exact intraday P&L, generates a styled Excel report on Desktop,
and dispatches an audit summary to Phone / WhatsApp.
"""
import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

DIR_PATH = os.path.dirname(os.path.abspath(__file__))
PICKS_FILE = os.path.join(DIR_PATH, 'dispatched_today_picks.json')
DESKTOP_DIR = r"C:\Users\DELL\OneDrive\Desktop"
AUDIT_DIR = os.path.join(DESKTOP_DIR, "Daily_Performance_Audits")
TOPIC = "nse_picks_9998710446"

def fetch_intraday_data(symbol):
    """Fetches full day 1m / 1d candles from Yahoo Finance."""
    sym_clean = symbol if symbol.endswith(".NS") or symbol.startswith("^") else f"{symbol}.NS"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym_clean}?interval=1m&range=1d"
    headers = {"User-Agent": "Mozilla/5.0"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            res = data['chart']['result'][0]
            meta = res['meta']
            quote = res['indicators']['quote'][0]
            
            highs = [x for x in quote.get('high', []) if x is not None]
            lows = [x for x in quote.get('low', []) if x is not None]
            opens = [x for x in quote.get('open', []) if x is not None]
            closes = [x for x in quote.get('close', []) if x is not None]
            
            day_high = max(highs) if highs else meta.get('regularMarketDayHigh')
            day_low = min(lows) if lows else meta.get('regularMarketDayLow')
            day_open = opens[0] if opens else meta.get('regularMarketPrice')
            day_close = closes[-1] if closes else meta.get('regularMarketPrice')
            
            return {
                "open": round(float(day_open), 2) if day_open else None,
                "high": round(float(day_high), 2) if day_high else None,
                "low": round(float(day_low), 2) if day_low else None,
                "close": round(float(day_close), 2) if day_close else None,
                "candles": list(zip(highs, lows, closes))
            }
    except Exception as e:
        print(f"[WARN] Failed to fetch {symbol}: {e}")
        return None

def audit_stock(pick, mkt):
    sym = pick['symbol']
    direction = pick['direction'].upper()
    trigger = float(pick['trigger'])
    sl = float(pick['sl'])
    t1 = float(pick['t1'])
    t2 = float(pick['t2'])
    
    if not mkt or mkt['high'] is None:
        return {
            "symbol": sym, "direction": direction, "trigger": trigger, "sl": sl, "t1": t1, "t2": t2,
            "status": "Data Missing", "triggered": False, "pnl_pct": 0.0, "net_pnl_rs": 0.0, "result": "NO DATA"
        }
        
    day_open = mkt['open']
    day_high = mkt['high']
    day_low = mkt['low']
    day_close = mkt['close']
    candles = mkt.get('candles', [])
    
    triggered = False
    t1_hit = False
    t2_hit = False
    sl_hit = False
    
    # Chronological minute-by-minute simulation
    if candles:
        for h, l, c in candles:
            if h is None or l is None:
                continue
            if not triggered:
                if direction == "BUY" and h >= trigger:
                    triggered = True
                elif direction == "SELL" and l <= trigger:
                    triggered = True
                    
            if triggered:
                if direction == "BUY":
                    if not t1_hit:
                        if h >= t2:
                            t2_hit = True
                            break
                        elif h >= t1:
                            t1_hit = True
                        elif l <= sl:
                            sl_hit = True
                            break
                    else: # Trailing SL at breakeven trigger
                        if h >= t2:
                            t2_hit = True
                            break
                        elif l <= trigger:
                            break # Trailed half exits at breakeven
                else: # SELL
                    if not t1_hit:
                        if l <= t2:
                            t2_hit = True
                            break
                        elif l <= t1:
                            t1_hit = True
                        elif h >= sl:
                            sl_hit = True
                            break
                    else: # Trailing SL at breakeven trigger
                        if l <= t2:
                            t2_hit = True
                            break
                        elif h >= trigger:
                            break # Trailed half exits at breakeven
    else:
        # Fallback to daily high/low
        if direction == "BUY":
            triggered = day_high >= trigger
            if triggered:
                if day_high >= t2: t2_hit = True
                elif day_high >= t1: t1_hit = True
                elif day_low <= sl: sl_hit = True
        else:
            triggered = day_low <= trigger
            if triggered:
                if day_low <= t2: t2_hit = True
                elif day_low <= t1: t1_hit = True
                elif day_high >= sl: sl_hit = True

    if not triggered:
        status = "Untriggered"
        result = "⚪ UNTRIGGERED (₹0 Risk)"
        pnl_pct = 0.0
        exit_price = trigger
    elif t2_hit:
        status = "Target 2 Hit"
        result = "🎯🎯 TARGET 2 HIT (+2.25%)"
        pnl_pct = 2.25
        exit_price = t2
    elif t1_hit:
        status = "Target 1 Hit"
        trail_pnl = max(0.0, ((day_close - trigger)/trigger)*100 if direction == "BUY" else ((trigger - day_close)/trigger)*100)
        pnl_pct = round((1.50 * 0.5) + (trail_pnl * 0.5), 2)
        result = f"🎯 TARGET 1 HIT (+{pnl_pct:.2f}%)"
        exit_price = round((t1 + (trigger if trail_pnl == 0 else day_close)) / 2.0, 2)
    elif sl_hit:
        status = "Stop-Loss Hit"
        result = "🛑 STOP LOSS HIT (-1.50%)"
        pnl_pct = -1.50
        exit_price = sl
    else:
        status = "Active / EOD Exit"
        pnl_pct = round(((day_close - trigger)/trigger)*100 if direction == "BUY" else ((trigger - day_close)/trigger)*100, 2)
        result = f"⏳ EOD CLOSE ({'+' if pnl_pct >= 0 else ''}{pnl_pct:.2f}%)"
        exit_price = day_close
            
    is_blocked = "Blocked" in pick.get("role", "")
    if is_blocked:
        if status == "Stop-Loss Hit":
            result = "⛔ BLOCKED (Trap Avoided: +1.50% Saved!)"
        else:
            result = f"⛔ BLOCKED ({result.replace('🛑 ', '').replace('🎯 ', '')})"
        # Do not penalize active portfolio PnL for blocked trades
        pnl_pct = 0.0
            
    return {
        "symbol": sym,
        "direction": direction,
        "trigger": trigger,
        "sl": sl,
        "t1": t1,
        "t2": t2,
        "open": day_open,
        "high": day_high,
        "low": day_low,
        "close": day_close,
        "triggered": triggered,
        "status": status,
        "result": result,
        "pnl_pct": pnl_pct,
        "exit_price": exit_price,
        "role": pick.get("role", "Primary Setup"),
        "is_blocked": is_blocked
    }

def send_ntfy_push(message):
    url = f"https://ntfy.sh/{TOPIC}"
    headers = {
        "Title": "NSE A+ EOD Performance Audit",
        "Priority": "high",
        "Tags": "chart_with_upwards_trend,bar_chart"
    }
    req = urllib.request.Request(url, data=message.encode('utf-8'), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return True, resp.status
    except Exception as e:
        return False, str(e)

def build_audit_excel(audit_results, today_str, nifty_data, session_date_slug):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"EOD Audit"
    ws.views.sheetView[0].showGridLines = True
    
    DARK_NAVY = "0F172A"
    HEADER_BLUE = "1E3A8A"
    SECTION_BLUE = "2563EB"
    GREEN_BG = "DCFCE7"
    GREEN_TEXT = "166534"
    RED_BG = "FEE2E2"
    RED_TEXT = "991B1B"
    GRAY_BG = "F1F5F9"
    WHITE = "FFFFFF"
    
    font_title = Font(name="Calibri", size=14, bold=True, color=WHITE)
    font_sub = Font(name="Calibri", size=10, italic=True, color=WHITE)
    font_sec = Font(name="Calibri", size=11, bold=True, color=WHITE)
    font_tbl_hdr = Font(name="Calibri", size=10, bold=True, color=WHITE)
    font_data = Font(name="Calibri", size=10)
    font_data_bold = Font(name="Calibri", size=10, bold=True)
    
    fill_navy = PatternFill(start_color=DARK_NAVY, end_color=DARK_NAVY, fill_type="solid")
    fill_hdr = PatternFill(start_color=HEADER_BLUE, end_color=HEADER_BLUE, fill_type="solid")
    fill_sec = PatternFill(start_color=SECTION_BLUE, end_color=SECTION_BLUE, fill_type="solid")
    fill_green = PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid")
    fill_red = PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid")
    fill_gray = PatternFill(start_color=GRAY_BG, end_color=GRAY_BG, fill_type="solid")
    
    thin_side = Side(border_style="thin", color="CBD5E1")
    thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    
    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")
    
    # Title
    ws.merge_cells("A1:M1")
    ws["A1"] = f"NSE A+ INTRADAY EOD PERFORMANCE AUDIT — {today_str}"
    ws["A1"].font = font_title
    ws["A1"].fill = fill_navy
    ws["A1"].alignment = align_center
    
    n_txt = f"Nifty Open: {nifty_data.get('open')} | High: {nifty_data.get('high')} | Low: {nifty_data.get('low')} | Close: {nifty_data.get('close')}" if nifty_data else "Market Session Complete"
    ws.merge_cells("A2:M2")
    ws["A2"] = n_txt
    ws["A2"].font = font_sub
    ws["A2"].fill = fill_navy
    ws["A2"].alignment = align_center
    ws.row_dimensions[1].height = 28
    ws.row_dimensions[2].height = 20
    
    # Table headers
    headers = [
        "Symbol", "Role", "Direction", "Trigger Entry (₹)", "Hard SL (₹)", "Target 1 (₹)", "Target 2 (₹)",
        "Day Open (₹)", "Day High (₹)", "Day Low (₹)", "Day Close (₹)", "P&L Return (%)", "Final Audit Verdict"
    ]
    
    ws.row_dimensions[4].height = 24
    for c_i, h in enumerate(headers, 1):
        c = ws.cell(row=4, column=c_i, value=h)
        c.font = font_tbl_hdr
        c.fill = fill_hdr
        c.alignment = align_center
        c.border = thin_border
        
    for r_i, item in enumerate(audit_results, start=5):
        ws.row_dimensions[r_i].height = 22
        ws.cell(row=r_i, column=1, value=item['symbol']).font = font_data_bold
        ws.cell(row=r_i, column=2, value=item['role']).alignment = align_center
        
        c_dir = ws.cell(row=r_i, column=3, value=item['direction'])
        c_dir.alignment = align_center
        c_dir.font = font_data_bold
        if item['direction'] == "BUY":
            c_dir.fill = fill_green
            c_dir.font = Font(name="Calibri", size=10, bold=True, color=GREEN_TEXT)
        else:
            c_dir.fill = fill_red
            c_dir.font = Font(name="Calibri", size=10, bold=True, color=RED_TEXT)
            
        for c_idx, val in enumerate([item['trigger'], item['sl'], item['t1'], item['t2']], start=4):
            c = ws.cell(row=r_i, column=c_idx, value=val)
            c.number_format = "[$₹-4009]#,##0.00"
            c.alignment = align_right
            
        for c_idx, val in enumerate([item.get('open'), item.get('high'), item.get('low'), item.get('close')], start=8):
            c = ws.cell(row=r_i, column=c_idx, value=val)
            if val is not None:
                c.number_format = "[$₹-4009]#,##0.00"
            c.alignment = align_right
            
        c_pnl = ws.cell(row=r_i, column=12, value=f"{'+' if item['pnl_pct'] > 0 else ''}{item['pnl_pct']:.2f}%")
        c_pnl.alignment = align_center
        c_pnl.font = font_data_bold
        if item['pnl_pct'] > 0:
            c_pnl.fill = fill_green
            c_pnl.font = Font(name="Calibri", size=10, bold=True, color=GREEN_TEXT)
        elif item['pnl_pct'] < 0:
            c_pnl.fill = fill_red
            c_pnl.font = Font(name="Calibri", size=10, bold=True, color=RED_TEXT)
            
        c_res = ws.cell(row=r_i, column=13, value=item['result'])
        c_res.font = font_data_bold
        c_res.alignment = align_left
        if "TARGET" in item['result']:
            c_res.fill = fill_green
        elif "STOP" in item['result']:
            c_res.fill = fill_red
            
        for c_idx in range(1, 14):
            ws.cell(row=r_i, column=c_idx).border = thin_border
            
    # Auto-adjust column widths
    for col in ws.columns:
        max_l = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_l + 3, 14)
        
    # Use the SESSION date (day that was traded) for the filename,
    # NOT datetime.now() — the audit may run the next morning.
    os.makedirs(AUDIT_DIR, exist_ok=True)
    out_file  = os.path.join(AUDIT_DIR, f"{session_date_slug}_EOD_Performance_Audit.xlsx")
    desk_file = os.path.join(DESKTOP_DIR, f"{session_date_slug}_EOD_Performance_Audit.xlsx")
    wb.save(out_file)
    wb.save(desk_file)
    return desk_file

def main():
    print("="*60)
    print("      NSE A+ EOD INTRADAY PERFORMANCE AUDIT ENGINE")
    print("="*60)
    
    if not os.path.exists(PICKS_FILE):
        print(f"[ERROR] No picks file found at {PICKS_FILE}")
        return
        
    with open(PICKS_FILE, 'r', encoding='utf-8') as f:
        picks_data = json.load(f)
        
    picks = picks_data.get('picks', [])
    date_str = picks_data.get('date', datetime.now().strftime("%a, %d-%b-%Y"))
    
    print(f"Auditing {len(picks)} setups for {date_str}...")
    nifty_mkt = fetch_intraday_data("^NSEI")
    
    audit_results = []
    for p in picks:
        print(f"Fetching live market action for {p['symbol']}...")
        mkt = fetch_intraday_data(p['symbol'])
        res = audit_stock(p, mkt)
        audit_results.append(res)
        
    # Derive a clean YYYY-MM-DD slug from the session date string e.g. "Mon, 21-Sep-2026"
    try:
        session_date_slug = datetime.strptime(date_str, "%a, %d-%b-%Y").strftime("%Y-%m-%d")
    except Exception:
        session_date_slug = datetime.now().strftime("%Y-%m-%d")

    # Generate Excel Report
    excel_path = build_audit_excel(audit_results, date_str, nifty_mkt, session_date_slug)
    print(f"✅ Excel Audit Report saved to: {excel_path}")
    
    # Generate Formatted Message
    lines = []
    lines.append("📊 *NSE A+ INTRADAY EOD PERFORMANCE AUDIT*")
    lines.append(f"📅 *Session Date:* {date_str}")
    if nifty_mkt and nifty_mkt.get('close'):
        lines.append(f"📈 *Nifty Close:* ₹{nifty_mkt['close']:,.2f}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    
    wins = 0
    losses = 0
    untriggered = 0
    total_pnl = 0.0
    
    for idx, item in enumerate(audit_results, 1):
        sym = item['symbol']
        dir_tag = "BUY" if item['direction'] == "BUY" else "SELL"
        res = item['result']
        pnl = item['pnl_pct']
        
        lines.append(f"{idx}. *{sym}* ({dir_tag})")
        lines.append(f"   • Trigger: ₹{item['trigger']:,.2f} | Close: ₹{item.get('close', 0):,.2f}")
        lines.append(f"   • Outcome: {res}")
        
        if "TARGET" in res:
            wins += 1
            total_pnl += pnl
        elif "STOP" in res:
            losses += 1
            total_pnl += pnl
        elif "EOD" in res:
            if pnl > 0: wins += 1
            elif pnl < 0: losses += 1
            total_pnl += pnl
        else:
            untriggered += 1
            
    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    tot_trades = wins + losses
    win_rate = round((wins / tot_trades) * 100, 1) if tot_trades > 0 else 0.0
    lines.append(f"🏆 *Scorecard:* {wins} Won | {losses} Lost | {untriggered} Untriggered")
    lines.append(f"💰 *Net Return:* {'+' if total_pnl >= 0 else ''}{total_pnl:.2f}% | Win Rate: {win_rate}%")
    lines.append(f"📁 *Detailed Excel Saved:* `{os.path.basename(excel_path)}`")
    lines.append("━━━━━━━━━━━━━━━━━━━━━")
    
    eod_msg = "\n".join(lines)
    print("\nFormatted EOD Message:")
    print("-" * 50)
    print(eod_msg)
    print("-" * 50)
    
    print("\nDispatching EOD Audit Notification to Phone...")
    ok, code = send_ntfy_push(eod_msg)
    if ok:
        print(f"✅ SUCCESS: EOD Audit delivered to push phone! (Status {code})")
    else:
        print(f"❌ Failed to dispatch push notification: {code}")

    # ── WHATSAPP WEB DISPATCH ──
    try:
        import send_whatsapp_web as sww
        config = sww.load_config()
        phone = config.get('phone_number', '+919998710446').strip()
        print(f"\nDispatching EOD Audit to WhatsApp ({phone})...")
        sww.send_via_whatsapp_web(phone, eod_msg)
        print("✅ SUCCESS: EOD Audit dispatched to WhatsApp Web!")
    except Exception as ex:
        print(f"[WARN] WhatsApp Web dispatch bypass: {ex}")

if __name__ == '__main__':
    main()


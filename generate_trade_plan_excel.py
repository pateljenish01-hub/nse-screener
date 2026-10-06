# -*- coding: utf-8 -*-
"""
Autonomous Trade Plan Excel Generator
Builds institutional-grade styled Excel workbooks for daily trade plans,
saving 'Today_Trade_Plan.xlsx' and a dated archive file directly to Desktop.
"""
import os
import sys
import json
from datetime import datetime, timedelta
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DESKTOP_DIR = r"C:\Users\DELL\OneDrive\Desktop"
ARCHIVE_DIR = os.path.join(DESKTOP_DIR, "Daily_Trade_Plans")

def build_trade_plan_excel(data, nifty_open=None):
    if not os.path.exists(ARCHIVE_DIR):
        try:
            os.makedirs(ARCHIVE_DIR, exist_ok=True)
        except Exception:
            pass

    scan_date = data.get("date", datetime.now().strftime("%Y-%m-%d"))
    nifty_close = data.get("nifty_close")
    if not nifty_close:
        # Read from market_data.js — same reliable logic as screening_core.py
        try:
            dir_path = os.path.dirname(os.path.abspath(__file__))
            md_path = os.path.join(dir_path, 'market_data.js')
            with open(md_path, 'r', encoding='utf-8') as f:
                text = f.read().replace('window.MARKET_DATA = ', '').rstrip(';').strip()
            md = json.loads(text)
            nifty_candles = md.get('^NSEI', [])
            today_str = datetime.now().strftime('%Y-%m-%d')
            completed = [c for c in nifty_candles if c.get('date') < today_str and c.get('close') is not None]
            if completed:
                nifty_close = float(completed[-1]['close'])
            elif len(nifty_candles) >= 2:
                nifty_close = float(nifty_candles[-2]['close'])
        except Exception:
            nifty_close = 0.0

    buys = data.get("buys", [])
    sells = data.get("sells", [])
    
    try:
        dt_obj = datetime.strptime(scan_date, "%Y-%m-%d")
        now = datetime.now()
        is_post_market = now.hour > 15 or (now.hour == 15 and now.minute >= 30)
        if is_post_market:
            days_ahead = 1
            if now.weekday() == 4: # Friday -> Monday
                days_ahead = 3
            elif now.weekday() == 5: # Saturday -> Monday
                days_ahead = 2
            trade_dt = now + timedelta(days=days_ahead)
        else:
            trade_dt = now

        day_name = trade_dt.strftime("%A")           # e.g. "Wednesday"
        trade_date_str = trade_dt.strftime("%d-%b-%Y")  # e.g. "30-Sep-2026"
        file_prefix = trade_dt.strftime("%Y-%m-%d")  # e.g. "2026-09-30"
        setup_date_str = dt_obj.strftime("%d-%b-%Y")    # e.g. "29-Sep-2026" (candle)
    except Exception:
        trade_dt = datetime.now()
        day_name = trade_dt.strftime("%A")
        trade_date_str = trade_dt.strftime("%d-%b-%Y")
        file_prefix = trade_dt.strftime("%Y-%m-%d")
        setup_date_str = scan_date

    wb = openpyxl.Workbook()

    # Sheet 1: Actionable Trade Plan
    ws1 = wb.active
    ws1.title = "Actionable Trade Plan"
    ws1.views.sheetView[0].showGridLines = True

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

    # Title — trading day in header, setup candle date in subtitle
    ws1.merge_cells("A1:J1")
    ws1["A1"] = f"NSE A+ INTRADAY TRADE PLAN — {day_name.upper()}, {trade_date_str.upper()}"
    ws1["A1"].font = font_title
    ws1["A1"].fill = fill_navy
    ws1["A1"].alignment = align_center

    sub_txt = f"Setup Candle: {setup_date_str} | Benchmark Nifty Prev Close: ₹{nifty_close:,.2f} | Qualified Breadth: {len(buys)} Buys vs {len(sells)} Sells"
    if nifty_open:
        gap = round(nifty_open - nifty_close, 2)
        sub_txt += f" | Pre-Open Settled: ₹{nifty_open:,.2f} ({'+' if gap>=0 else ''}{gap:.2f} pts)"
        
    ws1.merge_cells("A2:J2")
    ws1["A2"] = sub_txt
    ws1["A2"].font = font_sub
    ws1["A2"].fill = fill_navy
    ws1["A2"].alignment = align_center
    ws1.row_dimensions[1].height = 28
    ws1.row_dimensions[2].height = 20

    # Section 1: Pre-Open Contingency Gatekeeper Matrix
    ws1.merge_cells("A4:J4")
    ws1["A4"] = "1. PRE-OPEN CONTINGENCY GATEKEEPER MATRIX (CHECK AT 9:08 AM)"
    ws1["A4"].font = font_sec
    ws1["A4"].fill = fill_sec
    ws1["A4"].alignment = align_left
    ws1.row_dimensions[4].height = 24

    p_flat_l, p_flat_u = round(nifty_close - 40), round(nifty_close + 40)
    p_gap_d, p_gap_u = round(nifty_close - 75), round(nifty_close + 75)

    top_b_syms = ", ".join([b['symbol'] for b in buys[:2]]) if buys else "N/A"
    top_s_syms = ", ".join([s['symbol'] for s in sells[:2]]) if sells else "N/A"
    b_hedge = buys[0]['symbol'] if buys else "N/A"
    s_hedge = sells[0]['symbol'] if sells else "N/A"

    matrix_cols = [
        ("Zone 1: Flat Open", f"{p_flat_l:,} to {p_flat_u:,}", "-40 to +40 pts", f"Balanced Execution: Take Top 2 Buys ({top_b_syms}) + Top 2 Sells ({top_s_syms})", "✅ BALANCED 2L + 2S"),
        ("Zone 2: Shallow Gap-Down", f"{p_gap_d:,} to {p_flat_l:,}", "-40 to -75 pts", f"Bearish Skew: Take Top 3 Sells + 1 Buy Hedge ({b_hedge})", "✅ ALLOW 3 Sells + 1 Long"),
        ("Zone 3: Panic Crash Down", f"< {p_gap_d:,}", "< -75 pts", "100% Short Dominance: Deploy Top 4 Sells Pure (0 Longs)", "🚀 DEPLOY 4 Sells Pure (0 Longs)"),
        ("Zone 4: Shallow Gap-Up", f"{p_flat_u:,} to {p_gap_u:,}", "+40 to +75 pts", f"Bullish Skew: Take Top 3 Buys + 1 Sell Hedge ({s_hedge})", "🛡️ ALLOW 3 Longs + 1 Sell Hedge"),
        ("Zone 5: Breakout Gap-Up", f"> {p_gap_u:,}", "> +75 pts", "100% Long Dominance: Deploy Top 4 Buys Pure (100% Hard-Block on all Shorts)", "⛔ ALL SHORTS HARD-BLOCKED")
    ]

    headers_m = ["Zone", "Nifty Settled Range", "Gap Points", "Execution Protocol", "System Directive"]
    for col_idx, h in enumerate(headers_m, 1):
        c = ws1.cell(row=5, column=col_idx, value=h)
        c.font = font_tbl_hdr
        c.fill = fill_hdr
        c.alignment = align_center if col_idx in [2, 3] else align_left
        c.border = thin_border
    ws1.row_dimensions[5].height = 22

    for r_idx, (z_lbl, z_rng, z_pts, z_proto, z_act) in enumerate(matrix_cols, start=6):
        ws1.row_dimensions[r_idx].height = 22
        ws1.cell(row=r_idx, column=1, value=z_lbl).font = font_data_bold
        ws1.cell(row=r_idx, column=1).border = thin_border
        ws1.cell(row=r_idx, column=2, value=z_rng).alignment = align_center
        ws1.cell(row=r_idx, column=2).font = font_data
        ws1.cell(row=r_idx, column=2).border = thin_border
        ws1.cell(row=r_idx, column=3, value=z_pts).alignment = align_center
        ws1.cell(row=r_idx, column=3).font = font_data
        ws1.cell(row=r_idx, column=3).border = thin_border
        ws1.cell(row=r_idx, column=4, value=z_proto).font = font_data
        ws1.cell(row=r_idx, column=4).border = thin_border
        c_act = ws1.cell(row=r_idx, column=5, value=z_act)
        c_act.border = thin_border
        if "HARD-BLOCKED" in z_act:
            c_act.fill = fill_red
            c_act.font = Font(name="Calibri", size=10, bold=True, color=RED_TEXT)
        elif "DEPLOY" in z_act or "ALLOW" in z_act or "BALANCED" in z_act:
            c_act.fill = fill_green
            c_act.font = Font(name="Calibri", size=10, bold=True, color=GREEN_TEXT)
        else:
            c_act.font = font_data_bold

    # Section 2: Top Sweet-Spot Volume Buys
    r_b = 13
    ws1.merge_cells(f"A{r_b}:J{r_b}")
    ws1[f"A{r_b}"] = "2. TOP SWEET-SPOT VOLUME BUY SETUPS (GRADE-A+ SCORE 13)"
    ws1[f"A{r_b}"].font = font_sec
    ws1[f"A{r_b}"].fill = PatternFill(start_color="059669", end_color="059669", fill_type="solid")
    ws1[f"A{r_b}"].alignment = align_left
    ws1.row_dimensions[r_b].height = 24

    stock_headers = ["Rank", "Symbol", "Direction", "Trigger Entry (₹)", "Hard SL (-1.50%)", "Target 1 (+1.50%)", "Target 2 (+2.25%)", "Vol Ratio", "Score", "Setup Quality Type"]
    for col_idx, h in enumerate(stock_headers, 1):
        c = ws1.cell(row=r_b+1, column=col_idx, value=h)
        c.font = font_tbl_hdr
        c.fill = PatternFill(start_color="047857", end_color="047857", fill_type="solid")
        c.alignment = align_center
        c.border = thin_border
    ws1.row_dimensions[r_b+1].height = 22

    top_buys_data = buys[:5]
    for idx, b in enumerate(top_buys_data, start=r_b+2):
        ws1.row_dimensions[idx].height = 22
        ws1.cell(row=idx, column=1, value=idx - (r_b+1)).alignment = align_center
        ws1.cell(row=idx, column=2, value=b['symbol']).font = font_data_bold
        c_dir = ws1.cell(row=idx, column=3, value="BUY")
        c_dir.alignment = align_center
        c_dir.fill = fill_green
        c_dir.font = Font(name="Calibri", size=10, bold=True, color=GREEN_TEXT)
        for c_i, p_val in enumerate([b['trigger'], b['sl'], b['t1'], b['t2']], start=4):
            c = ws1.cell(row=idx, column=c_i, value=p_val)
            c.number_format = "[$₹-4009]#,##0.00"
            c.alignment = align_right
        ws1.cell(row=idx, column=8, value=f"{b.get('vol_ratio', 1.0):.2f}x").alignment = align_center
        ws1.cell(row=idx, column=9, value=b.get('score', 0)).alignment = align_center
        tag = "⚡ Sweet-Spot Volume (Demand Surge)" if b.get('is_sweet') else "Bullish Momentum"
        c_type = ws1.cell(row=idx, column=10, value=tag)
        c_type.font = font_data
        if b.get('is_sweet'):
            c_type.fill = fill_green
            c_type.font = Font(name="Calibri", size=9, bold=True, color=GREEN_TEXT)
        for c_i in range(1, 11):
            ws1.cell(row=idx, column=c_i).border = thin_border

    # Section 3: Top Institutional Vacuum Sells
    r_s = r_b + 2 + len(top_buys_data) + 2
    ws1.merge_cells(f"A{r_s}:J{r_s}")
    ws1[f"A{r_s}"] = "3. TOP INSTITUTIONAL LIQUIDITY VACUUM SELL SETUPS (GRADE-A+ SCORE 13)"
    ws1[f"A{r_s}"].font = font_sec
    ws1[f"A{r_s}"].fill = fill_sec
    ws1[f"A{r_s}"].alignment = align_left
    ws1.row_dimensions[r_s].height = 24

    sell_headers = ["Rank", "Symbol", "Direction", "Trigger Entry (₹)", "Hard SL (+1.50%)", "Target 1 (-1.50%)", "Target 2 (-2.25%)", "Vol Ratio", "Score", "Setup Quality Type"]
    for col_idx, h in enumerate(sell_headers, 1):
        c = ws1.cell(row=r_s+1, column=col_idx, value=h)
        c.font = font_tbl_hdr
        c.fill = fill_hdr
        c.alignment = align_center
        c.border = thin_border
    ws1.row_dimensions[r_s+1].height = 22

    top_sells_data = sells[:5]
    for idx, s in enumerate(top_sells_data, start=r_s+2):
        ws1.row_dimensions[idx].height = 22
        ws1.cell(row=idx, column=1, value=idx - (r_s+1)).alignment = align_center
        ws1.cell(row=idx, column=2, value=s['symbol']).font = font_data_bold
        c_dir = ws1.cell(row=idx, column=3, value="SELL")
        c_dir.alignment = align_center
        c_dir.fill = fill_red
        c_dir.font = Font(name="Calibri", size=10, bold=True, color=RED_TEXT)
        for c_i, p_val in enumerate([s['trigger'], s['sl'], s['t1'], s['t2']], start=4):
            c = ws1.cell(row=idx, column=c_i, value=p_val)
            c.number_format = "[$₹-4009]#,##0.00"
            c.alignment = align_right
        ws1.cell(row=idx, column=8, value=f"{s.get('vol_ratio', 1.0):.2f}x").alignment = align_center
        ws1.cell(row=idx, column=9, value=s.get('score', 0)).alignment = align_center
        tag = "📉 Ultra Institutional Vacuum (<0.15x)" if s.get('vol_ratio', 1.0) <= 0.15 else "📉 Institutional Vacuum"
        c_type = ws1.cell(row=idx, column=10, value=tag)
        c_type.font = font_data
        c_type.fill = fill_red
        c_type.font = Font(name="Calibri", size=9, bold=True, color=RED_TEXT)
        for c_i in range(1, 11):
            ws1.cell(row=idx, column=c_i).border = thin_border

    # Section 4: Golden Rules
    r_rules = r_s + 2 + len(top_sells_data) + 2
    ws1.merge_cells(f"A{r_rules}:J{r_rules}")
    ws1[f"A{r_rules}"] = "4. GOLDEN EXECUTION PROTOCOL"
    ws1[f"A{r_rules}"].font = font_sec
    ws1[f"A{r_rules}"].fill = fill_navy
    ws1[f"A{r_rules}"].alignment = align_left
    ws1.row_dimensions[r_rules].height = 22

    rules = [
        ("1. Check 9:10 AM Pre-Open Settlement:", "Wait for 9:10 AM official settlement. Check Nifty Zone. In Zone 5 (> +75 pts gap), all shorts are hard-blocked! In Zone 1 (Flat), trade balanced."),

        ("2. Order Type (Stop-Loss Limit):", "For BUY: Place Buy Stop-Loss Limit at trigger. For SELL: Place Sell Stop-Loss Limit at trigger. Never place pre-market market orders."),
        ("3. The 50% T1 + Trail Breakeven Rule:", "The instant Target 1 (+1.50% / -1.50%) is hit, book 50% profit immediately and trail the remaining stop loss to Breakeven (Entry Price)."),
        ("4. Stop-Loss Hard Cap:", "Never widen your Hard Stop Loss (1.50%). Cut immediately if touched."),
        ("5. Intraday Discipline:", "Square off all intraday positions before 3:15 PM.")
    ]

    for idx, (head, desc) in enumerate(rules, start=r_rules+1):
        ws1.row_dimensions[idx].height = 22
        ws1.merge_cells(f"A{idx}:C{idx}")
        ws1.merge_cells(f"D{idx}:J{idx}")
        ws1.cell(row=idx, column=1, value=head).font = font_data_bold
        ws1.cell(row=idx, column=1).fill = fill_gray
        ws1.cell(row=idx, column=1).border = thin_border
        ws1.cell(row=idx, column=4, value=desc).font = font_data
        ws1.cell(row=idx, column=4).border = thin_border
        for c_i in range(1, 11):
            ws1.cell(row=idx, column=c_i).border = thin_border

    # Auto adjust widths
    for col in ws1.columns:
        max_l = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws1.column_dimensions[col_letter].width = max(max_l + 3, 14)

    ws1.column_dimensions["A"].width = 24
    ws1.column_dimensions["B"].width = 18
    ws1.column_dimensions["C"].width = 16
    ws1.column_dimensions["D"].width = 20
    ws1.column_dimensions["E"].width = 20
    ws1.column_dimensions["F"].width = 20
    ws1.column_dimensions["G"].width = 20
    ws1.column_dimensions["H"].width = 14
    ws1.column_dimensions["I"].width = 14
    ws1.column_dimensions["J"].width = 44

    # Save:
    # 1. Today_Trade_Plan.xlsx  — single active file on Desktop for quick access
    # 2. Daily_Trade_Plans/YYYY-MM-DD_Trade_Plan.xlsx — archived by trading day
    today_file   = os.path.join(DESKTOP_DIR,  "Today_Trade_Plan.xlsx")
    archive_file = os.path.join(ARCHIVE_DIR,  f"{file_prefix}_Trade_Plan.xlsx")

    wb.save(today_file)
    wb.save(archive_file)

    return today_file, archive_file

if __name__ == "__main__":
    import sys
    sys.path.append(r"C:\Users\DELL\OneDrive\Desktop\NSE-Screener-Pro-Cloud")
    import screening_core as sc
    data = sc.get_latest_data()
    f1, f2 = build_trade_plan_excel(data)
    print(f"Generated: {f1} and {f2}")

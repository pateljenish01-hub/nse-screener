# -*- coding: utf-8 -*-
"""
NSE A+ Daily Intraday Picks - Autonomous Dynamic Phone Alert Dispatcher
Dispatches latest dynamic A+ picks to ntfy push notifications.
"""
import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

DIR_PATH = os.path.dirname(os.path.abspath(__file__))
TOPIC = "nse_picks_9998710446"

import screening_core as sc

def send_ntfy_push(message):
    url = f"https://ntfy.sh/{TOPIC}"
    headers = {
        "Title": "NSE A+ Daily Stock Picks",
        "Priority": "urgent",
        "Tags": "chart_with_upwards_trend,moneybag"
    }
    req = urllib.request.Request(url, data=message.encode('utf-8'), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return True, resp.status
    except Exception as e:
        return False, str(e)

def main():
    print("="*60)
    print("   NSE A+ DAILY INTRADAY PICKS - AUTONOMOUS PHONE DISPATCHER")
    print("="*60)
    
    # Auto-fetch if needed
    try:
        import fetch_data
        print("[1/2] Checking and refreshing market candles...")
        fetch_data.main()
    except Exception as e:
        print(f"[WARN] Auto fetch bypass: {e}")
        
    try:
        data = sc.get_latest_data()

        # ── FETCH LIVE NIFTY IEP OPEN (must happen before format + seeding) ──
        nifty_open = sc.get_live_nifty_open(data['nifty_close'])
        if nifty_open:
            gap = round(nifty_open - data['nifty_close'], 2)
            print(f"[INFO] Live Nifty Open: ₹{nifty_open} | Gap: {gap:+.2f} pts")
        else:
            print("[WARN] Could not fetch live Nifty open — defaulting Zone to FLAT")

        message = sc.format_alert_message(data, nifty_open=nifty_open)
        
        # ── AUTOMATIC DESKTOP EXCEL GENERATION ──
        try:
            import generate_trade_plan_excel as gtpe
            today_excel, dated_excel = gtpe.build_trade_plan_excel(data)
            print(f"✅ Excel Trade Plan generated on Desktop: {today_excel}")
            
            # Seed EOD picks tracker with the CORRECT active Zone basket using live open
            picks_list = sc.get_active_basket_picks(data, nifty_open=nifty_open)
            picks_file = os.path.join(DIR_PATH, 'dispatched_today_picks.json')
            today_label = datetime.now().strftime("%a, %d-%b-%Y")
            with open(picks_file, 'w', encoding='utf-8') as pf:
                json.dump({"date": today_label, "picks": picks_list}, pf, indent=2)
            print(f"✅ Seeded dispatched_today_picks.json with {len(picks_list)} picks for {today_label}")
        except Exception as ex:
            print(f"[WARN] Excel generation bypass: {ex}")
            
    except Exception as e:
        print(f"[ERROR] Screening failed: {e}")
        return
        
    print("\n[2/2] Screened Dynamic Candidates & Alert Message:")
    print("-" * 50)
    print(message)
    print("-" * 50)
    
    print(f"\nDispatching instant push notification to phone (Topic: {TOPIC})...")
    ok, code = send_ntfy_push(message)
    if ok:
        print(f"✅ SUCCESS: Alert delivered directly to phone! (Status {code})")
    else:
        print(f"❌ Failed to dispatch push notification: {code}")
    print("="*60)

if __name__ == '__main__':
    main()

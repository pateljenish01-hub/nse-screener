import re
import json
import urllib.request
import concurrent.futures
from datetime import datetime

def get_symbols():
    with open("nse500.js", "r", encoding="utf-8") as f:
        content = f.read()
    matches = re.findall(r"symbol:\s*'([^']+)'", content)
    return matches

def fetch_symbol(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=3mo"
    headers = {"User-Agent": "Mozilla/5.0"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            chart = data["chart"]["result"][0]
            timestamps = chart.get("timestamp", [])
            indicators = chart.get("indicators", {}).get("quote", [{}])[0]
            opens = indicators.get("open", [])
            highs = indicators.get("high", [])
            lows = indicators.get("low", [])
            closes = indicators.get("close", [])
            volumes = indicators.get("volume", [])
            meta = chart.get("meta", {})

            candles = []
            for j in range(len(timestamps)):
                o = opens[j] if j < len(opens) else None
                h = highs[j] if j < len(highs) else None
                l = lows[j] if j < len(lows) else None
                c = closes[j] if j < len(closes) else None
                v = volumes[j] if (volumes and j < len(volumes) and volumes[j] is not None) else 0

                if o is None and h is None and l is None and c is None:
                    continue

                if j == len(timestamps) - 1:
                    if c is None and "regularMarketPrice" in meta:
                        c = meta["regularMarketPrice"]
                    if h is None and "regularMarketDayHigh" in meta:
                        h = meta["regularMarketDayHigh"]
                    if l is None and "regularMarketDayLow" in meta:
                        l = meta["regularMarketDayLow"]
                    if o is None and "chartPreviousClose" in meta:
                        o = meta["chartPreviousClose"]

                if o is None or h is None or l is None or c is None:
                    continue

                dt_str = datetime.utcfromtimestamp(timestamps[j]).strftime("%Y-%m-%d")
                candles.append({
                    "time": timestamps[j] * 1000,
                    "date": dt_str,
                    "open": round(float(o), 2),
                    "high": round(float(h), 2),
                    "low": round(float(l), 2),
                    "close": round(float(c), 2),
                    "volume": int(v),
                    "source": "yahoo"
                })

            if candles:
                return sym, candles
    except Exception as e:
        # print(f"Error {sym}: {e}")
        pass
    return sym, None

def main():
    symbols = get_symbols()
    print(f"Fetching data for {len(symbols)} symbols in parallel...")
    results = {}
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        future_to_sym = {executor.submit(fetch_symbol, sym): sym for sym in symbols}
        for future in concurrent.futures.as_completed(future_to_sym):
            sym, candles = future.result()
            if candles:
                results[sym] = candles

    print(f"Successfully fetched {len(results)} symbols.")
    json_str = json.dumps(results, separators=(",", ":"))
    js_output = f"window.MARKET_DATA = {json_str};"
    
    with open("market_data.js", "w", encoding="utf-8") as f:
        f.write(js_output)
    print("market_data.js successfully written!")

if __name__ == "__main__":
    main()

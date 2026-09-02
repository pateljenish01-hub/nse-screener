// filterEngine.js â€” 3-Candle Pattern Filter Engine
// ALL candle evaluation is performed on HEIKIN-ASHI candles (strict requirement)

const FilterEngine = (() => {

  // â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const CONFIG = {
    // Wick tolerance for Candle 2 "no opposite-side wick" rule (absolute â‚¹)
    WICK_TOLERANCE_ABS: 0.01,  // â‚¹0.01 â€” essentially zero wick
    MIN_CANDLES: 25,
    TREND_SMA_PERIOD: 20,
    TREND_SLOPE_WINDOW: 5,
    MIN_BODY_PCT: 0.1,         // Body must be â‰¥ 10% of HA candle range
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â”€â”€ HEIKIN-ASHI CONVERSION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Heikin-Ashi formulas:
  //   HA_Close[i] = (Open[i] + High[i] + Low[i] + Close[i]) / 4
  //   HA_Open[i]  = (HA_Open[i-1] + HA_Close[i-1]) / 2   (seed: (O[0]+C[0])/2)
  //   HA_High[i]  = max(High[i], HA_Open[i], HA_Close[i])
  //   HA_Low[i]   = min(Low[i],  HA_Open[i], HA_Close[i])
  //
  // Wicks in HA candles carry strong trend signal:
  //   - No lower wick  = strong bullish momentum
  //   - No upper wick  = strong bearish momentum
  //   - Both-side wicks = indecision / reversal warning

  function convertToHeikinAshi(candles) {
    if (!candles || candles.length === 0) return [];
    const ha = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const haClose = parseFloat(((c.open + c.high + c.low + c.close) / 4).toFixed(4));

      let haOpen;
      if (i === 0) {
        haOpen = parseFloat(((c.open + c.close) / 2).toFixed(4));
      } else {
        haOpen = parseFloat(((ha[i - 1].open + ha[i - 1].close) / 2).toFixed(4));
      }

      const haHigh = parseFloat(Math.max(c.high, haOpen, haClose).toFixed(4));
      const haLow  = parseFloat(Math.min(c.low,  haOpen, haClose).toFixed(4));

      ha.push({
        time:   c.time,
        date:   c.date,
        open:   haOpen,
        high:   haHigh,
        low:    haLow,
        close:  haClose,
        volume: c.volume,
        source: 'heikin_ashi',
        // Keep original for reference
        _raw: { open: c.open, high: c.high, low: c.low, close: c.close },
      });
    }
    return ha;
  }

  // â”€â”€ Utility: SMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function sma(values, period) {
    const results = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      results[i] = sum / period;
    }
    return results;
  }

  // â”€â”€ Trend Detection (on HA closes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function detectTrend(haCandles) {
    if (haCandles.length < CONFIG.TREND_SMA_PERIOD) return 'sideways';
    const closes   = haCandles.map(c => c.close);
    const smaVals  = sma(closes, CONFIG.TREND_SMA_PERIOD);
    const valid    = smaVals.filter(v => v !== null);
    if (valid.length < CONFIG.TREND_SLOPE_WINDOW) return 'sideways';
    const recent   = valid.slice(-CONFIG.TREND_SLOPE_WINDOW);
    const slopePct = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;
    if (slopePct >  0.3) return 'bullish';
    if (slopePct < -0.3) return 'bearish';
    return 'sideways';
  }

  // â”€â”€ Candle Metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function candleMetrics(c) {
    const bodyTop   = Math.max(c.open, c.close);
    const bodyBot   = Math.min(c.open, c.close);
    const bodySize  = parseFloat((bodyTop - bodyBot).toFixed(4));
    const range     = parseFloat((c.high - c.low).toFixed(4));
    const upperWick = parseFloat((c.high - bodyTop).toFixed(4));
    const lowerWick = parseFloat((bodyBot - c.low).toFixed(4));
    const bullish   = c.close >= c.open;
    return { bodyTop, bodyBot, bodySize, range, upperWick, lowerWick, bullish };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â”€â”€ CONDITION 1: HA Candle 1 â€” Wicks on BOTH sides â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // In HA terms: both-side wicks signal indecision / potential reversal setup.
  // High > max(HA_Open, HA_Close)  AND  Low < min(HA_Open, HA_Close)
  function checkCandle1(c) {
    const m = candleMetrics(c);
    if (m.range === 0) return { pass: false, reason: 'Zero-range HA candle' };

    

    const hasUpper = m.upperWick > Math.max(CONFIG.WICK_TOLERANCE_ABS, c.close * 0.001);
    const hasLower = m.lowerWick > Math.max(CONFIG.WICK_TOLERANCE_ABS, c.close * 0.001);

    if (!hasUpper) return { pass: false, reason: 'HA C1: No upper wick (UpperWick=' + m.upperWick.toFixed(4) + ')' };
    if (!hasLower) return { pass: false, reason: 'HA C1: No lower wick (LowerWick=' + m.lowerWick.toFixed(4) + ')' };

    return {
      pass: true,
      reason: 'HA both-side wicks âœ“ (Upper: ' + m.upperWick.toFixed(2) + '  Lower: ' + m.lowerWick.toFixed(2) + ')',
      metrics: m,
    };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â”€â”€ CONDITION 2: HA Candle 2 â€” One-sided wick matching trend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Bearish trend â†’ lower wick only (no upper wick: High â‰ˆ max(HA_Open, HA_Close))
  // Bullish trend â†’ upper wick only (no lower wick: Low  â‰ˆ min(HA_Open, HA_Close))
  // In pure HA: "no upper wick" in bearish = HA_High == max(HA_Open, HA_Close)
  //             "no lower wick" in bullish  = HA_Low  == min(HA_Open, HA_Close)
  function checkCandle2(c, trend) {
    const m   = candleMetrics(c);
    const tol = Math.max(CONFIG.WICK_TOLERANCE_ABS, c.close * 0.001);

    if (m.range === 0) return { pass: false, reason: 'Zero-range HA candle' };

    const bodyPct = m.range > 0 ? m.bodySize / m.range : 0;
    if (bodyPct < CONFIG.MIN_BODY_PCT) {
      return { pass: false, reason: 'HA body too small (' + (bodyPct * 100).toFixed(1) + '%)' };
    }

    if (trend === 'bearish') {
      // No upper wick (upper wick â‰¤ tol), lower wick must exist
      if (m.upperWick > tol) {
        return {
          pass: false,
          reason: 'Bearish C2: HA upper wick present (' + m.upperWick.toFixed(4) + ' > â‚¹' + tol + ' limit)',
        };
      }
      if (m.lowerWick <= tol) {
        return {
          pass: false,
          reason: 'Bearish C2: HA lower wick absent (' + m.lowerWick.toFixed(4) + ' â‰¤ â‚¹' + tol + ')',
        };
      }
      return {
        pass: true,
        reason: 'Bearish probe âœ“  UpperWick: ' + m.upperWick.toFixed(4) + '  LowerWick: ' + m.lowerWick.toFixed(2),
        metrics: m,
      };

    } else if (trend === 'bullish') {
      // No lower wick (lower wick â‰¤ tol), upper wick must exist
      if (m.lowerWick > tol) {
        return {
          pass: false,
          reason: 'Bullish C2: HA lower wick present (' + m.lowerWick.toFixed(4) + ' > â‚¹' + tol + ' limit)',
        };
      }
      if (m.upperWick <= tol) {
        return {
          pass: false,
          reason: 'Bullish C2: HA upper wick absent (' + m.upperWick.toFixed(4) + ' â‰¤ â‚¹' + tol + ')',
        };
      }
      return {
        pass: true,
        reason: 'Bullish probe âœ“  UpperWick: ' + m.upperWick.toFixed(2) + '  LowerWick: ' + m.lowerWick.toFixed(4),
        metrics: m,
      };

    } else {
      return { pass: false, reason: 'Sideways â€” pattern needs directional trend' };
    }
  }

  // â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
  // â”€â”€ CONDITION 3: HA Candle 3 â€” Body crosses C2 body + Correct Color â”€â”€â”€â”€â”€â”€â”€
  // â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
  // Bearish: C3 must be RED  (HA_Close < HA_Open) AND HA body crosses below C2 body
  // Bullish: C3 must be GREEN (HA_Close > HA_Open) AND HA body crosses above C2 body
  function checkCandle3(c3, c2, trend) {
    const m3 = candleMetrics(c3);
    const m2 = candleMetrics(c2);

    if (m3.range === 0) return { pass: false, reason: 'Zero-range HA candle' };

    if (trend === 'bearish') {
      if (m3.bullish) {
        return {
          pass: false,
          reason: 'HA C3 must be RED for bearish (HA_Close ' + c3.close.toFixed(2) + ' â‰¥ HA_Open ' + c3.open.toFixed(2) + ')',
        };
      }
      const tol = Math.max(CONFIG.WICK_TOLERANCE_ABS, c3.close * 0.001);
      if (m3.upperWick > tol) { return { pass: false, reason: 'Bearish C3: HA upper wick present (' + m3.upperWick.toFixed(4) + ' > ' + tol + ') - Pattern failure' }; }
      const crossed = m3.bodyBot < m2.bodyBot;
      return {
        pass: crossed,
        reason: crossed
          ? 'âœ“ Red HA C3 body crosses below C2 body (C3_bot: ' + m3.bodyBot.toFixed(2) + ' < C2_bot: ' + m2.bodyBot.toFixed(2) + ')'
          : 'HA C3 body did not cross below C2 body (C3_bot: ' + m3.bodyBot.toFixed(2) + ' â‰¥ C2_bot: ' + m2.bodyBot.toFixed(2) + ')',
        metrics: { m3, m2 },
      };

    } else if (trend === 'bullish') {
      if (!m3.bullish) {
        return {
          pass: false,
          reason: 'HA C3 must be GREEN for bullish (HA_Close ' + c3.close.toFixed(2) + ' â‰¤ HA_Open ' + c3.open.toFixed(2) + ')',
        };
      }
      const tol = Math.max(CONFIG.WICK_TOLERANCE_ABS, c3.close * 0.001);
      if (m3.lowerWick > tol) { return { pass: false, reason: 'Bullish C3: HA lower wick present (' + m3.lowerWick.toFixed(4) + ' > ' + tol + ') - Pattern failure' }; }
      const crossed = m3.bodyTop > m2.bodyTop;
      return {
        pass: crossed,
        reason: crossed
          ? 'âœ“ Green HA C3 body crosses above C2 body (C3_top: ' + m3.bodyTop.toFixed(2) + ' > C2_top: ' + m2.bodyTop.toFixed(2) + ')'
          : 'HA C3 body did not cross above C2 body (C3_top: ' + m3.bodyTop.toFixed(2) + ' â‰¤ C2_top: ' + m2.bodyTop.toFixed(2) + ')',
        metrics: { m3, m2 },
      };

    } else {
      return { pass: false, reason: 'Sideways â€” not applicable' };
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â”€â”€ Main Evaluate (converts raw â†’ HA, then applies all 3 conditions) â”€â”€â”€â”€â”€â”€â”€
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function evaluate(symbol, rawCandles, meta) {
    if (!meta) meta = {};

    if (!rawCandles || rawCandles.length < CONFIG.MIN_CANDLES) {
      return {
        symbol, meta, pass: false,
        reason: 'Insufficient data: ' + (rawCandles ? rawCandles.length : 0) + ' candles (need ' + CONFIG.MIN_CANDLES + ')',
      };
    }

    const haCandles = convertToHeikinAshi(rawCandles);
    const MAX_LOOKBACK = 10;
    const len = haCandles.length;
    
    let bestResult = null;
    let fallbackResult = null;

    for (const testTrend of ['bullish', 'bearish']) {
        let matchFound = false;
        let sequenceIndices = [];
        let rejectReason = 'No valid pattern found';
        let finalC1, finalC2, finalC3;
        let finalR1, finalR2, finalR3;

        for (let i = len - 1; i >= len - 1 - MAX_LOOKBACK && i >= 2; i--) {
            const c1 = haCandles[i - 2];
            const c2 = haCandles[i - 1];
            const c3 = haCandles[i];

            const r1 = checkCandle1(c1);
            const r2 = checkCandle2(c2, testTrend);
            const r3 = checkCandle3(c3, c2, testTrend);

            if (r1.pass && r2.pass && r3.pass) {
                let continuationValid = true;
                let lastBodyEnd = testTrend === 'bearish' ? candleMetrics(c3).bodyBot : candleMetrics(c3).bodyTop;
                let tempIndices = [i - 2, i - 1, i];
                
                for (let j = i + 1; j < len; j++) {
                    const cNext = haCandles[j];
                    const mNext = candleMetrics(cNext);
                    const tol = Math.max(CONFIG.WICK_TOLERANCE_ABS, cNext.close * 0.001);

                    if (testTrend === 'bearish') {
                        if (mNext.bullish || mNext.upperWick > tol) {
                            continuationValid = false;
                            rejectReason = 'Trend broken at C' + (tempIndices.length + 1) + ' (not bearish or has upper wick)';
                            break;
                        }
                        if (mNext.bodyBot >= lastBodyEnd) {
                            continuationValid = false;
                            rejectReason = 'Trend broken at C' + (tempIndices.length + 1) + ' (body did not cross previous body)';
                            break;
                        }
                        lastBodyEnd = mNext.bodyBot;
                    } else {
                        if (!mNext.bullish || mNext.lowerWick > tol) {
                            continuationValid = false;
                            rejectReason = 'Trend broken at C' + (tempIndices.length + 1) + ' (not bullish or has lower wick)';
                            break;
                        }
                        if (mNext.bodyTop <= lastBodyEnd) {
                            continuationValid = false;
                            rejectReason = 'Trend broken at C' + (tempIndices.length + 1) + ' (body did not cross previous body)';
                            break;
                        }
                        lastBodyEnd = mNext.bodyTop;
                    }
                    tempIndices.push(j);
                }

                if (continuationValid) {
                    matchFound = true;
                    sequenceIndices = tempIndices;
                    finalC1 = c1; finalC2 = c2; finalC3 = haCandles[len - 1];
                    finalR1 = r1; finalR2 = r2; finalR3 = r3;
                    rejectReason = 'Pattern met and trend continued for ' + sequenceIndices.length + ' candles!';
                    break; 
                }
            } else {
                if (i === len - 1 && !fallbackResult) {
                   fallbackResult = {
                       trend: testTrend,
                       c1, c2, c3, r1, r2, r3,
                       rejectReason: [r1, r2, r3].find(r => !r.pass)?.reason || 'Failed'
                   };
                }
            }
        }

        const rawLatest = rawCandles[rawCandles.length - 1];
        const rawPrev = rawCandles[rawCandles.length - 4] || rawCandles[rawCandles.length - 2];
        const changePct = ((rawLatest.close - rawPrev.close) / rawPrev.close * 100);

        if (matchFound) {
            const entry = rawLatest.close;
            let sl, t1, t2, risk, riskPct;
            if (testTrend === 'bullish') {
                sl = finalC1.low;
                risk = Math.max(0.05, entry - sl);
                riskPct = (risk / entry) * 100;
                t1 = entry + risk * 1.5;
                t2 = entry + risk * 2.0;
            } else {
                sl = finalC1.high;
                risk = Math.max(0.05, sl - entry);
                riskPct = (risk / entry) * 100;
                t1 = entry - risk * 1.5;
                t2 = entry - risk * 2.0;
            }

            const levels = {
                entry: parseFloat(entry.toFixed(2)),
                sl: parseFloat(sl.toFixed(2)),
                risk: parseFloat(risk.toFixed(2)),
                riskPct: parseFloat(riskPct.toFixed(2)),
                t1: parseFloat(t1.toFixed(2)),
                t2: parseFloat(t2.toFixed(2)),
                rr: '1:2',
                slRef: testTrend === 'bullish' ? 'C1 Low' : 'C1 High'
            };

            bestResult = {
                symbol, meta, pass: true, trend: testTrend, sequenceIndices,
                conditions: { c1: finalR1, c2: finalR2, c3: finalR3 },
                haCandles: { c1: finalC1, c2: finalC2, c3: finalC3 },
                allHACandles: haCandles, allCandles: rawCandles,
                levels,
                stats: {
                    latestClose: rawLatest.close, haClose: haCandles[len - 1].close,
                    changePct: parseFloat(changePct.toFixed(2)),
                    changeSign: changePct >= 0 ? '+' : '',
                    volume: rawLatest.volume, date: rawLatest.date,
                },
                reason: rejectReason
            };
            break;
        }
    }

    if (bestResult) return bestResult;

    // If no match found in either trend, return fallback
    const rawLatest = rawCandles[rawCandles.length - 1];
    const rawPrev = rawCandles[rawCandles.length - 4] || rawCandles[rawCandles.length - 2];
    const changePct = ((rawLatest.close - rawPrev.close) / rawPrev.close * 100);
    
    if (fallbackResult) {
        return {
            symbol, meta, pass: false, trend: fallbackResult.trend, sequenceIndices: [],
            conditions: { c1: fallbackResult.r1, c2: fallbackResult.r2, c3: fallbackResult.r3 },
            haCandles: { c1: fallbackResult.c1, c2: fallbackResult.c2, c3: fallbackResult.c3 },
            allHACandles: haCandles, allCandles: rawCandles,
            stats: {
                latestClose: rawLatest.close, haClose: haCandles[len - 1].close,
                changePct: parseFloat(changePct.toFixed(2)),
                changeSign: changePct >= 0 ? '+' : '',
                volume: rawLatest.volume, date: rawLatest.date,
            },
            reason: fallbackResult.rejectReason
        };
    }
    
    return { symbol, meta, pass: false, reason: 'Failed', haCandles: {}, allHACandles: haCandles, allCandles: rawCandles };
  }

    function evaluateAll(fetchedResults) {
    const matched = [], failed = [];
    for (const item of fetchedResults) {
      const result = evaluate(item.symbol, item.candles, item.meta || {});
      if (result.pass) matched.push(result);
      else failed.push(result);
    }
    matched.sort((a, b) => {
      if (a.trend !== b.trend) return a.trend === 'bullish' ? -1 : 1;
      return Math.abs(b.stats.changePct) - Math.abs(a.stats.changePct);
    });
    return { matched, failed, total: fetchedResults.length };
  }

  // â”€â”€ SMA on HA closes (for chart overlay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function computeSMA(candles, period) {
    if (!period) period = 20;
    const closes = candles.map(c => c.close);
    return sma(closes, period);
  }

  return {
    evaluate,
    evaluateAll,
    detectTrend,
    computeSMA,
    convertToHeikinAshi,
    CONFIG,
  };
})();











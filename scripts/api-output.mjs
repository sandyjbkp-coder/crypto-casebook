#!/usr/bin/env node

const raw = process.argv[2] || "SUI";
const symbol = raw.toUpperCase().replace(/USDT$/, "") + "USDT";

const BASE = "https://api.bybit.com/v5/market/kline";

async function candles(interval, limit = 100) {
  const url =
    `${BASE}?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();

  if (json.retCode !== 0) {
    throw new Error(json.retMsg || "Bybit API error");
  }

  return json.result.list
    .map(x => ({
      time: Number(x[0]),
      open: Number(x[1]),
      high: Number(x[2]),
      low: Number(x[3]),
      close: Number(x[4]),
      volume: Number(x[5])
    }))
    .reverse();
}

function atr(data, period = 14) {
  if (data.length < period + 1) return null;

  const values = [];

  for (let i = 1; i < data.length; i++) {
    const c = data[i];
    const p = data[i - 1];

    values.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  const recent = values.slice(-period);

  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function pivots(data, left = 2, right = 2) {
  const highs = [];
  const lows = [];

  for (let i = left; i < data.length - right; i++) {
    let high = true;
    let low = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;

      if (data[j].high >= data[i].high) high = false;
      if (data[j].low <= data[i].low) low = false;
    }

    if (high) highs.push(data[i].high);
    if (low) lows.push(data[i].low);
  }

  return { highs, lows };
}

function structure(data) {
  const { highs, lows } = pivots(data);

  if (highs.length < 2 || lows.length < 2) {
    return { label: "UNKNOWN", direction: "UNKNOWN" };
  }

  const h1 = highs.at(-2);
  const h2 = highs.at(-1);
  const l1 = lows.at(-2);
  const l2 = lows.at(-1);

  const hs = h2 > h1 ? "HH" : h2 < h1 ? "LH" : "EH";
  const ls = l2 > l1 ? "HL" : l2 < l1 ? "LL" : "EL";

  let label = "MIXED / TRANSITION";
  let direction = "MIXED";

  if (hs === "HH" && ls === "HL") {
    label = "HH / HL";
    direction = "UP";
  }

  if (hs === "LH" && ls === "LL") {
    label = "LH / LL";
    direction = "DOWN";
  }

  return {
    label,
    direction,
    highState: hs,
    lowState: ls
  };
}

function quality(data, minutes) {
  const expected = minutes * 60 * 1000;

  if (!Array.isArray(data) || data.length < 50) {
    return "MISSING";
  }

  for (let i = 1; i < data.length; i++) {
    const gap = data[i].time - data[i - 1].time;

    if (gap <= 0 || gap > expected * 1.5) {
      return "FAIL";
    }
  }

  return "VERIFIED";
}

function frame(data, minutes) {
  const st = structure(data);
  const a = atr(data);

  return {
    close: data.at(-1).close,
    structure: st.label,
    direction: st.direction,
    swings: {
      high: st.highState || null,
      low: st.lowState || null
    },
    atr14: a,
    normalizedAtr:
      a && data.at(-1).close
        ? (a / data.at(-1).close) * 100
        : null,
    dataQuality: quality(data, minutes)
  };
}

try {
  const [m15, h1, h4] = await Promise.all([
    candles("15"),
    candles("60"),
    candles("240")
  ]);

  const f15 = frame(m15, 15);
  const f1 = frame(h1, 60);
  const f4 = frame(h4, 240);

  const directions = [f15.direction, f1.direction, f4.direction];

  const verified =
    f15.dataQuality === "VERIFIED" &&
    f1.dataQuality === "VERIFIED" &&
    f4.dataQuality === "VERIFIED";

  const aligned =
    verified &&
    directions.every(x => x === "UP") ||
    verified &&
    directions.every(x => x === "DOWN");

  const output = {
    schemaVersion: 1,
    symbol,
    source: "BYBIT_PUBLIC",
    generatedAt: new Date().toISOString(),

    dataGate: verified ? "PASS" : "FAIL",

    frames: {
      "15m": f15,
      "1h": f1,
      "4h": f4
    },

    integrity: {
      alignment: aligned ? "ALIGNED" : "CONFLICTING",
      gate: aligned ? "PASS" : "FAIL",
      state: aligned ? "RESEARCH_CANDIDATE" : "NO_SETUP"
    },

    ui: {
      headline:
        aligned ? "RESEARCH CANDIDATE" : "NO SETUP",

      message:
        aligned
          ? "Multi-timeframe structure is aligned."
          : "Current timeframe evidence is conflicting."
    },

    candles: {
      "15m": m15.slice(-60)
    }
  };

  console.log(JSON.stringify(output, null, 2));

} catch (err) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    symbol,
    error: true,
    message: err.message
  }, null, 2));

  process.exitCode = 1;
}

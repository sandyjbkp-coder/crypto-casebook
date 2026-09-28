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
    .map((x) => ({
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

  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const c = data[i];
    const prev = data[i - 1];

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      )
    );
  }

  const recent = tr.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function structure(data, lookback = 20) {
  const x = data.slice(-lookback);

  if (x.length < 2) return "UNKNOWN";

  const half = Math.floor(x.length / 2);
  const old = x.slice(0, half);
  const recent = x.slice(half);

  const oldHigh = Math.max(...old.map((c) => c.high));
  const oldLow = Math.min(...old.map((c) => c.low));

  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));

  if (recentHigh > oldHigh && recentLow > oldLow) {
    return "HIGHER-HIGH / HIGHER-LOW";
  }

  if (recentHigh < oldHigh && recentLow < oldLow) {
    return "LOWER-HIGH / LOWER-LOW";
  }

  return "MIXED / RANGE";
}

function summary(data) {
  const last = data[data.length - 1];
  const first = data[data.length - 20] || data[0];

  const change20 =
    ((last.close - first.close) / first.close) * 100;

  return {
    close: last.close,
    change20,
    atr14: atr(data),
    structure: structure(data)
  };
}

try {
  console.log("================================");
  console.log("CRYPTO CASEBOOK - MARKET DIAGNOSTICS");
  console.log("EDUCATIONAL / PAPER RESEARCH");
  console.log("================================");
  console.log("Symbol:", symbol);
  console.log("");

  const [m15, h1, h4] = await Promise.all([
    candles("15"),
    candles("60"),
    candles("240")
  ]);

  const s15 = summary(m15);
  const s1 = summary(h1);
  const s4 = summary(h4);

  console.log("15m");
  console.log(" Close:", s15.close);
  console.log(" 20-candle change:", s15.change20.toFixed(2) + "%");
  console.log(" ATR14:", s15.atr14.toFixed(6));
  console.log(" Structure:", s15.structure);
  console.log("");

  console.log("1h");
  console.log(" Close:", s1.close);
  console.log(" 20-candle change:", s1.change20.toFixed(2) + "%");
  console.log(" ATR14:", s1.atr14.toFixed(6));
  console.log(" Structure:", s1.structure);
  console.log("");

  console.log("4h");
  console.log(" Close:", s4.close);
  console.log(" 20-candle change:", s4.change20.toFixed(2) + "%");
  console.log(" ATR14:", s4.atr14.toFixed(6));
  console.log(" Structure:", s4.structure);
  console.log("");

  console.log("Data quality: LIVE PUBLIC MARKET DATA");
  console.log("No order execution or real-money trade signal generated.");
} catch (err) {
  console.error("DATA ERROR:", err.message);
  process.exitCode = 1;
}

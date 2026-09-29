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

function findPivots(data, left = 2, right = 2) {
  const highs = [];
  const lows = [];

  for (let i = left; i < data.length - right; i++) {
    const c = data[i];

    let isHigh = true;
    let isLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;

      if (data[j].high >= c.high) isHigh = false;
      if (data[j].low <= c.low) isLow = false;
    }

    if (isHigh) {
      highs.push({ time: c.time, price: c.high });
    }

    if (isLow) {
      lows.push({ time: c.time, price: c.low });
    }
  }

  return { highs, lows };
}

function structure(data) {
  const { highs, lows } = findPivots(data);

  if (highs.length < 2 || lows.length < 2) {
    return {
      label: "UNKNOWN",
      highState: null,
      lowState: null
    };
  }

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];

  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];

  const highState =
    h2.price > h1.price ? "HH" :
    h2.price < h1.price ? "LH" : "EH";

  const lowState =
    l2.price > l1.price ? "HL" :
    l2.price < l1.price ? "LL" : "EL";

  let label = "MIXED / TRANSITION";

  if (highState === "HH" && lowState === "HL") {
    label = "HH / HL";
  } else if (highState === "LH" && lowState === "LL") {
    label = "LH / LL";
  }

  return {
    label,
    highState,
    lowState,
    previousHigh: h1,
    lastHigh: h2,
    previousLow: l1,
    lastLow: l2
  };
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

function validateCandles(data, intervalMinutes) {
  if (!Array.isArray(data) || data.length < 50) {
    return {
      status: "MISSING",
      pass: false,
      reason: "Insufficient candle history"
    };
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  const now = Date.now();

  for (const c of data) {
    if (
      !Number.isFinite(c.time) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(c.volume)
    ) {
      return {
        status: "UNRELIABLE",
        pass: false,
        reason: "Non-numeric candle field detected"
      };
    }

    if (
      c.high < c.low ||
      c.high < c.open ||
      c.high < c.close ||
      c.low > c.open ||
      c.low > c.close
    ) {
      return {
        status: "UNRELIABLE",
        pass: false,
        reason: "Invalid OHLC relationship detected"
      };
    }
  }

  for (let i = 1; i < data.length; i++) {
    const gap = data[i].time - data[i - 1].time;

    if (gap <= 0) {
      return {
        status: "CONFLICTING",
        pass: false,
        reason: "Duplicate or non-chronological candles"
      };
    }

    if (gap > intervalMs * 1.5) {
      return {
        status: "MISSING",
        pass: false,
        reason: "Candle timestamp gap detected"
      };
    }
  }

  const last = data[data.length - 1];
  const age = now - last.time;

  if (age > intervalMs * 2.5) {
    return {
      status: "STALE",
      pass: false,
      reason: "Latest candle is stale"
    };
  }

  return {
    status: "VERIFIED",
    pass: true,
    reason: "Chronology, freshness and OHLC checks passed"
  };
}

function dataQualityGate(m15, h1, h4) {
  const q15 = validateCandles(m15, 15);
  const q1 = validateCandles(h1, 60);
  const q4 = validateCandles(h4, 240);

  const pass = q15.pass && q1.pass && q4.pass;

  return {
    pass,
    status: pass ? "VERIFIED" : "FAIL",
    frames: {
      "15m": q15,
      "1h": q1,
      "4h": q4
    }
  };
}

function normalizedATR(data, period = 14) {
  if (data.length < period + 1) return null;

  const value = atr(data, period);
  const close = data[data.length - 1].close;

  if (!value || !close) return null;

  return (value / close) * 100;
}

function atrRatio(data, period = 14) {
  if (data.length < period * 3) return null;

  const recent = data.slice(-period - 1);
  const baseline = data.slice(-(period * 3), -(period + 1));

  const recentATR = atr(recent, period);

  const baselineChunks = [];

  for (let i = period; i < baseline.length; i++) {
    const chunk = baseline.slice(i - period, i + 1);
    const value = atr(chunk, period);

    if (value !== null) baselineChunks.push(value);
  }

  if (!recentATR || baselineChunks.length === 0) return null;

  const baselineATR =
    baselineChunks.reduce((a, b) => a + b, 0) /
    baselineChunks.length;

  if (!baselineATR) return null;

  return recentATR / baselineATR;
}

function regime(data, structureResult) {
  const ratio = atrRatio(data);
  const natr = normalizedATR(data);

  if (ratio === null || natr === null) {
    return {
      label: "UNKNOWN",
      volatility: "UNKNOWN",
      atrRatio: ratio,
      normalizedATR: natr
    };
  }

  let volatility = "NORMAL";

  if (ratio >= 1.25) {
    volatility = "EXPANSION";
  } else if (ratio <= 0.75) {
    volatility = "CONTRACTION";
  }

  const direction = directionOf(structureResult);

  let label = "TRANSITION";

  if (
    (direction === "UP" || direction === "DOWN") &&
    volatility === "EXPANSION"
  ) {
    label = "TRENDING / EXPANSION";
  } else if (
    (direction === "UP" || direction === "DOWN") &&
    volatility === "NORMAL"
  ) {
    label = "TRENDING";
  } else if (
    direction === "MIXED" &&
    volatility === "CONTRACTION"
  ) {
    label = "RANGING / CONTRACTION";
  } else if (
    direction === "MIXED" &&
    volatility === "EXPANSION"
  ) {
    label = "TRANSITION / EXPANSION";
  } else if (direction === "MIXED") {
    label = "TRANSITION";
  }

  return {
    label,
    volatility,
    atrRatio: ratio,
    normalizedATR: natr
  };
}

function directionOf(structure) {
  if (!structure || structure.label === "UNKNOWN") return "UNKNOWN";
  if (structure.label === "HH / HL") return "UP";
  if (structure.label === "LH / LL") return "DOWN";
  return "MIXED";
}

function integrityGate(s15, s1, s4) {
  const d15 = directionOf(s15.structure);
  const d1 = directionOf(s1.structure);
  const d4 = directionOf(s4.structure);

  const directions = {
    "15m": d15,
    "1h": d1,
    "4h": d4
  };

  if ([d15, d1, d4].includes("UNKNOWN")) {
    return {
      alignment: "UNRESOLVED",
      gate: "FAIL",
      state: "NO SETUP",
      reason: "One or more timeframes lack confirmed swing structure",
      directions
    };
  }

  if (d15 === "MIXED" || d1 === "MIXED" || d4 === "MIXED") {
    return {
      alignment: "CONFLICTING",
      gate: "FAIL",
      state: "NO SETUP",
      reason: "One or more timeframes are mixed / transitional",
      directions
    };
  }

  if (d15 !== d1 || d1 !== d4) {
    return {
      alignment: "CONFLICTING",
      gate: "FAIL",
      state: "NO SETUP",
      reason: "15m, 1h and 4h directional structures are not aligned",
      directions
    };
  }

  return {
    alignment: "ALIGNED",
    gate: "PASS",
    state: "RESEARCH CANDIDATE",
    reason: "15m, 1h and 4h confirmed swing structures agree",
    directions
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
  console.log(" Structure:", s15.structure.label);
  console.log(" Last swings:", s15.structure.highState || "-", "/", s15.structure.lowState || "-");
  console.log("");

  console.log("1h");
  console.log(" Close:", s1.close);
  console.log(" 20-candle change:", s1.change20.toFixed(2) + "%");
  console.log(" ATR14:", s1.atr14.toFixed(6));
  console.log(" Structure:", s1.structure.label);
  console.log(" Last swings:", s1.structure.highState || "-", "/", s1.structure.lowState || "-");
  console.log("");

  console.log("4h");
  console.log(" Close:", s4.close);
  console.log(" 20-candle change:", s4.change20.toFixed(2) + "%");
  console.log(" ATR14:", s4.atr14.toFixed(6));
  console.log(" Structure:", s4.structure.label);
  console.log(" Last swings:", s4.structure.highState || "-", "/", s4.structure.lowState || "-");
  console.log("");

  const quality = dataQualityGate(m15, h1, h4);

  console.log("================================");
  console.log("DATA QUALITY");
  console.log("================================");

  console.log(
    "15m:",
    quality.frames["15m"].status,
    "|",
    quality.frames["15m"].reason
  );

  console.log(
    "1h:",
    quality.frames["1h"].status,
    "|",
    quality.frames["1h"].reason
  );

  console.log(
    "4h:",
    quality.frames["4h"].status,
    "|",
    quality.frames["4h"].reason
  );

  console.log("Data Gate:", quality.pass ? "PASS" : "FAIL");
  console.log("");

  const r15 = regime(m15, s15.structure);
  const r1 = regime(h1, s1.structure);
  const r4 = regime(h4, s4.structure);

  console.log("================================");
  console.log("MARKET REGIME");
  console.log("================================");

  console.log(
    "15m:",
    r15.label,
    "| ATR Ratio:",
    r15.atrRatio?.toFixed(2) ?? "N/A",
    "| NATR:",
    r15.normalizedATR?.toFixed(2) + "%" ?? "N/A"
  );

  console.log(
    "1h:",
    r1.label,
    "| ATR Ratio:",
    r1.atrRatio?.toFixed(2) ?? "N/A",
    "| NATR:",
    r1.normalizedATR?.toFixed(2) + "%" ?? "N/A"
  );

  console.log(
    "4h:",
    r4.label,
    "| ATR Ratio:",
    r4.atrRatio?.toFixed(2) ?? "N/A",
    "| NATR:",
    r4.normalizedATR?.toFixed(2) + "%" ?? "N/A"
  );

  console.log("");

  const integrity = integrityGate(s15, s1, s4);

  console.log("================================");
  console.log("DECISION INTEGRITY");
  console.log("================================");
  console.log("15m Direction:", integrity.directions["15m"]);
  console.log("1h Direction:", integrity.directions["1h"]);
  console.log("4h Direction:", integrity.directions["4h"]);
  console.log("TF Alignment:", integrity.alignment);
  console.log("Integrity Gate:", integrity.gate);
  console.log("Research State:", integrity.state);
  console.log("Reason:", integrity.reason);
  console.log("");

  console.log("Data quality: LIVE PUBLIC MARKET DATA");
  console.log("No order execution or real-money trade signal generated.");
} catch (err) {
  console.error("DATA ERROR:", err.message);
  process.exitCode = 1;
}

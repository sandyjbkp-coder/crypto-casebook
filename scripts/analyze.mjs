#!/usr/bin/env node

const raw = process.argv[2] || "SUI";
const symbol = raw.toUpperCase().replace(/USDT$/, "") + "USDT";

console.log("================================");
console.log("CRYPTO CASEBOOK");
console.log("DEMO / PAPER RESEARCH ONLY");
console.log("================================");
console.log("");
console.log("Symbol:", symbol);
console.log("Market: Bybit USDT perpetual");
console.log("Setup TF: 15m");
console.log("Context TF: 1h / 4h");
console.log("Timezone: IST");
console.log("");

console.log("CASE STUDY OUTPUT");
console.log("1. Symbol:", symbol);
console.log("2. 1h/4h context: pending live data engine");
console.log("3. 15m structure: pending live data engine");
console.log("4. Trigger level: pending");
console.log("5. Entry zone: pending");
console.log("6. SL / invalidation: pending");
console.log("7. TP1 / TP2: pending");
console.log("8. Fee-adjusted R:R: pending");
console.log("9. Data quality: MISSING");
console.log("10. Verdict: NO TRADE");
console.log("");
console.log("Note: VALID DEMO means rule-pass only, not guaranteed profit.");

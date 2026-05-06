#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const INDEXES = [
  ["S&P 500", "^GSPC"],
  ["Nasdaq Comp.", "^IXIC"],
  ["Dow Jones Ind.", "^DJI"],
  ["Russell 2000", "^RUT"],
  ["VIX", "^VIX"],
];

const ASSETS = [
  ["WTI Crude (CL.F)", "CL=F"],
  ["Gold (GC.F)", "GC=F"],
  ["Bitcoin (BTC)", "BTC-USD"],
  ["USD / EUR", "EURUSD=X"],
  ["10-Yr Treasury", "^TNX"],
];

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function money(value, digits = 2) {
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(value, digits = 2) {
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;
}

function todayET() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")}`;
}

async function yahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=ytd&interval=1d&includePrePost=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo chart failed for ${symbol}: ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const meta = result?.meta || {};
  const closes = (quote?.close || []).filter((n) => typeof n === "number");
  if (closes.length < 2) throw new Error(`Yahoo chart returned insufficient data for ${symbol}`);
  const last = meta.regularMarketPrice || closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  const weekBase = closes.length > 6 ? closes[closes.length - 6] : closes[0];
  const ytdBase = meta.chartPreviousClose || closes[0];
  return {
    last,
    oneDay: ((last - previous) / previous) * 100,
    oneWeek: ((last - weekBase) / weekBase) * 100,
    ytd: ((last - ytdBase) / ytdBase) * 100,
  };
}

async function marketRows(items) {
  const rows = [];
  for (const [name, symbol] of items) {
    const quote = await yahooChart(symbol);
    if (symbol === "^TNX") {
      rows.push([name, `${(quote.last / 10).toFixed(3)}%`, pct(quote.oneDay * 10), pct(quote.oneWeek), pct(quote.ytd)]);
    } else if (symbol === "EURUSD=X") {
      rows.push([name, quote.last.toFixed(4), pct(quote.oneDay), pct(quote.oneWeek), pct(quote.ytd)]);
    } else if (symbol === "^VIX") {
      rows.push([name, money(quote.last), quote.oneDay > 0 ? `+${quote.oneDay.toFixed(2)}` : quote.oneDay.toFixed(2), pct(quote.oneWeek), pct(quote.ytd)]);
    } else {
      rows.push([name, money(quote.last), pct(quote.oneDay), pct(quote.oneWeek), pct(quote.ytd)]);
    }
  }
  return rows;
}

async function yahooScreener(scrId, count = 5) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo screener failed for ${scrId}: ${res.status}`);
  const json = await res.json();
  return json.finance?.result?.[0]?.quotes || [];
}

function moverRow(q, positive) {
  const symbol = q.symbol || "";
  const name = (q.shortName || q.longName || symbol).split(",")[0].slice(0, 16);
  const price = typeof q.regularMarketPrice === "number" ? money(q.regularMarketPrice) : "n/a";
  const move = typeof q.regularMarketChangePercent === "number" ? pct(q.regularMarketChangePercent, 1) : "n/a";
  const commentary = positive
    ? "Daily mover screen flagged upside momentum; verify earnings catalyst before publishing. Read-through: sector peers."
    : "Daily mover screen flagged downside pressure; verify earnings catalyst before publishing. Read-through: sector peers.";
  return [symbol, name, price, move, commentary];
}

async function earningsRows() {
  const override = env("EARNINGS_MOVERS_JSON");
  if (override) {
    const parsed = JSON.parse(override);
    if (!parsed.beats?.length || !parsed.misses?.length) throw new Error("EARNINGS_MOVERS_JSON must include beats and misses arrays");
    return parsed;
  }
  const [gainers, losers] = await Promise.all([yahooScreener("day_gainers", 8), yahooScreener("day_losers", 8)]);
  return {
    beats: gainers.slice(0, 5).map((q) => moverRow(q, true)),
    misses: losers.slice(0, 5).map((q) => moverRow(q, false)),
  };
}

function tone(indexes, assets) {
  const [spx, ndx, dow, rut, vix] = indexes;
  const crude = assets[0];
  const gold = assets[1];
  return `Tone - U.S. markets enter the morning with ${spx[0]} at ${spx[1]} (${spx[2]}) and ${ndx[0]} at ${ndx[1]} (${ndx[2]}), while ${rut[0]} shows ${rut[2]} breadth. The VIX sits at ${vix[1]}, keeping risk appetite and hedging demand in focus. Cross-asset signals remain mixed: WTI trades near ${crude[1]} and gold near ${gold[1]}, leaving the tape sensitive to inflation, rates, and liquidity headlines.`;
}

function themes(indexes, assets, earnings) {
  return [
    `Risk Breadth Check. ${indexes[3][0]} is moving ${indexes[3][2]}, a useful signal for whether participation is broadening beyond mega-cap leadership. Key read-throughs: IWM, KRE, XLI, XRT, RSP.`,
    `Growth Duration Watch. ${indexes[1][0]} at ${indexes[1][1]} keeps AI and software duration in focus into the open. Read-throughs: NVDA, MSFT, AVGO, AMD, SMH.`,
    `Energy Input Risk. WTI near ${assets[0][1]} keeps fuel costs and inflation sensitivity on the morning checklist. Read-throughs: XOM, CVX, MPC, DAL, UPS.`,
    `Hedge Demand. Gold near ${assets[1][1]} and VIX at ${indexes[4][1]} frame the defensive bid. Read-throughs: GLD, NEM, WPM, AEM, PG.`,
    `Overnight Movers Matter. ${earnings.beats[0]?.[0] || "Top gainers"} and ${earnings.misses[0]?.[0] || "top decliners"} set the first read on single-name risk appetite. Read-throughs should be verified against earnings catalysts before distribution.`,
  ];
}

async function main() {
  const output = path.resolve(arg("out", `data/morning-call-${new Date().toISOString().slice(0, 10)}.json`));
  const [indexes, assets, earnings] = await Promise.all([marketRows(INDEXES), marketRows(ASSETS), earningsRows()]);
  const data = {
    date: todayET(),
    analyst: env("ANALYST", "Leo"),
    subtitle: "Live snapshot - delayed quotes where applicable",
    market: { indexes, assets },
    tone: tone(indexes, assets),
    earnings,
    themes: themes(indexes, assets, earnings),
    sourceNote: "Live automated version. Market snapshot: Yahoo Finance. Earnings movers: override JSON when available; otherwise Yahoo daily gainers/losers screen. Delayed quotes may apply.",
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

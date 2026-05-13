#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const GROUPS = {
  rates: [
    ["13W T-Bill", "^IRX", "yield10"],
    ["5Y UST", "^FVX", "yield10"],
    ["10Y UST", "^TNX", "yield10"],
    ["30Y UST", "^TYX", "yield10"],
  ],
  equities: [
    ["S&P 500", "^GSPC"],
    ["Nasdaq", "^IXIC"],
    ["Dow Jones", "^DJI"],
    ["Hang Seng", "^HSI"],
    ["Hang Seng Tech", "^HSTECH"],
    ["Shanghai Comp.", "000001.SS"],
    ["Shenzhen Comp.", "399001.SZ"],
    ["CSI 300", "000300.SS"],
    ["CSI 500", "000905.SS"],
    ["CSI 1000", "000852.SS"],
  ],
  usMega7: [
    ["Apple", "AAPL"],
    ["Microsoft", "MSFT"],
    ["Nvidia", "NVDA"],
    ["Amazon", "AMZN"],
    ["Alphabet", "GOOGL"],
    ["Meta", "META"],
    ["Tesla", "TSLA"],
  ],
  cnMega7: [
    ["Tencent", "0700.HK"],
    ["Alibaba", "9988.HK"],
    ["Meituan", "3690.HK"],
    ["JD.com", "9618.HK"],
    ["Xiaomi", "1810.HK"],
    ["BYD", "1211.HK"],
    ["Kweichow Moutai", "600519.SS"],
  ],
  commodities: [
    ["Gold", "GC=F"],
    ["Silver", "SI=F"],
    ["Copper", "HG=F"],
    ["Aluminum", "ALI=F"],
    ["WTI Oil", "CL=F"],
  ],
};

const NEWS_RSS = [
  ["Yahoo Finance", "https://finance.yahoo.com/news/rssindex"],
  ["MarketWatch Economy", "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines"],
  ["Reuters Business", "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best"],
];

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function pct(value, digits = 2) {
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;
}

function number(value, digits = 2) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function todayShanghai() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date());
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function yahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includePrePost=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo chart failed for ${symbol}: ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const meta = result?.meta || {};
  const closes = (quote?.close || []).filter((n) => typeof n === "number");
  if (closes.length < 2) throw new Error(`Insufficient close data for ${symbol}`);
  const last = meta.regularMarketPrice || closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const week = closes.length > 6 ? closes[closes.length - 6] : closes[0];
  const month = closes[0];
  return {
    last,
    change: last - prev,
    oneDay: ((last - prev) / prev) * 100,
    oneWeek: ((last - week) / week) * 100,
    oneMonth: ((last - month) / month) * 100,
    currency: meta.currency || "",
    marketState: meta.marketState || "",
  };
}

function formatQuote(name, symbol, quote, type = "") {
  const isYield = type === "yield10";
  return {
    name,
    symbol,
    last: isYield ? `${number(quote.last / 10, 3)}%` : number(quote.last, quote.last < 10 ? 3 : 2),
    change: isYield ? `${quote.change > 0 ? "+" : ""}${number(quote.change * 10, 1)} bps` : pct(quote.oneDay),
    oneDay: pct(quote.oneDay),
    oneWeek: pct(quote.oneWeek),
    oneMonth: pct(quote.oneMonth),
    direction: quote.oneDay >= 0 ? "up" : "down",
    currency: quote.currency,
    marketState: quote.marketState,
  };
}

async function fetchGroup(items) {
  const rows = [];
  for (const [name, symbol, type] of items) {
    try {
      rows.push(formatQuote(name, symbol, await yahooChart(symbol), type));
    } catch (error) {
      rows.push({ name, symbol, last: "n/a", change: "n/a", oneDay: "n/a", oneWeek: "n/a", oneMonth: "n/a", direction: "flat", error: error.message });
    }
  }
  return rows;
}

async function fetchNews() {
  const override = env("NEWS_ITEMS_JSON");
  if (override) return JSON.parse(override);
  const items = [];
  for (const [source, url] of NEWS_RSS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const block of blocks.slice(0, 6)) {
        const title = stripHtml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
        const description = stripHtml(block.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
        const link = stripHtml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
        if (title && !items.some((item) => item.title === title)) {
          items.push({ source, title, summary: description.slice(0, 120) || "Market-relevant headline to monitor today.", link });
        }
      }
    } catch {
      // Keep the report alive if one RSS source is unavailable.
    }
  }
  return items.slice(0, 6);
}

function topMoves(rows, n = 3) {
  return rows
    .filter((row) => row.oneDay !== "n/a")
    .map((row) => ({ ...row, abs: Math.abs(Number(row.oneDay.replace("%", ""))) }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, n);
}

function buildNarrative(sections, news) {
  const equityMoves = topMoves([...sections.equities, ...sections.usMega7, ...sections.cnMega7], 4)
    .map((row) => `${row.name} ${row.oneDay}`)
    .join(", ");
  const commodityMoves = topMoves(sections.commodities, 2)
    .map((row) => `${row.name} ${row.oneDay}`)
    .join(", ");
  const rateLine = sections.rates.map((row) => `${row.name} ${row.last}`).join("; ");
  return [
    `利率: ${rateLine}。`,
    `权益: 今日重点波动为 ${equityMoves || "暂无显著波动"}。`,
    `大宗: ${commodityMoves || "暂无显著波动"}。`,
    `新闻: ${news[0]?.title || "暂无可用新闻标题"}。`,
  ];
}

async function main() {
  const output = path.resolve(arg("out", `data/ai-research-${new Date().toISOString().slice(0, 10)}.json`));
  const [rates, equities, usMega7, cnMega7, commodities, news] = await Promise.all([
    fetchGroup(GROUPS.rates),
    fetchGroup(GROUPS.equities),
    fetchGroup(GROUPS.usMega7),
    fetchGroup(GROUPS.cnMega7),
    fetchGroup(GROUPS.commodities),
    fetchNews(),
  ]);
  const data = {
    title: "每日 AI 投研推送",
    date: todayShanghai(),
    analyst: env("ANALYST", "Leo"),
    sources: {
      market: "Yahoo Finance chart API: /v8/finance/chart/{symbol}?range=1mo&interval=1d",
      news: NEWS_RSS.map(([name, url]) => ({ name, url })),
      overrides: ["NEWS_ITEMS_JSON", "EARNINGS_MOVERS_JSON"],
    },
    sections: { rates, equities, usMega7, cnMega7, commodities },
    news,
    narrative: buildNarrative({ rates, equities, usMega7, cnMega7, commodities }, news),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

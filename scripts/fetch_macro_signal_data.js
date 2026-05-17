#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const YAHOO_GROUPS = {
  usRisk: [
    ["S&P 500", ["^GSPC", "^SPX", "SPY"]],
    ["Nasdaq 100", ["^NDX", "QQQ"]],
    ["Russell 2000", ["^RUT", "IWM"]],
    ["RSP", "RSP"],
    ["VIX", "^VIX"],
    ["MOVE", ["^MOVE", "MOVE"]],
    ["HYG", ["HYG", "JNK"]],
    ["LQD", "LQD"],
  ],
  fx: [
    ["DXY", ["DX-Y.NYB", "UUP"]],
    ["EURUSD", "EURUSD=X"],
    ["USDJPY", "JPY=X"],
    ["GBPUSD", "GBPUSD=X"],
    ["USDCNY", "CNY=X"],
    ["AUDUSD", "AUDUSD=X"],
  ],
  china: [
    ["沪深300", "000300.SS"],
    ["创业板ETF", "159915.SZ"],
    ["恒生指数", "^HSI"],
    ["恒生科技ETF", ["3033.HK", "3067.HK"]],
    ["KWEB", "KWEB"],
  ],
  commoditiesGlobal: [
    ["黄金", ["GC=F", "GLD"]],
    ["白银", "SI=F"],
    ["铜", "HG=F"],
    ["WTI原油", "CL=F"],
    ["Brent原油", "BZ=F"],
    ["天然气", "NG=F"],
    ["Nikkei 225", "^N225"],
    ["STOXX 600", ["^STOXX", "VGK", "FEZ"]],
    ["MSCI EM", "EEM"],
  ],
};

const FRED_SERIES = {
  us2y: ["US 2Y", "DGS2"],
  us10y: ["US 10Y", "DGS10"],
  us30y: ["US 30Y", "DGS30"],
  real10y: ["10Y实际利率", "DFII10"],
  breakeven10y: ["10Y通胀预期", "T10YIE"],
};

const NEWS_RSS = [
  ["Yahoo Finance", "https://finance.yahoo.com/news/rssindex"],
  ["MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines"],
  ["Reuters", "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best"],
];

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function pct(value, digits = 2) {
  if (!Number.isFinite(value) || Math.abs(value) > 25) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function bps(value, digits = 1) {
  if (!Number.isFinite(value) || Math.abs(value) > 100) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}bp`;
}

function num(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Yahoo ${symbol}: ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close || []).filter((v) => typeof v === "number");
  const meta = result?.meta || {};
  if (closes.length < 2) throw new Error(`Yahoo ${symbol}: insufficient closes`);
  const last = meta.regularMarketPrice || closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const week = closes.length > 6 ? closes[closes.length - 6] : closes[0];
  const month = closes[0];
  return {
    value: last,
    dayPct: ((last - prev) / prev) * 100,
    weekPct: ((last - week) / week) * 100,
    monthPct: ((last - month) / month) * 100,
    source: "Yahoo Finance chart API",
  };
}

async function fetchWithRetry(url, tries = 3) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
  }
  throw lastError;
}

async function yahooRow(name, symbols) {
  const candidates = Array.isArray(symbols) ? symbols : [symbols];
  const errors = [];
  for (const symbol of candidates) {
    try {
      const q = await yahooChart(symbol);
      return { name, symbol, value: num(q.value, q.value < 10 ? 4 : 2), day: pct(q.dayPct), week: pct(q.weekPct), month: pct(q.monthPct), raw: q };
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }
  return { name, symbol: candidates.join("|"), value: "n/a", day: "n/a", week: "n/a", month: "n/a", error: errors.join("; ") };
}

async function yahooRowOld(name, symbol) {
  try {
    const q = await yahooChart(symbol);
    return { name, symbol, value: num(q.value, q.value < 10 ? 4 : 2), day: pct(q.dayPct), week: pct(q.weekPct), month: pct(q.monthPct), raw: q };
  } catch (error) {
    return { name, symbol, value: "n/a", day: "n/a", week: "n/a", month: "n/a", error: error.message };
  }
}

async function fredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: ${res.status}`);
  const csv = await res.text();
  const rows = csv.trim().split(/\r?\n/).slice(1)
    .map((line) => {
      const [date, value] = line.split(",");
      const parsed = Number(value);
      return Number.isFinite(parsed) ? { date, value: parsed } : null;
    })
    .filter(Boolean);
  if (rows.length < 22) throw new Error(`FRED ${seriesId}: insufficient data`);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const week = rows[rows.length - 6] || rows[0];
  const month = rows[rows.length - 22] || rows[0];
  return {
    value: last.value,
    dayBp: (last.value - prev.value) * 100,
    weekBp: (last.value - week.value) * 100,
    monthBp: (last.value - month.value) * 100,
    date: last.date,
    source: "FRED CSV",
  };
}

async function fredRow(name, seriesId) {
  try {
    const q = await fredSeries(seriesId);
    return { name, seriesId, value: `${q.value.toFixed(2)}%`, day: bps(q.dayBp), week: bps(q.weekBp), month: bps(q.monthBp), raw: q };
  } catch (error) {
    return { name, seriesId, value: "n/a", day: "n/a", week: "n/a", month: "n/a", error: error.message };
  }
}

function spreadRow(name, left, right) {
  if (!left.raw || !right.raw) return { name, value: "n/a", day: "n/a", week: "n/a", month: "n/a", error: "missing spread leg" };
  return {
    name,
    value: `${((left.raw.value - right.raw.value) * 100).toFixed(1)}bp`,
    day: bps(left.raw.dayBp - right.raw.dayBp),
    week: bps(left.raw.weekBp - right.raw.weekBp),
    month: bps(left.raw.monthBp - right.raw.monthBp),
  };
}

async function fetchNews() {
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
          items.push({ source, title, summary: summarizeNews(title, description), link });
        }
      }
    } catch {
      // tolerate one source failure
    }
  }
  return items
    .map((item) => ({ ...item, score: newsScore(item.title, item.summary) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function newsScore(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  let score = 0;
  if (/(cpi|inflation|pce|payroll|jobs|unemployment|gdp|retail sales)/.test(text)) score += 8;
  if (/(fed|fomc|powell|ecb|boj|pboc|central bank|rate cut|rate hike)/.test(text)) score += 8;
  if (/(treasury|yield|bond|dollar|currency|credit|spread)/.test(text)) score += 6;
  if (/(tariff|sanction|war|conflict|geopolitical|china policy|fiscal)/.test(text)) score += 6;
  if (/(nvidia|apple|microsoft|tesla|amazon|alphabet|meta|earnings|guidance)/.test(text)) score += 4;
  if (/(celebrity|sports|lifestyle|auto industry truth)/.test(text)) score -= 6;
  return score;
}

function summarizeNews(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (/(cpi|inflation|pce|price)/.test(text)) return "通胀线索会直接影响降息定价、实际利率和成长股估值。";
  if (/(fed|fomc|powell|rate cut|rate)/.test(text)) return "美联储预期变化会主导美债、美元和风险资产折现率。";
  if (/(earnings|revenue|guidance|profit)/.test(text)) return "财报与指引变化可能触发行业盈利预期修正。";
  if (/(china|tariff|trade|yuan|renminbi)/.test(text)) return "中国资产与汇率相关变量，重点看政策预期和外资风险偏好。";
  if (/(war|conflict|sanction|geopolitical)/.test(text)) return "地缘变量升温时，通常利好避险资产并压制高 beta。";
  return stripHtml(description).slice(0, 90) || "重要市场新闻，需结合价格反应判断方向。";
}

function parsePct(text) {
  const v = Number(String(text || "").replace("%", ""));
  return Number.isFinite(v) ? v : 0;
}

function parseBp(text) {
  const v = Number(String(text || "").replace("bp", ""));
  return Number.isFinite(v) ? v : 0;
}

function rowMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function buildSignals(sections) {
  const us = rowMap(sections.usRisk);
  const rates = rowMap(sections.ratesDollar);
  const china = rowMap(sections.china);
  const comm = rowMap(sections.commoditiesGlobal);
  const riskScore =
    50
    + parsePct(us["S&P 500"]?.day) * 4
    + parsePct(us["Nasdaq 100"]?.day) * 3
    + parsePct(us.RSP?.day) * 2
    - parsePct(us.VIX?.day) * 0.7
    + parsePct(us.HYG?.day) * 6
    - parseBp(rates["US 10Y"]?.day) * 0.2;
  let riskPreference = "Mixed";
  if (riskScore >= 58) riskPreference = "Risk-on";
  if (riskScore <= 42) riskPreference = "Risk-off";

  const factors = [
    ["利率", Math.abs(parseBp(rates["US 10Y"]?.day)) + Math.abs(parseBp(rates["US 2Y"]?.day))],
    ["美元", Math.abs(parsePct(rates.DXY?.day)) + Math.abs(parsePct(rates.USDCNH?.day))],
    ["通胀", Math.abs(parsePct(comm.WTI原油?.day)) + Math.abs(parsePct(comm.铜?.day)) + Math.abs(parseBp(rates["10Y通胀预期"]?.day))],
    ["中国资产", Math.abs(parsePct(china.恒生科技?.day)) + Math.abs(parsePct(china.KWEB?.day)) + Math.abs(parsePct(china.沪深300?.day))],
    ["信用", Math.abs(parsePct(us.HYG?.day)) + Math.abs(parsePct(us.LQD?.day)) + Math.abs(parsePct(us.MOVE?.day))],
  ].sort((a, b) => b[1] - a[1]);
  const dominantFactor = factors[0]?.[0] || "混合";
  const confirmations = [
    parsePct(us["S&P 500"]?.day) > 0,
    parsePct(us.RSP?.day) > 0,
    parsePct(us.VIX?.day) < 0,
    parsePct(us.HYG?.day) >= parsePct(us.LQD?.day),
  ].filter(Boolean).length;
  const tradeQuality = confirmations >= 3 ? "强" : confirmations >= 2 ? "中" : "弱";
  return { riskPreference, dominantFactor, tradeQuality, riskScore: Math.round(Math.max(0, Math.min(100, riskScore))) };
}

function buildText(data) {
  const us = rowMap(data.sections.usRisk);
  const rates = rowMap(data.sections.ratesDollar);
  const china = rowMap(data.sections.china);
  const comm = rowMap(data.sections.commoditiesGlobal);
  const focus = data.news[0]?.title || "价格行为本身";
  const trade = data.signals.dominantFactor;
  const logic = [
    `市场今天主要围绕${trade}定价：标普500 ${us["S&P 500"]?.day}、纳指100 ${us["Nasdaq 100"]?.day}，VIX ${us.VIX?.day}。`,
    `利率端 US 10Y ${rates["US 10Y"]?.value}，日变动 ${rates["US 10Y"]?.day}；信用端 HYG ${us.HYG?.day}、LQD ${us.LQD?.day}，用于确认风险偏好质量。`,
    `中国资产方面，恒生科技ETF ${china.恒生科技ETF?.day}、KWEB ${china.KWEB?.day}，与 USDCNY ${rates.USDCNY?.day} 一起观察外资和人民币压力。`,
  ];
  const outlook = [
    data.signals.tradeQuality === "强"
      ? "当前交易逻辑有较多跨资产确认，短线延续性相对更好，但仍需防范单一数据或央行表态逆转。"
      : "当前交易质量并不算强，更多像是局部资产驱动，追价胜率需要打折。",
    `后续重点观察 10Y 实际利率、DXY/USDCNH、HYG-LQD 相对表现，以及新闻主线“${focus}”是否继续被价格确认。`,
  ];
  return {
    focus,
    trade,
    logic,
    outlook,
    crossAsset: {
      股债关系: parsePct(us["S&P 500"]?.day) > 0 && parseBp(rates["US 10Y"]?.day) > 0 ? "股债同跌压力未显著扩散，需观察利率上行是否压制成长股。" : "股债信号相对温和，关注利率方向是否改变权益估值。",
      美元压力: parsePct(rates.DXY?.day) > 0 || parsePct(rates.USDCNY?.day) > 0 ? "美元偏强，对非美资产和中国资产形成压力。" : "美元压力有限，有利于风险资产和非美资产修复。",
      信用风险: parsePct(us.HYG?.day) < parsePct(us.LQD?.day) ? "高收益债弱于投资级，信用风险偏谨慎。" : "高收益债相对不弱，信用风险暂未明显恶化。",
      商品信号: parsePct(comm.黄金?.day) > 0 && parsePct(comm.WTI原油?.day) > 0 ? "黄金和原油同涨，偏通胀/地缘交易。" : "商品信号分化，暂不构成单一宏观主线。",
      中国资产: parsePct(china.恒生科技ETF?.day) > 0 && parsePct(china.KWEB?.day) > 0 ? "中国互联网资产修复，观察人民币和政策预期配合。" : "中国资产动能不足，仍需等待政策或盈利催化。",
      波动率: parsePct(us.VIX?.day) < 0 && parsePct(us.MOVE?.day) < 0 ? "股债波动率同步回落，风险承接改善。" : "波动率信号未完全配合，仓位不宜过度激进。",
    },
    watchList: ["美国通胀与美联储官员表态", "10Y实际利率与DXY/USDCNY方向", "HYG相对LQD、VIX/MOVE是否继续确认风险偏好"],
  };
}

async function fetchYahooGroup(items) {
  return Promise.all(items.map(([name, symbol]) => yahooRow(name, symbol)));
}

async function main() {
  const output = path.resolve(arg("out", `data/macro-signal-${today()}.json`));
  const [usRisk, fx, china, commoditiesGlobal, fredRows, news] = await Promise.all([
    fetchYahooGroup(YAHOO_GROUPS.usRisk),
    fetchYahooGroup(YAHOO_GROUPS.fx),
    fetchYahooGroup(YAHOO_GROUPS.china),
    fetchYahooGroup(YAHOO_GROUPS.commoditiesGlobal),
    Promise.all(Object.values(FRED_SERIES).map(([name, series]) => fredRow(name, series))),
    fetchNews(),
  ]);
  const fred = rowMap(fredRows);
  const ratesDollar = [
    fred["US 2Y"],
    fred["US 10Y"],
    fred["US 30Y"],
    spreadRow("10Y-2Y", fred["US 10Y"], fred["US 2Y"]),
    fred["10Y实际利率"],
    fred["10Y通胀预期"],
    ...fx,
  ];
  const sections = { usRisk, ratesDollar, china, commoditiesGlobal };
  const signals = buildSignals(sections);
  const data = {
    title: "Macro Daily Signal",
    date: today(),
    sources: {
      market: "Yahoo Finance chart API",
      rates: "FRED CSV: DGS2, DGS10, DGS30, DFII10, T10YIE",
      news: NEWS_RSS.map(([name, url]) => ({ name, url })),
      removed: ["中国1Y/10Y国债", "DR007", "中美10Y利差", "铁矿石"],
      notes: ["恒生科技使用 3033.HK/3067.HK ETF 代理", "创业板使用 159915.SZ ETF 代理", "USDCNY 使用 CNY=X"],
    },
    sections,
    news,
    signals,
  };
  data.text = buildText(data);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

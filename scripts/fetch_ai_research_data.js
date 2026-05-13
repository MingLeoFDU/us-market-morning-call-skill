#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const GROUPS = {
  rates: [
    ["13周美债", "^IRX", "yield10"],
    ["5年美债", "^FVX", "yield10"],
    ["10年美债", "^TNX", "yield10"],
    ["30年美债", "^TYX", "yield10"],
  ],
  equities: [
    ["标普500", "^GSPC"],
    ["纳斯达克", "^IXIC"],
    ["道琼斯", "^DJI"],
    ["恒生指数", "^HSI"],
    ["恒生科技", "^HSTECH"],
    ["上证指数", "000001.SS"],
    ["深证成指", "399001.SZ"],
    ["沪深300", "000300.SS"],
    ["中证500", "000905.SS"],
    ["中证1000", "000852.SS"],
  ],
  usMega7: [
    ["苹果", "AAPL"],
    ["微软", "MSFT"],
    ["英伟达", "NVDA"],
    ["亚马逊", "AMZN"],
    ["谷歌", "GOOGL"],
    ["Meta", "META"],
    ["特斯拉", "TSLA"],
  ],
  cnMega7: [
    ["腾讯控股", "0700.HK"],
    ["阿里巴巴", "9988.HK"],
    ["美团", "3690.HK"],
    ["京东集团", "9618.HK"],
    ["小米集团", "1810.HK"],
    ["比亚迪", "1211.HK"],
    ["贵州茅台", "600519.SS"],
  ],
  commodities: [
    ["黄金", "GC=F"],
    ["白银", "SI=F"],
    ["铜", "HG=F"],
    ["铝", "ALI=F"],
    ["碳酸锂链(LIT)", "LIT"],
    ["WTI原油", "CL=F"],
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

function parsePct(value) {
  const parsed = Number(String(value || "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
          items.push({ source, title, summary: chineseNewsSummary(title, description), link });
        }
      }
    } catch {
      // Keep the report alive if one RSS source is unavailable.
    }
  }
  return items.slice(0, 6);
}

function chineseNewsSummary(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (/(fed|rate|inflation|cpi|pce|yield)/.test(text)) return "利率与通胀预期相关信息，可能影响成长股估值和美元资产定价。";
  if (/(tariff|trade|china|geopolitic|war|sanction)/.test(text)) return "宏观或地缘政治变量升温，重点观察风险偏好、供应链和中国资产反应。";
  if (/(ai|chip|nvidia|semiconductor|tech)/.test(text)) return "科技与 AI 产业线索，可能影响美股 Mega 7、半导体和港股科技情绪。";
  if (/(earnings|profit|revenue|guidance)/.test(text)) return "公司财报或业绩指引变化，重点观察同行业估值重估和盈利预期修正。";
  if (/(oil|gold|copper|commodity|energy)/.test(text)) return "大宗商品相关事件，可能影响通胀、资源股和周期资产表现。";
  return stripHtml(description).slice(0, 80) || "重要市场新闻，建议结合当日价格反应判断影响方向。";
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

function breadth(rows) {
  const valid = rows.filter((row) => row.oneDay !== "n/a");
  if (!valid.length) return 0;
  return valid.filter((row) => parsePct(row.oneDay) > 0).length / valid.length;
}

function averageMove(rows) {
  const valid = rows.filter((row) => row.oneDay !== "n/a");
  if (!valid.length) return 0;
  return valid.reduce((sum, row) => sum + parsePct(row.oneDay), 0) / valid.length;
}

function getRow(rows, name) {
  return rows.find((row) => row.name === name) || {};
}

function buildDashboard(sections) {
  const equityBreadth = breadth(sections.equities);
  const megaBreadth = breadth(sections.usMega7);
  const cnBreadth = breadth(sections.cnMega7);
  const tenYear = getRow(sections.rates, "10年美债");
  const gold = getRow(sections.commodities, "黄金");
  const oil = getRow(sections.commodities, "WTI原油");
  const spx = getRow(sections.equities, "标普500");
  const hstech = getRow(sections.equities, "恒生科技");
  const score = Math.round(
    50
      + (equityBreadth - 0.5) * 32
      + (megaBreadth - 0.5) * 18
      + Math.max(-12, Math.min(12, averageMove(sections.usMega7) * 4))
      - Math.max(-8, Math.min(8, parsePct(tenYear.oneDay || "0") * 0.8))
  );
  const clamped = Math.max(0, Math.min(100, score));
  let regime = "中性震荡";
  if (clamped >= 65) regime = "风险偏好上行";
  if (clamped <= 40) regime = "防御优先";
  return {
    riskScore: clamped,
    regime,
    equityBreadth: `${Math.round(equityBreadth * 100)}%`,
    megaBreadth: `${Math.round(megaBreadth * 100)}%`,
    cnBreadth: `${Math.round(cnBreadth * 100)}%`,
    watch: [
      `标普500 ${spx.oneDay || "n/a"}，恒生科技 ${hstech.oneDay || "n/a"}`,
      `10年美债 ${tenYear.last || "n/a"}，日内 ${tenYear.change || tenYear.oneDay || "n/a"}`,
      `黄金 ${gold.oneDay || "n/a"}，原油 ${oil.oneDay || "n/a"}`,
    ],
  };
}

function assertDataQuality(sections) {
  const allRows = Object.values(sections).flat();
  const validRows = allRows.filter((row) => row.oneDay !== "n/a");
  const requiredNames = ["标普500", "纳斯达克", "10年美债", "黄金", "WTI原油"];
  const missingRequired = requiredNames.filter((name) => !allRows.find((row) => row.name === name && row.oneDay !== "n/a"));
  if (missingRequired.length || validRows.length < Math.ceil(allRows.length * 0.65)) {
    throw new Error(
      `Market data quality check failed. Missing required: ${missingRequired.join(", ") || "none"}. Valid rows: ${validRows.length}/${allRows.length}.`
    );
  }
}

function buildConsensus(sections, dashboard) {
  const nasdaq = getRow(sections.equities, "纳斯达克");
  const tenYear = getRow(sections.rates, "10年美债");
  const hsi = getRow(sections.equities, "恒生指数");
  const hstech = getRow(sections.equities, "恒生科技");
  const gold = getRow(sections.commodities, "黄金");
  const oil = getRow(sections.commodities, "WTI原油");
  const consensus = [
    `市场共识偏向“${dashboard.regime}”：风险分数 ${dashboard.riskScore}/100，权益上涨广度 ${dashboard.equityBreadth}。`,
    `美股定价主线仍看“利率 + AI 盈利”：纳指 ${nasdaq.oneDay || "n/a"}，10年美债 ${tenYear.last || "n/a"}。`,
    `中国资产关注政策与盈利修复是否共振：恒生 ${hsi.oneDay || "n/a"}，恒生科技 ${hstech.oneDay || "n/a"}。`,
    `大宗反映通胀与避险拉扯：黄金 ${gold.oneDay || "n/a"}，原油 ${oil.oneDay || "n/a"}。`,
  ];
  return consensus;
}

function buildStrategy(sections, dashboard) {
  const tenYear = getRow(sections.rates, "10年美债");
  const usMegaAvg = averageMove(sections.usMega7);
  const cnMegaAvg = averageMove(sections.cnMega7);
  const oil = getRow(sections.commodities, "WTI原油");
  const strategy = [];
  if (dashboard.riskScore >= 65) {
    strategy.push("权益仓位可维持中高水平，但优先选择盈利确定性强、现金流质量高的龙头。");
  } else if (dashboard.riskScore <= 40) {
    strategy.push("降低追涨，保留现金和防御资产，等待利率或指数广度改善后再加风险。");
  } else {
    strategy.push("维持均衡配置，指数不追高，围绕强业绩和政策催化做结构性机会。");
  }
  if (parsePct(tenYear.oneDay) > 0.5) strategy.push("若美债收益率继续上行，成长股估值承压，Mega 7 更适合逢回调而非追高。");
  if (usMegaAvg > 0.5) strategy.push("美股 Mega 7 相对强势，可关注 AI 算力、云和广告链条的延续性。");
  if (cnMegaAvg > 0.5) strategy.push("中国 Mega 7 出现修复时，优先看互联网平台、消费电子和新能源龙头的成交放量。");
  if (parsePct(oil.oneDay) > 1) strategy.push("油价上行会抬高通胀预期，利好能源链但压制航空、物流和部分消费。");
  strategy.push("单日信号只用于仓位微调，核心决策仍需结合趋势、估值和未来 1-2 周事件日历。");
  return strategy.slice(0, 5);
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
  const sections = { rates, equities, usMega7, cnMega7, commodities };
  assertDataQuality(sections);
  const data = {
    title: "每日 AI 投研推送",
    date: todayShanghai(),
    analyst: env("ANALYST", "Leo"),
    sources: {
      market: "Yahoo Finance chart API: /v8/finance/chart/{symbol}?range=1mo&interval=1d",
      news: NEWS_RSS.map(([name, url]) => ({ name, url })),
      overrides: ["NEWS_ITEMS_JSON", "EARNINGS_MOVERS_JSON"],
    },
    sections,
    news,
    dashboard: buildDashboard(sections),
    narrative: buildNarrative(sections, news),
  };
  data.consensus = buildConsensus(data.sections, data.dashboard);
  data.strategy = buildStrategy(data.sections, data.dashboard);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CN_SOURCES = [
  {
    name: "财联社电报",
    type: "CLS",
    url: "https://www.cls.cn/nodeapi/telegraphList",
    category: "A股/港股",
    buildUrl: () => "https://www.cls.cn/nodeapi/telegraphList?rn=80&page=1",
  },
  {
    name: "东方财富7x24",
    type: "Eastmoney Fast News",
    url: "https://np-weblist.eastmoney.com/comm/web/getFastNewsList",
    category: "宏观/全球",
    buildUrl: () => {
      const params = new URLSearchParams({
        client: "web",
        biz: "web_724",
        fastColumn: "102",
        sortEnd: "",
        pageSize: "80",
        req_trace: crypto.randomUUID(),
      });
      return `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?${params.toString()}`;
    },
  },
];

const WATCHLIST = [
  ["英伟达", "NVDA"],
  ["微软", "MSFT"],
  ["苹果", "AAPL"],
  ["亚马逊", "AMZN"],
  ["Meta", "META"],
  ["特斯拉", "TSLA"],
  ["谷歌", "GOOGL"],
  ["腾讯", "00700"],
  ["阿里巴巴", "BABA"],
  ["美团", "03690"],
  ["比亚迪", "002594"],
  ["宁德时代", "300750"],
];

const GOOGLE_NEWS_QUERIES = [
  ["美股/宏观", "(Fed OR inflation OR Treasury yield OR dollar) stocks when:1d"],
  ["美股/科技", "(Nvidia OR Apple OR Microsoft OR Tesla OR AI chip) stock when:1d"],
  ["美股/财报", "(earnings OR guidance OR revenue) shares stock when:1d"],
  ["中国资产", "(China stocks OR Hong Kong stocks OR Alibaba Tencent BYD) when:1d"],
];

const FALLBACK_FEEDS = [
  ["Yahoo Finance", "美股/市场", "https://finance.yahoo.com/news/rssindex"],
  ["MarketWatch", "美股/市场", "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines"],
  ["CNBC Markets", "美股/市场", "https://www.cnbc.com/id/15839135/device/rss/rss.html"],
];

const TOPIC_RULES = [
  ["央行/利率", /(美联储|央行|降息|加息|利率|收益率|国债|联储|制造业指数|FOMC|Fed|Treasury|yield|rate)/i],
  ["通胀/美元", /(通胀|CPI|PPI|PCE|美元|汇率|人民币|DXY|inflation|dollar)/i],
  ["财报/盈利", /(财报|业绩|营收|利润|指引|earnings|revenue|profit|guidance)/i],
  ["AI/芯片", /(\bAI\b|人工智能|芯片|半导体|英伟达|算力|Nvidia|semiconductor|chip|GPU)/i],
  ["中国资产", /(A股|港股|恒生|沪指|深成指|创业板|中概|中国资产|中国金龙|腾讯|阿里|美团|比亚迪|宁德时代|China|Hong Kong|Hang Seng)/i],
  ["商品/能源", /(原油|黄金|铜|大宗|商品|油价|石化|能源公司|oil|gold|copper|commodity)/i],
  ["风险偏好", /(美股|纳指|标普|道指|股市|市场|上涨|下跌|反弹|回调|S&P|Nasdaq|Dow|Wall Street|stocks)/i],
];

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
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

function isoShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function cleanText(text) {
  return decodeEntities(String(text || ""))
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
}

function truncate(text, limit) {
  const clean = cleanText(text);
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trim()}…`;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{10}$/.test(String(value))) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(String(value))) return new Date(Number(value));
  const date = new Date(String(value).replace(/-/g, "/"));
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeTitle(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/财联社\d+月\d+日电/g, "")
    .replace(/财联社[：:]/g, "")
    .replace(/【|】/g, "")
    .replace(/\s[-|–].*$/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
}

async function fetchWithRetry(url, tries = 3, headers = {}) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json,text/xml,application/rss+xml,text/html;q=0.8",
          "Referer": new URL(url).origin,
          ...headers,
        },
      });
      clearTimeout(timer);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
  throw lastError;
}

async function fetchCls() {
  const source = CN_SOURCES[0];
  const res = await fetchWithRetry(source.buildUrl());
  const json = await res.json();
  return (json?.data?.roll_data || []).map((item) => {
    const content = cleanText(item.content || item.brief || item.title);
    return {
      source: source.name,
      sourceType: source.type,
      category: source.category,
      title: cleanText(item.title || item.brief || content),
      summary: content,
      link: "https://www.cls.cn/telegraph",
      pubDate: item.ctime || "",
      publishedAt: parseDate(item.ctime),
    };
  }).filter((item) => item.title || item.summary);
}

async function fetchEastmoneyFastNews() {
  const source = CN_SOURCES[1];
  const res = await fetchWithRetry(source.buildUrl());
  const json = await res.json();
  return (json?.data?.fastNewsList || []).map((item) => ({
    source: source.name,
    sourceType: source.type,
    category: source.category,
    title: cleanText(item.title),
    summary: cleanText(item.summary || item.digest || item.title),
    link: item.url || "https://kuaixun.eastmoney.com/",
    pubDate: item.showTime || "",
    publishedAt: parseDate(item.showTime),
  })).filter((item) => item.title);
}

async function fetchEastmoneyStockNews(code, label) {
  const inner = JSON.stringify({
    uid: "",
    keyword: code,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize: 8,
        preTag: "",
        postTag: "",
      },
    },
  });
  const params = new URLSearchParams({ cb: "jQuery_news", param: inner });
  const url = `https://search-api-web.eastmoney.com/search/jsonp?${params.toString()}`;
  const res = await fetchWithRetry(url, 3, {
    "Accept": "text/javascript,application/javascript,application/json,text/plain,*/*",
    "Referer": "https://so.eastmoney.com/",
  });
  const text = await res.text();
  const jsonText = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const json = JSON.parse(jsonText);
  return (json?.result?.cmsArticleWebOld?.list || []).map((item) => ({
    source: `东方财富个股新闻-${label}`,
    sourceType: "Eastmoney Stock News",
    category: /NVDA|MSFT|AAPL|AMZN|META|TSLA|GOOGL|BABA/.test(code) ? "美股/个股" : "中国资产",
    title: cleanText(item.title),
    summary: cleanText(item.content || item.title),
    link: item.url || "https://so.eastmoney.com/",
    pubDate: item.date || "",
    publishedAt: parseDate(item.date),
  })).filter((item) => item.title);
}

function googleNewsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function parseRssItems(xml, source, category, sourceType = "RSS") {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return blocks.map((block) => {
    const title = cleanText(block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]);
    const rawSummary = block.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1]
      || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]
      || block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1];
    let summary = cleanText(decodeEntities(rawSummary || ""));
    if (/https?:\/\/|href=|rss\/articles|Google News/i.test(summary)) summary = title;
    const link = cleanText(
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1]
        || block.match(/<link[^>]*href="([^"]+)"/)?.[1]
    );
    const pubDate = cleanText(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]);
    return { source, sourceType, category, title, summary, link, pubDate, publishedAt: parseDate(pubDate) };
  }).filter((item) => item.title && item.link);
}

async function fetchRss(source, category, url, sourceType = "RSS") {
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  return parseRssItems(xml, source, category, sourceType);
}

async function translate(text) {
  const clean = truncate(text, 900);
  if (!clean || /[\u4e00-\u9fa5]/.test(clean)) return clean;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(clean)}`;
  const res = await fetchWithRetry(url);
  const json = await res.json();
  const translated = json?.[0]?.map((part) => part[0]).join("");
  return cleanText(translated || clean);
}

function classify(item) {
  const text = `${item.title} ${item.summary}`;
  const tags = TOPIC_RULES.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  let category = item.category || "市场";
  if (tags.includes("中国资产")) category = "中国资产";
  else if (tags.includes("财报/盈利")) category = "财报/盈利";
  else if (tags.includes("央行/利率")) category = "宏观/利率";
  else if (tags.includes("AI/芯片")) category = "AI/科技";
  else if (tags.includes("通胀/美元")) category = "宏观/利率";
  else if (tags.includes("商品/能源")) category = "商品/能源";
  else if (tags.includes("风险偏好")) category = "市场风险";
  if (/(波音|美光|英伟达|苹果|微软|特斯拉|Applovin|Boeing|Micron|Nvidia|Apple|Microsoft|Tesla|美股|纳指|标普|道指)/i.test(text)) category = "美股/个股";
  return { category, tags };
}

function scoreItem(item) {
  const text = `${item.title} ${item.summary}`;
  let score = 0;
  for (const [, pattern] of TOPIC_RULES) if (pattern.test(text)) score += 5;
  if (/财联社|东方财富/.test(item.source)) score += 6;
  if (/快讯|电报|7x24|Fast/.test(item.sourceType)) score += 3;
  if (/个股新闻/.test(item.source)) score += 2;
  if (/(传闻|网红|体育|娱乐|彩票|电影|旅游|无关|航天员|神舟|着陆场|演练|开户)/.test(text)) score -= 14;
  if (/(新闻精选|要闻一览|晚间新闻|早间新闻|一文读懂|盘前必读|早知道)/.test(text)) score -= 18;
  const published = item.publishedAt?.getTime?.() || 0;
  if (published) {
    const hours = Math.max(0, (Date.now() - published) / 36e5);
    if (hours <= 3) score += 10;
    else if (hours <= 8) score += 7;
    else if (hours <= 24) score += 4;
    else score -= 3;
  }
  return score;
}

function isHardExcluded(item) {
  const text = `${item.title} ${item.summary}`;
  if (/(开户|国际刑事法院|杜特尔特|航天员|神舟|着陆场|彩票开奖|影视|体育赛事)/.test(text)) return true;
  if (item.source === "Google News" && /(guide|account|broker|开户|港股开户)/i.test(text)) return true;
  if (item.source === "财联社电报" && item.category === "A股/港股" && !(item.tags || []).length) return true;
  return false;
}

function impactFor(item) {
  const tags = new Set(item.tags || []);
  if (item.category === "AI/科技") return ["AI和芯片仍是全球权益最拥挤的主线之一，龙头变化会带动指数权重和产业链情绪。", "NVDA、MSFT、AAPL、半导体、云计算"];
  if (item.category === "中国资产") return ["中国资产对政策、流动性、平台经济和人民币预期敏感，适合观察外资风险偏好。", "沪深300、恒生科技、KWEB、人民币"];
  if (item.category === "财报/盈利") return ["盈利和指引决定市场是在交易业绩上修，还是担心估值透支。", "相关个股、行业ETF、标普/纳指"];
  if (item.category === "商品/能源") return ["商品变化会进入通胀和企业成本预期，也影响资源股、黄金和能源链。", "WTI、黄金、铜、资源股"];
  if (tags.has("央行/利率")) return ["影响折现率和风险偏好，是美股成长股、港股科技和债券定价的共同变量。", "美债收益率、美元、纳指、恒生科技"];
  if (tags.has("通胀/美元")) return ["会改变降息预期和美元流动性，对黄金、成长股和人民币资产都有传导。", "DXY、黄金、A/H股、QQQ"];
  return ["这类消息反映市场主线和情绪变化，适合与指数、波动率、成交量一起交叉验证。", "SPY、QQQ、A股/港股主要指数、VIX"];
}

function cleanTranslatedTitle(text) {
  return truncate(text, 90)
    .replace(/\s+-\s+.*$/g, "")
    .replace(/美股指南.*$/g, "")
    .replace(/美股开户.*$/g, "")
    .replace(/港股开户.*$/g, "")
    .trim();
}

async function enrichChinese(item) {
  const [titleZh, summaryZh] = await Promise.all([
    translate(item.title),
    translate(item.summary || item.title),
  ]);
  const [why, assets] = impactFor(item);
  const cleanTitle = cleanTranslatedTitle(titleZh);
  const happened = truncate(cleanTranslatedTitle(summaryZh || titleZh) || cleanTitle, 130);
  return {
    ...item,
    titleZh: truncate(cleanTitle, 60),
    contentZh: `发生了什么：${happened}\n为什么重要：${why}\n关注资产：${assets}`,
  };
}

function selectBalanced(items, total = 10) {
  const order = ["宏观/利率", "中国资产", "AI/科技", "财报/盈利", "商品/能源", "市场风险", "A股/港股", "美股/市场", "宏观/全球"];
  const buckets = new Map(order.map((category) => [category, []]));
  for (const item of items) {
    if (!buckets.has(item.category)) buckets.set(item.category, []);
    buckets.get(item.category).push(item);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();
  for (const category of order) {
    const item = buckets.get(category)?.shift();
    const dedupeKey = item?.key?.slice(0, 18);
    if (item && !seen.has(item.key) && !seen.has(dedupeKey)) {
      selected.push(item);
      seen.add(item.key);
      seen.add(dedupeKey);
    }
  }
  const rest = [...buckets.values()].flat().sort((a, b) => b.score - a.score);
  for (const item of rest) {
    if (selected.length >= total) break;
    const dedupeKey = item.key.slice(0, 18);
    if (seen.has(item.key) || seen.has(dedupeKey)) continue;
    selected.push(item);
    seen.add(item.key);
    seen.add(dedupeKey);
  }
  return selected.slice(0, total);
}

async function collectNews() {
  const sources = [];
  const failures = [];
  const tasks = [
    fetchCls().catch((error) => {
      failures.push(`财联社电报: ${error.message}`);
      return [];
    }),
    fetchEastmoneyFastNews().catch((error) => {
      failures.push(`东方财富7x24: ${error.message}`);
      return [];
    }),
  ];
  sources.push(...CN_SOURCES.map(({ name, url }) => ({ name, url })));

  for (const [label, code] of WATCHLIST) {
    sources.push({ name: `东方财富个股新闻-${label}`, url: "https://search-api-web.eastmoney.com/search/jsonp" });
    tasks.push(fetchEastmoneyStockNews(code, label).catch((error) => {
      failures.push(`东方财富个股新闻-${label}: ${error.message}`);
      return [];
    }));
  }
  for (const [category, query] of GOOGLE_NEWS_QUERIES) {
    const url = googleNewsUrl(query);
    sources.push({ name: `Google News ${category}`, url });
    tasks.push(fetchRss("Google News", category, url, "Google News RSS").catch((error) => {
      failures.push(`Google News ${category}: ${error.message}`);
      return [];
    }));
  }
  for (const [source, category, url] of FALLBACK_FEEDS) {
    sources.push({ name: source, url });
    tasks.push(fetchRss(source, category, url, "Fallback RSS").catch((error) => {
      failures.push(`${source}: ${error.message}`);
      return [];
    }));
  }

  const raw = (await Promise.all(tasks)).flat();
  const unique = [];
  const seen = new Set();
  for (const original of raw) {
    const key = normalizeTitle(original.title || original.summary);
    if (!key || key.length < 8 || seen.has(key)) continue;
    seen.add(key);
    const classified = classify(original);
    const item = {
      ...original,
      ...classified,
      key,
      summary: original.summary || original.title,
    };
    item.score = scoreItem(item);
    if (!isHardExcluded(item) && item.score > 6) unique.push(item);
  }
  return { items: selectBalanced(unique.sort((a, b) => b.score - a.score), 10), sources, failures };
}

async function main() {
  const out = path.resolve(arg("out", `data/stock-news-${isoShanghaiDate()}.json`));
  const { items: selected, sources, failures } = await collectNews();
  if (selected.length < 10) {
    throw new Error(`Only ${selected.length} valid stock-news items found; need 10. Failures: ${failures.join("; ")}`);
  }
  const items = [];
  for (const item of selected) items.push(await enrichChinese(item));
  const data = {
    title: "每日股市投研新闻",
    date: todayShanghai(),
    generatedAt: new Date().toISOString(),
    freshnessWindow: "中文投研源实时优先，海外源兜底",
    sources,
    failedSources: failures,
    items,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(out);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

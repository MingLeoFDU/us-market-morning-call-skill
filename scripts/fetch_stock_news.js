#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const FEEDS = [
  ["Yahoo Finance", "https://finance.yahoo.com/news/rssindex"],
  ["MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines"],
  ["CNBC Markets", "https://www.cnbc.com/id/15839135/device/rss/rss.html"],
  ["Nasdaq Stocks", "https://www.nasdaq.com/feed/rssoutbound?category=Stocks"],
  ["Reuters Business", "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best"],
];

const KEYWORDS = [
  "stock", "stocks", "market", "shares", "nasdaq", "dow", "s&p", "earnings", "guidance",
  "revenue", "profit", "ipo", "fed", "rate", "inflation", "treasury", "yield", "chip",
  "ai", "nvidia", "apple", "microsoft", "tesla", "amazon", "alphabet", "meta", "china",
  "hong kong", "oil", "gold", "dollar",
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

function stripHtml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemScore(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let score = 0;
  for (const keyword of KEYWORDS) if (text.includes(keyword)) score += 2;
  if (/(earnings|guidance|revenue|profit)/.test(text)) score += 5;
  if (/(fed|inflation|rate|yield|treasury|dollar)/.test(text)) score += 4;
  if (/(nvidia|apple|microsoft|tesla|amazon|alphabet|meta|semiconductor|chip|ai)/.test(text)) score += 4;
  if (/(celebrity|sports|lifestyle|travel|movie)/.test(text)) score -= 8;
  return score;
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
    await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
  }
  throw lastError;
}

async function fetchFeed(source, url) {
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return blocks.map((block) => {
    const title = stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]);
    const summary = stripHtml(
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1]
        || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]
        || block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1]
    );
    const link = stripHtml(
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1]
        || block.match(/<link[^>]*href="([^"]+)"/)?.[1]
    );
    const pubDate = stripHtml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]);
    return { source, title, summary, link, pubDate };
  }).filter((item) => item.title && item.link);
}

async function translate(text) {
  const clean = stripHtml(text).slice(0, 900);
  if (!clean) return "";
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(clean)}`;
  const res = await fetchWithRetry(url);
  const json = await res.json();
  const translated = json?.[0]?.map((part) => part[0]).join("");
  if (!translated) throw new Error("translation returned empty text");
  return translated;
}

async function main() {
  const out = path.resolve(arg("out", `data/stock-news-${new Date().toISOString().slice(0, 10)}.json`));
  const fetched = [];
  for (const [source, url] of FEEDS) {
    try {
      fetched.push(...await fetchFeed(source, url));
    } catch (error) {
      console.error(`Feed failed: ${source}: ${error.message}`);
    }
  }
  const unique = [];
  const seen = new Set();
  for (const item of fetched) {
    const key = item.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...item, score: itemScore(item) });
  }
  const selected = unique
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (selected.length < 10) {
    throw new Error(`Only ${selected.length} valid stock-news items found; need 10.`);
  }
  const items = [];
  for (const item of selected) {
    const titleZh = await translate(item.title);
    const contentZh = await translate(item.summary || item.title);
    items.push({ ...item, titleZh, contentZh });
  }
  const data = {
    title: "每日股市新闻",
    date: todayShanghai(),
    sources: FEEDS.map(([name, url]) => ({ name, url })),
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

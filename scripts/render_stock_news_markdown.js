#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function render(data) {
  const lines = [`# ${data.title}｜${data.date}`, ""];
  lines.push("今日股市投研新闻精选。每条新闻按“发生了什么、为什么重要、关注资产”整理。");
  lines.push("");
  data.items.forEach((item, index) => {
    const tags = [item.category, ...(item.tags || []).slice(0, 2)].filter(Boolean).join(" / ");
    lines.push(`## ${index + 1}. [${tags}] ${item.titleZh}`);
    lines.push("");
    lines.push(item.contentZh);
    lines.push("");
    lines.push(`来源：${item.source}`);
    lines.push(`原文：${item.link}`);
    lines.push("");
  });
  lines.push("数据说明：新闻优先来自财联社电报、东方财富7x24、东方财富个股新闻；Google News/Yahoo/MarketWatch/CNBC 作为兜底。内容为中文投研摘要，不复刻全文。");
  return `${lines.join("\n")}\n`;
}

const input = path.resolve(arg("data"));
const output = path.resolve(arg("out", "output/stock-news.md"));
const data = JSON.parse(fs.readFileSync(input, "utf8"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, render(data));
console.log(output);

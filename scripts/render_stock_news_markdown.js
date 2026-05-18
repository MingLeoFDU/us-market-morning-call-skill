#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function render(data) {
  const lines = [`# ${data.title}｜${data.date}`, ""];
  data.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.titleZh}`);
    lines.push("");
    lines.push(item.contentZh);
    lines.push("");
    lines.push(`来源：${item.source}`);
    lines.push(`原文：${item.link}`);
    lines.push("");
  });
  lines.push("数据说明：新闻来自公开财经 RSS，内容为标题和摘要翻译，不复刻全文。");
  return `${lines.join("\n")}\n`;
}

const input = path.resolve(arg("data"));
const output = path.resolve(arg("out", "output/stock-news.md"));
const data = JSON.parse(fs.readFileSync(input, "utf8"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, render(data));
console.log(output);

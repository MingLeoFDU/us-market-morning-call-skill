#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function itemBlock(item, index) {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${index + 1}. ${item.titleZh}**\n${item.contentZh}\n来源：${item.source}　[原文](${item.link})`,
    },
  };
}

function buildCard(data) {
  const elements = [
    {
      tag: "markdown",
      content: "以下为今日股市相关新闻精选。标题与摘要已翻译为中文，原文链接保留用于追溯。",
    },
    { tag: "hr" },
  ];
  data.items.slice(0, 10).forEach((item, index) => {
    elements.push(itemBlock(item, index));
    if (index !== 9) elements.push({ tag: "hr" });
  });
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: "数据源：Yahoo Finance、MarketWatch、CNBC、Nasdaq、Reuters RSS。摘要翻译为中文，不复刻全文。" }],
  });
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `${data.title}｜${data.date}` },
    },
    elements,
  };
}

async function main() {
  const webhook = required(env("FEISHU_WEBHOOK_URL"), "FEISHU_WEBHOOK_URL");
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!data.items || data.items.length < 10) throw new Error("Need 10 translated news items before sending.");
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", card: buildCard(data) }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Feishu webhook failed: ${res.status} ${body}`);
  console.log(body);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

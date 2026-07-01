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
  const tags = [item.category, ...(item.tags || []).slice(0, 2)].filter(Boolean).join(" / ");
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${index + 1}. [${tags}] ${item.titleZh}**\n${item.contentZh}\n来源：${item.source}　[原文](${item.link})`,
    },
  };
}

function buildCard(data) {
  const elements = [
    {
      tag: "markdown",
      content: "以下为今日股市投研新闻精选。每条新闻按“发生了什么、为什么重要、关注资产”整理，中文源实时优先，海外源兜底。",
    },
    { tag: "hr" },
  ];
  data.items.slice(0, 10).forEach((item, index) => {
    elements.push(itemBlock(item, index));
    if (index !== 9) elements.push({ tag: "hr" });
  });
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: "数据源：财联社电报、东方财富7x24、东方财富个股新闻；Google News/Yahoo/MarketWatch/CNBC 兜底。内容为中文投研摘要，不复刻全文。" }],
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

async function sendToFeishu(webhook, payload) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(body);
          if (json.code === 0 || json.StatusCode === 0) {
            console.log(`Feishu send OK (attempt ${attempt})`);
            return body;
          }
          lastError = new Error(`Feishu code ${json.code}: ${body}`);
        } catch {
          console.log(body);
          return body;
        }
      } else {
        lastError = new Error(`Feishu webhook failed: ${res.status} ${body}`);
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) {
      const delay = Math.min(4000, 1000 * Math.pow(2, attempt - 1));
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function main() {
  const webhook = required(env("FEISHU_WEBHOOK_URL"), "FEISHU_WEBHOOK_URL");
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!data.items || data.items.length < 10) throw new Error("Need 10 translated news items before sending.");
  const body = await sendToFeishu(webhook, { msg_type: "interactive", card: buildCard(data) });
  console.log(body);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

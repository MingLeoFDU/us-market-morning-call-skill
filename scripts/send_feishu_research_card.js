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

function colorByDirection(direction) {
  if (direction === "up") return "green";
  if (direction === "down") return "red";
  return "grey";
}

function tag(row) {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${row.name}**｜${row.last}｜日: <font color='${colorByDirection(row.direction)}'>${row.oneDay}</font>｜周: ${row.oneWeek}｜月: ${row.oneMonth}`,
    },
  };
}

function section(title, rows, limit = 8) {
  return [
    {
      tag: "markdown",
      content: `**${title}**`,
    },
    ...rows.slice(0, limit).map(tag),
  ];
}

function bulletSection(title, rows) {
  return [
    {
      tag: "markdown",
      content: `**${title}**\n${rows.map((line) => `- ${line}`).join("\n")}`,
    },
  ];
}

function scoreBar(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "n/a";
  const filled = Math.max(0, Math.min(10, Math.round(value / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${value}/100`;
}

function newsBlock(items) {
  const blocks = [
    {
      tag: "markdown",
      content: "**重要经济新闻**",
    },
  ];
  for (const item of items.slice(0, 6)) {
    const link = item.link ? `[原文](${item.link})` : "";
    blocks.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${item.title}**\n${item.summary}${link ? `\n${link}` : ""}`,
      },
    });
  }
  return blocks;
}

function buildCard(data) {
  const dashboard = data.dashboard || {};
  const template = dashboard.riskScore >= 65 ? "green" : dashboard.riskScore <= 40 ? "red" : "blue";
  return {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: "plain_text", content: `${data.title} | ${data.date}` },
    },
    elements: [
      {
        tag: "markdown",
        content: [
          `**今日状态：${dashboard.regime || "中性震荡"}｜风险分数 ${dashboard.riskScore ?? "n/a"}/100**`,
          scoreBar(dashboard.riskScore),
          `权益上涨广度：${dashboard.equityBreadth || "n/a"}｜美股 Mega 7 广度：${dashboard.megaBreadth || "n/a"}｜中国 Mega 7 广度：${dashboard.cnBreadth || "n/a"}`,
          ...(dashboard.watch || []).map((line) => `- ${line}`),
        ].join("\n"),
      },
      { tag: "hr" },
      ...bulletSection("市场共识", data.consensus || data.narrative || []),
      { tag: "hr" },
      ...bulletSection("投资策略建议", data.strategy || []),
      { tag: "hr" },
      ...section("利率数据", data.sections.rates, 6),
      { tag: "hr" },
      ...section("权益数据", data.sections.equities, 10),
      { tag: "hr" },
      ...section("自选股 - 美股 Mega 7", data.sections.usMega7, 7),
      { tag: "hr" },
      ...section("自选股 - 中国 Mega 7", data.sections.cnMega7, 7),
      { tag: "hr" },
      ...section("大宗商品", data.sections.commodities, 8),
      { tag: "hr" },
      ...newsBlock(data.news),
      { tag: "hr" },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `数据源：Yahoo Finance chart API + 新闻 RSS。分析师：${data.analyst}。行情可能延迟；策略建议仅供投研参考。`,
          },
        ],
      },
    ],
  };
}

async function main() {
  const webhook = required(env("FEISHU_WEBHOOK_URL"), "FEISHU_WEBHOOK_URL");
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const card = buildCard(data);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", card }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Feishu webhook failed: ${res.status} ${body}`);
  console.log(body);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

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
      content: `**${row.name}**  ${row.last}  <font color='${colorByDirection(row.direction)}'>${row.oneDay}</font>  1W ${row.oneWeek}`,
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
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `${data.title} | ${data.date}` },
    },
    elements: [
      {
        tag: "markdown",
        content: data.narrative.map((line) => `- ${line}`).join("\n"),
      },
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
            content: `Data: Yahoo Finance chart API; news RSS. Analyst: ${data.analyst}. Delayed quotes may apply.`,
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

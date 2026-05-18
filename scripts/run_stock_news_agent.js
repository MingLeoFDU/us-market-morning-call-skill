#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 10);
const dataPath = path.join(root, "data", `stock-news-${stamp}.json`);
const markdownPath = path.join(root, "output", `Stock_News_${stamp}.md`);

function run(label, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!process.env.FEISHU_WEBHOOK_URL) {
  console.error("Missing FEISHU_WEBHOOK_URL. Set it as a GitHub Actions secret before running delivery.");
  process.exit(1);
}

run("Fetch and translate stock news", ["scripts/fetch_stock_news.js", "--out", dataPath]);
run("Render stock news markdown", ["scripts/render_stock_news_markdown.js", "--data", dataPath, "--out", markdownPath]);
run("Send Feishu stock news card", ["scripts/send_feishu_stock_news_card.js", "--data", dataPath]);

console.log(JSON.stringify({ ok: true, data: dataPath, markdown: markdownPath }, null, 2));

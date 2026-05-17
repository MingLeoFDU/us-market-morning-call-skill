#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 10);
const macroDataPath = path.join(root, "data", `macro-signal-${stamp}.json`);
const macroMarkdownPath = path.join(root, "output", `Macro_Daily_Signal_${stamp}.md`);

function run(label, args, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!process.env.FEISHU_WEBHOOK_URL) {
  console.error("Missing FEISHU_WEBHOOK_URL. Set it as a GitHub Actions secret before running delivery.");
  process.exit(1);
}

run("Fetch macro signal data", ["scripts/fetch_macro_signal_data.js", "--out", macroDataPath]);
run("Render macro signal markdown", ["scripts/render_macro_signal_markdown.js", "--data", macroDataPath, "--out", macroMarkdownPath]);
run("Send Feishu macro signal card", ["scripts/send_feishu_macro_signal_card.js", "--data", macroDataPath]);

console.log(JSON.stringify({ ok: true, data: macroDataPath, markdown: macroMarkdownPath }, null, 2));

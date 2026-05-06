#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 10);
const dataPath = path.join(root, "data", `morning-call-${stamp}.json`);
const pdfPath = path.join(root, "output", `US_Market_Morning_Call_${stamp}.pdf`);

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

run("Fetch daily data", ["scripts/fetch_daily_data.js", "--out", dataPath]);
run("Generate PDF", ["scripts/generate_pdf.js", "--data", dataPath, "--out", pdfPath]);
if (process.env.FEISHU_WEBHOOK_URL) {
  run("Notify Feishu webhook", ["scripts/send_feishu_webhook.js", "--pdf", pdfPath]);
} else {
  run("Send PDF to Feishu", ["scripts/send_feishu_file.js", "--file", pdfPath]);
}

console.log(JSON.stringify({ ok: true, data: dataPath, pdf: pdfPath }, null, 2));

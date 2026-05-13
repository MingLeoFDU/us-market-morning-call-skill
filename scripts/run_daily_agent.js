#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 10);
const dataPath = path.join(root, "data", `morning-call-${stamp}.json`);
const researchDataPath = path.join(root, "data", `ai-research-${stamp}.json`);
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

run("Fetch PDF data", ["scripts/fetch_daily_data.js", "--out", dataPath]);
run("Generate PDF backup", ["scripts/generate_pdf.js", "--data", dataPath, "--out", pdfPath]);
run("Fetch AI research data", ["scripts/fetch_ai_research_data.js", "--out", researchDataPath]);
if (process.env.FEISHU_WEBHOOK_URL) {
  run("Send Feishu research card", ["scripts/send_feishu_research_card.js", "--data", researchDataPath]);
} else {
  run("Send PDF to Feishu", ["scripts/send_feishu_file.js", "--file", pdfPath]);
}

console.log(JSON.stringify({ ok: true, data: dataPath, researchData: researchDataPath, pdf: pdfPath }, null, 2));

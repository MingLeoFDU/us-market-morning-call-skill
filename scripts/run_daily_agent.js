#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 10);
const macroDataPath = path.join(root, "data", `macro-signal-${stamp}.json`);
const macroMarkdownPath = path.join(root, "output", `Macro_Daily_Signal_${stamp}.md`);
const calendarPath = path.join(root, "data", `event-calendar-${stamp}.json`);

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
run("Fetch event calendar", ["scripts/fetch_event_calendar.js", "--out", calendarPath]);

// Merge event calendar into macro data
try {
  const macroData = JSON.parse(fs.readFileSync(macroDataPath, "utf8"));
  const calendarData = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
  macroData.eventCalendar = {
    thisWeek: calendarData.thisWeek,
    thisMonthBeyondWeek: calendarData.thisMonthBeyondWeek,
  };
  fs.writeFileSync(macroDataPath, JSON.stringify(macroData, null, 2) + "\n");
  console.log("EVENT_CALENDAR_MERGED: " + calendarData.thisWeek.length + " thisWeek, " + (calendarData.thisMonthBeyondWeek || []).length + " thisMonth");
} catch (err) {
  console.log("EVENT_CALENDAR_MERGE_FAILED: " + String(err).slice(0, 200) + ", proceeding without calendar");
}

// Generate AI-powered commentary using Gemini; falls back to hardcoded text if unavailable.
if (process.env.GEMINI_API_KEY) {
  const aiResult = spawnSync(process.execPath, ["scripts/generate_ai_commentary.js", "--data", macroDataPath, "--calendar", calendarPath], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (aiResult.status !== 0) {
    console.log("AI commentary generation failed (exit " + aiResult.status + "), falling back to hardcoded text.");
  }
} else {
  console.log("GEMINI_API_KEY not set, using hardcoded commentary text.");
}

run("Render macro signal markdown", ["scripts/render_macro_signal_markdown.js", "--data", macroDataPath, "--out", macroMarkdownPath]);
run("Send Feishu macro signal card", ["scripts/send_feishu_macro_signal_card.js", "--data", macroDataPath]);

console.log(JSON.stringify({ ok: true, data: macroDataPath, markdown: macroMarkdownPath }, null, 2));

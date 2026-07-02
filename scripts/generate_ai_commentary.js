#!/usr/bin/env node

/**
 * 使用 Gemini API 基于当日真实市场数据生成 Macro Daily Signal 的定性评论。
 *
 * 输入：fetch_macro_signal_data.js 输出的 data JSON
 * 输出：将 AI 生成的 text 写回同一个 JSON 文件
 * 如果 Gemini 失败，保留原有的硬编码 fallback 文本不动。
 */

const fs = require("node:fs");
const path = require("node:path");

// ── helpers ──────────────────────────────────────────────────────────

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Gemini model discovery ───────────────────────────────────────────

const GEMINI_MODEL_CANDIDATES = [
  "models/gemini-2.5-flash",
  "models/gemini-2.0-flash",
  "models/gemini-2.0-flash-lite",
  "models/gemini-2.0-flash-001",
  "models/gemini-flash-latest",
  "models/gemini-flash-lite-latest",
];

async function discoverGeminiModels(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { timeout: 15000 }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const available = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name);
    console.log("GEMINI_AVAILABLE_MODELS=" + JSON.stringify(available));
    const models = GEMINI_MODEL_CANDIDATES.filter((m) => available.includes(m));
    if (models.length === 0) {
      // try any flash model
      const flashModels = available.filter(
        (m) => m.toLowerCase().includes("flash") && !m.includes("image") && !m.includes("tts")
      );
      models.push(...flashModels);
    }
    if (models.length === 0) throw new Error("No usable Gemini flash model found");
    console.log("GEMINI_CHOSEN_MODELS=" + JSON.stringify(models.slice(0, 3)));
    return models.slice(0, 3);
  } catch (err) {
    console.log(`GEMINI_DISCOVERY_FAILED reason=${String(err).slice(0, 200)}`);
    // fallback to candidates
    console.log("GEMINI_FALLBACK_CANDIDATES=" + JSON.stringify(GEMINI_MODEL_CANDIDATES.slice(0, 3)));
    return GEMINI_MODEL_CANDIDATES.slice(0, 3);
  }
}

// ── Gemini JSON call ─────────────────────────────────────────────────

async function geminiJsonOnce(model, apiKey, prompt, temperature) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, topP: 0.75, responseMimeType: "application/json" },
  };

  let res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeout: 40000,
  });

  // retry without responseMimeType if API rejects it
  if (res.status >= 400) {
    const errBody = await res.text();
    if (errBody.includes("responseMimeType") || errBody.includes("response_mime_type")) {
      delete payload.generationConfig.responseMimeType;
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeout: 40000,
      });
    } else {
      throw new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned empty response");

  // extract JSON array or object from the response
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  // try to find a JSON object in the text
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error(`Gemini response is not valid JSON: ${trimmed.slice(0, 300)}`);
}

async function geminiJson(models, apiKey, prompt, temperature, stage) {
  let lastError;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await geminiJsonOnce(model, apiKey, prompt, temperature);
        console.log(`GEMINI_CALL_OK stage=${stage} model=${model} attempt=${attempt}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = String(err).slice(0, 500);
        console.log(`GEMINI_CALL_FAIL stage=${stage} model=${model} attempt=${attempt} error=${msg}`);
        await sleep(Math.min(8000, 2000 * attempt));
      }
    }
  }
  throw new Error(`Gemini ${stage} failed: ${lastError}`);
}

// ── Format market data for the prompt ────────────────────────────────

function fmtRow(row) {
  if (!row || row.value === "n/a") return null;
  return { name: row.name, value: row.value, day: row.day, week: row.week };
}

function buildDataSummary(data) {
  const us = (data.sections.usRisk || []).map(fmtRow).filter(Boolean);
  const rates = (data.sections.ratesDollar || []).map(fmtRow).filter(Boolean);
  const china = (data.sections.china || []).map(fmtRow).filter(Boolean);
  const global = (data.sections.commoditiesGlobal || []).map(fmtRow).filter(Boolean);
  const signals = data.signals || {};
  const news = (data.news || []).slice(0, 6).map((n) => ({
    source: n.source,
    title: n.title,
    summary: (n.summary || "").slice(0, 200),
  }));

  // Economic surprise data
  const econSurprise = (data.econSurprise || []).map((e) => ({
    name: e.name,
    direction: e.direction,
    surprisePct: e.surprisePct,
    latestValue: e.latestValue,
  }));

  // CFTC positioning
  const cftcPositions = data.cftcPositions || [];

  // Factor rotation
  const factorRotation = data.factorRotation || {};

  return {
    date: data.date,
    news,
    signals: {
      riskPreference: signals.riskPreference,
      dominantFactor: signals.dominantFactor,
      tradeQuality: signals.tradeQuality,
      riskScore: signals.riskScore,
    },
    usRisk: us,
    ratesDollar: rates,
    china,
    commoditiesGlobal: global,
    econSurprise,
    cftcPositions,
    factorRotation,
  };
}

// ── Build the Gemini prompt ──────────────────────────────────────────

function buildPrompt(summary, eventCalendar) {
  const econSection = summary.econSurprise.length > 0
    ? `\n## 经济数据超预期方向\n${summary.econSurprise.map((e) => `- ${e.name}：${e.direction}，偏离3M均值 ${e.surprisePct}%`).join("\n")}`
    : "";

  const factorSection = Object.keys(summary.factorRotation).length > 0
    ? `\n## 因子轮动（原始数据）\n${Object.entries(summary.factorRotation).map(([group, factors]) => {
        const label = group === "equityStyle" ? "权益风格" : group === "ficcCarry" ? "FICC因子" : "跨资产主题";
        return `### ${label}\n${factors.map((f) => `${f.name}：日${f.day} 周${f.week} → ${f.direction}`).join("\n")}`;
      }).join("\n")}`
    : "";

  const eventSection = eventCalendar && eventCalendar.thisWeek.length > 0
    ? `\n## 本周及本月关注事件\n本周：${eventCalendar.thisWeek.map((e) => `${e.date} ${e.event}（${e.importance}）`).join("；")}\n本月后续：${(eventCalendar.thisMonthBeyondWeek || []).slice(0, 8).map((e) => `${e.date} ${e.event}（${e.importance}）`).join("；")}`
    : "";

  return `你是资深全球宏观策略分析师。基于以下真实市场数据，生成精炼的定性判断。
核心原则：各部分职责不同，严禁跨部分重复引用相同数据点和判断。

# 市场数据

## 信号摘要
风险偏好：${summary.signals.riskPreference}
主导因子：${summary.signals.dominantFactor}
交易质量：${summary.signals.tradeQuality}
风险评分：${summary.signals.riskScore}

## 美股与风险
${summary.usRisk.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}）`).join("\n")}

## 利率与美元
${summary.ratesDollar.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}）`).join("\n")}

## 中国资产
${summary.china.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}）`).join("\n")}

## 商品与全球
${summary.commoditiesGlobal.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}）`).join("\n")}
${econSection}
${factorSection}
${eventSection}

## 今日重要新闻
${summary.news.slice(0, 4).map((n) => `- [${n.source}] ${n.title}`).join("\n")}

# 各部分职责定义（严格遵守）

1. **narrative**（主线叙事）：识别今天市场在讲什么故事。只给叙事名称、强度、跟随/背离资产和1句交易含义。这是全卡最核心的定性判断，不展开论证。
2. **logic**（交易逻辑）：2-3条，用具体数据解释跨资产传导。这是唯一引用具体数字的论证部分。严禁与narrative或crossAsset重复相同数据点。
3. **outlook**（后续判断）：2条，纯方向性前瞻判断。不重复logic的论证，只给出"如果X则Y"的条件展望。
4. **crossAsset**（跨资产信号）：6个维度，每个仅1句定性方向判断（≤15字），绝对不引用任何具体数字（数字在logic中已出现）。格式如："股债关系：利率压制成长"而非"股债关系：US 10Y +6bp压制Nasdaq -1.54%"。
5. **watchList**（后续观察）：3条，仅列具体数据发布/政策事件/技术点位，不重复event calendar已列出的事件，不写前瞻判断（outlook已覆盖）。

# 输出格式

严格输出JSON：
{
  "narrative": {
    "theme": "5-10字叙事名称",
    "strength": "强化中/维持/弱化中/切换中",
    "assetsFollowing": [{"asset": "资产名", "move": "涨跌幅"}],
    "assetsDiverging": [{"asset": "资产名", "move": "涨跌幅"}],
    "implication": "1句交易含义"
  },
  "logic": ["2-3条论证，每条1-2句，必须引用具体数值"],
  "outlook": ["2条方向性前瞻，不重复logic"],
  "crossAsset": {
    "股债关系": "≤15字定性判断",
    "美元压力": "≤15字定性判断",
    "信用风险": "≤15字定性判断",
    "商品信号": "≤15字定性判断",
    "中国资产": "≤15字定性判断",
    "波动率": "≤15字定性判断"
  },
  "watchList": ["3条具体观察项，不重复事件日历"]
}

只输出JSON，不要包含任何解释文字。`;
}

// ── Validate AI output ───────────────────────────────────────────────

function validateAiText(text) {
  const required = ["narrative", "logic", "outlook", "crossAsset", "watchList"];
  const missing = required.filter((k) => !text[k]);
  if (missing.length > 0) throw new Error(`AI output missing fields: ${missing.join(", ")}`);
  if (!Array.isArray(text.logic) || text.logic.length < 2 || text.logic.length > 3) throw new Error("logic must be array with 2-3 items");
  if (!Array.isArray(text.outlook) || text.outlook.length < 1 || text.outlook.length > 2) throw new Error("outlook must be array with 1-2 items");
  if (!Array.isArray(text.watchList) || text.watchList.length < 2 || text.watchList.length > 3) throw new Error("watchList must be array with 2-3 items");
  const crossKeys = ["股债关系", "美元压力", "信用风险", "商品信号", "中国资产", "波动率"];
  const crossMissing = crossKeys.filter((k) => !text.crossAsset[k]);
  if (crossMissing.length > 0) throw new Error(`crossAsset missing keys: ${crossMissing.join(", ")}`);
  // Validate crossAsset values are short (≤20 chars, allowing some leniency)
  for (const [k, v] of Object.entries(text.crossAsset)) {
    if (v.length > 25) throw new Error(`crossAsset.${k} too long (${v.length} chars): ${v}`);
  }

  // Validate narrative structure
  if (!text.narrative.theme || text.narrative.theme.length < 3) throw new Error("narrative.theme too short");
  if (!["强化中", "维持", "弱化中", "切换中"].includes(text.narrative.strength)) throw new Error(`narrative.strength invalid: ${text.narrative.strength}`);
  if (!Array.isArray(text.narrative.assetsFollowing) || text.narrative.assetsFollowing.length < 1) throw new Error("narrative.assetsFollowing must have >=1 item");

  console.log("AI_TEXT_VALIDATION OK");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const apiKey = required(env("GEMINI_API_KEY"), "GEMINI_API_KEY");

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const summary = buildDataSummary(data);

  // Load event calendar if available
  let eventCalendar = null;
  const calendarPath = path.resolve(arg("calendar", ""));
  if (calendarPath) {
    try {
      eventCalendar = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
    } catch {
      console.log("EVENT_CALENDAR_LOAD_FAILED: proceeding without calendar data");
    }
  }

  console.log("AI_COMMENTARY_INPUT=" + JSON.stringify({
    date: summary.date,
    riskScore: summary.signals.riskScore,
    riskPreference: summary.signals.riskPreference,
    dominantFactor: summary.signals.dominantFactor,
    assetCount: summary.usRisk.length + summary.ratesDollar.length + summary.china.length + summary.commoditiesGlobal.length,
    newsCount: summary.news.length,
    econSurpriseCount: summary.econSurprise.length,
    cftcCount: summary.cftcPositions.length,
    factorGroups: Object.keys(summary.factorRotation).length,
    eventWeekCount: eventCalendar?.thisWeek?.length || 0,
  }));

  // Discover available Gemini models
  const models = await discoverGeminiModels(apiKey);

  // Build prompt and call Gemini
  const prompt = buildPrompt(summary, eventCalendar);
  console.log(`AI_COMMENTARY_PROMPT_LENGTH=${prompt.length}`);

  let aiText;
  try {
    aiText = await geminiJson(models, apiKey, prompt, 0.35, "macro_commentary");
    validateAiText(aiText);
    console.log("AI_COMMENTARY_GENERATED successfully");
  } catch (err) {
    console.error(`AI_COMMENTARY_FAILED: ${String(err).slice(0, 500)}`);
    console.log("AI_COMMENTARY_FALLBACK: keeping existing hardcoded text");
    // Don't modify the data — keep the fallback text
    return;
  }

  // Replace the text in the data
  data.text = aiText;

  // Keep the signals data (riskPreference etc.) but we don't modify it
  // Write back the enriched data
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`AI_COMMENTARY_WRITTEN to ${dataPath}`);
  console.log("AI_COMMENTARY_PREVIEW=" + JSON.stringify({
    narrativeTheme: aiText.narrative?.theme,
    narrativeStrength: aiText.narrative?.strength,
    narrativeImplication: aiText.narrative?.implication,
    logicCount: aiText.logic.length,
    outlookCount: aiText.outlook.length,
    watchCount: aiText.watchList.length,
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

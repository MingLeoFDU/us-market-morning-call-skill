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
  return { name: row.name, value: row.value, day: row.day, week: row.week, month: row.month };
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
  };
}

// ── Build the Gemini prompt ──────────────────────────────────────────

function buildPrompt(summary) {
  return `你是资深全球宏观策略分析师，专注于美股、美债、美元、商品和中国资产的跨资产分析。
你的任务是基于以下**真实市场数据**，生成一份专业、有洞察力的宏观日报评论。

# 市场数据

## 信号摘要
风险偏好：${summary.signals.riskPreference}
主导因子：${summary.signals.dominantFactor}
交易质量：${summary.signals.tradeQuality}
风险评分：${summary.signals.riskScore}

## 美股与风险指标
${summary.usRisk.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}，月 ${r.month}）`).join("\n")}

## 利率与美元
${summary.ratesDollar.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}，月 ${r.month}）`).join("\n")}

## 中国资产
${summary.china.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}，月 ${r.month}）`).join("\n")}

## 商品与全球
${summary.commoditiesGlobal.map((r) => `- ${r.name}：${r.value}（日 ${r.day}，周 ${r.week}，月 ${r.month}）`).join("\n")}

## 今日重要新闻标题
${summary.news.map((n) => `- [${n.source}] ${n.title}${n.summary ? " — " + n.summary : ""}`).join("\n")}

# 分析要求

请基于以上数据，生成以下内容的 JSON。每一部分都必须基于数据中的**具体涨跌方向和幅度**来做判断，切忌写泛泛而谈的套话。

要求：
- **focus**（今日宏观焦点）：10-20字，概括今天市场最核心的交易主题或最关键的变量。
- **trade**（市场交易主线）：10-15字，说明当前市场围绕什么定价（如"利率预期重定价""美元走强""风险偏好修复"等）。
- **logic**（交易逻辑）：3-4条，每条1-2句。用数据说话，解释当前的跨资产传导逻辑。例如"10Y实际利率上行Xbp，同时纳指Y%，表明成长股估值承压"这种具体关联。
- **outlook**（后续判断）：2-3条，每条1-2句。基于当前趋势和跨资产信号，给出短线展望，包括需要关注的关键变量和可能的风险情形。
- **crossAsset**（跨资产信号）：6个维度的简短判断（各1句），必须引用数据：
  - "股债关系"：结合股指和美债收益率的同向/反向变动判断
  - "美元压力"：结合DXY和USDCNY走势判断对非美资产的影响
  - "信用风险"：结合HYG vs LQD相对表现判断信用市场情绪
  - "商品信号"：结合黄金、原油、铜的联动判断交易主题
  - "中国资产"：结合恒生科技/KWEB和人民币走势判断外资态度
  - "波动率"：结合VIX和MOVE判断市场恐慌/平静程度
- **watchList**（后续观察）：4-5条，每条是具体需要跟踪的指标或事件，要具体到资产/数据，不能是泛泛的"关注政策"之类。

# 输出格式

严格输出一个 JSON 对象，schema 如下：
{
  "focus": "string",
  "trade": "string",
  "logic": ["string", "string", "string"],
  "outlook": ["string", "string"],
  "crossAsset": {
    "股债关系": "string",
    "美元压力": "string",
    "信用风险": "string",
    "商品信号": "string",
    "中国资产": "string",
    "波动率": "string"
  },
  "watchList": ["string", "string", "string", "string"]
}

只输出 JSON，不要包含任何解释文字。`;
}

// ── Validate AI output ───────────────────────────────────────────────

function validateAiText(text) {
  const required = ["focus", "trade", "logic", "outlook", "crossAsset", "watchList"];
  const missing = required.filter((k) => !text[k]);
  if (missing.length > 0) throw new Error(`AI output missing fields: ${missing.join(", ")}`);
  if (!Array.isArray(text.logic) || text.logic.length < 2) throw new Error("logic must be array with >=2 items");
  if (!Array.isArray(text.outlook) || text.outlook.length < 1) throw new Error("outlook must be array with >=1 item");
  if (!Array.isArray(text.watchList) || text.watchList.length < 3) throw new Error("watchList must be array with >=3 items");
  const crossKeys = ["股债关系", "美元压力", "信用风险", "商品信号", "中国资产", "波动率"];
  const crossMissing = crossKeys.filter((k) => !text.crossAsset[k]);
  if (crossMissing.length > 0) throw new Error(`crossAsset missing keys: ${crossMissing.join(", ")}`);
  // Sanity check: focus and trade shouldn't be too short or generic
  if (text.focus.length < 6) throw new Error("focus too short");
  if (text.trade.length < 4) throw new Error("trade too short");
  console.log("AI_TEXT_VALIDATION OK");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const apiKey = required(env("GEMINI_API_KEY"), "GEMINI_API_KEY");

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const summary = buildDataSummary(data);

  console.log("AI_COMMENTARY_INPUT=" + JSON.stringify({
    date: summary.date,
    riskScore: summary.signals.riskScore,
    riskPreference: summary.signals.riskPreference,
    dominantFactor: summary.signals.dominantFactor,
    assetCount: summary.usRisk.length + summary.ratesDollar.length + summary.china.length + summary.commoditiesGlobal.length,
    newsCount: summary.news.length,
  }));

  // Discover available Gemini models
  const models = await discoverGeminiModels(apiKey);

  // Build prompt and call Gemini
  const prompt = buildPrompt(summary);
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
    focus: aiText.focus,
    trade: aiText.trade,
    logicCount: aiText.logic.length,
    outlookCount: aiText.outlook.length,
    watchCount: aiText.watchList.length,
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

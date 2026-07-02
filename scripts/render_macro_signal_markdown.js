#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function row(rows, name) {
  return rows.find((item) => item.name === name) || { value: "n/a", day: "n/a", week: "n/a", month: "n/a" };
}

function line(rows, name) {
  const item = row(rows, name);
  if (item.value === "n/a") return "";
  return `- ${name}：${item.value}（日 ${item.day}，周 ${item.week}，月 ${item.month}）`;
}

function rateLine(rows, name) {
  const item = row(rows, name);
  if (item.value === "n/a") return "";
  return `- ${name}：${item.value}（日 ${item.day}，周 ${item.week}，月 ${item.month}）`;
}

function block(lines) {
  return lines.filter(Boolean).join("\n");
}

function render(data) {
  const us = data.sections.usRisk;
  const rates = data.sections.ratesDollar;
  const china = data.sections.china;
  const global = data.sections.commoditiesGlobal;
  const text = data.text;
  const narrative = text.narrative || {};

  // Unified narrative opening (replaces separate focus + trade + narrative block)
  const narrativeLine = narrative.theme
    ? `**今日主线：${narrative.theme}**（${narrative.strength}）
跟随：${(narrative.assetsFollowing || []).map((a) => `${a.asset} ${a.move}`).join(" / ")}${narrative.assetsDiverging?.length > 0 ? "　背离：" + narrative.assetsDiverging.map((a) => `${a.asset} ${a.move}`).join(" / ") : ""}
→ ${narrative.implication || ""}`
    : "";

  // Factor rotation: only raw data tables (no AI summary — it duplicates the tables)
  const factorBlock = data.factorRotation && Object.keys(data.factorRotation).length > 0
    ? `
八、因子轮动
${Object.entries(data.factorRotation).map(([group, factors]) => {
    const label = group === "equityStyle" ? "权益风格" : group === "ficcCarry" ? "FICC因子" : "跨资产主题";
    return `**${label}**\n${factors.map((f) => `${f.name}(${f.long}/${f.short})：日 ${f.day} 周 ${f.week} → ${f.direction}`).join("\n")}`;
  }).join("\n")}
`
    : "";

  // Event calendar section
  const eventBlock = data.eventCalendar
    ? `
九、本周关注
${data.eventCalendar.thisWeek.map((e) => `- ${e.date}：${e.event}（${e.importance}）`).join("\n")}
**本月后续**
${(data.eventCalendar.thisMonthBeyondWeek || []).slice(0, 8).map((e) => `- ${e.date}：${e.event}（${e.importance}）`).join("\n")}
`
    : "";

  // Economic surprise section
  const econBlock = (data.econSurprise || []).length > 0
    ? `
六、经济数据超预期方向
${data.econSurprise.map((e) => `- ${e.name}：${e.direction}（偏离3M均值 ${e.surprisePct}%）`).join("\n")}
`
    : "";

  return `【Macro Daily Signal｜${data.date}】

${narrativeLine}

风险偏好：${data.signals.riskPreference}　主导因子：${data.signals.dominantFactor}　交易质量：${data.signals.tradeQuality}

交易逻辑：
${(text.logic || []).join("\n")}

后续判断：
${(text.outlook || []).join("\n")}

一、美股与风险
${block([
  line(us, "S&P 500"),
  line(us, "Nasdaq 100"),
  line(us, "Russell 2000"),
  line(us, "RSP"),
  line(us, "VIX"),
  line(us, "MOVE"),
  line(us, "HYG"),
  line(us, "LQD"),
])}

二、利率与美元
${block([
  rateLine(rates, "US 2Y"),
  rateLine(rates, "US 10Y"),
  rateLine(rates, "US 30Y"),
  rateLine(rates, "10Y-2Y"),
  rateLine(rates, "10Y实际利率"),
  rateLine(rates, "10Y通胀预期"),
  line(rates, "DXY"),
  line(rates, "EURUSD"),
  line(rates, "USDJPY"),
  line(rates, "GBPUSD"),
  line(rates, "USDCNY"),
  line(rates, "AUDUSD"),
])}

三、中国资产
${block([
  line(china, "沪深300"),
  line(china, "创业板ETF"),
  line(china, "恒生指数"),
  line(china, "恒生科技ETF"),
  line(china, "KWEB"),
])}

四、商品与全球
${block([
  line(global, "黄金"),
  line(global, "白银"),
  line(global, "铜"),
  line(global, "WTI原油"),
  line(global, "Brent原油"),
  line(global, "天然气"),
  line(global, "Nikkei 225"),
  line(global, "STOXX 600"),
  line(global, "MSCI EM"),
])}

五、跨资产信号
${Object.entries(text.crossAsset || {}).map(([key, value]) => `${key}：${value}`).join("\n")}

后续观察：
${(text.watchList || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}
${econBlock}${factorBlock}${eventBlock}
数据源：${data.sources.market} + ${data.sources.rates} + 新闻RSS。仅供投研参考。
`;
}

const input = path.resolve(arg("data"));
const output = path.resolve(arg("out", "output/macro-daily-signal.md"));
const data = JSON.parse(fs.readFileSync(input, "utf8"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, render(data));
console.log(output);

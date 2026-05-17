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
  return `【Macro Daily Signal｜${data.date}】

今日简评：
今日宏观焦点为【${text.focus}】。
市场主要交易【${text.trade}】。

风险偏好：${data.signals.riskPreference}
主导因子：${data.signals.dominantFactor}
交易质量：${data.signals.tradeQuality}

交易逻辑：
${text.logic.join("\n")}

后续判断：
${text.outlook.join("\n")}

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
股债关系：${text.crossAsset.股债关系}
美元压力：${text.crossAsset.美元压力}
信用风险：${text.crossAsset.信用风险}
商品信号：${text.crossAsset.商品信号}
中国资产：${text.crossAsset.中国资产}
波动率：${text.crossAsset.波动率}

后续观察：
${text.watchList.map((item, index) => `${index + 1}. ${item}`).join("\n")}

数据源：
- ${data.sources.market}
- ${data.sources.rates}
- 新闻：${data.sources.news.map((item) => item.name).join(" / ")}
- 已剔除不稳定字段：${(data.sources.removed || data.sources.gaps || []).join("；")}
- 代理说明：${(data.sources.notes || []).join("；") || "无"}
`;
}

const input = path.resolve(arg("data"));
const output = path.resolve(arg("out", "output/macro-daily-signal.md"));
const data = JSON.parse(fs.readFileSync(input, "utf8"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, render(data));
console.log(output);

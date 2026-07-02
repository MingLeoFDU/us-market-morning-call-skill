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

function row(rows, name) {
  return rows.find((item) => item.name === name && item.value !== "n/a");
}

function rowText(item) {
  if (!item) return "";
  const color = String(item.day).startsWith("-") ? "red" : "green";
  return `**${item.name}**：${item.value}  <font color='${color}'>日 ${item.day}</font>  周 ${item.week}  月 ${item.month}`;
}

function section(title, rows) {
  const content = rows.filter(Boolean).map(rowText).filter(Boolean).join("\n");
  if (!content) return [];
  return [
    { tag: "markdown", content: `**${title}**\n${content}` },
    { tag: "hr" },
  ];
}

function bullet(title, rows) {
  return [
    {
      tag: "markdown",
      content: `**${title}**\n${rows.map((item) => `- ${item}`).join("\n")}`,
    },
    { tag: "hr" },
  ];
}

function templateFor(signal) {
  if (signal.riskPreference === "Risk-on") return "green";
  if (signal.riskPreference === "Risk-off") return "red";
  return "blue";
}

function buildCard(data) {
  const us = data.sections.usRisk;
  const rates = data.sections.ratesDollar;
  const china = data.sections.china;
  const global = data.sections.commoditiesGlobal;
  const text = data.text;

  // Build narrative section
  const narrativeSection = text.narrative
    ? [
        {
          tag: "markdown",
          content: [
            `**主线叙事：${text.narrative.theme}**（${text.narrative.strength}）`,
            `跟随：${text.narrative.assetsFollowing.map((a) => `${a.asset} ${a.move}`).join(" / ")}`,
            text.narrative.assetsDiverging?.length > 0 ? `背离：${text.narrative.assetsDiverging.map((a) => `${a.asset} ${a.move}`).join(" / ")}` : "",
            `含义：${text.narrative.implication}`,
          ].filter(Boolean).join("\n"),
        },
        { tag: "hr" },
      ]
    : [];

  // Build economic surprise section
  const econSurpriseSection = (data.econSurprise || []).length > 0
    ? [
        ...bullet("六、经济数据超预期", data.econSurprise.map((e) => `${e.name}：${e.direction}（偏离 ${e.surprisePct}%）`)),
      ]
    : [];

  // Build CFTC positioning section
  const cftcSection = (text.positioning || []).length > 0
    ? [
        ...bullet("七、仓位信号", text.positioning),
      ]
    : [];

  // Build factor rotation section
  const factorElements = [];
  if (data.factorRotation && Object.keys(data.factorRotation).length > 0) {
    // AI summary points first
    if (text.factorRotation && text.factorRotation.length > 0) {
      factorElements.push(...bullet("八、因子轮动要点", text.factorRotation));
    }
    // Then detailed factor tables
    for (const [group, factors] of Object.entries(data.factorRotation)) {
      const label = group === "equityStyle" ? "权益风格" : group === "ficcCarry" ? "FICC因子" : "跨资产主题";
      factorElements.push({
        tag: "markdown",
        content: `**${label}**\n${factors.map((f) => `${f.name}：日 ${f.day} 周 ${f.week} → ${f.direction}`).join("\n")}`,
      });
      factorElements.push({ tag: "hr" });
    }
  }

  // Build event calendar section
  const eventSection = data.eventCalendar && data.eventCalendar.thisWeek.length > 0
    ? [
        ...bullet("本周关注", data.eventCalendar.thisWeek.map((e) => `${e.date} ${e.event}（${e.importance}）`)),
        ...(data.eventCalendar.thisMonthBeyondWeek || []).length > 0
          ? bullet("本月后续", data.eventCalendar.thisMonthBeyondWeek.slice(0, 8).map((e) => `${e.date} ${e.event}（${e.importance}）`))
          : [],
      ]
    : [];

  return {
    config: { wide_screen_mode: true },
    header: {
      template: templateFor(data.signals),
      title: { tag: "plain_text", content: `Macro Daily Signal｜${data.date}` },
    },
    elements: [
      {
        tag: "markdown",
        content: [
          `**今日简评**：${text.focus}`,
          `市场主要交易：**${text.trade}**`,
          `风险偏好：**${data.signals.riskPreference}**　主导因子：**${data.signals.dominantFactor}**　交易质量：**${data.signals.tradeQuality}**`,
        ].join("\n"),
      },
      { tag: "hr" },
      ...narrativeSection,
      ...bullet("交易逻辑", text.logic),
      ...bullet("后续判断", text.outlook),
      ...section("一、美股与风险", [
        row(us, "S&P 500"),
        row(us, "Nasdaq 100"),
        row(us, "Russell 2000"),
        row(us, "RSP"),
        row(us, "VIX"),
        row(us, "MOVE"),
        row(us, "HYG"),
        row(us, "LQD"),
      ]),
      ...section("二、利率与美元", [
        row(rates, "US 2Y"),
        row(rates, "US 10Y"),
        row(rates, "US 30Y"),
        row(rates, "10Y-2Y"),
        row(rates, "10Y实际利率"),
        row(rates, "10Y通胀预期"),
        row(rates, "DXY"),
        row(rates, "EURUSD"),
        row(rates, "USDJPY"),
        row(rates, "GBPUSD"),
        row(rates, "USDCNY"),
        row(rates, "AUDUSD"),
      ]),
      ...section("三、中国资产", [
        row(china, "沪深300"),
        row(china, "创业板ETF"),
        row(china, "恒生指数"),
        row(china, "恒生科技ETF"),
        row(china, "KWEB"),
      ]),
      ...section("四、商品与全球", [
        row(global, "黄金"),
        row(global, "白银"),
        row(global, "铜"),
        row(global, "WTI原油"),
        row(global, "Brent原油"),
        row(global, "天然气"),
        row(global, "Nikkei 225"),
        row(global, "STOXX 600"),
        row(global, "MSCI EM"),
      ]),
      ...bullet("五、跨资产信号", Object.entries(text.crossAsset).map(([key, value]) => `${key}：${value}`)),
      ...bullet("后续观察", text.watchList),
      ...econSurpriseSection,
      ...cftcSection,
      ...factorElements,
      ...eventSection,
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "数据源：Yahoo Finance + FRED + CFTC + 新闻RSS。仅供投研参考。",
          },
        ],
      },
    ],
  };
}

async function sendToFeishu(webhook, payload) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(body);
          if (json.code === 0 || json.StatusCode === 0) {
            console.log(`Feishu send OK (attempt ${attempt})`);
            return body;
          }
          lastError = new Error(`Feishu code ${json.code}: ${body}`);
        } catch {
          console.log(body);
          return body;
        }
      } else {
        lastError = new Error(`Feishu webhook failed: ${res.status} ${body}`);
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) {
      const delay = Math.min(4000, 1000 * Math.pow(2, attempt - 1));
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function main() {
  const webhook = required(env("FEISHU_WEBHOOK_URL"), "FEISHU_WEBHOOK_URL");
  const dataPath = path.resolve(required(arg("data"), "--data"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const body = await sendToFeishu(webhook, { msg_type: "interactive", card: buildCard(data) });
  console.log(body);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

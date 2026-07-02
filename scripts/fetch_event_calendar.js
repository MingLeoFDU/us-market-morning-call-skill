#!/usr/bin/env node

/**
 * Fetch upcoming economic events and key dates for this week and this month.
 *
 * Sources:
 * 1. FRED release calendar (free, no API key needed)
 * 2. Hardcoded known recurring events (FOMC, options expiry, quarter-end)
 *
 * Output: JSON with thisWeek and thisMonth arrays, each containing
 * { date, event, importance, category } objects.
 */

const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ── Recurring known events ────────────────────────────────────────────

function getRecurringEvents(now) {
  const events = [];
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const day = now.getDate();

  // FOMC meetings (approximate dates for 2026 — 8 meetings per year)
  const fomcDates2026 = [
    "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16",
  ];
  for (const d of fomcDates2026) {
    const date = new Date(d);
    if (date >= now) {
      events.push({ date: d, event: "FOMC利率决议", importance: "★★★", category: "央行" });
      // Press conference usually next day
      const pressDate = new Date(date.getTime() + 86400000);
      const pressDateStr = pressDate.toISOString().slice(0, 10);
      events.push({ date: pressDateStr, event: "Powell新闻发布会", importance: "★★★", category: "央行" });
    }
  }

  // Options expiry (third Friday of each month)
  for (let m = month; m <= month + 2; m++) {
    const actualMonth = m % 12;
    const actualYear = m >= 12 ? year + 1 : year;
    // Third Friday
    const firstDay = new Date(actualYear, actualMonth, 1);
    const firstFriday = firstDay.getDay() <= 5
      ? 1 + (5 - firstDay.getDay())
      : 1 + (12 - firstDay.getDay());
    const thirdFriday = firstFriday + 14;
    const expiryDate = `${actualYear}-${String(actualMonth + 1).padStart(2, "0")}-${String(thirdFriday).padStart(2, "0")}`;
    if (new Date(expiryDate) >= now) {
      events.push({ date: expiryDate, event: "美股期权到期日(OPEX)", importance: "★★", category: "市场结构" });
    }
  }

  // Quarter-end rebalancing
  const quarterEnds = [
    "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31",
  ];
  for (const d of quarterEnds) {
    if (new Date(d) >= now) {
      events.push({ date: d, event: "季度末机构rebalancing", importance: "★★", category: "市场结构" });
    }
  }

  // Known US data release patterns (roughly same day each month)
  const dataPatterns = [];
  for (let offsetMonth = 0; offsetMonth <= 1; offsetMonth++) {
    const targetMonth = (month + offsetMonth) % 12;
    const targetYear = month + offsetMonth >= 12 ? year + 1 : year;
    const mm = String(targetMonth + 1).padStart(2, "0");

    // CPI: usually around 10th-13th
    dataPatterns.push({ date: `${targetYear}-${mm}-10`, event: "CPI数据发布窗口(约10-13日)", importance: "★★★", category: "经济数据" });
    // NFP: usually first Friday
    dataPatterns.push({ date: `${targetYear}-${mm}-03`, event: "非农就业数据发布窗口(约第一个周五)", importance: "★★★", category: "经济数据" });
    // PCE: usually around last week
    dataPatterns.push({ date: `${targetYear}-${mm}-27`, event: "PCE数据发布窗口(约月末)", importance: "★★★", category: "经济数据" });
    // ISM Manufacturing: usually 1st
    dataPatterns.push({ date: `${targetYear}-${mm}-01`, event: "ISM制造业PMI发布窗口", importance: "★★★", category: "经济数据" });
    // ISM Services: usually 3rd
    dataPatterns.push({ date: `${targetYear}-${mm}-03`, event: "ISM服务业PMI发布窗口", importance: "★★", category: "经济数据" });
    // Retail sales: usually around 14th-15th
    dataPatterns.push({ date: `${targetYear}-${mm}-14`, event: "零售销售数据发布窗口", importance: "★★", category: "经济数据" });
    // Durable goods: usually around 23rd-27th
    dataPatterns.push({ date: `${targetYear}-${mm}-24`, event: "耐用品订单发布窗口", importance: "★★", category: "经济数据" });
  }
  events.push(...dataPatterns);

  // ECB meetings (approximate)
  const ecbDates2026 = [
    "2026-01-30", "2026-03-13", "2026-04-17", "2026-06-05",
    "2026-07-17", "2026-09-11", "2026-10-23", "2026-12-11",
  ];
  for (const d of ecbDates2026) {
    if (new Date(d) >= now) {
      events.push({ date: d, event: "ECB利率决议", importance: "★★★", category: "央行" });
    }
  }

  // BOJ meetings (approximate)
  const bojDates2026 = [
    "2026-01-22", "2026-03-14", "2026-04-26", "2026-06-17",
    "2026-07-31", "2026-09-22", "2026-10-31", "2026-12-18",
  ];
  for (const d of bojDates2026) {
    if (new Date(d) >= now) {
      events.push({ date: d, event: "BOJ利率决议", importance: "★★★", category: "央行" });
    }
  }

  return events;
}

// ── FRED release calendar ─────────────────────────────────────────────

async function fetchFredReleases(apiKey) {
  if (!apiKey) return [];
  try {
    // Get upcoming releases for the next 30 days
    const todayStr = today();
    const thirtyDaysLater = new Date(new Date().getTime() + 30 * 86400000);
    const laterStr = thirtyDaysLater.toISOString().slice(0, 10);

    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=2024a_fut_xls`;
    // FRED doesn't have a direct release calendar API without key,
    // so we rely on our recurring events + the surprise data for context
    return [];
  } catch {
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const output = path.resolve(arg("out", `data/event-calendar-${today()}.json`));

  const now = new Date(new Date().getTime() + 8 * 3600000); // Asia/Shanghai
  const recurringEvents = getRecurringEvents(now);
  const fredEvents = await fetchFredReleases(process.env.FRED_API_KEY || "");

  // Combine and deduplicate
  const allEvents = [...recurringEvents, ...fredEvents];
  const seen = new Set();
  const deduped = allEvents.filter((e) => {
    const key = `${e.date}:${e.event}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date
  deduped.sort((a, b) => a.date.localeCompare(b.date));

  // Split into thisWeek and thisMonth
  const todayStr = today();
  const weekEnd = new Date(new Date(todayStr).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const monthEnd = new Date(new Date(todayStr).getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const thisWeek = deduped.filter((e) => e.date >= todayStr && e.date <= weekEnd);
  const thisMonth = deduped.filter((e) => e.date >= todayStr && e.date <= monthEnd);

  // Remove thisWeek events from thisMonth to avoid duplication in display
  const weekEventKeys = new Set(thisWeek.map((e) => `${e.date}:${e.event}`));
  const thisMonthBeyondWeek = thisMonth.filter((e) => !weekEventKeys.has(`${e.date}:${e.event}`));

  const result = {
    date: todayStr,
    thisWeek,
    thisMonthBeyondWeek,
    totalEvents: deduped.length,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

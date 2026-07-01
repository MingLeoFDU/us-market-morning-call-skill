# US Market Morning Call Skill

Daily Feishu push bot suite for market data, FICC desk English learning, and stock news — running on GitHub Actions.

## Workflows

| Workflow | File | Schedule (Beijing) | Content |
|----------|------|---------------------|---------|
| Macro Daily Signal | `daily-feishu.yml` | 18:30 weekdays | US rates, equities, FX, commodities, cross-asset signals |
| FICC 日报 | `daily-ficc-feishu.yml` | 18:30 weekdays | China money market, bond curves, active bonds (akshare) |
| FICC Desk English | `daily-ficc-english-feishu.yml` | 08:45 / 09:30 / 10:15 weekdays | Gemini-curated FICC English learning card from RSS feeds |
| Stock News | `daily-stock-news.yml` | 09:00 weekdays | 10 translated stock news items with research summaries |

> `daily-feishu.yml` and `daily-ficc-feishu.yml` share the same UTC cron (`30 10 * * 1-5`) because 10:30 UTC = 18:30 Beijing (CN market close) = 06:30 New York (US pre-market). They serve different markets and run in parallel.

## Required Secrets

- `FEISHU_WEBHOOK_URL` — personal Feishu webhook bot URL (all workflows)
- `GEMINI_API_KEY` — Google Gemini API key (FICC English workflow only)

## Project Structure

```
scripts/                          # Node.js scripts for Macro Signal & Stock News
├── fetch_macro_signal_data.js    # Fetch Yahoo Finance + FRED data, build signals
├── send_feishu_macro_signal_card.js  # Send macro signal card (with retry)
├── fetch_stock_news.js           # Fetch + translate stock news from CN/EN sources
├── send_feishu_stock_news_card.js    # Send stock news card (with retry)
├── generate_pdf.js               # US Market Morning Call PDF renderer
└── ...

daily_ficc_push/                  # Python scripts for FICC 日报 & FICC English
├── daily_rates_push.py           # Core: fetch akshare data, build card, send to Feishu
├── send_feishu_daily_ficc_card.py  # Entry point for FICC 日报 (--date / --from-output / --dry-run)
├── ficc_desk_english.py          # FICC English learning card via Gemini + RSS
└── outputs/                      # Generated artifacts (gitignored)

.github/workflows/                # 4 GitHub Actions workflows
```

## Manual Run

```bash
# Macro Daily Signal
FEISHU_WEBHOOK_URL=https://... node scripts/run_daily_agent.js

# FICC 日报
cd daily_ficc_push && FEISHU_WEBHOOK_URL=https://... python send_feishu_daily_ficc_card.py

# FICC Desk English
FEISHU_WEBHOOK_URL=https://... GEMINI_API_KEY=... python daily_ficc_push/ficc_desk_english.py

# Stock News
FEISHU_WEBHOOK_URL=https://... node scripts/run_stock_news_agent.js
```

## PDF Generation (Legacy)

The original US Market Morning Call PDF skill is still available:

```bash
node scripts/generate_pdf.js \
  --data examples/leo-live-2026-05-06.json \
  --out output/US_Market_Morning_Call.pdf
```

## Data Sources

- **Market data**: Yahoo Finance chart API, FRED CSV (US rates)
- **China bond data**: AKShare (Shibor, repo fixing, bond curves, active bonds)
- **News**: 财联社电报, 东方财富7x24, Google News RSS, Yahoo/MarketWatch/CNBC RSS
- **FICC English**: Bloomberg Markets/Economics RSS, FT Markets RSS, ING Think RSS → Gemini curation

Market consensus and strategy blocks are rule-based investment research heuristics, not brokerage consensus estimates or personalized investment advice.

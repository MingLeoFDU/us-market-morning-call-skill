# US Market Morning Call Skill

This Codex skill generates a one-page `US Equity Morning Note` PDF in the approved US Market Morning Call layout.

## Generate the Approved Sample

```bash
node scripts/generate_pdf.js \
  --data examples/leo-live-2026-05-06.json \
  --out output/US_Market_Morning_Call_2026-05-06_live_Leo.pdf
```

## Daily Workflow

1. Update the input JSON with the current market snapshot.
2. Update `earnings.beats` and `earnings.misses` from overnight / after-hours / pre-market movers.
3. Set `analyst` to the requested analyst name.
4. Run the generator.
5. Open the PDF and confirm `Overnight Earnings Reactions` is not stale.

## Input Contract

The generator expects a JSON file with these top-level fields:

- `date`
- `analyst`
- `subtitle`
- `market.indexes`
- `market.assets`
- `tone`
- `earnings.beats`
- `earnings.misses`
- `themes`
- `sourceNote`

Each table row is represented as an array of display-ready strings, preserving exact formatting in the PDF.

## Notes

The script has no external npm dependencies. It writes a vector PDF directly using built-in Node.js APIs.

## Feishu Delivery Agent

The Feishu delivery layer is independent from the PDF renderer:

- PDF rendering skill: `SKILL.md` + `scripts/generate_pdf.js`
- Feishu delivery skill: `feishu-delivery-skill/SKILL.md`
- Daily agent: `scripts/run_daily_agent.js`

Personal Feishu webhook mode sends a WYSIWYG interactive research card directly into Feishu. PDF and JSON files are still saved as GitHub Actions artifacts for audit/backups.

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
ANALYST=Leo \
node scripts/run_daily_agent.js
```

Custom app file upload mode:

```bash
FEISHU_APP_ID=cli_xxx \
FEISHU_APP_SECRET=xxx \
FEISHU_RECEIVE_ID=oc_xxx \
FEISHU_RECEIVE_ID_TYPE=chat_id \
ANALYST=Leo \
node scripts/run_daily_agent.js
```

GitHub Actions schedule:

`.github/workflows/daily-feishu.yml` runs on weekdays at `10:30 UTC`, which is `06:30 New York time` during US daylight time.

Required repository secrets:

- `FEISHU_WEBHOOK_URL` for personal Feishu webhook mode

Or, for custom app file upload mode:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_RECEIVE_ID`
- `FEISHU_RECEIVE_ID_TYPE`

Optional repository variables/secrets:

- `ANALYST`, default `Leo`
- `EARNINGS_MOVERS_JSON`, used when you want curated overnight earnings movers instead of the default Yahoo daily gainers/losers screen

## Daily AI Research Push

The Feishu card is generated from `scripts/fetch_ai_research_data.js` and includes:

- Top-line risk regime, risk score, breadth, and key watchpoints
- Market consensus inferred from rates, equity breadth, Mega 7 performance, commodities, and news
- Strategy suggestions for positioning and risk control
- Rates: 13W, 5Y, 10Y, 30Y US Treasury yields
- Equities: S&P 500, Nasdaq, Dow, Hang Seng, Hang Seng Tech, Shanghai, Shenzhen, CSI 300/500/1000
- Watchlist: US Mega 7 and China Mega 7
- Commodities: gold, silver, copper, aluminum, lithium-chain proxy, WTI oil
- News: headline plus one-sentence summary from public RSS feeds

### Data Sources

Market data source:

```text
Yahoo Finance chart API
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d&includePrePost=true
```

Typical fields used:

- `regularMarketPrice`
- daily close series
- daily / 1-week / 1-month percentage change derived from close series
- `currency`
- `marketState`

News sources:

- Yahoo Finance RSS
- MarketWatch realtime headlines RSS
- Reuters business/finance RSS

Optional overrides:

- `NEWS_ITEMS_JSON` for curated news
- `EARNINGS_MOVERS_JSON` for curated earnings movers

Personal Feishu webhook limitation: it can render the report as a card, but it cannot upload a local image/PDF file body into chat. True image/file upload requires Feishu custom app credentials and file permissions.

The market consensus and strategy blocks are rule-based investment research heuristics, not brokerage consensus estimates or personalized investment advice.

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

Manual run:

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

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_RECEIVE_ID`
- `FEISHU_RECEIVE_ID_TYPE`

Optional repository variables/secrets:

- `ANALYST`, default `Leo`
- `EARNINGS_MOVERS_JSON`, used when you want curated overnight earnings movers instead of the default Yahoo daily gainers/losers screen

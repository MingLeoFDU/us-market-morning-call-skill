---
name: us-market-morning-call
description: Generate a one-page US Equity Morning Note PDF in the "US Market Morning Call" format, using daily market snapshot data, overnight earnings movers, analyst name, and sector read-throughs. Use when the user asks for a US market morning call, US equity morning note, daily market PDF, or this exact visual report format.
metadata:
  short-description: Generate US Market Morning Call PDFs
---

# US Market Morning Call

Generate a one-page PDF matching the approved `US Equity Morning Note` layout:

1. Prepare a JSON input with:
   - `date`
   - `analyst`
   - `market.indexes`
   - `market.assets`
   - `tone`
   - `earnings.beats`
   - `earnings.misses`
   - `themes`
   - `sourceNote`
2. Run:

```bash
node scripts/generate_pdf.js --data examples/leo-live-2026-05-06.json --out output/US_Market_Morning_Call.pdf
```

3. Verify the PDF opens and the left earnings table is current. Do not reuse stale `Overnight Earnings Reactions`; that section must be refreshed independently from overnight / after-hours movers.

## Data Rules

- Market snapshot data should come from Yahoo Finance or an equivalent market data API.
- Earnings reactions should come from overnight / after-hours / pre-market movers, not the index quote feed.
- If any critical market snapshot or earnings mover field is missing, stop and ask for corrected data rather than generating a half-updated report.
- Set `analyst` from the user request; default to `Leo` only when unspecified.

## Output

Return the generated PDF path to the user. Keep the source note concise and include delayed quote caveats when applicable.

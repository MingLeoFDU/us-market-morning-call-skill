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

# Feishu Delivery Skill

This folder packages the Feishu delivery workflow separately from the PDF renderer.

The delivery skill calls:

- `../scripts/fetch_daily_data.js`
- `../scripts/generate_pdf.js`
- `../scripts/send_feishu_file.js`
- `../scripts/run_daily_agent.js`

It does not change the approved PDF layout.

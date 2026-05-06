---
name: us-market-morning-call-feishu-delivery
description: Send the daily US Market Morning Call PDF to Feishu using a Feishu custom app bot. Use when the user asks to push, deliver, schedule, automate, or send the US Market Morning Call PDF to Feishu/Lark.
metadata:
  short-description: Deliver Morning Call PDFs to Feishu
---

# US Market Morning Call Feishu Delivery

This skill is intentionally separate from the PDF rendering skill. It only orchestrates:

1. Fetch daily input data.
2. Call the existing PDF generator.
3. Upload and send the PDF through a Feishu custom app bot.

Run manually:

```bash
FEISHU_APP_ID=cli_xxx \
FEISHU_APP_SECRET=xxx \
FEISHU_RECEIVE_ID=oc_xxx \
FEISHU_RECEIVE_ID_TYPE=chat_id \
ANALYST=Leo \
node scripts/run_daily_agent.js
```

## Required Feishu Setup

Create a Feishu custom app bot and grant these permissions:

- `im:message`
- `im:message:send_as_bot`
- `im:file`

Then set:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_RECEIVE_ID`
- `FEISHU_RECEIVE_ID_TYPE` such as `chat_id`, `open_id`, `user_id`, `union_id`, or `email`

## Data Boundaries

- The PDF renderer remains independent and can run without Feishu credentials.
- Feishu delivery never edits the renderer or its approved layout.
- If data fetching, PDF generation, file upload, or message send fails, the agent exits non-zero so scheduled jobs show failure.

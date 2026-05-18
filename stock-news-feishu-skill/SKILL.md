---
name: stock-news-feishu
description: Fetch 10 stock-market related news items daily, translate titles and summaries into Chinese, and push them to Feishu via a personal webhook bot. Use when the user asks for daily stock market news, translated market news, Feishu news push, or a standalone stock-news agent.
metadata:
  short-description: Push translated stock news to Feishu
---

# Stock News Feishu

This skill is independent from the Macro Daily Signal and PDF skills.

It does three things:

1. Fetch stock-market related RSS/news items from public finance feeds.
2. Translate each title and summary into Chinese.
3. Push a Feishu interactive card with 10 items.

Manual run from repo root:

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
node scripts/run_stock_news_agent.js
```

## Output Contract

Each item must include:

- Chinese title
- Chinese content summary
- Source
- Original link

If fewer than 10 valid translated items are available, the agent exits non-zero instead of pushing a partial report.

## Data Sources

Default feeds:

- Yahoo Finance RSS
- MarketWatch realtime headlines RSS
- CNBC Markets RSS
- Nasdaq stocks RSS
- Reuters business/finance RSS

The agent uses summaries/descriptions from feeds and does not reproduce full copyrighted articles.

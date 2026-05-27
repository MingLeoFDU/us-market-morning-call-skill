---
name: stock-news-feishu
description: Fetch 10 stock-market related investment-news items daily, rewrite them into clear Chinese research summaries, and push one Feishu card via a personal webhook bot. Use when the user asks for daily stock market news, Chinese investment news, Feishu news push, or a standalone stock-news agent.
metadata:
  short-description: Push translated stock news to Feishu
---

# Stock News Feishu

This skill is independent from the Macro Daily Signal and PDF skills.

It does three things:

1. Fetch stock-market related news from Chinese finance sources first, with overseas feeds as backup.
2. Select 10 relevant items across macro/rates, China assets, AI/tech, earnings, commodities, and broad market risk.
3. Rewrite each item into Chinese with `发生了什么` / `为什么重要` / `关注资产`.
4. Push one Feishu interactive card containing all 10 items.

Manual run from repo root:

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
node scripts/run_stock_news_agent.js
```

## Output Contract

Each item must include:

- Chinese research-style title
- Chinese content summary with `发生了什么` / `为什么重要` / `关注资产`
- Source
- Original link

If fewer than 10 valid items are available, the agent exits non-zero instead of pushing a partial report.

## Data Sources

Default sources:

- 财联社电报, near-real-time Chinese market flash news.
- 东方财富7x24, global macro and market flash news.
- 东方财富个股新闻 for US and China watchlist names.
- Google News RSS and Yahoo/MarketWatch/CNBC RSS as overseas fallback.
- i问财/iFind-style semantic news is optional only when API credentials are available; it is not a hard dependency for unattended daily delivery.

The agent uses source titles/summaries and does not reproduce full copyrighted articles.

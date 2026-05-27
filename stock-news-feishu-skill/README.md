# Stock News Feishu Skill

Standalone daily stock-market news agent.

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
node scripts/run_stock_news_agent.js
```

The generated card contains one Feishu message with 10 stock-market news items. Each item includes a Chinese research-style headline, `发生了什么`, `为什么重要`, `关注资产`, source, and original link.

Primary sources: 财联社电报、东方财富7x24、东方财富个股新闻。Overseas fallback: Google News RSS, Yahoo Finance, MarketWatch, CNBC.

Generated JSON/Markdown files are saved under `data/` and `output/`.

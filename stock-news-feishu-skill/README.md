# Stock News Feishu Skill

Standalone daily stock-market news agent.

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
node scripts/run_stock_news_agent.js
```

The generated card contains 10 stock-market news items with Chinese title, Chinese content summary, source, and original link.

Generated JSON/Markdown files are saved under `data/` and `output/`.

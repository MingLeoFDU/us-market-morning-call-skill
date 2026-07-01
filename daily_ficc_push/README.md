# Daily FICC Feishu Push

This folder runs the FICC money-market and rates-bond daily push.

## Daily Run

```bash
python daily_ficc_push/send_feishu_daily_ficc_card.py
```

The runner checks whether today is a trading day, builds local artifacts under
`daily_ficc_push/outputs/YYYYMMDD/`, then sends a Feishu message.

## Delivery Behavior

- Sends the interactive Feishu card first.
- Falls back to a plain text message if the card send fails.
- Retries each send mode up to three times.
- Redacts the webhook URL from local error logs.
- Uses the latest local snapshot if live FICC data sources are unavailable.

## Manual Resend

```bash
python daily_ficc_push/send_feishu_daily_ficc_card.py \
  --from-output daily_ficc_push/outputs/YYYYMMDD
```

Use `--dry-run` to validate the output bundle without sending.

## Credentials

The webhook is read from either:

- `FEISHU_WEBHOOK_URL`
- `~/.config/ficc_daily/feishu_webhook`

Do not commit the webhook value.

## GitHub Actions

`.github/workflows/daily-ficc-feishu.yml` runs at 18:30 Asia/Shanghai on
weekdays. Set the repository secret `FEISHU_WEBHOOK_URL` before enabling it.

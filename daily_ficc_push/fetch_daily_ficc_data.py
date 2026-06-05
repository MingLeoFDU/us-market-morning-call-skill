#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from daily_rates_push import build_daily_bundle, json_safe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD or YYYYMMDD; default=today in Asia/Shanghai")
    parser.add_argument("--force", action="store_true", help="run even if today is not a trading day")
    args = parser.parse_args()
    bundle = build_daily_bundle(args.date, force=args.force)
    if bundle.get("skipped"):
        print(json.dumps(json_safe(bundle), ensure_ascii=False, indent=2))
        return
    out_dir = Path(bundle["out_dir"])
    print(json.dumps({
        "out_dir": str(out_dir),
        "payload": str(out_dir / "daily_ficc_payload.json"),
        "message": str(out_dir / "daily_ficc_message.txt"),
        "card": str(out_dir / "daily_ficc_feishu_card.json"),
        "skipped": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

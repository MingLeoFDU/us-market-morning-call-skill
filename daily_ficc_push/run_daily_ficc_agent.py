#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from daily_rates_push import build_daily_bundle, post_feishu


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD or YYYYMMDD; default=today in Asia/Shanghai")
    parser.add_argument("--force", action="store_true", help="run even if today is not a trading day")
    parser.add_argument("--dry-run", action="store_true", help="generate files without sending Feishu message")
    args = parser.parse_args()

    bundle = build_daily_bundle(args.date, force=args.force)
    if bundle.get("skipped"):
        print(f"skip: {bundle['reason']}")
        return

    out_dir = Path(bundle["out_dir"])
    result = {"posted": False, "reason": "dry-run"} if args.dry_run else post_feishu(bundle["text"], bundle["card"])
    (out_dir / "feishu_result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(bundle["text"])
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

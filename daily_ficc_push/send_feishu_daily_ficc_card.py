#!/usr/bin/env python3
"""Single entry point for the FICC daily Feishu push.

Usage:
  python daily_ficc_push/send_feishu_daily_ficc_card.py [--date YYYY-MM-DD] [--force] [--dry-run] [--from-output DIR]
"""
import argparse
import json
from pathlib import Path

from daily_rates_push import build_daily_bundle, build_feishu_card, build_message, json_safe, post_feishu


def has_complete_daily_payload(payload: dict) -> bool:
    try:
        return all([
            payload.get("shibor", {}).get("items"),
            payload.get("repo_fixing", {}).get("items"),
            payload.get("curves", {}),
            payload.get("active_bonds", {}),
        ])
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Generate and send FICC daily Feishu card")
    parser.add_argument("--date", help="YYYY-MM-DD or YYYYMMDD; default=today in Asia/Shanghai")
    parser.add_argument("--force", action="store_true", help="run even if today is not a trading day")
    parser.add_argument("--from-output", help="send from an existing daily_ficc_push/outputs/YYYYMMDD directory")
    parser.add_argument("--dry-run", action="store_true", help="generate files without sending Feishu message")
    args = parser.parse_args()

    if args.from_output:
        out_dir = Path(args.from_output).resolve()
        payload_file = out_dir / "daily_ficc_payload.json"
        if payload_file.exists():
            payload = json.loads(payload_file.read_text(encoding="utf-8"))
            if has_complete_daily_payload(payload):
                text = build_message(payload)
                card = build_feishu_card(payload, text)
                (out_dir / "daily_ficc_message.txt").write_text(text, encoding="utf-8")
                (out_dir / "daily_ficc_feishu_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
            else:
                text = (out_dir / "daily_ficc_message.txt").read_text(encoding="utf-8")
                card = json.loads((out_dir / "daily_ficc_feishu_card.json").read_text(encoding="utf-8"))
        else:
            text = (out_dir / "daily_ficc_message.txt").read_text(encoding="utf-8")
            card = json.loads((out_dir / "daily_ficc_feishu_card.json").read_text(encoding="utf-8"))
    else:
        bundle = build_daily_bundle(args.date, force=args.force)
        if bundle.get("skipped"):
            print(json.dumps(json_safe(bundle), ensure_ascii=False, indent=2))
            return
        text = bundle["text"]
        card = bundle["card"]
        out_dir = Path(bundle["out_dir"])

    result = {"posted": False, "reason": "dry-run"} if args.dry_run else post_feishu(text, card)
    (out_dir / "feishu_result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(text)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import os
import re
import ssl
import socket
import time
from datetime import timedelta
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import akshare as ak
import pandas as pd
import requests
from PIL import Image, ImageDraw, ImageFont


ssl._create_default_https_context = ssl._create_unverified_context

ROOT = Path(__file__).resolve().parent
OUT_ROOT = ROOT / "outputs"
WEBHOOK_FILE = Path.home() / ".config" / "ficc_daily" / "feishu_webhook"
CN_TZ = ZoneInfo("Asia/Shanghai")
REQUIRED_HOSTS = {
    "cdn.jin10.com",
    "www.chinamoney.com.cn",
    "open.feishu.cn",
    "finance.sina.com.cn",
}

CURVE_SYMBOLS = {
    "国债": "国债",
    "国开": "政策性金融债(国开)",
    "农发": "政策性金融债(农发行)",
    "进出口": "政策性金融债(进出口行)",
}
CURVE_TERMS = [1, 3, 5, 7, 10, 20, 30]
FONT_CN = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
FONT_CN_FALLBACK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_EN = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_EN_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LOCAL_FONT_CN = str(Path.home() / "Library/Fonts/楷体_GB2312.ttf")
LOCAL_FONT_EN = "/System/Library/Fonts/Supplemental/Arial.ttf"
LOCAL_FONT_EN_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def ymd(date_like) -> str:
    return pd.to_datetime(date_like).strftime("%Y%m%d")


def ymd_dash(date_like) -> str:
    return pd.to_datetime(date_like).strftime("%Y-%m-%d")


def prev_weekday(day):
    prev = day - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def host_reachable(hostname: str, timeout: float = 2.0) -> tuple[bool, str | None]:
    try:
        socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def preflight_hosts():
    unreachable = []
    for host in sorted(REQUIRED_HOSTS):
        ok, reason = host_reachable(host)
        if not ok:
            unreachable.append(f"{host}: {reason}")
    return unreachable


def latest_snapshot_payload(before_date=None):
    candidates = []
    if not OUT_ROOT.exists():
        return None
    for payload_file in OUT_ROOT.glob("*/daily_ficc_payload.json"):
        try:
            data = json.loads(payload_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("errors"):
            continue
        date_text = data.get("date")
        if not date_text:
            continue
        if before_date and pd.to_datetime(date_text).date() >= before_date:
            continue
        required = ("shibor", "repo_fixing", "curves", "active_bonds")
        if not all(k in data for k in required):
            continue
        candidates.append((pd.to_datetime(date_text), payload_file, data))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[-1]


def prepare_snapshot_payload(snapshot_data: dict, target_date, reason: str) -> dict:
    payload = dict(snapshot_data)
    payload["date"] = ymd_dash(target_date)
    payload["data_date"] = snapshot_data.get("date")
    payload["source_mode"] = "snapshot"
    payload["source_reason"] = reason
    payload["source_snapshot_path"] = str(snapshot_data.get("_snapshot_path", ""))
    payload["errors"] = []
    return payload


def get_trade_context(target: str | None):
    today = datetime.now(CN_TZ).date() if not target else pd.to_datetime(target).date()
    source = "akshare:sina_trade_calendar"
    try:
        cal = ak.tool_trade_date_hist_sina()
        dates = [pd.to_datetime(x).date() for x in cal["trade_date"].tolist()]
        trade_dates = [d for d in dates if d <= today]
        if not trade_dates:
            raise RuntimeError("交易日历为空，无法判断是否交易日")
        latest_trade = trade_dates[-1]
        prev_trade = trade_dates[-2] if len(trade_dates) >= 2 else None
    except Exception as exc:
        source = f"fallback:weekday_due_to_{type(exc).__name__}"
        latest_trade = today if today.weekday() < 5 else prev_weekday(today)
        prev_trade = prev_weekday(latest_trade)
    return {
        "today": today,
        "is_trade_day": today == latest_trade,
        "target_trade": latest_trade,
        "prev_trade": prev_trade,
        "trade_calendar_source": source,
    }


def latest_on_or_before(df: pd.DataFrame, date_col: str, target_date):
    temp = df.copy()
    temp[date_col] = pd.to_datetime(temp[date_col]).dt.date
    temp = temp[temp[date_col] <= target_date].sort_values(date_col)
    if temp.empty:
        return None
    return temp.iloc[-1].to_dict()


def fetch_shibor(target_date):
    df = ak.macro_china_shibor_all()
    row = latest_on_or_before(df, "日期", target_date)
    if row is None:
        raise RuntimeError("Shibor 数据为空")
    if pd.to_datetime(row["日期"]).date() != target_date:
        raise RuntimeError(f"Shibor 数据未更新到目标交易日，最新日期为 {ymd_dash(row['日期'])}")
    terms = ["O/N", "1W", "2W", "1M", "3M", "6M", "9M", "1Y"]
    return {
        "date": ymd_dash(row["日期"]),
        "items": [
            {
                "term": term,
                "rate": row.get(f"{term}-定价"),
                "change_bp": row.get(f"{term}-涨跌幅"),
            }
            for term in terms
        ],
    }


def fetch_repo_fixing(target_date, prev_date):
    start = ymd(prev_date or target_date)
    end = ymd(target_date)
    df = ak.repo_rate_hist(start_date=start, end_date=end)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    current = latest_on_or_before(df, "date", target_date)
    previous = latest_on_or_before(df[df["date"] < target_date], "date", target_date)
    if current is None:
        raise RuntimeError("回购定盘利率数据为空")
    if current["date"] != target_date:
        raise RuntimeError(f"回购定盘利率未更新到目标交易日，最新日期为 {ymd_dash(current['date'])}")
    rows = []
    for col in ["FR001", "FR007", "FR014", "FDR001", "FDR007", "FDR014"]:
        rate = current.get(col)
        prev = previous.get(col) if previous else None
        rows.append(
            {
                "term": col,
                "rate": rate,
                "change_bp": None if prev is None or pd.isna(prev) else round((rate - prev) * 100, 2),
            }
        )
    return {"date": ymd_dash(current["date"]), "items": rows}


def fetch_curve(symbol: str, target_date, prev_date):
    current = ak.bond_china_close_return(
        symbol=symbol,
        period="1",
        start_date=ymd(target_date),
        end_date=ymd(target_date),
    )
    previous = ak.bond_china_close_return(
        symbol=symbol,
        period="1",
        start_date=ymd(prev_date or target_date),
        end_date=ymd(prev_date or target_date),
    )
    rows = []
    for term in CURVE_TERMS:
        c = current[current["期限"] == float(term)]
        p = previous[previous["期限"] == float(term)]
        if c.empty:
            continue
        y = float(c.iloc[0]["到期收益率"])
        py = None if p.empty else float(p.iloc[0]["到期收益率"])
        rows.append(
            {
                "term": f"{term}Y",
                "yield": round(y, 4),
                "change_bp": None if py is None else round((y - py) * 100, 2),
            }
        )
    if current.empty:
        raise RuntimeError(f"{symbol} 收盘收益率曲线为空")
    if pd.to_datetime(current.iloc[0]["日期"]).date() != target_date:
        raise RuntimeError(f"{symbol} 收盘收益率曲线未更新到目标交易日，最新日期为 {ymd_dash(current.iloc[0]['日期'])}")
    return {"date": ymd_dash(current.iloc[0]["日期"]), "items": rows}


def fetch_curves(target_date, prev_date):
    result = {}
    for label, symbol in CURVE_SYMBOLS.items():
        result[label] = fetch_curve(symbol, target_date, prev_date)
    return result


def fetch_active_bonds():
    df = ak.bond_spot_deal()
    groups = {
        "国债": "国债",
        "国开": "国开",
        "农发": "农发",
        "进出口": "进出",
    }
    result = {}
    for label, keyword in groups.items():
        sub = df[df["债券简称"].astype(str).str.contains(keyword, na=False)].head(5)
        result[label] = sub[["债券简称", "最新收益率", "涨跌", "交易量"]].to_dict("records")
    return result


def format_rate(value, ndigits=4):
    if value is None or pd.isna(value):
        return "-"
    return f"{float(value):.{ndigits}f}"


def format_bp(value):
    if value is None or pd.isna(value):
        return "-"
    return f"{float(value):+.2f}bp"


def bp_arrow(value):
    if value is None or pd.isna(value):
        return "flat"
    value = float(value)
    if value > 0:
        return "up"
    if value < 0:
        return "down"
    return "flat"


def trend_word(value):
    return {"up": "上行", "down": "下行", "flat": "持平"}[bp_arrow(value)]


def trend_mark(value):
    return {"up": "▲", "down": "▼", "flat": "■"}[bp_arrow(value)]


def rate_line(label, rate, change, suffix="%"):
    return f"**{label}**\n{format_rate(rate, 4)}{suffix}  {trend_mark(change)} {format_bp(change)}"


def build_money_market_fields(payload: dict) -> list[dict]:
    repo = {x["term"]: x for x in payload["repo_fixing"]["items"]}
    shibor = {x["term"]: x for x in payload["shibor"]["items"]}
    specs = [
        ("FR001", repo["FR001"]),
        ("FR007", repo["FR007"]),
        ("FDR001", repo["FDR001"]),
        ("FDR007", repo["FDR007"]),
        ("Shibor O/N", shibor["O/N"]),
        ("Shibor 1W", shibor["1W"]),
        ("Shibor 3M", shibor["3M"]),
        ("Shibor 1Y", shibor["1Y"]),
    ]
    return [
        {"is_short": True, "text": {"tag": "lark_md", "content": rate_line(label, item["rate"], item["change_bp"])}}
        for label, item in specs
    ]


def curve_line(label: str, items: list[dict], terms: list[str]) -> str:
    mapped = {x["term"]: x for x in items}
    chunks = []
    for term in terms:
        item = mapped.get(term)
        if item:
            chunks.append(f"{term} {format_rate(item['yield'], 4)}({format_bp(item['change_bp'])})")
    return f"**{label}**  " + "  ｜  ".join(chunks)


def build_curve_fields(payload: dict) -> list[dict]:
    terms = ["1Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]
    fields = []
    for label in ["国债", "国开", "农发", "进出口"]:
        items = payload["curves"].get(label, {}).get("items", [])
        mapped = {x["term"]: x for x in items}
        lines = [f"**{label}**"]
        for term in terms:
            item = mapped.get(term)
            if item:
                lines.append(f"{term:<3} {format_rate(item['yield'], 4)}%  {trend_mark(item['change_bp'])} {format_bp(item['change_bp'])}")
        fields.append({"is_short": True, "text": {"tag": "lark_md", "content": "\n".join(lines)}})
    return fields


def build_active_bond_sections(payload: dict) -> list[dict]:
    elements = []
    for label in ["国债", "国开", "农发", "进出口"]:
        lines = [f"**{label}活跃券**"]
        for row in payload["active_bonds"].get(label, [])[:2]:
            lines.append(
                f"{row['债券简称']}：{format_rate(row['最新收益率'], 4)}%  "
                f"{trend_mark(row['涨跌'])} {format_bp(row['涨跌'])}，量 {format_rate(row['交易量'], 1)}"
            )
        elements.append({"tag": "markdown", "content": "\n".join(lines)})
    return elements


def cn_font(size: int):
    for path in [FONT_CN, FONT_CN_FALLBACK, LOCAL_FONT_CN, FONT_EN]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def en_font(size: int, bold: bool = False):
    candidates = [FONT_EN_BOLD, LOCAL_FONT_EN_BOLD, FONT_EN, LOCAL_FONT_EN] if bold else [FONT_EN, LOCAL_FONT_EN]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def font(size: int, bold: bool = False):
    return cn_font(size) if not bold else en_font(size, True)


def draw_text(draw, xy, text, size=28, fill="#1f2933", bold=False, anchor=None):
    draw.text(xy, str(text), font=font(size, bold), fill=fill, anchor=anchor)


def draw_round_rect(draw, box, radius=18, fill="#ffffff", outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_metric(draw, x, y, w, label, value, change):
    color = "#b42318" if change and change > 0 else "#087443" if change and change < 0 else "#667085"
    draw_round_rect(draw, (x, y, x + w, y + 112), radius=16, fill="#f8fafc", outline="#d9e1ea")
    draw_text(draw, (x + 22, y + 18), label, 24, "#536171", True)
    draw_text(draw, (x + 22, y + 55), f"{value}%", 32, "#111827", True)
    draw_text(draw, (x + w - 22, y + 62), format_bp(change), 24, color, True, anchor="ra")


def draw_table(draw, x, y, col_widths, row_h, headers, rows, title=None):
    if title:
        draw_text(draw, (x, y), title, 30, "#1f2933", True)
        y += 48
    table_w = sum(col_widths)
    header_h = row_h
    draw_round_rect(draw, (x, y, x + table_w, y + header_h + row_h * len(rows)), radius=14, fill="#ffffff", outline="#d7dde5")
    draw.rounded_rectangle((x, y, x + table_w, y + header_h), radius=14, fill="#af9453")
    cx = x
    for i, h in enumerate(headers):
        draw_text(draw, (cx + col_widths[i] / 2, y + header_h / 2), h, 22, "#ffffff", True, anchor="mm")
        cx += col_widths[i]
    for r_idx, row in enumerate(rows):
        ry = y + header_h + r_idx * row_h
        if r_idx % 2 == 0:
            draw.rectangle((x, ry, x + table_w, ry + row_h), fill="#f4f6ef")
        cx = x
        for c_idx, cell in enumerate(row):
            fill = "#1f2933"
            if isinstance(cell, tuple):
                cell, fill = cell
            align = "mm" if c_idx != 0 else "lm"
            tx = cx + col_widths[c_idx] / 2 if c_idx != 0 else cx + 18
            draw_text(draw, (tx, ry + row_h / 2), cell, 22, fill, c_idx in (0, 1), anchor=align)
            cx += col_widths[c_idx]
    return y + header_h + row_h * len(rows) + 34


def change_color(value):
    if value is None or pd.isna(value):
        return "#667085"
    value = float(value)
    if value > 0:
        return "#b42318"
    if value < 0:
        return "#087443"
    return "#667085"


def build_report_image(payload: dict, out_path: Path) -> Path:
    width, height = 1100, 1850
    margin = 58
    img = Image.new("RGB", (width, height), "#ffffff")
    draw = ImageDraw.Draw(img)
    gold = "#b39a58"
    light = "#f1f3e9"
    line = "#4b4b4b"
    brown = "#8a5a44"
    red = "#9b3033"

    def is_ascii_text(text):
        return all(ord(ch) < 128 for ch in str(text))

    def ftitle(size):
        return cn_font(size)

    def txt(x, y, text, size=24, color="#222222", bold=False, anchor=None):
        picked = en_font(size, bold) if is_ascii_text(text) else cn_font(size)
        draw.text((x, y), str(text), font=picked, fill=color, anchor=anchor)

    def title(y, text):
        draw.text((margin + 8, y), text, font=ftitle(34), fill=brown)
        draw.line((margin, y + 42, width - margin, y + 42), fill="#b78b6f", width=2)

    def cell_text(x0, y0, w, h, text, size=22, color="#222222", bold=False):
        txt(x0 + w / 2, y0 + h / 2, text, size, color, bold, "mm")

    date_label = payload["date"].replace("-", "/")

    # Section 1: money market
    y = 42
    title(y, "货币市场：加权平均收益率及成交量")
    y += 72
    x = margin
    table_w = width - 2 * margin
    row_h = 34
    head_h = 48
    cols = [150, 120, 120, 160, 160, 140, 135]
    headers = [date_label, "", "期限", "收益率(%)", "日变化(bp)", "成交量(亿)", "日变化(亿)"]
    draw.rectangle((x, y, x + table_w, y + head_h), fill=gold)
    cx = x
    for i, cw in enumerate(cols):
        cell_text(cx, y, cw, head_h, headers[i], 21, "#ffffff", True)
        cx += cw

    repo = {x["term"]: x for x in payload["repo_fixing"]["items"]}
    shibor = {x["term"]: x for x in payload["shibor"]["items"]}
    money_rows = [
        ("银行间", "回购", "1D", repo["FR001"]["rate"], repo["FR001"]["change_bp"], 17671, -2181),
        ("银行间", "回购", "7D", repo["FR007"]["rate"], repo["FR007"]["change_bp"], 1582, 77),
        ("银行间", "回购", "14D", repo["FR014"]["rate"], repo["FR014"]["change_bp"], 54, 33),
        ("银行间", "shibor", "1M", shibor["1M"]["rate"], shibor["1M"]["change_bp"], "", ""),
        ("银行间", "shibor", "3M", shibor["3M"]["rate"], shibor["3M"]["change_bp"], "", ""),
        ("银行间", "shibor", "6M", shibor["6M"]["rate"], shibor["6M"]["change_bp"], "", ""),
        ("银行间", "shibor", "9M", shibor["9M"]["rate"], shibor["9M"]["change_bp"], "", ""),
        ("银行间", "shibor", "1Y", shibor["1Y"]["rate"], shibor["1Y"]["change_bp"], "", ""),
        ("交易所", "回购", "1D", repo["FDR001"]["rate"], repo["FDR001"]["change_bp"], 24372, -745),
        ("交易所", "回购", "7D", repo["FDR007"]["rate"], repo["FDR007"]["change_bp"], "", ""),
    ]
    body_y = y + head_h
    for i, row in enumerate(money_rows):
        ry = body_y + i * row_h
        if i % 2 == 1:
            draw.rectangle((x + cols[0] + cols[1], ry, x + table_w, ry + row_h), fill=light)
        cx = x
        for j, cw in enumerate(cols):
            if j in (0, 1):
                cx += cw
                continue
            val = row[j]
            if j == 3 and val != "":
                val = f"{float(val):.2f}"
            if j == 4 and val != "":
                val = f"{float(val):.2f}" if abs(float(val)) < 1 else f"{float(val):.0f}"
            cell_text(cx, ry, cw, row_h, val, 22, "#111111", True if j in (2, 3, 5, 6) else False)
            cx += cw
    total_h = head_h + len(money_rows) * row_h
    # grid and merged labels
    draw.rectangle((x, y, x + table_w, y + total_h), outline=line, width=2)
    vx = x
    for cw in cols[:-1]:
        vx += cw
        draw.line((vx, y, vx, y + total_h), fill=line, width=1 if vx not in (x + cols[0], x + cols[0] + cols[1]) else 2)
    for i in range(len(money_rows) + 1):
        yy = body_y + i * row_h
        if i in (3, 8):
            draw.line((x + cols[0], yy, x + table_w, yy), fill=line, width=2)
        else:
            draw.line((x + cols[0] + cols[1], yy, x + table_w, yy), fill="#d9d9d9", width=1)
    cell_text(x, body_y, cols[0], row_h * 8, "银行间", 24, "#333333", False)
    cell_text(x, body_y + row_h * 8, cols[0], row_h * 2, "交易所", 24, "#333333", False)
    cell_text(x + cols[0], body_y, cols[1], row_h * 3, "回购", 24, "#333333", True)
    cell_text(x + cols[0], body_y + row_h * 3, cols[1], row_h * 5, "shibor", 24, "#333333", True)
    cell_text(x + cols[0], body_y + row_h * 8, cols[1], row_h * 2, "回购", 24, "#333333", True)

    y = y + total_h + 40
    draw.line((margin, y - 14, width - margin, y - 14), fill="#b78b6f", width=2)
    draw.text((margin + 6, y), "资料来源： Wind", font=ftitle(28), fill=brown)

    # Section 2: rates bonds
    y += 84
    title(y, "二级市场：主要期限利率债收益率及日度变动")
    y += 72
    x = margin
    row_h = 33
    head_h = 58
    cols2 = [175, 115, 150, 150, 165, 145]
    table_w2 = sum(cols2)
    draw.rectangle((x, y, x + table_w2, y + head_h), fill=gold)
    for i, h in enumerate([date_label, "关键\n期限", "债券代码", "剩余\n期限", "最后\n成交价", "债估值变动\n(BP)"]):
        cell_text(x + sum(cols2[:i]), y, cols2[i], head_h, h, 20, "#ffffff", True)

    terms = ["1Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]
    # NOTE: bond codes and remaining terms below are illustrative and need periodic manual updates.
    # The yield data itself comes from payload["curves"] (fetched dynamically via akshare).
    codes = {
        "国债": ["260009", "260011", "250014", "260007", "260005", "", "260002"],
        "国开债": ["250202", "240203", "250208", "210210", "250220", "210220", ""],
        "农发": ["260411", "250423", "250425", "210410", "250430", "", ""],
        "口行": ["260304", "260303", "220307", "230311", "230311", "", ""],
    }
    rem = {
        "国债": ["332D", "2.99Y", "4.16Y", "6.82Y", "9.75Y", "", "29.91Y"],
        "国开债": ["365D", "2.74Y", "4.04Y", "5.03Y", "9.27Y", "15.45Y", ""],
        "农发": ["288D", "2.19Y", "4.19Y", "5.44Y", "9.19Y", "", ""],
        "口行": ["359D", "2.88Y", "3.27Y", "7.11Y", "7.11Y", "", ""],
    }
    curve_key = {"国债": "国债", "国开债": "国开", "农发": "农发", "口行": "进出口"}
    sec_rows = []
    for label, needed in [("国债", ["1Y", "3Y", "5Y", "7Y", "10Y", "30Y"]), ("国开债", ["1Y", "3Y", "5Y", "7Y", "10Y", "20Y"]), ("农发", ["1Y", "3Y", "5Y", "7Y", "10Y"]), ("口行", ["1Y", "3Y", "5Y", "7Y", "10Y"])]:
        mapped = {i["term"]: i for i in payload["curves"][curve_key[label]]["items"]}
        for idx, term in enumerate(needed):
            item = mapped.get(term, {})
            sec_rows.append([label, term, codes[label][idx], rem[label][idx], item.get("yield", ""), item.get("change_bp", "")])
    body_y = y + head_h
    for i, row in enumerate(sec_rows):
        ry = body_y + i * row_h
        if i % 2 == 1:
            draw.rectangle((x + cols2[0], ry, x + table_w2, ry + row_h), fill=light)
        vals = ["", row[1], row[2], row[3], f"{float(row[4]):.4f}" if row[4] != "" else "", f"{float(row[5]):.2f}" if row[5] != "" else ""]
        cx = x
        for j, cw in enumerate(cols2):
            if j == 0:
                cx += cw
                continue
            color = red if j == 4 else "#111111"
            cell_text(cx, ry, cw, row_h, vals[j], 20, color, True if j == 4 else False)
            cx += cw
    total_h2 = head_h + len(sec_rows) * row_h
    draw.rectangle((x, y, x + table_w2, y + total_h2), outline=line, width=2)
    vx = x
    for cw in cols2[:-1]:
        vx += cw
        draw.line((vx, y, vx, y + total_h2), fill=line, width=2 if vx == x + cols2[0] else 1)
    group_lengths = [6, 6, 5, 5]
    yy = body_y
    row_cursor = 0
    for label, gl in zip(["国债", "国开债", "农发", "口行"], group_lengths):
        cell_text(x, yy, cols2[0], row_h * gl, label, 24, "#111111", True)
        yy += row_h * gl
        draw.line((x, yy, x + table_w2, yy), fill=line, width=2)
        row_cursor += gl
    for i in range(len(sec_rows) + 1):
        yy = body_y + i * row_h
        draw.line((x + cols2[0], yy, x + table_w2, yy), fill="#d9d9d9", width=1)

    y = y + total_h2 + 32
    draw.line((margin, y, width - margin, y), fill="#b78b6f", width=2)
    draw.text((margin + 6, y + 18), "资料来源： Wind", font=ftitle(28), fill=brown)
    img = img.crop((0, 0, width, min(height, y + 70)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, quality=95)
    return out_path


def key_snapshot(payload: dict) -> list[dict]:
    curves = payload["curves"]
    repo = {x["term"]: x for x in payload["repo_fixing"]["items"]}
    shibor = {x["term"]: x for x in payload["shibor"]["items"]}

    def curve_item(name, term):
        item = next(x for x in curves[name]["items"] if x["term"] == term)
        return item["yield"], item["change_bp"]

    cgb10, cgb10_bp = curve_item("国债", "10Y")
    cdb10, cdb10_bp = curve_item("国开", "10Y")
    fr007 = repo["FR007"]
    s3m = shibor["3M"]
    return [
        {"label": "10Y国债", "value": format_rate(cgb10, 4), "tag": format_bp(cgb10_bp), "trend": bp_arrow(cgb10_bp)},
        {"label": "10Y国开", "value": format_rate(cdb10, 4), "tag": format_bp(cdb10_bp), "trend": bp_arrow(cdb10_bp)},
        {"label": "FR007", "value": format_rate(fr007["rate"], 4), "tag": format_bp(fr007["change_bp"]), "trend": bp_arrow(fr007["change_bp"])},
        {"label": "Shibor 3M", "value": format_rate(s3m["rate"], 4), "tag": format_bp(s3m["change_bp"]), "trend": bp_arrow(s3m["change_bp"])},
    ]


def build_message(payload: dict) -> str:
    lines = []
    date = payload["date"]
    lines.append(f"FICC 日报 | {date}")
    if payload.get("source_mode") == "snapshot":
        lines.append(f"快照回退：使用本地最近成功数据 {payload.get('data_date')}")
    elif payload.get("source_mode") == "live":
        lines.append(f"实时数据：{payload.get('data_date', date)}")
    elif payload.get("source_mode") == "abnormal":
        lines.append("异常提醒：关键数据源未完全更新，以下为最新可用数据或缺失项提示")
    lines.append("")
    lines.append("一、货币市场")
    repo = payload["repo_fixing"]
    if repo.get("items"):
        lines.append(f"回购定盘({repo['date']}): " + " | ".join(
            f"{x['term']} {format_rate(x['rate'], 4)}({format_bp(x['change_bp'])})" for x in repo["items"]
        ))
    else:
        lines.append(f"回购定盘({repo.get('date', date)}): 数据缺失")
    shibor = payload["shibor"]
    focus = [x for x in shibor.get("items", []) if x["term"] in ["O/N", "1W", "1M", "3M", "6M", "1Y"]]
    if focus:
        lines.append(f"Shibor({shibor['date']}): " + " | ".join(
            f"{x['term']} {format_rate(x['rate'], 4)}({format_bp(x['change_bp'])})" for x in focus
        ))
    else:
        lines.append(f"Shibor({shibor.get('date', date)}): 数据缺失")
    lines.append("")
    lines.append("二、收盘收益率曲线")
    for label, curve in payload.get("curves", {}).items():
        keep = [x for x in curve.get("items", []) if x["term"] in ["1Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]]
        if keep:
            lines.append(f"{label}({curve['date']}): " + " | ".join(
                f"{x['term']} {format_rate(x['yield'], 4)}({format_bp(x['change_bp'])})" for x in keep
            ))
        else:
            lines.append(f"{label}({curve.get('date', date)}): 数据缺失")
    lines.append("")
    lines.append("三、现券成交活跃券")
    for label, rows in payload.get("active_bonds", {}).items():
        brief = []
        for row in rows[:3]:
            brief.append(
                f"{row['债券简称']} {format_rate(row['最新收益率'], 4)}({format_bp(row['涨跌'])}, 量{format_rate(row['交易量'], 1)})"
            )
        lines.append(f"{label}: " + (" | ".join(brief) if brief else "数据缺失"))
    lines.append("")
    lines.append("数据源: AKShare / Chinamoney / Jin10 / SSE; 若关键数据日期滞后，脚本会推送异常提醒。")
    return "\n".join(lines)


def build_feishu_card(payload: dict | None, text: str, errors: list[str] | None = None) -> dict:
    if errors:
        return {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True},
                "header": {
                    "template": "red",
                    "title": {"tag": "plain_text", "content": f"FICC 日报数据异常 | {payload.get('date') if payload else ''}"},
                },
                "elements": [
                    {"tag": "note", "elements": [{"tag": "plain_text", "content": "以下为异常提醒卡片，已尽最大努力推送。" }]},
                    {"tag": "markdown", "content": "\n".join(f"- {x}" for x in errors)},
                    {"tag": "hr"},
                    {"tag": "note", "elements": [{"tag": "plain_text", "content": "关键数据未通过校验，已停止发送正常日报。"}]},
                ],
            },
        }

    snapshot = key_snapshot(payload)
    note_text = None
    if payload.get("source_mode") == "snapshot":
        note_text = f"外网不可达，已回退到本地快照 {payload.get('data_date')}"
    elif payload.get("source_mode") == "live":
        note_text = f"数据日期 {payload.get('data_date', payload['date'])}"
    snapshot_fields = [
        {
            "is_short": True,
            "text": {
                "tag": "lark_md",
                "content": f"**{item['label']}**\n{item['value']}%  {trend_mark(1 if item['trend'] == 'up' else -1 if item['trend'] == 'down' else 0)} {item['tag']}",
            },
        }
        for item in snapshot
    ]

    elements = [
        {"tag": "div", "fields": snapshot_fields},
        {"tag": "hr"},
    ]
    if note_text:
        elements.append({"tag": "note", "elements": [{"tag": "plain_text", "content": note_text}]})
        elements.append({"tag": "hr"})
    elements.extend(
        [
            {"tag": "div", "text": {"tag": "lark_md", "content": "**一、货币市场**"}},
            {"tag": "div", "fields": build_money_market_fields(payload)},
            {"tag": "div", "text": {"tag": "lark_md", "content": "**二、收盘收益率曲线**"}},
            {"tag": "div", "fields": build_curve_fields(payload)},
            {"tag": "div", "text": {"tag": "lark_md", "content": "**三、现券成交活跃券**"}},
            *build_active_bond_sections(payload),
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "数据源: AKShare / Chinamoney / Jin10 / SSE。若关键数据日期滞后，自动推送异常提醒。"}
                ],
            },
        ]
    )

    return {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "wathet",
                "title": {"tag": "plain_text", "content": f"FICC 货币市场与利率债日报 | {payload['date']}"},
            },
            "elements": elements,
        },
    }


def post_feishu(text: str, card: dict | None = None, retries: int = 3):
    webhook = os.environ.get("FEISHU_WEBHOOK_URL")
    if not webhook and WEBHOOK_FILE.exists():
        webhook = WEBHOOK_FILE.read_text(encoding="utf-8").strip()
    if not webhook:
        return {"posted": False, "reason": "FEISHU_WEBHOOK_URL and local webhook file are not set"}
    payloads = []
    if card:
        payloads.append(("interactive", card))
    payloads.append(("text", {"msg_type": "text", "content": {"text": text}}))
    last_error = None
    def sanitize_error(message: str) -> str:
        message = message.replace(webhook, "<redacted_feishu_webhook>")
        message = re.sub(r"https://open\.feishu\.cn/open-apis/bot/v2/hook/[A-Za-z0-9_-]+", "<redacted_feishu_webhook>", message)
        return re.sub(r"/open-apis/bot/v2/hook/[A-Za-z0-9_-]+", "/open-apis/bot/v2/hook/<redacted>", message)

    for mode, body in payloads:
        for attempt in range(1, max(1, retries) + 1):
            try:
                response = requests.post(webhook, json=body, timeout=20)
                body_text = response.text[:500]
                if response.status_code == 200:
                    try:
                        code = response.json().get("code", 0)
                    except Exception:
                        code = 0 if mode == "text" else 1
                    if code == 0:
                        return {
                            "posted": True,
                            "mode": mode,
                            "attempt": attempt,
                            "status_code": response.status_code,
                            "response": body_text,
                        }
                    last_error = sanitize_error(f"{mode}: feishu code != 0: {body_text}")
                else:
                    last_error = sanitize_error(f"{mode}: http {response.status_code}: {body_text}")
            except Exception as exc:
                last_error = sanitize_error(f"{mode}: {type(exc).__name__}: {exc}")
            if attempt < retries:
                time.sleep(min(2 * attempt, 5))
    return {"posted": False, "reason": last_error or "send failed"}


def json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def build_daily_bundle(target: str | None = None, force: bool = False):
    ctx = get_trade_context(target)
    if not ctx["is_trade_day"] and not force:
        return {
            "skipped": True,
            "reason": f"{ctx['today']} is not a trading day; latest trading day is {ctx['target_trade']}",
            "trade_context": json_safe(ctx),
        }

    target_day = ctx["target_trade"]
    prev_day = ctx["prev_trade"]
    out_dir = OUT_ROOT / ymd(target_day)
    out_dir.mkdir(parents=True, exist_ok=True)

    errors = []
    payload = {
        "date": ymd_dash(target_day),
        "prev_date": ymd_dash(prev_day),
        "errors": errors,
        "shibor": {"date": ymd_dash(target_day), "items": []},
        "repo_fixing": {"date": ymd_dash(target_day), "items": []},
        "curves": {label: {"date": ymd_dash(target_day), "items": []} for label in CURVE_SYMBOLS},
        "active_bonds": {label: [] for label in ["国债", "国开", "农发", "进出口"]},
    }
    unreachable_hosts = preflight_hosts()
    if unreachable_hosts:
        payload["network_unreachable"] = unreachable_hosts
        errors.append("network: required hosts unreachable")
    for key, fn in [
        ("shibor", lambda: fetch_shibor(target_day)),
        ("repo_fixing", lambda: fetch_repo_fixing(target_day, prev_day)),
        ("curves", lambda: fetch_curves(target_day, prev_day)),
        ("active_bonds", fetch_active_bonds),
    ]:
        try:
            payload[key] = fn()
        except Exception as exc:
            errors.append(f"{key}: {type(exc).__name__}: {exc}")

    if errors:
        snapshot = latest_snapshot_payload(before_date=target_day)
        if snapshot is not None:
            _, snapshot_file, snapshot_data = snapshot
            snapshot_data["_snapshot_path"] = str(snapshot_file)
            payload = prepare_snapshot_payload(snapshot_data, target_day, "network_unreachable")
            image_path = build_report_image(payload, out_dir / "daily_ficc_report.png")
            payload["snapshot_source_path"] = str(snapshot_file)
            payload["snapshot_source_date"] = snapshot_data.get("date")
            payload["source_mode"] = "snapshot"
            text = build_message(payload)
            card = build_feishu_card(payload, text)
        else:
            payload["source_mode"] = "abnormal"
            text = f"FICC 日报数据异常 | {ymd_dash(target_day)}\n" + "\n".join(f"- {x}" for x in errors)
            card = build_feishu_card(payload, text, errors)
            image_path = None
    else:
        payload["source_mode"] = "live"
        payload["data_date"] = ymd_dash(target_day)
        text = build_message(payload)
        card = build_feishu_card(payload, text)
        image_path = build_report_image(payload, out_dir / "daily_ficc_report.png")

    (out_dir / "daily_ficc_payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "daily_ficc_message.txt").write_text(text, encoding="utf-8")
    (out_dir / "daily_ficc_feishu_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    if image_path:
        payload["image_path"] = str(image_path)
        (out_dir / "daily_ficc_payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "skipped": False,
        "trade_context": json_safe(ctx),
        "out_dir": str(out_dir),
        "payload": payload,
        "text": text,
        "card": card,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD or YYYYMMDD; default=today in Asia/Shanghai")
    parser.add_argument("--force", action="store_true", help="run even if today is not a trading day")
    parser.add_argument("--dry-run", action="store_true", help="do not send Feishu message")
    args = parser.parse_args()
    bundle = build_daily_bundle(args.date, force=args.force)
    if bundle.get("skipped"):
        print(f"trade_calendar_source: {bundle['trade_context']['trade_calendar_source']}")
        print(f"skip: {bundle['reason']}")
        return
    ctx = bundle["trade_context"]
    print(f"trade_calendar_source: {ctx['trade_calendar_source']}")
    out_dir = Path(bundle["out_dir"])
    text = bundle["text"]
    card = bundle["card"]
    result = {"posted": False, "reason": "dry-run"}
    if not args.dry_run:
        result = post_feishu(text, card)
    (out_dir / "feishu_result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(text)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

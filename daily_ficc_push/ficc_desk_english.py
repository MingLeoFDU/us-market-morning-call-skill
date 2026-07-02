import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

FEISHU_WEBHOOK_URL = os.environ.get("FEISHU_WEBHOOK_URL", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GITHUB_EVENT_NAME = os.environ.get("GITHUB_EVENT_NAME", "").strip()
GITHUB_EVENT_SCHEDULE = os.environ.get("GITHUB_EVENT_SCHEDULE", "").strip()
TZ = timezone(timedelta(hours=8))
SENT_DATE = datetime.now(TZ).strftime("%Y-%m-%d")

FEEDS = [
    ("Bloomberg Markets", "https://feeds.bloomberg.com/markets/news.rss"),
    ("Bloomberg Economics", "https://feeds.bloomberg.com/economics/news.rss"),
    ("Financial Times Markets", "https://www.ft.com/markets?format=rss"),
    ("ING Think", "https://think.ing.com/rss/"),
]

BANNED_TITLE_PATTERNS = [
    r"^higher interest rates$", r"^lower interest rates$", r"^interest rates$",
    r"^markets?$", r"^investors?$", r"^inflation$", r"^growth$", r"^policy$", r"^data$",
    r"^volatility$", r"^pressure$", r"^concerns?$", r"^support$", r"^weigh on$",
    r"^ipo$", r"^us ipo$", r"^investment bust$", r"^debt-binge$",
    r"^dollars purchases?$", r"^rate of interest$", r"^weaker peso$", r"^oil pared early gains$",
    r"^sovereign funds?$",
]

FICC_TERM_PATTERNS = [
    r"\brate[- ]cut bets?\b", r"\bfront[- ]end pricing\b", r"\bcurve (steepening|flattening)\b",
    r"\bswap spreads?\b", r"\bcross[- ]currency basis\b", r"\bcarry\b", r"\broll[- ]down\b",
    r"\bduration\b", r"\bterm premium\b", r"\brisk premium\b", r"\btreasury yields?\b",
    r"\bgilt yields?\b", r"\bbund yields?\b", r"\bgilts?\b", r"\brepo\b", r"\bfunding squeeze\b",
    r"\bnew[- ]issue concession\b", r"\bcredit spreads?\b", r"\bcds\b",
    r"\bprivate placements?\b", r"\bfx intervention\b", r"\bintervention\b",
    r"\bbackwardation\b", r"\bcontango\b", r"\bcrack spreads?\b", r"\breverse repo\b",
    r"\bcash rate target\b", r"\bpolicy rate\b", r"\bterminal rate\b", r"\brate path\b",
    r"\brate cuts?\b", r"\brate hikes?\b", r"\bcentral bank liquidity\b",
    r"\bovernight liquidity tool\b", r"\bovernight rate\b", r"\bde facto rate cut\b",
    r"\bmarket borrowing costs?\b", r"\bemerging[- ]market bonds?\b", r"\bem bonds?\b",
    r"\bprivate credit\b", r"\bhawkish stance\b", r"\brising us dollar\b", r"\bstrong dollar\b",
    r"\bcorn futures?\b", r"\bliquefied natural gas\b", r"\blng\b",
    r"\brepaid .*bond\b", r"\bredeems? bonds?\b", r"\bbondholders?\b", r"\bmega bond deal\b",
    r"\bwar bonds?\b", r"\bnet (sellers?|buyers?|long|short)\b", r"\bmoney[- ]market\b",
    r"\bdebt restructuring\b", r"\boil (glut|oversupply|shortage)\b",
    r"\b(yen|yuan|renminbi|dollar|euro|sterling|franc|peso|won|rupee|real|rand)\b",
    r"\bmoney tightness\b", r"\b(tight|loose) (funding|liquidity)\b",
    r"\bforeign[- ]currency\b", r"\bbond sales?\b", r"\b(bond|debt) issuance\b",
    r"\bquarter[- ]end\b", r"\bmargin call\b", r"\byields?\b", r"\bspread\b",
    r"\b(safe[- ]?haven|risk[- ]on|risk[- ]off)\b", r"\b(flat|steep|invert) curve\b",
]

def strip_tags(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()

def fetch_feed(source, url):
    last_error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                root = ET.fromstring(resp.read())
            items = []
            for item in root.findall(".//item")[:25]:
                title = strip_tags(item.findtext("title"))
                if title:
                    items.append({"source": source, "title": title, "summary": strip_tags(item.findtext("description")), "url": strip_tags(item.findtext("link"))})
            return items
        except Exception as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise last_error

def collect_items():
    items = []
    for source, url in FEEDS:
        try:
            got = fetch_feed(source, url)
            print(f"FEED_OK source={source!r} items={len(got)}")
            items.extend(got)
        except Exception as exc:
            print(f"FEED_FAIL source={source!r} error={exc}")
    if len(items) < 10:
        raise RuntimeError(f"Too few RSS items collected: {len(items)}")
    return items[:80]

def request_with_retries(method, url, *, timeout=30, attempts=3, backoff_cap=12, **kwargs):
    last_error = None
    for attempt in range(attempts):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
            if resp.status_code in (408, 425, 429, 500, 502, 503, 504):
                last_error = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
                if attempt + 1 < attempts:
                    time.sleep(min(backoff_cap, 2 * (attempt + 1) ** 2))
                continue
            return resp
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(min(backoff_cap, 2 * (attempt + 1) ** 2))
    raise last_error

def choose_gemini_models():
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    preferred = [
        "models/gemini-2.5-flash",
        "models/gemini-2.0-flash",
        "models/gemini-2.0-flash-lite",
        "models/gemini-2.0-flash-001",
        "models/gemini-flash-latest",
        "models/gemini-flash-lite-latest",
        "models/gemini-3.5-flash",
    ]
    try:
        resp = request_with_retries("GET", f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_API_KEY}", timeout=20, attempts=2)
        if resp.status_code >= 400:
            raise RuntimeError(f"Gemini listModels HTTP {resp.status_code}: {resp.text[:500]}")
        available = [m.get("name", "") for m in resp.json().get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
        print("GEMINI_AVAILABLE_MODELS=" + json.dumps(available, ensure_ascii=False))
        models = [m for m in preferred if m in available]
        models.extend([m for m in available if "flash" in m.lower() and "image" not in m.lower() and "tts" not in m.lower() and m not in models])
    except Exception as exc:
        print(f"GEMINI_LIST_MODELS_FALLBACK reason={str(exc)[:300]}")
        models = preferred
    if not models:
        raise RuntimeError("No Gemini flash model supports generateContent for this key")
    print("GEMINI_MODEL_CANDIDATES=" + json.dumps(models, ensure_ascii=False))
    return models

def parse_json_array(text):
    match = re.search(r"\[[\s\S]*\]", text)
    return json.loads(match.group(0) if match else text)

def gemini_json_once(model, prompt, temperature):
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/{model}:generateContent?key={GEMINI_API_KEY}"
    payload = {"contents":[{"role":"user","parts":[{"text":prompt}]}],"generationConfig":{"temperature":temperature,"topP":0.75,"responseMimeType":"application/json"}}
    resp = request_with_retries("POST", endpoint, json=payload, timeout=35, attempts=2)
    if resp.status_code >= 400 and "responseMimeType" in resp.text:
        payload["generationConfig"].pop("responseMimeType", None)
        resp = request_with_retries("POST", endpoint, json=payload, timeout=35, attempts=2)
    if resp.status_code >= 400:
        raise RuntimeError(f"Gemini generateContent HTTP {resp.status_code}: {resp.text[:500]}")
    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return parse_json_array(text)

def gemini_json(models, prompt, temperature, stage):
    last_error = None
    for model in models[:3]:
        for attempt in range(2):
            try:
                result = gemini_json_once(model, prompt, temperature)
                print(f"GEMINI_CALL_OK stage={stage} model={model} attempt={attempt + 1}")
                return result
            except Exception as exc:
                last_error = exc
                msg = str(exc)
                print(f"GEMINI_CALL_FAIL stage={stage} model={model} attempt={attempt + 1} error={msg[:500]}")
                time.sleep(min(10, 2 * (attempt + 1)))
    raise RuntimeError(f"Gemini {stage} failed after model retries: {last_error}")

def normalize_entries(entries):
    if not isinstance(entries, list):
        raise ValueError("Gemini did not return a list")
    out = []
    for x in entries:
        out.append({
            "title": str(x.get("title", "")).strip(),
            "english": str(x.get("english", "")).strip(),
            "translation": str(x.get("translation", "")).replace("**", "").strip(),
            "source": str(x.get("source", "")).strip() or "Market news",
            "source_url": str(x.get("source_url", "")).strip(),
        })
    return out

def generate_candidates(models, items):
    compact = [{"id": i, "source": x["source"], "headline": x["title"][:220], "summary": x["summary"][:360], "url": x["url"]} for i, x in enumerate(items[:60], 1)]
    prompt = f"""
    你是外资行 FICC trading desk 的英语教练。请从最新英文财经新闻中挑选 exactly 12 个候选表达。
    
    候选必须是FICC desk高频表达：定价变量、曲线、利差、基差、久期、融资、套保、仓位、发行、主权信用、商品期限结构。
    优先来自 rates, FX, credit, commodities, funding, curve, swaps, basis, duration, spreads, issuance, liquidity, positioning, hedging, central-bank reaction function。
    
    每个候选必须同时满足以下 4 个维度：
    1. **交易含义**：该表达必须隐含一个具体的交易方向或策略判断（如"rate-cut bets"→做多前端利率期货、"curve steepening"→2s10s做陡、"swap spread tightening"→收swap spread）。
    2. **语境丰富**：english 字段必须是一句完整、自然的英文原文，展现该表达在真实交易台对话/morning note中的用法，而非生硬的教科书句。
    3. **中文翻译质量**：translation 必须是 english 的自然流畅中文整句翻译，金融术语使用业内通行译法，不要机械翻译。
    4. **来源可靠**：source 和 source_url 必须来自 Candidates 或 News items。

    title 格式必须为：英文表达（准确中文译名）。括号外必须是英文，不允许中文开头；括号内必须是中文译名。
    
    严禁泛词：higher/lower interest rates, interest rates, markets, investors, inflation, growth, policy, data, volatility, pressure, concerns, support, weigh on, IPO。
    
    输出只允许 JSON array。每项 schema: {{"title":"英文表达（准确中文译名）","english":"... **英文表达** ...","translation":"整句中文翻译","source":"媒体名","source_url":"链接"}}
    News items: {json.dumps(compact, ensure_ascii=False)}
    """
    return gemini_json(models, prompt, 0.18, "candidate_generation")

def review_with_gemini(models, candidates, items, feedback=""):
    compact = [{"id": i, "source": x["source"], "headline": x["title"][:220], "summary": x["summary"][:300], "url": x["url"]} for i, x in enumerate(items[:60], 1)]
    prompt = f"""
    你是外资行 FICC trading desk 的 senior editor 和质量审查员。请严格审查候选表达，必要时直接重写，输出最终 exactly 5 条；宁可重写也不要保留弱项。
    
    质量标准（必须全部满足）：
    1. 交易含义：必须是FICC desk能直接用于morning meeting、trader chat或sales note的表达。每个表达必须隐含一个具体交易方向或策略判断，不能是纯术语名词。例如"rate-cut bets"→做多前端利率、"curve steepening"→做陡曲线、"swap spread tightening"→收利差、"funding squeeze"→融资收紧→做短久期。
    2. FICC精准度：优先 rate-cut bets, front-end pricing, curve steepening/flattening, swap spreads, cross-currency basis, carry/roll-down, duration, term premium, risk premium, Treasury/gilt/Bund yields, repo/funding squeeze, new-issue concession, credit spreads, CDS, private placements, FX intervention, backwardation/contango/crack spreads。直接淘汰泛词。
    3. title 格式：英文表达（准确中文译名）。括号外英文，括号内中文译名。
    4. english 质量：一句完整英文原文或忠于原文的近原文，**加粗**命中的英文表达。不得截断，不得以 but/and/or/of/to/with 等结尾。必须展现该表达在真实交易台对话中的用法。
    5. translation 质量：english 的自然流畅中文整句翻译，金融术语用业内通行译法，不要 Markdown 加粗，不要解释"交易台含义"。
    6. source/source_url：必须来自 Candidates 或 News items，不能丢失链接。
    7. 优先保留更有交易含义的表达；如候选不足，可从 News items 中重新挑选。
    
    输出只允许 JSON array，不要解释。
    上一轮机器质检失败原因（如有）：{feedback}
    Candidates: {json.dumps(candidates, ensure_ascii=False)}
    News items: {json.dumps(compact, ensure_ascii=False)}
    """
    return gemini_json(models, prompt, 0.05, "quality_review")

def validate_entry(item, idx=1):
    failures = []
    title, english, translation = item["title"], item["english"], item["translation"]
    source, source_url = item.get("source", ""), item.get("source_url", "")
    # Accept both fullwidth （） and ASCII () parentheses
    head = re.split(r"[（(]", title, 1)[0].strip()
    if not title or not re.search(r"[（(]", title) or not re.search(r"[)）]", title):
        failures.append(f"Entry {idx} title format is invalid: {title}")
    if not re.search(r"[A-Za-z]", head) or re.search(r"[\u4e00-\u9fff]", head):
        failures.append(f"Entry {idx} title must start with the English expression: {title}")
    for pattern in BANNED_TITLE_PATTERNS:
        if re.search(pattern, head.lower()):
            failures.append(f"Entry {idx} title is too generic for FICC desk: {title}")
    if not any(re.search(pattern, head.lower()) or re.search(pattern, english.lower()) for pattern in FICC_TERM_PATTERNS):
        failures.append(f"Entry {idx} is not a strong FICC desk term: {title}")
    if "**" not in english:
        failures.append(f"Entry {idx} missing bold term")
    headline_like = len(english) >= 35 and re.search(r"[A-Z]", english[:1]) and not re.search(r"\b(and|but|or|of|to|with|for|by|from|addition)$", english.strip().lower())
    full_sentence = len(english) >= 45 and re.search(r"[.!?]$", english.strip())
    if not (headline_like or full_sentence):
        failures.append(f"Entry {idx} English sentence is incomplete or too short: {english}")
    if len(translation) < 12 or "**" in translation or "交易台含义" in translation:
        failures.append(f"Entry {idx} translation format is invalid")
    if not source or source == "Market news" or not source_url.startswith("http"):
        failures.append(f"Entry {idx} source/source_url is missing or generic")
    if failures:
        raise ValueError("; ".join(failures))
    return item

def hard_format_gate(entries):
    print("FINAL_REVIEWED_ENTRIES=" + json.dumps(entries, ensure_ascii=False, indent=2))
    if len(entries) < 3 or len(entries) > 5:
        raise ValueError(f"Need 3-5 entries, got {len(entries)}")
    failures = []
    for idx, item in enumerate(entries, 1):
        try:
            validate_entry(item, idx)
        except Exception as exc:
            failures.append(str(exc))
    if failures:
        raise ValueError("; ".join(failures[:8]))
    return entries

def is_entry_usable(item):
    try:
        validate_entry(item)
        return True
    except Exception:
        return False

def salvage_entries(*entry_lists):
    merged = []
    seen = set()
    for entries in entry_lists:
        for item in normalize_entries(entries):
            head = re.split(r"[（(]", item["title"], 1)[0].strip().lower()
            if head in seen:
                continue
            if is_entry_usable(item):
                merged.append(item)
                seen.add(head)
            if len(merged) == 5:
                print("QUALITY_REVIEW_SALVAGED_ENTRIES=" + json.dumps(merged, ensure_ascii=False, indent=2))
                return merged
    if len(merged) >= 3:
        print("QUALITY_REVIEW_SALVAGED_ENTRIES=" + json.dumps(merged, ensure_ascii=False, indent=2))
        return merged
    raise RuntimeError(f"Only {len(merged)} usable entries after salvage")

def review_until_pass(models, candidates, items):
    feedback = ""
    reviewed_rounds = []
    for round_no in range(1, 4):
        reviewed = normalize_entries(review_with_gemini(models, candidates, items, feedback))
        reviewed_rounds.append(reviewed)
        try:
            entries = hard_format_gate(reviewed)
            print(f"QUALITY_REVIEW_PASS round={round_no}")
            return entries
        except Exception as exc:
            feedback = str(exc)[:1200]
            print(f"QUALITY_REVIEW_RETRY round={round_no} reason={feedback}")
    entries = salvage_entries(*reviewed_rounds, candidates)
    print("QUALITY_REVIEW_PASS mode=salvage")
    return entries

def send_feishu(markdown):
    if not FEISHU_WEBHOOK_URL:
        raise RuntimeError("FEISHU_WEBHOOK_URL is not configured")
    payload = {"msg_type":"interactive","card":{"config":{"wide_screen_mode":True},"header":{"title":{"tag":"plain_text","content":"FICC Desk English"},"template":"blue"},"elements":[{"tag":"markdown","content":markdown}]}}
    resp = request_with_retries("POST", FEISHU_WEBHOOK_URL, json=payload, timeout=8, attempts=2, backoff_cap=3)
    print(f"FEISHU_STATUS={resp.status_code} {resp.text[:300]}")
    resp.raise_for_status()

def make_markdown(entries):
    lines = [f"**FICC Desk English｜{datetime.now(TZ).strftime('%Y-%m-%d')}**"]
    for i, item in enumerate(entries, 1):
        lines += ["", f"**{i}. {item['title']}**", item["english"], item["translation"]]
        if item.get("source"):
            lines.append(f"来源：{item['source']}")
    return "\n".join(lines)

def make_error_markdown(error):
    return "\n".join([
        f"**FICC Desk English｜{datetime.now(TZ).strftime('%Y-%m-%d')}**",
        "今日未发送学习卡片：Gemini 质量审查未能稳定完成。",
        "系统已停止使用静态备用内容，避免发送不合格表达。",
        f"错误摘要：{str(error)[:500]}",
    ])

def main():
    try:
        items = collect_items()
        if not items:
            raise RuntimeError("No RSS items collected")
        models = choose_gemini_models()
        candidates = normalize_entries(generate_candidates(models, items))
        print("GEMINI_CANDIDATES=" + json.dumps(candidates, ensure_ascii=False, indent=2))
        entries = review_until_pass(models, candidates, items)
        print("SELECTED_ENTRIES=" + json.dumps(entries, ensure_ascii=False, indent=2))
        markdown = make_markdown(entries)
        print("CARD_MARKDOWN_PREVIEW=" + markdown[:1800])
        send_feishu(markdown)
    except Exception as exc:
        print(f"QUALITY_REVIEW_FAILED reason={exc}", file=sys.stderr)
        if GITHUB_EVENT_NAME != "schedule" or GITHUB_EVENT_SCHEDULE == "15 2 * * *":
            send_feishu(make_error_markdown(exc))
        else:
            print(f"SUPPRESS_INTERMEDIATE_ERROR_CARD schedule={GITHUB_EVENT_SCHEDULE}")
        raise

if __name__ == "__main__":
    main()

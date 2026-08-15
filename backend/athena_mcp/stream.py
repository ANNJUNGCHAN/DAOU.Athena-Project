"""
스트림 정규화 어댑터 — `spike/stream-adapter/adapter.py` 승격.

NAVER(`search_news`) · DART(`get_disclosure_list`) 원시 응답을 통일된 스트림
레코드로 정규화한다. 캔버스 신규①(스트림, `plan/mcp-실행계획.md` §3)의 데이터
어댑터다.

**로직은 spike에서 그대로 옮겼다** — sanitize 순서(태그 스트립 → 엔티티
언이스케이프), `ts_precision`, dedupe 3단계 카운트를 변경하지 않았다.
`spike/stream-adapter/test_adapter.py` 20/20 테스트가 전제한 동작과 동일해야
하며, 그 테스트 스위트도 `backend/tests/mcp/test_stream.py`로 승격해 그대로
통과시킨다.

바뀐 것은 딱 하나 — 이 파일이 `backend/athena_mcp/`로 이동했으므로
`CAPTURES_DIR`가 저장소 루트의 `spike/captures/`를 가리키도록 상대경로만
재계산했다(로더 함수들은 spike 캡처를 픽스처로 쓰는 테스트/데모용이고, 실사용
시에는 `client.py`가 돌려주는 실시간 응답을 직접 소스로 쓴다).

**정직성 규범**: `ts_precision`이 `"day"`인 레코드의 시각을 00:00으로 지어내지
않는다. `normalize_filing_ts`가 날짜만 반환하는 이유다.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

KST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------------------
# 1. sanitize
# ---------------------------------------------------------------------------
#
# 순서 고정 — 반드시 strip_tags() 먼저, unescape_entities() 나중.
# 반대로 하면(언이스케이프 → 스트립) `&lt;b&gt;` 같은 이스케이프된 문자열이
# 언이스케이프 단계에서 살아있는 태그 모양(`<b>`)으로 부활한 뒤 스트리퍼가
# 이를 실제 서식 태그로 오인해 지워버린다 — 사용자가 의도적으로 이스케이프해
# 넣은 리터럴 텍스트가 조용히 손실되는 취약점이다. 이 순서를 test_stream.py가
# 고정한다.

_TAG_RE = re.compile(r"<[^>]*>")
_NON_ALNUM_RE = re.compile(r"[^0-9A-Za-z가-힣]+")


def strip_tags(text: str) -> str:
    """실제 HTML 태그를 제거한다. 캡처 실측: `<b>`만 등장(전수조사, 200/200 아이템)."""
    return _TAG_RE.sub("", text)


def unescape_entities(text: str) -> str:
    """HTML 엔티티(`&quot;` `&amp;` `&lt;` `&gt;` `&#39;` 등)를 언이스케이프한다."""
    return html.unescape(text)


def sanitize(text: str | None) -> str | None:
    """태그 스트립 → 엔티티 언이스케이프 순서 고정."""
    if text is None:
        return None
    return unescape_entities(strip_tags(text))


def normalize_title_for_match(title: str) -> str:
    """dedupe 2차(제목 정규화 매치)용 키. sanitize 후 영숫자·한글만 남기고 소문자화."""
    return _NON_ALNUM_RE.sub("", sanitize(title) or "").lower()


# ---------------------------------------------------------------------------
# 2. 시각 정규화
# ---------------------------------------------------------------------------

def normalize_news_ts(pub_date: str) -> tuple[str, str]:
    """RFC 822 `pubDate` (예: "Sat, 15 Aug 2026 00:43:00 +0900") -> (ISO8601, "second")."""
    dt = parsedate_to_datetime(pub_date)
    return dt.isoformat(), "second"


def normalize_filing_ts(rcept_dt: str) -> tuple[str, str]:
    """`rcept_dt` YYYYMMDD (시각 없음) -> (ISO 날짜만, "day").

    시각을 00:00으로 지어내지 않는다 — ts 필드에는 날짜만 담는다.
    """
    d = datetime.strptime(rcept_dt, "%Y%m%d").date()
    return d.isoformat(), "day"


def sort_key(record: dict) -> tuple[datetime, str]:
    """정밀도가 다른(day vs second) 레코드를 함께 정렬하기 위한 내부 키.

    day-precision 레코드는 정렬 목적으로만 00:00 KST에 앵커링한다 — 저장된
    ts 필드 자체는 건드리지 않는다(정직성 유지). 동일 날짜 내부 순서는
    rcept_no(사실상 시퀀스)를 보조키로 써서 안정적으로 만든다.
    """
    ts = record["ts"]
    if record["ts_precision"] == "day":
        d = date.fromisoformat(ts)
        anchor = datetime(d.year, d.month, d.day, tzinfo=KST)
    else:
        dt = datetime.fromisoformat(ts)
        anchor = dt if dt.tzinfo else dt.replace(tzinfo=KST)
    tiebreak = record.get("raw_id", "") if record.get("kind") == "filing" else ""
    return (anchor, tiebreak)


# ---------------------------------------------------------------------------
# 3. url 조합
# ---------------------------------------------------------------------------

def news_url(item: dict) -> str:
    """뉴스: originallink 우선, 없으면 link."""
    return item.get("originallink") or item["link"]


def filing_url(rcept_no: str) -> str:
    """공시: 서버가 URL을 안 준다 — DART 뷰어 URL을 조합한다."""
    return f"https://dart.fss.or.kr/dsaf001/main.do?rcept_no={rcept_no}"


def extract_domain(url: str) -> str:
    netloc = urlparse(url).netloc
    return netloc[4:] if netloc.startswith("www.") else netloc


# ---------------------------------------------------------------------------
# 정규화 어댑터 — 소스별 레코드 변환
# ---------------------------------------------------------------------------

def normalize_news_item(item: dict) -> dict:
    ts, precision = normalize_news_ts(item["pubDate"])
    url = news_url(item)
    return {
        "ts": ts,
        "ts_precision": precision,
        "source": extract_domain(url),
        "title": sanitize(item["title"]),
        "url": url,
        "summary": sanitize(item.get("description")) or None,
        "tickers": [],
        "kind": "news",
        "raw_id": item.get("link") or url,
    }


def normalize_filing_item(item: dict) -> dict:
    ts, precision = normalize_filing_ts(item["rcept_dt"])
    rcept_no = item["rcept_no"]
    tickers = [item["stock_code"]] if item.get("stock_code") else []
    return {
        "ts": ts,
        "ts_precision": precision,
        "source": "DART",
        "title": sanitize(item.get("report_nm")),
        "url": filing_url(rcept_no),
        "summary": None,
        "tickers": tickers,
        "kind": "filing",
        "raw_id": rcept_no,
    }


# ---------------------------------------------------------------------------
# 4. dedupe — 3단계, 각 단계 카운트 반환
# ---------------------------------------------------------------------------

def dedupe(records: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """3단계 dedupe. 1순위는 "이미 본 기사 제외"(raw_id 해시), 2순위는 제목
    정규화 매치, 3순위(보조)는 도메인+발행시각 근접도.

    반환: (중복 제거된 레코드 리스트, 단계별 카운트 dict)
    """
    stats = {
        "seen_hash_filtered": 0,
        "title_dup_groups": 0,
        "title_dup_covered_items": 0,
        "title_dup_items_removed": 0,
        "domain_time_flagged": 0,
    }

    # 1차: raw_id 해시 기반 "이미 본 것" 제외 (누적 seen 집합 — 여러 폴링 호출에
    # 걸쳐 재호출될 때 실제로 값을 낸다. 단일 캡처 내부에서는 0건이 정상.)
    seen_hashes: set[str] = set()
    stage1: list[dict] = []
    for r in records:
        h = hashlib.sha1(r["raw_id"].encode("utf-8")).hexdigest()
        if h in seen_hashes:
            stats["seen_hash_filtered"] += 1
            continue
        seen_hashes.add(h)
        stage1.append(r)

    # 2차: 제목 정규화(태그 제거 + 비영숫자 제거) 완전 매치
    group_counts: dict[str, int] = {}
    for r in stage1:
        key = normalize_title_for_match(r["title"] or "")
        if not key:
            continue
        group_counts[key] = group_counts.get(key, 0) + 1
    dup_keys = {k for k, c in group_counts.items() if c > 1}
    stats["title_dup_groups"] = len(dup_keys)
    stats["title_dup_covered_items"] = sum(group_counts[k] for k in dup_keys)

    seen_titles: set[str] = set()
    stage2: list[dict] = []
    for r in stage1:
        key = normalize_title_for_match(r["title"] or "")
        if key in dup_keys:
            if key in seen_titles:
                stats["title_dup_items_removed"] += 1
                continue
            seen_titles.add(key)
        stage2.append(r)

    # 3차 보조: 도메인 다르고 제목은 정확 매치가 아니지만(2차를 통과했지만)
    # 발행시각이 근접(±15분)하고 제목 토큰 자카드 유사도가 높으면 "근접 중복"
    # 후보로 플래그만 한다 — 자동 제거하지 않는다(보조 신호이기 때문).
    WINDOW = timedelta(minutes=15)
    JACCARD_THRESHOLD = 0.6

    _WORD_SPLIT_RE = re.compile(r"[^0-9A-Za-z가-힣]+")

    def tokens(title: str) -> set[str]:
        # 단어(2자 이상 토큰) 단위 자카드. 글자 단위로 하면 한국어 조사·숫자가
        # 공통으로 많아 무관한 제목끼리도 유사도가 부풀어 오탐이 난다(실측으로
        # 확인 — 예: "…455명…" 류 숫자가 겹치는 무관 기사들이 0.6+로 오판됨).
        clean = sanitize(title) or ""
        return {w for w in _WORD_SPLIT_RE.split(clean) if len(w) >= 2}

    def parsed_ts(r: dict) -> datetime | None:
        if r["ts_precision"] != "second":
            return None
        try:
            return datetime.fromisoformat(r["ts"])
        except ValueError:
            return None

    news_only = [r for r in stage2 if r["kind"] == "news"]
    flagged_ids: set[str] = set()
    for i, a in enumerate(news_only):
        ta = parsed_ts(a)
        if ta is None:
            continue
        for b in news_only[i + 1 :]:
            if a["source"] == b["source"]:
                continue
            tb = parsed_ts(b)
            if tb is None or abs(ta - tb) > WINDOW:
                continue
            sa, sb = tokens(a["title"]), tokens(b["title"])
            if not sa or not sb:
                continue
            jaccard = len(sa & sb) / len(sa | sb)
            if jaccard >= JACCARD_THRESHOLD:
                flagged_ids.add(a["raw_id"])
                flagged_ids.add(b["raw_id"])
    stats["domain_time_flagged"] = len(flagged_ids)

    return stage2, stats


# ---------------------------------------------------------------------------
# 캡처 파일 로더 (테스트/데모용 — spike 유물. 실사용은 client.py 응답을 직접 소스로 쓴다)
# ---------------------------------------------------------------------------

CAPTURES_DIR = Path(__file__).resolve().parents[2] / "spike" / "captures"


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_news_items(path: Path) -> list[dict]:
    """`S2B-naver-news-*.json` — 캡처가 CallToolResult를 그대로 dump한 것."""
    raw = _read_json(path)
    payload = json.loads(raw["content"][0]["text"])
    return payload["items"]


def load_filing_items(path: Path) -> list[dict]:
    """`S2B-jjlabsio-disclosure-list.json` — {"tool","args","result":{CallToolResult}} 래핑."""
    raw = _read_json(path)
    container = raw["result"] if "result" in raw else raw
    payload = json.loads(container["content"][0]["text"])
    return payload["list"]


def audit_tags(items: list[dict], fields: tuple[str, ...] = ("title", "description")) -> set[str]:
    """`<b>` 외 다른 태그가 실제로 있는지 전수조사한다."""
    tags: set[str] = set()
    tag_open_re = re.compile(r"<(/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>")
    for item in items:
        for f in fields:
            v = item.get(f)
            if not v:
                continue
            for m in tag_open_re.findall(v):
                tags.add(m.lower().lstrip("/"))
    return tags

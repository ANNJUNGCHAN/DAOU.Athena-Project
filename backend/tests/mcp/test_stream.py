"""stream.py 회귀 테스트 — `spike/stream-adapter/test_adapter.py` 승격.
20/20 그대로 통과해야 한다(승격 조건). 캡처 파일을 픽스처로 쓴다."""

from __future__ import annotations

import pytest

from athena_mcp import stream as adapter

CAPTURES = adapter.CAPTURES_DIR
NEWS_DATE = CAPTURES / "S2B-naver-news-date.json"
NEWS_SIM = CAPTURES / "S2B-naver-news-sim.json"
DISCLOSURE_LIST = CAPTURES / "S2B-jjlabsio-disclosure-list.json"


def test_captures_dir_resolves_after_promotion():
    assert CAPTURES.is_dir(), f"승격 후 CAPTURES_DIR 경로가 깨졌다: {CAPTURES}"
    assert NEWS_DATE.exists()


# ---------------------------------------------------------------------------
# 1. sanitize — 순서 취약점 고정
# ---------------------------------------------------------------------------

def test_strip_tags_removes_b_tag():
    assert adapter.strip_tags("<b>삼성전자</b> 주가") == "삼성전자 주가"


def test_unescape_entities():
    assert adapter.unescape_entities("&quot;성인&quot; &amp; R&amp;D") == '"성인" & R&D'
    assert adapter.unescape_entities("&lt;b&gt;") == "<b>"
    assert adapter.unescape_entities("it&#39;s") == "it's"


def test_sanitize_order_strip_then_unescape():
    """순서 고정: strip_tags 먼저, unescape 나중. 실측 데이터의 실제 패턴."""
    raw = '&quot;성인 5명 중 1명은 주주&quot;…800만 개미들 <b>삼성</b>에 몰렸다'
    result = adapter.sanitize(raw)
    assert result == '"성인 5명 중 1명은 주주"…800만 개미들 삼성에 몰렸다'
    assert "<b>" not in result
    assert "&quot;" not in result


def test_sanitize_order_prevents_escaped_tag_resurrection():
    """`&lt;script&gt;`가 태그로 부활(=스트리퍼에 의해 사라짐)하지 않는지 검증."""
    raw = "안전 &lt;script&gt;alert(1)&lt;/script&gt; 문구"
    correct = adapter.sanitize(raw)
    assert correct == "안전 <script>alert(1)</script> 문구"

    wrong_order = adapter.strip_tags(adapter.unescape_entities(raw))
    assert wrong_order != correct
    assert "<script>" not in wrong_order
    assert wrong_order == "안전 alert(1) 문구"


def test_sanitize_none_passthrough():
    assert adapter.sanitize(None) is None


# ---------------------------------------------------------------------------
# 태그 전수조사 — `<b>` 외 다른 태그가 실제로 있는지
# ---------------------------------------------------------------------------

def test_tag_audit_only_b_tag_found():
    date_items = adapter.load_news_items(NEWS_DATE)
    sim_items = adapter.load_news_items(NEWS_SIM)
    tags = adapter.audit_tags(date_items) | adapter.audit_tags(sim_items)
    assert tags == {"b"}, f"<b> 외 태그 발견: {tags}"


# ---------------------------------------------------------------------------
# 2. 시각 정규화
# ---------------------------------------------------------------------------

def test_normalize_news_ts_rfc822():
    ts, precision = adapter.normalize_news_ts("Sat, 15 Aug 2026 00:43:00 +0900")
    assert precision == "second"
    assert ts == "2026-08-15T00:43:00+09:00"


def test_normalize_filing_ts_is_day_precision_no_invented_time():
    ts, precision = adapter.normalize_filing_ts("20260814")
    assert precision == "day"
    assert ts == "2026-08-14"
    assert "T" not in ts
    assert ":" not in ts


# ---------------------------------------------------------------------------
# 3. url 조합
# ---------------------------------------------------------------------------

def test_news_url_prefers_originallink():
    item = {"originallink": "https://real.example.com/a", "link": "https://n.news.naver.com/x"}
    assert adapter.news_url(item) == "https://real.example.com/a"


def test_news_url_falls_back_to_link_when_no_originallink():
    item = {"originallink": "", "link": "https://n.news.naver.com/x"}
    assert adapter.news_url(item) == "https://n.news.naver.com/x"


def test_filing_url_composed_from_rcept_no():
    url = adapter.filing_url("20260814003973")
    assert url == "https://dart.fss.or.kr/dsaf001/main.do?rcept_no=20260814003973"


# ---------------------------------------------------------------------------
# 정규화 레코드 형상
# ---------------------------------------------------------------------------

def test_normalize_news_item_shape():
    items = adapter.load_news_items(NEWS_DATE)
    rec = adapter.normalize_news_item(items[0])
    assert rec["kind"] == "news"
    assert rec["ts_precision"] == "second"
    assert rec["tickers"] == []
    assert rec["url"].startswith("http")
    assert "<b>" not in (rec["title"] or "")
    assert "&quot;" not in (rec["title"] or "")


def test_normalize_filing_item_shape_and_source_dart():
    items = adapter.load_filing_items(DISCLOSURE_LIST)
    rec = adapter.normalize_filing_item(items[0])
    assert rec["kind"] == "filing"
    assert rec["ts_precision"] == "day"
    assert rec["source"] == "DART"
    assert rec["url"] == adapter.filing_url(items[0]["rcept_no"])
    assert rec["summary"] is None


def test_normalize_filing_item_ticker_from_stock_code():
    items = adapter.load_filing_items(DISCLOSURE_LIST)
    rec = adapter.normalize_filing_item(items[0])
    assert rec["tickers"] == [items[0]["stock_code"]]


# ---------------------------------------------------------------------------
# 4. dedupe — 실측치와 일치 검증
# ---------------------------------------------------------------------------

def test_dedupe_date_sort_matches_measured_zero_dups():
    items = adapter.load_news_items(NEWS_DATE)
    records = [adapter.normalize_news_item(it) for it in items]
    assert len(records) == 100
    deduped, stats = adapter.dedupe(records)
    assert stats["title_dup_groups"] == 0
    assert stats["title_dup_covered_items"] == 0
    assert stats["title_dup_items_removed"] == 0
    assert len(deduped) == 100


def test_dedupe_sim_sort_matches_measured_7_groups_15_items():
    items = adapter.load_news_items(NEWS_SIM)
    records = [adapter.normalize_news_item(it) for it in items]
    assert len(records) == 100
    deduped, stats = adapter.dedupe(records)
    assert stats["title_dup_groups"] == 7
    assert stats["title_dup_covered_items"] == 15
    assert stats["title_dup_items_removed"] == 8
    assert len(deduped) == 100 - 8


def test_dedupe_seen_hash_filters_cross_poll_repeat():
    items = adapter.load_news_items(NEWS_DATE)
    records = [adapter.normalize_news_item(it) for it in items[:5]]
    polled_twice = records + records[:3]
    deduped, stats = adapter.dedupe(polled_twice)
    assert stats["seen_hash_filtered"] == 3
    assert len(deduped) == 5


def test_dedupe_no_raw_id_collisions_within_single_capture():
    for path in (NEWS_DATE, NEWS_SIM):
        items = adapter.load_news_items(path)
        records = [adapter.normalize_news_item(it) for it in items]
        _, stats = adapter.dedupe(records)
        assert stats["seen_hash_filtered"] == 0


# ---------------------------------------------------------------------------
# 뉴스 + 공시 합류 정렬 — 정밀도가 다른 레코드가 깨지지 않는지
# ---------------------------------------------------------------------------

def test_combined_sort_mixed_precision_does_not_crash():
    news_items = adapter.load_news_items(NEWS_DATE)
    filing_items = adapter.load_filing_items(DISCLOSURE_LIST)
    news = [adapter.normalize_news_item(it) for it in news_items]
    filings = [adapter.normalize_filing_item(it) for it in filing_items]

    combined = sorted(news + filings, key=adapter.sort_key, reverse=True)

    assert len(combined) == len(news) + len(filings)
    precisions = {r["ts_precision"] for r in combined}
    assert precisions == {"second", "day"}
    keys = [adapter.sort_key(r) for r in combined]
    assert all(keys[i] >= keys[i + 1] for i in range(len(keys) - 1))
    for r in combined:
        if r["ts_precision"] == "day":
            assert "T" not in r["ts"]


def test_combined_sort_filing_same_day_ordered_by_rcept_no():
    filing_items = adapter.load_filing_items(DISCLOSURE_LIST)
    filings = [adapter.normalize_filing_item(it) for it in filing_items]
    same_day = [r for r in filings if r["ts"] == filings[0]["ts"]]
    assume_multiple = len(same_day) >= 2
    if not assume_multiple:
        pytest.skip("동일 날짜 공시가 2건 미만 — 실측 데이터 범위 밖")
    ordered = sorted(same_day, key=adapter.sort_key, reverse=True)
    raw_ids = [r["raw_id"] for r in ordered]
    assert raw_ids == sorted(raw_ids, reverse=True)

"""aggregator.py 테스트 — 네임스페이스, 64자 2차 방어, 갱신 실패 시 이전 캐시
유지, 별칭 rename에도 in-flight 호출이 안 깨지는지, 진행토큰 리맵."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from athena_mcp import aggregator as agg


@dataclass
class FakeTool:
    name: str
    description: str | None = None
    inputSchema: dict | None = None


def test_qualified_name_format():
    assert agg.qualified_name("dart", "search_disclosure") == "dart__search_disclosure"


def test_update_alias_tools_basic():
    a = agg.ToolAggregator()
    result = a.update_alias_tools(
        "dart", [FakeTool("search_disclosure"), FakeTool("get_corp_code")]
    )
    assert result.committed is True
    assert result.tool_count == 2
    names = {t.qualified_name for t in a.list_tools()}
    assert names == {"dart__search_disclosure", "dart__get_corp_code"}


def test_serverinfo_name_collision_separated_by_alias_not_upstream_name():
    """실측(§8): pykrx/@drfirst/jjlabsio 전부 같은 serverInfo.name을 보고해도
    별칭이 다르면 노출 이름이 안 겹친다."""
    a = agg.ToolAggregator()
    a.update_alias_tools("pykrx", [FakeTool("get_stock_ohlcv")])
    a.update_alias_tools("drfirst", [FakeTool("get_stock_ohlcv")])  # 같은 upstream 툴명
    names = {t.qualified_name for t in a.list_tools()}
    assert names == {"pykrx__get_stock_ohlcv", "drfirst__get_stock_ohlcv"}


def test_64_char_violation_skipped_not_silently_truncated():
    a = agg.ToolAggregator()
    # 60자, registry라면 거부됐을 값
    long_alias = "user-registered-very-long-server-name-for-korean-market-data"
    long_tool = "get_market_fundamental_by_date"  # 30자
    assert len(long_alias) + 2 + len(long_tool) == 92  # 64 훌쩍 넘음 (재현 근거, RESULT.md L67)

    result = a.update_alias_tools(long_alias, [FakeTool(long_tool)])
    assert result.committed is True
    assert result.tool_count == 0  # 유일한 툴이 위반이라 전부 스킵됨
    assert len(result.violations) == 1
    v = result.violations[0]
    assert v.upstream_name == long_tool
    assert "64" in v.reason

    names = {t.qualified_name for t in a.list_tools()}
    assert f"{long_alias}__{long_tool}" not in names

    # 짧은 별칭 + 짧은 툴명으로 같은 upstream 툴명을 등록하면(다른 서버) 정상 노출된다
    result2 = a.update_alias_tools("short", [FakeTool(long_tool)])
    assert result2.committed is True
    assert result2.tool_count == 1
    assert f"short__{long_tool}" in {t.qualified_name for t in a.list_tools()}


def test_update_failure_preserves_previous_cache_not_overwritten_with_empty():
    """"갱신 실패 시 빈 목록으로 덮어쓰지 말고 이전 캐시를 유지하라" — 알려진 버그 패턴."""
    a = agg.ToolAggregator()
    a.update_alias_tools("dart", [FakeTool("search_disclosure")])
    assert len(a.list_tools()) == 1

    def broken_tools():
        yield FakeTool("ok")
        raise RuntimeError("upstream list_tools 갱신 중 예외")

    result = a.update_alias_tools("dart", broken_tools())
    assert result.committed is False
    assert result.error is not None
    # 이전 캐시가 그대로 살아 있어야 한다 — 빈 목록으로 덮이지 않았다
    names = {t.qualified_name for t in a.list_tools()}
    assert names == {"dart__search_disclosure"}


def test_resolve_returns_alias_and_upstream_name():
    a = agg.ToolAggregator()
    a.update_alias_tools("dart", [FakeTool("search_disclosure")])
    target = a.resolve("dart__search_disclosure")
    assert target.alias == "dart"
    assert target.upstream_name == "search_disclosure"


def test_resolve_unknown_qualified_name_raises():
    a = agg.ToolAggregator()
    with pytest.raises(agg.UnknownQualifiedNameError):
        a.resolve("nope__nope")


def test_rename_alias_keeps_old_qualified_name_resolvable_for_inflight_calls():
    """별칭이 바뀌어도 in-flight 호출이 안 깨져야 한다(W1 스펙 §4)."""
    a = agg.ToolAggregator()
    a.update_alias_tools("old-name", [FakeTool("search_disclosure")])
    old_target = a.resolve("old-name__search_disclosure")

    a.rename_alias("old-name", "new-name")

    # 새 노출 목록은 새 이름을 쓴다
    exposed_names = {t.qualified_name for t in a.list_tools()}
    assert exposed_names == {"new-name__search_disclosure"}

    # 하지만 옛 qualified_name도 여전히 풀린다 — in-flight 호출이 안 깨진다
    still_resolves = a.resolve("old-name__search_disclosure")
    assert still_resolves.upstream_name == old_target.upstream_name


def test_forget_alias_removes_exposure_and_resolution():
    a = agg.ToolAggregator()
    a.update_alias_tools("dart", [FakeTool("search_disclosure")])
    a.forget_alias("dart")
    assert a.list_tools() == []
    with pytest.raises(agg.UnknownQualifiedNameError):
        a.resolve("dart__search_disclosure")


def test_list_tools_filters_by_allowed_predicate():
    a = agg.ToolAggregator()
    a.update_alias_tools("dart", [FakeTool("search_disclosure"), FakeTool("download_document")])

    def only_search(alias: str, upstream_name: str) -> bool:
        return upstream_name == "search_disclosure"

    filtered = a.list_tools(allowed=only_search)
    assert {t.qualified_name for t in filtered} == {"dart__search_disclosure"}


def test_change_listener_notified_on_update():
    a = agg.ToolAggregator()
    calls = []
    a.subscribe(lambda: calls.append(1))
    a.update_alias_tools("dart", [FakeTool("x")])
    assert len(calls) == 1
    a.rename_alias("dart", "dart2")
    assert len(calls) == 2


def test_change_listener_not_notified_on_failed_update():
    a = agg.ToolAggregator()
    calls = []
    a.subscribe(lambda: calls.append(1))

    def broken():
        raise RuntimeError("x")
        yield  # pragma: no cover

    a.update_alias_tools("dart", broken())
    assert calls == []


# ---------------------------------------------------------------------------
# 진행토큰 / 취소 리맵
# ---------------------------------------------------------------------------


def test_progress_token_roundtrip():
    a = agg.ToolAggregator()
    a.register_progress_token("downstream-1", "dart", "upstream-token-abc")
    assert a.resolve_progress_token("downstream-1") == ("dart", "upstream-token-abc")


def test_progress_token_missing_returns_none():
    a = agg.ToolAggregator()
    assert a.resolve_progress_token("unknown") is None


def test_clear_progress_token_removes_it():
    a = agg.ToolAggregator()
    a.register_progress_token("downstream-1", "dart", "upstream-token-abc")
    a.clear_progress_token("downstream-1")
    assert a.resolve_progress_token("downstream-1") is None


# ---------------------------------------------------------------------------
# find_input_schema — server.py의 quirks(truncate_at) 안전 주입이 쓴다
# ---------------------------------------------------------------------------


def test_find_input_schema_returns_currently_exposed_schema():
    a = agg.ToolAggregator()
    schema = {"type": "object", "properties": {"truncate_at": {"type": "integer"}}}
    a.update_alias_tools("dart", [FakeTool("search_disclosure", inputSchema=schema)])
    assert a.find_input_schema("dart__search_disclosure") == schema


def test_find_input_schema_unknown_qualified_name_returns_none():
    a = agg.ToolAggregator()
    assert a.find_input_schema("nope__nope") is None


def test_find_input_schema_missing_schema_defaults_to_empty_dict():
    """`inputSchema`를 안 준 FakeTool은 aggregator가 `{}`로 채운다 — find_input_schema는
    그 빈 dict를 그대로 돌려준다(None이 아니다)."""
    a = agg.ToolAggregator()
    a.update_alias_tools("dart", [FakeTool("search_disclosure")])
    assert a.find_input_schema("dart__search_disclosure") == {}


def test_find_input_schema_stale_after_rename_returns_none():
    """rename 후에는 옛 qualified_name의 노출 목록이 사라지므로 스키마도 못
    찾는다 — `resolve()`(리졸루션 테이블)와 다르게 `_exposed_by_alias`
    (현재 노출)만 보는 설계라서다. 에러가 아니라 None(안전한 폴백)."""
    a = agg.ToolAggregator()
    schema = {"type": "object", "properties": {"truncate_at": {"type": "integer"}}}
    a.update_alias_tools("old-name", [FakeTool("search_disclosure", inputSchema=schema)])
    a.rename_alias("old-name", "new-name")
    assert a.find_input_schema("old-name__search_disclosure") is None
    assert a.find_input_schema("new-name__search_disclosure") == schema

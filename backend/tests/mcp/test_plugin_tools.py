"""athena_plugin — 액션 6종 고정, 제안만으로 소비자 두 파일 불변, 별칭 게이트.

이 파일이 고정하는 것은 "코드가 안 돈다"가 아니라 **"두 파일이 안 바뀐다"**이다
(계획 §3.1 ③ 주석). 소비자 파일은 `~/.athena/mcp_servers.json`·`consent.json`이고
테스트는 `ATHENA_MCP_REGISTRY_PATH`로 임시 디렉터리를 잡는다. `reload()`가 만드는
`.mcp_servers.json.lock`은 소비자 파일이 아니라 단언 대상에서 뺀다.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import pytest

from athena_mcp import plugin_tools
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.result import ERROR_ORIGIN_META_KEY

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "plugin-proposal"

_SNIPPET = json.dumps(
    {"mcpServers": {"weather": {"command": "uvx", "args": ["mcp-server-weather"]}}},
    ensure_ascii=False,
)

# 6종 각각의 **툴 입력 예시**. 픽스처 파일의 `tool_input`이 되고, 앱 쪽
# `step.input.actions[]` 판정부 테스트가 같은 파일을 읽는다(계획 §2.5 계약 행).
TOOL_INPUTS: dict[str, dict] = {
    "install": {
        "actions": [
            {
                "action": "install",
                "target": "time",
                "features": ["get_current_time", "convert_time"],
            }
        ],
        "reason": "시간대 변환이 필요해 보입니다",
    },
    "allow_tools": {
        "actions": [{"action": "allow_tools", "target": "fetch", "features": ["fetch"]}],
        "reason": "공시 원문을 읽으려면 필요합니다",
    },
    "revoke_tools": {
        "actions": [{"action": "revoke_tools", "target": "fetch", "features": ["fetch"]}],
        "reason": "당분간 웹 읽기를 쓰지 않기로 했습니다",
    },
    "set_enabled": {
        "actions": [{"action": "set_enabled", "target": "fetch", "enabled": False}],
        "reason": "잠시 꺼두겠습니다",
    },
    "remove": {
        "actions": [{"action": "remove", "target": "fetch"}],
        "reason": "더 쓰지 않는 플러그인입니다",
    },
    "stage_snippet": {
        "actions": [{"action": "stage_snippet", "snippet": _SNIPPET}],
        "reason": "설정 JSON으로 직접 등록합니다",
    },
}

# 대상 별칭을 갖는 다섯 액션 — PM-1 별칭 게이트가 적용되는 범위다.
TARGETED_ACTIONS = ("install", "allow_tools", "revoke_tools", "set_enabled", "remove")


@dataclass
class _State:
    registry: ServerRegistry
    consent: ConsentStore
    registry_path: Path
    consent_path: Path


@pytest.fixture
def state(tmp_path, monkeypatch) -> _State:
    """실경로 오버라이드(`ATHENA_MCP_REGISTRY_PATH`)로 잡은 임시 소비자 두 파일."""
    registry_path = tmp_path / "mcp_servers.json"
    consent_path = tmp_path / "consent.json"
    monkeypatch.setenv("ATHENA_MCP_REGISTRY_PATH", str(registry_path))
    registry = ServerRegistry()  # 경로는 환경변수에서 온다
    assert registry.path == registry_path
    registry.add("fetch", command="uvx", args=["mcp-server-fetch"], env={})
    consent = ConsentStore(path=consent_path)
    consent.request_consent("fetch", "uvx", ["mcp-server-fetch"], {})
    consent.approve("fetch", approved_tools={"fetch"})
    return _State(
        registry=registry,
        consent=consent,
        registry_path=registry_path,
        consent_path=consent_path,
    )


def _stat(path: Path) -> tuple[bytes, int]:
    return path.read_bytes(), path.stat().st_mtime_ns


def _envelope(result) -> dict:
    assert not result.isError, result.content[0].text
    return json.loads(result.content[0].text)


# ---------------------------------------------------------------------------
# (a)(b) 액션 enum
# ---------------------------------------------------------------------------


def test_action_enum_is_exactly_the_six_names():
    """6종을 고정한다 — 빌트인은 consent 게이트를 우회하므로 추가는 실패여야 한다."""
    (tool,) = plugin_tools.builtin_tool_defs()
    assert tool.name == "athena_plugin"
    enum = tool.inputSchema["properties"]["actions"]["items"]["properties"]["action"]["enum"]
    assert enum == [
        "install",
        "allow_tools",
        "revoke_tools",
        "set_enabled",
        "remove",
        "stage_snippet",
    ]
    assert len(plugin_tools._ALLOWED_ACTIONS) == 6  # noqa: SLF001
    # 툴 입력도 봉투와 같은 모양이다 — `actions` 배열이고 최소 1개다(C-8).
    assert tool.inputSchema["required"] == ["actions"]
    assert tool.inputSchema["properties"]["actions"]["minItems"] == 1
    # 설명이 정직성 계약을 담는다.
    assert "제안만 한다" in tool.description
    assert "athena:mcp-stage-snippet" in tool.description


CATALOG_JS = Path(__file__).resolve().parents[3] / "app" / "lib" / "plugin-catalog.js"


def test_catalog_ids_match_the_renderer_catalog():
    """설치 제안의 화이트리스트는 허브가 보여주는 목록과 같아야 한다.

    어긋나면 허브에 뜨는 항목을 모델이 제안할 수 없거나(누락), 화면에 없는 것을
    제안한다(초과). 두 목록은 언어가 달라 한쪽만 고치기 쉬우므로 여기서 잠근다.
    """
    source = CATALOG_JS.read_text(encoding="utf-8")
    # MARKETPLACES에도 같은 모양의 id가 있다 — CATALOG 블록만 잘라 읽는다.
    block = source[source.index("const CATALOG = Object.freeze([") : source.index("const MARKETPLACES")]
    ids = set(re.findall(r"^ {4}id: '([^']+)',", block, re.MULTILINE))
    assert ids, f"카탈로그 id를 하나도 읽지 못했다: {CATALOG_JS}"
    assert ids == set(plugin_tools._CATALOG_IDS)


@pytest.mark.parametrize("action", ["enable", "disable", "approve", "probe", None, 5])
def test_action_outside_the_enum_is_blocked_and_no_handler_runs(action, state, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("enum 밖 action이 게이트를 지나 처리기에 도달했다")

    monkeypatch.setattr(plugin_tools, "_gate_action", _boom)
    result = plugin_tools.dispatch(
        {"actions": [{"action": action, "target": "fetch"}]}, state.registry, state.consent
    )
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert "허용되지 않는 action" in result.content[0].text


def test_empty_actions_is_blocked(state):
    result = plugin_tools.dispatch({"actions": []}, state.registry, state.consent)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"


# ---------------------------------------------------------------------------
# (c) 소비자 두 파일 불변 — 6종 전부
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("action", list(TOOL_INPUTS))
def test_proposal_never_touches_the_two_consumer_files(action, state):
    before = (_stat(state.registry_path), _stat(state.consent_path))

    result = plugin_tools.dispatch(TOOL_INPUTS[action], state.registry, state.consent)
    assert not result.isError, result.content[0].text

    after = (_stat(state.registry_path), _stat(state.consent_path))
    assert before == after  # 바이트도 mtime도 그대로 (.lock은 소비자 파일이 아니다)
    # revision도 그대로다 — 제안은 쓰기 세대를 올리지 않는다.
    assert json.loads(state.registry_path.read_text(encoding="utf-8"))["revision"] == 1


# ---------------------------------------------------------------------------
# (d)(e) 별칭 게이트 — PM-1
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("alias", ["brain", "kiwoom", "kiwoom-selector", "없는서버"])
@pytest.mark.parametrize("action", TARGETED_ACTIONS)
def test_builtin_and_unknown_aliases_are_blocked(alias, action, state, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("차단돼야 할 제안이 쓰기 경로에 도달했다")

    monkeypatch.setattr(ServerRegistry, "_mutate", _boom)
    monkeypatch.setattr(ConsentStore, "_mutate", _boom)

    result = plugin_tools.dispatch(
        {"actions": [{"action": action, "target": alias, "enabled": True}]},
        state.registry,
        state.consent,
    )
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert alias in result.content[0].text


def test_snippet_declaring_brain_is_blocked(state):
    snippet = json.dumps({"mcpServers": {"brain": {"command": "uvx", "args": []}}})
    result = plugin_tools.dispatch(
        {"actions": [{"action": "stage_snippet", "snippet": snippet}]},
        state.registry,
        state.consent,
    )
    assert result.isError
    assert "brain" in result.content[0].text


@pytest.mark.parametrize(
    ("snippet", "fragment"),
    [
        ("{이건 JSON이 아니다", "읽을 수 없다"),
        (json.dumps({"mcpServers": {}}), "하나도 없다"),
        (
            json.dumps({"mcpServers": {"a": {"command": "uvx"}, "b": {"command": "npx"}}}),
            "2개다",
        ),
    ],
)
def test_snippet_must_declare_exactly_one_server(snippet, fragment, state):
    result = plugin_tools.dispatch(
        {"actions": [{"action": "stage_snippet", "snippet": snippet}]},
        state.registry,
        state.consent,
    )
    assert result.isError
    assert fragment in result.content[0].text


def test_valid_single_alias_snippet_passes_with_null_target(state):
    envelope = _envelope(
        plugin_tools.dispatch(TOOL_INPUTS["stage_snippet"], state.registry, state.consent)
    )
    (action,) = envelope["actions"]
    assert action["action"] == "stage_snippet"
    assert action["target"] is None  # 카드 제목은 `직접 등록`이다
    assert action["snippet"] == _SNIPPET


@pytest.mark.parametrize(
    "snippet",
    [
        json.dumps({"mcpServers": {"DART MCP": {"command": "uvx", "args": []}}}),
        json.dumps(
            {
                "mcpServers": {
                    "공시": {"command": "npx", "args": ["-y", "dart-mcp"]}
                }
            },
            ensure_ascii=False,
        ),
    ],
)
def test_stage_snippet_rejects_existing_alias_after_onboarding_normalization(snippet, state):
    state.registry.add("dart-mcp", command="uvx", args=["dart-mcp"], env={})
    result = plugin_tools.dispatch(
        {"actions": [{"action": "stage_snippet", "snippet": snippet}]},
        state.registry,
        state.consent,
    )
    assert result.isError
    assert "'dart-mcp'은 이미 등록된 플러그인" in result.content[0].text
    assert "기존 연결 설정과 권한을 확인" in result.content[0].text


def test_stage_snippet_rejects_normalized_alias_collision_in_same_batch(state):
    result = plugin_tools.dispatch(
        {
            "actions": [
                {
                    "action": "stage_snippet",
                    "snippet": json.dumps(
                        {"mcpServers": {"dart mcp": {"command": "uvx", "args": []}}}
                    ),
                },
                {
                    "action": "stage_snippet",
                    "snippet": json.dumps(
                        {"mcpServers": {"dart@mcp": {"command": "uvx", "args": []}}}
                    ),
                },
            ]
        },
        state.registry,
        state.consent,
    )
    assert result.isError
    assert "같은 제안에 중복" in result.content[0].text


@pytest.mark.parametrize(
    "actions",
    [
        [
            {"action": "install", "target": "time"},
            {
                "action": "stage_snippet",
                "snippet": json.dumps(
                    {"mcpServers": {"time": {"command": "uvx", "args": []}}}
                ),
            },
        ],
        [
            {
                "action": "stage_snippet",
                "snippet": json.dumps(
                    {"mcpServers": {"time": {"command": "uvx", "args": []}}}
                ),
            },
            {"action": "install", "target": "time"},
        ],
    ],
)
def test_install_and_stage_snippet_cannot_add_same_alias_in_one_batch(actions, state):
    result = plugin_tools.dispatch({"actions": actions}, state.registry, state.consent)
    assert result.isError
    assert "같은 제안에 중복" in result.content[0].text


def test_existing_alias_update_action_is_not_blocked_by_snippet_duplicate_gate(state):
    result = plugin_tools.dispatch(
        {"actions": [{"action": "set_enabled", "target": "fetch", "enabled": False}]},
        state.registry,
        state.consent,
    )
    assert not result.isError, result.content[0].text


def test_stage_snippet_rejects_an_explicit_target(state):
    result = plugin_tools.dispatch(
        {"actions": [{"action": "stage_snippet", "target": "weather", "snippet": _SNIPPET}]},
        state.registry,
        state.consent,
    )
    assert result.isError
    assert "대상 별칭을 보내지 않는다" in result.content[0].text


# ---------------------------------------------------------------------------
# (f) 등록 회귀 가드
# ---------------------------------------------------------------------------


def test_the_tool_is_registered_in_the_builtin_set():
    """정의만 있고 등록이 빠지면 모델에게는 존재하지 않는 툴이다(server.py 배선)."""
    from athena_mcp import server

    names = {tool.name for tool in server._builtin_tool_defs()}  # noqa: SLF001
    assert plugin_tools.PLUGIN_TOOL in names


# ---------------------------------------------------------------------------
# (g)(h) 봉투 스탬프
# ---------------------------------------------------------------------------


def test_revision_is_stamped_after_reload(state):
    """게이트웨이 캐시가 아니라 **디스크의 현재 revision**을 찍는다(PM-3)."""
    stale_revision = state.registry.revision

    # 다른 프로세스(설치 CLI)가 낸 변경을 흉내낸다 — 같은 파일, 다른 인스턴스.
    other = ServerRegistry(path=state.registry_path)
    other.add("memory", command="npx", args=["-y", "@modelcontextprotocol/server-memory"], env={})
    on_disk = json.loads(state.registry_path.read_text(encoding="utf-8"))["revision"]
    assert on_disk > stale_revision
    assert state.registry.revision == stale_revision  # 아직 캐시는 낡았다

    envelope = _envelope(
        plugin_tools.dispatch(TOOL_INPUTS["allow_tools"], state.registry, state.consent)
    )
    assert envelope["revision"] == on_disk
    aliases = [server["alias"] for server in envelope["current"]["servers"]]
    assert aliases == ["fetch", "memory"]


def test_identical_reconnect_metadata_keeps_plugin_proposal_revision_stable(state):
    state.registry.record_self_reported_info(
        "fetch",
        reported_name="fetch",
        reported_version="1.0.0",
        protocol_version="2025-11-25",
    )
    before = _envelope(
        plugin_tools.dispatch(TOOL_INPUTS["set_enabled"], state.registry, state.consent)
    )["revision"]

    state.registry.record_self_reported_info(
        "fetch",
        reported_name="fetch",
        reported_version="1.0.0",
        protocol_version="2025-11-25",
    )
    after = _envelope(
        plugin_tools.dispatch(TOOL_INPUTS["set_enabled"], state.registry, state.consent)
    )["revision"]

    assert after == before


def test_source_is_forced_to_model_even_when_arguments_say_gui(state):
    arguments = dict(TOOL_INPUTS["remove"], source="gui")
    envelope = _envelope(plugin_tools.dispatch(arguments, state.registry, state.consent))
    assert envelope["source"] == "model"


def test_current_carries_approval_state_from_both_snapshots(state):
    envelope = _envelope(
        plugin_tools.dispatch(TOOL_INPUTS["set_enabled"], state.registry, state.consent)
    )
    (server,) = envelope["current"]["servers"]
    assert server == {
        "alias": "fetch",
        "approved": True,
        "enabled": True,
        "tools_allowed": ["fetch"],
    }
    assert len(envelope["proposal_id"]) == 32


# ---------------------------------------------------------------------------
# (i) 계약 픽스처 — 앱 쪽 `validateProposal`이 이 파일들을 읽는다
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("action", list(TOOL_INPUTS))
def test_writes_the_cross_language_contract_fixture(action, state):
    tool_input = TOOL_INPUTS[action]
    envelope = _envelope(plugin_tools.dispatch(tool_input, state.registry, state.consent))

    # 결정적 픽스처 — `proposal_id`는 실행마다 새 nonce라 그대로 쓰면 테스트를 돌릴 때마다
    # 작업 트리가 더러워진다. 액션 이름에서 유도한 32자 hex로 고정해 봉투 *모양*이 바뀔
    # 때만 파일이 바뀌게 하고, 내용이 같으면 다시 쓰지 않는다(mtime도 그대로).
    envelope = dict(envelope)
    envelope["proposal_id"] = hashlib.md5(f"fixture-{action}".encode("utf-8")).hexdigest()

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    target = FIXTURE_DIR / f"{action}.json"
    payload = (
        json.dumps(
            {"tool_input": tool_input, "envelope": envelope},
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    if not target.exists() or target.read_text(encoding="utf-8") != payload:
        target.write_text(payload, encoding="utf-8")

    written = json.loads(target.read_text(encoding="utf-8"))
    assert written["tool_input"]["actions"][0]["action"] == action
    assert written["envelope"]["source"] == "model"

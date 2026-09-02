"""`athena_backtest` — 백테스트 조회·검증·실행 빌트인 (HTTP 루프백 프록시).

routine_tools.py와 같은 이유로 `athena_api`를 import하지 않고 이미 떠 있는 백엔드에
루프백 호출만 한다. **재시도 없음** — 같은 문서의 규율 그대로.

허용 액션은 `list_presets`·`list_indicators`·`validate`·`plan`·`run`·`status`·`result`
**일곱뿐**이다(docs/architecture/backtest-mode-plan.md §9). `backfill`·`activate` 액션은
**존재하지 않는다** — 대량 백필은 키움 쿼터를 태우는 행위, 전략 버전 활성화는 모델이
바꿔놓고 사람은 옛 코드/스펙이 도는 줄 아는 경로를 여는 행위라 둘 다 사람 클릭(렌더러)
전용이다(routine_tools.py의 confirm/cancel 부재 규율과 같은 형태). 이 부재는 테스트가
고정한다.

`run`이 캐시 부족(백엔드 409)을 만나면 실행하지 않고 `blocked` 상태 페이로드
(`needed_pages`/`est_seconds`)로 번역해 돌려준다 — 캔버스가 그 숫자로 승인 카드를 띄운다.
"""

from __future__ import annotations

from typing import Any

import httpx
import mcp.types as types

from athena_mcp.result import (
    blocked as _blocked,
)
from athena_mcp.result import (
    success as _success,
)
from athena_mcp.result import (
    upstream_failed as _upstream_failed,
)

BACKTEST_TOOL = "athena_backtest"

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "list_presets",
    "list_indicators",
    "validate",
    "plan",
    "run",
    "status",
    "result",
    # 아래 넷은 상태를 바꾸지 않거나(flow·diagnose·read_code) 바꿔도 **비활성 초안**만
    # 만든다(propose_code). 활성화는 여전히 사람 클릭 전용이다(§7.3).
    "list_strategies",
    "read_code",
    "propose_code",
    "flow",
    "diagnose",
    "optimize",
    # 폼 설정 — HTTP를 타지 않고 캔버스로 간다. 검증을 통과하면 폼에 바로 반영되고,
    # 실행은 사람이 채팅의 [실행]을 눌러야 시작된다.
    "propose_spec",
    # 화면 전환(navigate)과 최적화 제안(propose_optimize)도 HTTP를 타지 않고 캔버스로만
    # 간다 — [탐색 시작] 버튼은 여전히 사람이 누른다. list_runs만 읽기 전용 조회다.
    "navigate",
    "propose_optimize",
    "list_runs",
)

# action=run이 백엔드로 넘길 수 있는 키 — 스키마 `run`에 적힌 둘뿐이다. `source`(코드
# 실행)와 `allow_partial`(캐시 부족 우회)은 사람 클릭 전용이라 여기서 걸러낸다.
_RUN_FORWARDED_KEYS: frozenset[str] = frozenset({"yaml", "params"})

_NAVIGATE_TABS: tuple[str, ...] = ("design", "result", "history", "optimize", "deploy")
_NAVIGATE_DESIGN_TABS: tuple[str, ...] = ("form", "code", "flow")
_OPTIMIZE_METHODS: tuple[str, ...] = ("grid", "random")

_TIMEOUT_SECONDS = 15.0

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ALLOWED_ACTIONS),
            "description": (
                "list_presets/list_indicators = 카탈로그 조회(읽기 전용). "
                "validate = yaml|python 파싱·계약 검사만(실행 안 함). "
                "plan = 필요한 데이터 수집 호출 수 추정. "
                "run = 실행(캐시가 충분할 때만 즉시 실행 — 부족하면 blocked). "
                "status/result = 실행 상태·결과 조회(읽기 전용). "
                "list_strategies/read_code = 저장된 전략과 활성 버전 소스 조회(읽기 전용). "
                "flow = 전략 코드를 단계 지도로 옮긴다(실행하지 않는다). "
                "diagnose = 오류 문구와 소스로 원인·수정안을 만든다(적용하지 않는다). "
                "propose_code = 코드를 낸다 — strategy_id가 있으면 **비활성 버전**으로 "
                "저장하고(활성화는 사람 전용), 없으면 캔버스 편집기에 바로 반영된다(HTTP 없음). "
                "채팅에 변경 내역과 [되돌리기]가 뜬다. "
                "optimize = 캐시 안에서 파라미터 조합을 훑는다(추가 TR 호출 없음). "
                "propose_spec = 폼 설정(patch)을 캔버스로 보낸다 — 검증을 통과하면 폼에 바로 "
                "반영되고 채팅에 변경 내역과 [되돌리기]가 뜬다(오류면 반영되지 않는다). 실행은 "
                "사람이 채팅의 [실행]을 누른다. "
                "navigate = 캔버스 탭을 옮긴다(design/result/history/optimize/deploy, "
                "designTab=form|code|flow). "
                "propose_optimize = 최적화 탭에 방식을 준비한다 — [탐색 시작]은 사람이 누른다. "
                "list_runs = 실행 이력 목록 조회(읽기 전용). "
                "실행·탐색 시작·수집·저장·활성화·배포는 전부 사람이 카드 버튼을 누른다. "
                "backfill(대량 백필)·activate(전략 버전 활성화)·deploy(실전 배포)는 이 툴에 "
                "없다 — 쿼터를 태우거나 돈이 나가는 경로라 사용자가 앱에서 직접 한다."
            ),
        },
        "validate": {
            "type": "object",
            "description": "action=validate일 때의 입력.",
            "properties": {
                "kind": {"type": "string", "enum": ["yaml", "python"]},
                "source": {"type": "string"},
            },
        },
        "plan": {
            "type": "object",
            "description": "action=plan일 때의 입력 — 종목·주기·수정주가·기간.",
            "properties": {
                "stk_cd": {"type": "string", "description": "6자리 종목코드"},
                "period": {"type": "string", "enum": ["day", "week", "month"]},
                "adjusted": {"type": "boolean"},
                "from_dt": {"type": "string", "description": "YYYYMMDD"},
                "to_dt": {"type": "string", "description": "YYYYMMDD"},
            },
        },
        "run": {
            "type": "object",
            "description": (
                "action=run일 때의 입력 — `.athena.yaml` 전략 원문 + 파라미터 오버라이드."
            ),
            "properties": {
                "yaml": {"type": "string"},
                "params": {"type": "object", "description": "선택: strategy.params 오버라이드"},
            },
        },
        "run_id": {
            "type": "string",
            "description": "action=status|result일 때 조회할 실행 id.",
        },
        "strategy_id": {
            "type": "string",
            "description": (
                "action=read_code일 때 대상 전략 id(필수). propose_code에선 선택 — 넣으면 그 "
                "전략의 비활성 초안 버전으로 저장되고, 빼면 캔버스 편집기에 바로 반영된다."
            ),
        },
        "propose_code": {
            "type": "object",
            "description": (
                "action=propose_code일 때의 입력 — 제안할 **전체 소스**와 왜 바꿨는지. "
                "저장되든 편집기에 바로 반영되든 **활성화되지 않는다**."
            ),
            "required": ["source"],
            "properties": {
                "source": {
                    "type": "string",
                    "description": "PARAMS 딕셔너리 + def signals(df, p)를 담은 파일 전체",
                },
                "note": {"type": "string", "description": "무엇을 왜 바꿨는지 한 줄"},
                "suggest_run": {
                    "type": "boolean",
                    "description": (
                        "true면 채팅 변경 카드에 [실행] 버튼이 함께 뜬다 — 실행 여부는 여전히 "
                        "사람이 결정한다."
                    ),
                },
                "suggest_validate": {
                    "type": "boolean",
                    "description": "true면 채팅 변경 카드에 [검증] 버튼이 함께 뜬다.",
                },
            },
        },
        "flow": {
            "type": "object",
            "description": "action=flow일 때의 입력 — 지도로 옮길 파이썬 소스.",
            "properties": {"source": {"type": "string"}},
        },
        "diagnose": {
            "type": "object",
            "description": "action=diagnose일 때의 입력 — 오류 문구와 그때의 소스.",
            "properties": {
                "error": {"type": "string"},
                "source": {"type": "string"},
            },
        },
        "optimize": {
            "type": "object",
            "description": (
                "action=optimize일 때의 입력 — 전략 yaml과 훑을 파라미터 범위. "
                "캐시 밖 구간이 있으면 실행하지 않고 blocked로 필요한 수집량을 알린다."
            ),
            "properties": {
                "yaml": {"type": "string"},
                "ranges": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "start": {"type": "number"},
                            "stop": {"type": "number"},
                            "step": {"type": "number"},
                        },
                    },
                },
                "method": {"type": "string", "enum": ["grid", "random"]},
                "samples": {"type": "integer"},
                "ascending": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "예: [\"fast\",\"slow\"] — fast<slow 조합만 훑는다",
                },
            },
        },
        "propose_spec": {
            "type": "object",
            "description": (
                "action=propose_spec일 때의 입력 — 백테스트 폼에 제안할 설정 초안. "
                "검증을 통과하면 폼에 바로 반영되고, 오류가 있으면 반영되지 않는다. "
                "실행·수집·저장은 일어나지 않는다."
            ),
            "required": ["patch"],
            "properties": {
                "patch": {
                    "type": "object",
                    "description": (
                        "폼 설정의 부분 갱신. 한 턴에 한 항목만 담는다. 빈 객체 {}도 허용된다"
                        "(suggest_run과 함께 실행 제안만 할 때)."
                    ),
                    "properties": {
                        "preset": {
                            "type": "string",
                            "description": (
                                "프리셋 id(예: sma_crossover) — 전략 템플릿을 먼저 고른다"
                            ),
                        },
                        "symbols": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "6자리 종목코드 목록 — 전체를 교체한다",
                        },
                        "period": {"type": "string", "enum": ["day", "week", "month"]},
                        "adjusted": {"type": "boolean"},
                        "fromDt": {"type": "string", "description": "YYYYMMDD"},
                        "toDt": {"type": "string", "description": "YYYYMMDD"},
                        "params": {
                            "type": "object",
                            "additionalProperties": {"type": "number"},
                            "description": "파라미터 값만 — 이름별로 병합, 모르는 이름은 무시된다",
                        },
                        "indicators": {
                            "type": "array",
                            "description": "지표 목록 — 전체를 교체한다",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "alias": {"type": "string"},
                                    "params": {"type": "object"},
                                },
                            },
                        },
                        "entry": {
                            "type": "object",
                            "description": "진입 조건 그룹 — 전체를 교체한다",
                            "properties": {
                                "logic": {"type": "string", "enum": ["AND", "OR"]},
                                "conditions": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "indicator": {"type": "string"},
                                            "operator": {
                                                "type": "string",
                                                "enum": [
                                                    "cross_above",
                                                    "cross_below",
                                                    "greater_than",
                                                    "less_than",
                                                    "greater_equal",
                                                    "less_equal",
                                                    "equals",
                                                ],
                                            },
                                            "compare_to": {
                                                "type": ["number", "string"],
                                                "description": (
                                                    "숫자 임계값은 number로, 지표 별칭·"
                                                    "원시 열 이름은 string으로 보낸다"
                                                ),
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        "exit": {
                            "type": "object",
                            "description": "청산 조건 그룹 — entry와 같은 형태, 전체를 교체한다",
                            "properties": {
                                "logic": {"type": "string", "enum": ["AND", "OR"]},
                                "conditions": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "indicator": {"type": "string"},
                                            "operator": {
                                                "type": "string",
                                                "enum": [
                                                    "cross_above",
                                                    "cross_below",
                                                    "greater_than",
                                                    "less_than",
                                                    "greater_equal",
                                                    "less_equal",
                                                    "equals",
                                                ],
                                            },
                                            "compare_to": {
                                                "type": ["number", "string"],
                                                "description": (
                                                    "숫자 임계값은 number로, 지표 별칭·"
                                                    "원시 열 이름은 string으로 보낸다"
                                                ),
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        "risk": {
                            "type": "object",
                            "description": "손절·익절 — 항목별로 깊이 병합한다",
                            "properties": {
                                "stop_loss": {
                                    "type": "object",
                                    "properties": {
                                        "enabled": {"type": "boolean"},
                                        "percent": {"type": "number"},
                                    },
                                },
                                "take_profit": {
                                    "type": "object",
                                    "properties": {
                                        "enabled": {"type": "boolean"},
                                        "percent": {"type": "number"},
                                    },
                                },
                            },
                        },
                        "costs": {
                            "type": "object",
                            "description": "수수료·세금·슬리피지(bp) — 항목별로 병합한다",
                            "properties": {
                                "fee_bps": {"type": "number"},
                                "tax_bps": {"type": "number"},
                                "slippage_bps": {"type": "number"},
                            },
                        },
                    },
                },
                "note": {"type": "string", "description": "무엇을 왜 제안했는지 한 줄"},
                "suggest_run": {
                    "type": "boolean",
                    "description": (
                        "true면 채팅 변경 카드에 [실행] 버튼이 함께 뜬다 — 실행 여부는 여전히 "
                        "사람이 결정한다."
                    ),
                },
            },
        },
        "navigate": {
            "type": "object",
            "description": (
                "action=navigate일 때의 입력 — 캔버스에서 보여줄 탭. 화면만 옮기고 "
                "실행·수집은 하지 않는다."
            ),
            "required": ["tab"],
            "properties": {
                "tab": {"type": "string", "enum": list(_NAVIGATE_TABS)},
                "designTab": {
                    "type": "string",
                    "enum": list(_NAVIGATE_DESIGN_TABS),
                    "description": "tab=design일 때의 하위 탭 — 폼·코드·흐름 지도",
                },
            },
        },
        "propose_optimize": {
            "type": "object",
            "description": (
                "action=propose_optimize일 때의 입력 — 최적화 탭에 준비할 탐색 방식. "
                "탐색은 사람이 [탐색 시작]을 눌러야 시작된다."
            ),
            "required": ["method"],
            "properties": {
                "method": {"type": "string", "enum": list(_OPTIMIZE_METHODS)},
                "note": {"type": "string", "description": "무엇을 왜 제안했는지 한 줄"},
            },
        },
    },
}

_DESCRIPTION = (
    "백테스트 카탈로그 조회·전략 검증·실행 계획·실행·상태 조회, 실행 이력 목록(list_runs), "
    "코드 플로우 지도·오류 진단, 코드 초안 제안, 파라미터 최적화, 캔버스 화면 전환(navigate)과 "
    "최적화 제안(propose_optimize). run과 optimize는 **캐시가 충분할 때만 즉시 실행된다** — "
    "부족하면 실행하지 않고 blocked 상태로 필요한 수집량을 알려준다(사람이 앱에서 데이터 "
    "수집을 승인해야 한다). propose_code는 strategy_id가 있으면 초안을 저장할 뿐 활성화하지 "
    "않고, strategy_id가 없으면 캔버스 편집기에 바로 반영된다 — 지금 도는 전략은 그대로다. "
    "propose_spec은 폼 설정을 캔버스로 보낸다 — 검증을 통과하면 폼에 바로 반영되고, 채팅의 "
    "[되돌리기]로 되돌린다. propose_optimize도 방식만 준비한다. 실행·탐색 시작·수집·저장·"
    "활성화·배포는 전부 사람이 카드 버튼을 누른다. 대량 백필(backfill)·전략 버전 "
    "활성화(activate)·실전 배포(deploy)는 이 툴로 할 수 없다 — 셋 다 사람 클릭 전용이다."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=BACKTEST_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


def _error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        message = body.get("message") if isinstance(body, dict) else None
    except ValueError:
        detail, message = response.text[:300], None
    text = f"{detail or 'HTTP ' + str(response.status_code)}"
    if message:
        text += f" — {message}"
    return text


async def dispatch(
    arguments: dict[str, Any], http_client: httpx.AsyncClient
) -> types.CallToolResult:
    """재시도 없음 — 단 한 번의 루프백 시도 후 즉시 결과를 반환한다."""
    action = arguments.get("action")
    if action not in _ALLOWED_ACTIONS:
        # backfill·activate를 포함한 그 외 전부 — 사람 전용 행위임을 명시한다.
        return _blocked(
            f"허용되지 않는 action: {action!r}. 가능한 것은 "
            f"{'/'.join(_ALLOWED_ACTIONS)}뿐이다 — 백필·전략 버전 활성화·실전 배포는 "
            "사용자가 앱에서 직접 한다."
        )

    if action in ("status", "result"):
        run_id = arguments.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            return _blocked(f"action={action!r}는 run_id(문자열)가 필요하다.")

    strategy_id = arguments.get("strategy_id")
    has_strategy_id = isinstance(strategy_id, str) and bool(strategy_id)
    if action == "read_code" and not has_strategy_id:
        return _blocked(f"action={action!r}는 strategy_id(문자열)가 필요하다.")

    if action == "propose_code" and not has_strategy_id:
        # 저장할 전략이 아직 없는 경우 — 백엔드를 타지 않고 캔버스 편집기로 바로 간다.
        # 실행·검증은 사람이 채팅 카드의 버튼을 눌러야 일어난다.
        code_input = arguments.get("propose_code")
        code_input = code_input if isinstance(code_input, dict) else {}
        source = code_input.get("source")
        if not isinstance(source, str) or not source.strip():
            return _blocked("propose_code에는 source(문자열)가 필요하다.")
        note = code_input.get("note")
        return _success(
            {
                "delivered": "canvas",
                "kind": "code_draft",
                "source": source,
                "note": note if isinstance(note, str) else None,
                "suggest_run": code_input.get("suggest_run") is True,
                "suggest_validate": code_input.get("suggest_validate") is True,
                "notice": (
                    "코드가 편집기에 바로 들어갔다. 실행·검증은 사람이 채팅의 버튼을 누른다."
                ),
            }
        )

    if action == "navigate":
        # 화면만 옮긴다 — 어떤 상태도 바뀌지 않는다.
        nav_input = arguments.get("navigate")
        nav_input = nav_input if isinstance(nav_input, dict) else {}
        tab = nav_input.get("tab")
        if tab not in _NAVIGATE_TABS:
            return _blocked(
                f"navigate에는 tab(문자열)이 필요하다 — {'/'.join(_NAVIGATE_TABS)} 중 하나."
            )
        design_tab = nav_input.get("designTab")
        if design_tab is not None and design_tab not in _NAVIGATE_DESIGN_TABS:
            return _blocked(
                f"navigate의 designTab은 {'/'.join(_NAVIGATE_DESIGN_TABS)} 중 하나여야 한다."
            )
        return _success(
            {
                "delivered": "canvas",
                "kind": "navigate",
                "tab": tab,
                "designTab": design_tab,
            }
        )

    if action == "propose_optimize":
        # 탐색 방식만 준비한다 — 실제 탐색은 사람이 [탐색 시작]을 눌러야 시작된다.
        opt_input = arguments.get("propose_optimize")
        opt_input = opt_input if isinstance(opt_input, dict) else {}
        method = opt_input.get("method")
        if method not in _OPTIMIZE_METHODS:
            return _blocked(
                f"propose_optimize에는 method가 필요하다 — "
                f"{'/'.join(_OPTIMIZE_METHODS)} 중 하나."
            )
        note = opt_input.get("note")
        return _success(
            {
                "delivered": "canvas",
                "kind": "optimize_request",
                "method": method,
                "note": note if isinstance(note, str) else None,
                "notice": (
                    "최적화 탭에 방식을 준비했다. 사용자가 [탐색 시작]을 눌러야 실행된다."
                ),
            }
        )

    if action == "propose_spec":
        # 백엔드를 타지 않는다 — main.js가 이 결과를 렌더러로 보내고 캔버스가 바로 반영한다.
        # 검증 오류면 반영되지 않고, 실행은 사람이 채팅 카드의 버튼을 눌러야 일어난다.
        spec_input = arguments.get("propose_spec")
        spec_input = spec_input if isinstance(spec_input, dict) else {}
        patch = spec_input.get("patch")
        if not isinstance(patch, dict):
            return _blocked("propose_spec에는 patch(객체)가 필요하다.")
        note = spec_input.get("note")
        return _success(
            {
                "delivered": "canvas",
                "patch": patch,
                "note": note if isinstance(note, str) else None,
                "suggest_run": spec_input.get("suggest_run") is True,
                "notice": (
                    "설정이 캔버스로 전달됐다. 검증을 통과하면 폼에 바로 반영되고, 오류가 "
                    "있으면 반영되지 않는다(다음 턴 컨텍스트의 대기 중 초안에 오류가 보인다). "
                    "실행은 사람이 채팅의 [실행]을 누른다."
                ),
            }
        )

    try:
        if action == "list_presets":
            response = await http_client.get(
                "/api/v1/backtest/presets", timeout=_TIMEOUT_SECONDS
            )
        elif action == "list_indicators":
            response = await http_client.get(
                "/api/v1/backtest/indicators", timeout=_TIMEOUT_SECONDS
            )
        elif action == "validate":
            response = await http_client.post(
                "/api/v1/backtest/validate",
                json=arguments.get("validate") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "plan":
            response = await http_client.post(
                "/api/v1/backtest/data/plan",
                json=arguments.get("plan") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "run":
            # 스키마에 적힌 키만 넘긴다 — 특히 `source`는 여기서 잘라낸다. POST /runs는
            # source가 있으면 그 파이썬을 샌드박스에서 돌리고 origin="human"·active=True
            # 버전으로 남기는데, 그걸 모델이 낼 수 있으면 propose_code가 origin을
            # llm_draft로 못박은 이유(§7.3)가 한 칸 옆에서 무너진다. 코드 실행은 사람이
            # 캔버스·채팅 카드에서 [실행]을 눌렀을 때만 시작된다.
            run_input = arguments.get("run") or {}
            response = await http_client.post(
                "/api/v1/backtest/runs",
                json={
                    key: value
                    for key, value in run_input.items()
                    if key in _RUN_FORWARDED_KEYS
                },
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "list_runs":
            response = await http_client.get(
                "/api/v1/backtest/runs", timeout=_TIMEOUT_SECONDS
            )
        elif action == "list_strategies":
            response = await http_client.get(
                "/api/v1/backtest/strategies", timeout=_TIMEOUT_SECONDS
            )
        elif action == "read_code":
            response = await http_client.get(
                f"/api/v1/backtest/strategies/{arguments['strategy_id']}/versions",
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "propose_code":
            # origin=llm_draft를 **여기서 못박는다** — 모델이 human으로 위장해 즉시 활성화되는
            # 경로를 만들지 않는다(§7.3). 인자로 받지 않는 이유가 그것이다.
            body = dict(arguments.get("propose_code") or {})
            body["origin"] = "llm_draft"
            response = await http_client.post(
                f"/api/v1/backtest/strategies/{arguments['strategy_id']}/versions",
                json=body,
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "flow":
            response = await http_client.post(
                "/api/v1/backtest/flow",
                json=arguments.get("flow") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "diagnose":
            response = await http_client.post(
                "/api/v1/backtest/diagnose",
                json=arguments.get("diagnose") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "optimize":
            response = await http_client.post(
                "/api/v1/backtest/optimize",
                json=arguments.get("optimize") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        else:  # status | result
            run_id = arguments["run_id"]
            response = await http_client.get(
                f"/api/v1/backtest/runs/{run_id}", timeout=_TIMEOUT_SECONDS
            )
    except httpx.ConnectError:
        return _upstream_failed(
            "키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다. 사용자에게 백엔드 "
            "실행을 안내하고, 실행이 시작됐다고 말하지 마라."
        )
    except httpx.HTTPError as exc:
        return _upstream_failed(f"athena_backtest 호출 중 전송 오류: {exc}")

    if action in ("run", "optimize") and response.status_code == 409:
        # 캐시 부족 — 실행하지 않았다는 사실과 필요한 수집량을 그대로 옮긴다.
        try:
            body = response.json()
        except ValueError:
            body = {}
        detail = body.get("detail") if isinstance(body, dict) else None
        detail = detail if isinstance(detail, dict) else {}
        return _success(
            {
                "status": "blocked",
                "needed_pages": detail.get("needed_pages"),
                "est_seconds": detail.get("est_seconds"),
                "message": (
                    "캔들 캐시가 부족해 실행하지 않았다 — 먼저 데이터 수집(백필)이 "
                    "필요하다. 백필은 사용자가 앱에서 직접 승인해야 한다."
                ),
            }
        )

    if response.status_code >= 400:
        return _upstream_failed(_error_text(response))

    payload = response.json()
    if action == "run":
        payload = {**payload, "status": "accepted"}
    if action == "propose_code":
        # 저장됐지만 **켜지지 않았다**는 사실을 모델이 오해할 수 없게 매번 같이 실어 보낸다.
        payload = {
            **payload,
            "message": (
                "초안 버전으로 저장했다. 아직 활성화되지 않았고 지금 도는 전략은 그대로다 — "
                "사용자가 앱에서 diff를 보고 [적용]을 눌러야 바뀐다. "
                "적용됐다고 말하지 마라."
            ),
        }
    return _success(payload)


__all__ = ["BACKTEST_TOOL", "builtin_tool_defs", "dispatch"]

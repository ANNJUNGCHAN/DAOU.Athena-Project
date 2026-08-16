"""툴 집계 + 네임스페이스 — `별칭__툴명`으로 재노출.

## 모델 노출 이름과 내부 upstream ID 분리

"별칭이 바뀌어도 in-flight 호출이 안 깨져야 한다"(W1 스펙 §4)는 요구를
`_resolution_table`로 만족시킨다: `update_alias_tools()`/`rename_alias()`는
**노출 목록**(`list_tools()`가 반환하는 것)만 새로 쓰고, 과거에 발급된
qualified name -> upstream 매핑은 `forget_alias()`(서버 완전 제거)를 명시적으로
호출하기 전까지 리졸루션 테이블에 남는다. 즉 이미 CLI에 전달된 `별칭__툴명`
문자열은, 그 별칭이 나중에 다른 이름으로 바뀌거나 그 별칭의 툴 목록이
갱신되더라도 여전히 올바른 upstream 서버·툴 이름으로 풀린다.

## 64자 규칙 — 2차 방어선

`registry.py`가 등록 시점에 관측치 기반으로 별칭 길이를 제한하지만(1차 방어),
실제 upstream 툴 이름은 연결 전까지 알 수 없다. 이 모듈이 **실제** 툴 이름을
받은 뒤 `별칭__툴명`이 64자를 넘는지 다시 검사한다 — 위반 툴은 조용히 잘리지
않고 **스킵되며 사유가 `violations`에 기록된다**(호출자가 UI에 보여줄 수 있게).

## 갱신 실패 시 이전 캐시 유지

"`notifications/tools/list_changed` 재방송. 갱신 실패 시 빈 목록으로 덮어쓰지
말고 이전 캐시를 유지하라(알려진 버그 패턴)" — `update_alias_tools()`는 새
목록을 전부 만든 뒤에만 커밋한다. 예외가 나면 그 별칭의 기존 노출 목록은
그대로 남는다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from athena_mcp.registry import MAX_QUALIFIED_NAME_LEN, QUALIFIED_NAME_SEPARATOR


def qualified_name(alias: str, upstream_tool_name: str) -> str:
    return f"{alias}{QUALIFIED_NAME_SEPARATOR}{upstream_tool_name}"


@dataclass(frozen=True)
class QualifiedTool:
    """CLI에 노출되는 툴 하나. `qualified_name`이 모델이 보는 이름이다."""

    qualified_name: str
    alias: str
    upstream_name: str
    description: str | None
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ResolvedTarget:
    """qualified_name -> (등록 당시 별칭, upstream 원본 툴명)."""

    alias: str
    upstream_name: str


@dataclass(frozen=True)
class SkippedToolViolation:
    alias: str
    upstream_name: str
    attempted_qualified_name: str
    reason: str


@dataclass
class UpdateResult:
    alias: str
    committed: bool
    tool_count: int
    violations: list[SkippedToolViolation] = field(default_factory=list)
    error: str | None = None


class UnknownQualifiedNameError(KeyError):
    pass


class ToolAggregator:
    def __init__(self) -> None:
        self._exposed_by_alias: dict[str, list[QualifiedTool]] = {}
        self._resolution_table: dict[str, ResolvedTarget] = {}
        self._change_listeners: list[Callable[[], None]] = []
        # upstream 툴 하나가 새 이름으로 다시 등록될 때(같은 alias, 같은
        # upstream_name) 같은 qualified_name을 재사용하도록 하는 인덱스.
        self._progress_tokens: dict[str, tuple[str, str]] = {}

    # -- 구독 ------------------------------------------------------------

    def subscribe(self, callback: Callable[[], None]) -> None:
        """`tools/list_changed`를 재방송해야 할 때 호출할 콜백을 등록한다.
        실제 MCP 알림 전송은 server.py의 몫이다 — 여기서는 훅만 제공한다."""
        self._change_listeners.append(callback)

    def _notify_changed(self) -> None:
        for cb in self._change_listeners:
            cb()

    # -- 집계 --------------------------------------------------------------

    def update_alias_tools(self, alias: str, upstream_tools: Iterable[Any]) -> UpdateResult:
        """upstream의 `list_tools()` 결과로 해당 별칭의 노출 목록을 갱신한다.

        `upstream_tools`의 각 항목은 `.name`/`.description`/`.inputSchema`
        속성을 가진 객체(mcp.types.Tool) 또는 동등한 dict여도 된다.
        실패(예외 발생) 시 이전 캐시를 그대로 유지하고 `committed=False`를 반환한다
        — 빈 목록으로 덮어쓰지 않는다.
        """
        try:
            new_tools: list[QualifiedTool] = []
            violations: list[SkippedToolViolation] = []
            for t in upstream_tools:
                name = t["name"] if isinstance(t, dict) else t.name
                raw_description = t.get("description") if isinstance(t, dict) else t.description
                description = raw_description or None
                raw_schema = t.get("inputSchema") if isinstance(t, dict) else t.inputSchema
                schema = raw_schema or {}
                qname = qualified_name(alias, name)
                if len(qname) > MAX_QUALIFIED_NAME_LEN:
                    violations.append(
                        SkippedToolViolation(
                            alias=alias,
                            upstream_name=name,
                            attempted_qualified_name=qname,
                            reason=(
                                f"{len(qname)}자 — {MAX_QUALIFIED_NAME_LEN}자 상한 위반, "
                                "이 툴은 집계 목록에서 제외한다(조용히 자르지 않는다)"
                            ),
                        )
                    )
                    continue
                new_tools.append(
                    QualifiedTool(
                        qualified_name=qname,
                        alias=alias,
                        upstream_name=name,
                        description=description,
                        input_schema=schema,
                    )
                )
        except Exception as exc:  # 이전 캐시 유지 — 커밋하지 않는다
            previous_count = len(self._exposed_by_alias.get(alias, []))
            return UpdateResult(
                alias=alias, committed=False, tool_count=previous_count, error=repr(exc)
            )

        # 여기까지 왔으면 전부 성공 — 이제서야 커밋한다.
        self._exposed_by_alias[alias] = new_tools
        for qt in new_tools:
            self._resolution_table[qt.qualified_name] = ResolvedTarget(
                alias=qt.alias, upstream_name=qt.upstream_name
            )
        self._notify_changed()
        return UpdateResult(
            alias=alias, committed=True, tool_count=len(new_tools), violations=violations
        )

    def rename_alias(self, old_alias: str, new_alias: str) -> UpdateResult:
        """노출 목록만 새 별칭으로 옮긴다. 옛 qualified_name의 리졸루션 항목은
        지우지 않는다 — in-flight 호출이 안 깨지게 하기 위해서다."""
        old_tools = self._exposed_by_alias.get(old_alias, [])
        renamed = [
            QualifiedTool(
                qualified_name=qualified_name(new_alias, t.upstream_name),
                alias=new_alias,
                upstream_name=t.upstream_name,
                description=t.description,
                input_schema=t.input_schema,
            )
            for t in old_tools
        ]
        # `.get(old_alias, [])`로 없는 키를 관대하게 받았으므로 삭제도 관대해야
        # 한다 — 아직 connect되지 않아(= 노출 목록이 비어) 집계에 없는 별칭을
        # rename하는 건 정상 흐름이고, 여기서 KeyError로 터지면 안 된다.
        self._exposed_by_alias.pop(old_alias, None)
        # 옛 별칭의 노출 리스트는 지우지만, _resolution_table은 그대로 둔다
        # (일부러 지우지 않음 — 옛 qualified_name으로 온 in-flight 호출을 위해).
        self._exposed_by_alias[new_alias] = renamed
        for qt in renamed:
            self._resolution_table[qt.qualified_name] = ResolvedTarget(
                alias=new_alias, upstream_name=qt.upstream_name
            )
        self._notify_changed()
        return UpdateResult(alias=new_alias, committed=True, tool_count=len(renamed))

    def forget_alias(self, alias: str) -> None:
        """서버를 완전히 제거한다. 이 별칭으로 발급된 모든 qualified_name의
        리졸루션도 함께 지운다(재등록 안 할 거라는 명시적 의도이므로)."""
        self._exposed_by_alias.pop(alias, None)
        stale = [qname for qname, target in self._resolution_table.items() if target.alias == alias]
        for qname in stale:
            del self._resolution_table[qname]
        self._notify_changed()

    # -- 조회/디스패치 -------------------------------------------------------

    def list_tools(self, allowed: Callable[[str, str], bool] | None = None) -> list[QualifiedTool]:
        """`allowed(alias, upstream_name) -> bool`로 필터링할 수 있다.

        승인 안 된 툴을 집계 목록에서 빼는 건(W1-5) consent.py의 책임이고,
        이 메서드는 그 판정 함수를 주입받아 적용만 한다 — aggregator가
        consent 상태를 직접 알 필요가 없게 분리한다.
        """
        tools = [t for tools in self._exposed_by_alias.values() for t in tools]
        if allowed is None:
            return tools
        return [t for t in tools if allowed(t.alias, t.upstream_name)]

    def resolve(self, qname: str) -> ResolvedTarget:
        """qualified_name -> (alias, upstream_name). in-flight 호출 리맵에 쓰인다.

        별칭이 그 사이 바뀌었더라도, 이 qualified_name이 한 번이라도 유효했다면
        `forget_alias()`가 호출되기 전까지는 계속 풀린다.
        """
        try:
            return self._resolution_table[qname]
        except KeyError:
            raise UnknownQualifiedNameError(qname) from None

    # -- 진행토큰/취소 리맵 --------------------------------------------------

    def register_progress_token(
        self, downstream_token: str, alias: str, upstream_token: str
    ) -> None:
        """CLI(다운스트림)가 준 진행토큰을 실제 upstream 세션의 진행토큰에 매핑한다.

        `notifications/cancelled`를 올바른 upstream 세션으로 리맵할 때 쓴다.
        """
        self._progress_tokens[downstream_token] = (alias, upstream_token)

    def resolve_progress_token(self, downstream_token: str) -> tuple[str, str] | None:
        """`(alias, upstream_token)`. `notifications/cancelled`를 올바른 upstream
        세션으로 리맵할 때 쓴다. 없으면 None(이미 끝났거나 알 수 없는 토큰)."""
        return self._progress_tokens.get(downstream_token)

    def clear_progress_token(self, downstream_token: str) -> None:
        self._progress_tokens.pop(downstream_token, None)

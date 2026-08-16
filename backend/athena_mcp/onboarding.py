"""이식 절차 — 임의의 외부 MCP 서버를 게이트웨이에 태우는 프로덕션 경로.

W1까지는 이 절차가 **테스트 픽스처 안에만** 있었다(`tests/mcp/test_server.py`의
`gateway` fixture가 손으로 registry/consent/aggregator를 조립했다). 실제로
"서버를 등록해서 쓴다"는 흐름을 코드로 만든 게 이 모듈이다.

    스니펫/수동 입력
        -> 별칭 정규화 (임의 이름 -> MCP 툴 이름 규칙에 맞는 별칭)
        -> registry.add            (등록)
        -> consent.request_consent (승인 요청 — 아직 spawn 금지)
        -> [사용자 승인]           consent.approve
        -> probe                   (1회 spawn: initialize + list_tools + 인코딩 스모크)
        -> consent.allow_tool      (툴별 allowlist)
        -> runner가 serve 시 connect

## 왜 별칭 정규화가 이 절차의 핵심인가

클로드 데스크탑 스니펫의 서버 이름은 **아무 문자열이나 될 수 있다.** 실제로
쓰이는 이름들이 MCP 툴 이름 규칙(`^[A-Za-z0-9_-]{1,64}$`)을 그대로는 통과하지
못한다:

    "@drfirst/korea-stock-mcp"   -> '@'와 '/'가 허용 문자집합 밖
    "네이버 검색"                 -> 비ASCII + 공백
    "server.everything"          -> '.'이 밖

`registry.validate_alias()`는 이걸 **거부**한다(옳다 — 규칙은 규칙이다). 그런데
거부만 하면 "클로드 데스크탑 스니펫을 그대로 붙여넣으면 된다"는 §2 등록 UX가
성립하지 않는다. 그래서 거부 대신 **결정적으로 정규화**해서 제안하고, 최종
확정은 사용자가 한다. 정규화는 조용히 일어나지 않는다 — 원본과 제안을 둘 다
`PendingRegistration`에 실어 호출자가 보여줄 수 있게 한다.

## 인코딩 스모크 테스트를 두 층으로 나눈 이유

W1은 `quirks.run_encoding_smoke_test()`를 만들어놓고 아무 데서도 안 불렀다.
"한글 툴을 자동으로 한 번 호출한다"는 오케스트레이션이 빠져 있었는데, 그건
**범용적으로 불가능하다** — 서버마다 툴 이름도 인자도 다르므로 게이트웨이가
임의 서버에 대해 "한글이 나올 만한 호출"을 스스로 지어낼 수 없다. 지어내면
부작용 있는 툴(주문/삭제)을 건드릴 위험도 있다.

그래서 두 층으로 나눈다:

1. **수동적 스캔 (항상, 무료, 부작용 0)** — `list_tools()` 응답의 툴 이름과
   설명에 U+FFFD가 있는지 본다. 호출을 하지 않으므로 어떤 서버에도 안전하다.
2. **능동적 왕복 (선택)** — 사용자가 `probe_tool`/`probe_arguments`를 지정하면
   그 툴을 실제로 한 번 불러 응답을 검사한다. `@drfirst/korea-stock-mcp`의
   실측 손상은 툴 설명이 아니라 **응답 본문**에 나타나므로(§9-④) 이 층이
   있어야 잡힌다. 어떤 툴을 부를지는 사람이 정한다 — 게이트웨이가 추측하지
   않는다.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena_mcp import quirks
from athena_mcp.client import UpstreamServerHandle, describe_exception
from athena_mcp.consent import AuditLog, ConsentRecord, ConsentStore
from athena_mcp.registry import (
    MAX_ALIAS_LEN,
    ParsedSnippetServer,
    ServerEntry,
    ServerRegistry,
    parse_claude_desktop_snippet,
)
from athena_mcp.result import parse_call_tool_result

_NON_ALIAS_CHARS = re.compile(r"[^A-Za-z0-9_-]+")
_DASH_RUN = re.compile(r"-{2,}")
# 별칭이 상한을 넘을 때 잘라내면서 붙이는 해시 접미사 길이. 서로 다른 긴 이름이
# 앞 21자를 공유해도 충돌하지 않게 한다(예: 같은 스코프의 두 패키지).
_HASH_SUFFIX_LEN = 6


def sanitize_alias(raw: str) -> str:
    """임의 문자열을 `^[A-Za-z0-9_-]{1,MAX_ALIAS_LEN}$` 별칭으로 결정적 변환한다.

    - 허용 문자집합 밖은 전부 `-`로 치환하고 연속된 `-`는 하나로 접는다
      (`"@drfirst/korea-stock-mcp"` -> `"drfirst-korea-stock-mcp"`).
    - 비ASCII(한글 등)도 같은 규칙으로 사라진다. 전부 사라져 빈 문자열이 되면
      `"server"`로 대체한다 — 거부하지 않는다(호출자가 어차피 최종 확정한다).
    - 상한을 넘으면 자르되 **뒤에 원본 해시 6자를 붙인다.** 단순 절단은 접두사가
      같은 두 서버를 같은 별칭으로 만들어 `DuplicateAliasError`를 유발한다.

    같은 입력에는 항상 같은 출력을 준다(해시가 원본 전체에서 나오므로).
    """
    cleaned = _NON_ALIAS_CHARS.sub("-", raw)
    cleaned = _DASH_RUN.sub("-", cleaned).strip("-_")
    if not cleaned:
        cleaned = "server"
    if len(cleaned) <= MAX_ALIAS_LEN:
        return cleaned
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:_HASH_SUFFIX_LEN]
    keep = MAX_ALIAS_LEN - _HASH_SUFFIX_LEN - 1
    return f"{cleaned[:keep]}-{digest}"


_FALLBACK_ALIAS = "server"
# `npx -y <pkg>` / `uvx --from x <pkg>` 처럼 패키지 이름이 아닌 인자들. 별칭
# 후보로는 무의미하므로 건너뛴다.
_NON_PACKAGE_ARGS = frozenset({"-y", "--yes", "-q", "--quiet", "run", "exec", "--"})


def derive_alias(name: str, command: str, args: list[str] | None = None) -> str:
    """별칭 후보를 정한다 — 이름이 못 쓰게 되면 실행 명령에서 유도한다.

    `sanitize_alias()`는 허용 문자집합 밖을 전부 버리므로 이름이 통째로
    비ASCII면(예: 클로드 데스크탑 설정에 흔한 `"네이버 검색"`) 아무것도 안
    남아 `"server"`가 된다. 서버가 둘 이상이면 전부 `server`, `server-2`,
    `server-3`이 되어 목록에서 서로를 구분할 수 없다.

    그래서 이름이 통째로 날아간 경우에만 **실행 명령의 패키지 이름**으로
    물러난다 — `npx -y @isnow890/naver-search-mcp` -> `isnow890-naver-search-mcp`.
    이름이 조금이라도 살아남으면 사용자가 붙인 이름을 우선한다.
    """
    from_name = sanitize_alias(name)
    if from_name != _FALLBACK_ALIAS:
        return from_name
    for candidate in reversed(list(args or [])):
        if candidate.startswith("-") or candidate in _NON_PACKAGE_ARGS:
            continue
        derived = sanitize_alias(candidate)
        if derived != _FALLBACK_ALIAS:
            return derived
    derived = sanitize_alias(command)
    return derived


def unique_alias(candidate: str, taken: set[str]) -> str:
    """이미 쓰인 별칭이면 `-2`, `-3`... 을 붙여 피한다. 상한은 계속 지킨다."""
    if candidate not in taken:
        return candidate
    for n in range(2, 1000):
        suffix = f"-{n}"
        base = candidate[: MAX_ALIAS_LEN - len(suffix)]
        attempt = f"{base}{suffix}"
        if attempt not in taken:
            return attempt
    raise ValueError(f"별칭 {candidate!r}의 중복 회피 후보를 999개 안에서 못 찾았다")


@dataclass
class PendingRegistration:
    """등록됐고 승인 대기 중인 서버 하나.

    `original_name`과 `alias`를 둘 다 남긴다 — 정규화가 조용히 일어나지 않게
    호출자가 "스니펫에는 X라고 돼 있었고 별칭은 Y로 제안한다"를 보여줄 수 있다.
    """

    alias: str
    original_name: str
    entry: ServerEntry
    consent: ConsentRecord

    @property
    def alias_was_rewritten(self) -> bool:
        return self.alias != self.original_name

    @property
    def risk_warnings(self) -> list[str]:
        return self.consent.risk_warnings


def stage_registration(
    registry: ServerRegistry,
    consent_store: ConsentStore,
    *,
    original_name: str,
    command: str,
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    alias: str | None = None,
    source: str = "manual",
    notes: str | None = None,
) -> PendingRegistration:
    """등록 + 승인요청까지. **승인은 하지 않는다** — spawn은 여전히 금지 상태다.

    `alias`를 명시하면 그대로 쓰고(검증은 `registry.add()`가 한다), 안 주면
    `original_name`에서 정규화해 유도한다.
    """
    chosen = alias or unique_alias(
        derive_alias(original_name, command, list(args or [])),
        {e.alias for e in registry.list()},
    )
    entry = registry.add(
        alias=chosen,
        command=command,
        args=list(args or []),
        env=dict(env or {}),
        source=source,  # type: ignore[arg-type]
        notes=notes,
    )
    record = consent_store.request_consent(chosen, entry.command, list(entry.args), dict(entry.env))
    return PendingRegistration(
        alias=chosen, original_name=original_name, entry=entry, consent=record
    )


def stage_from_snippet(
    registry: ServerRegistry, consent_store: ConsentStore, raw: str
) -> list[PendingRegistration]:
    """클로드 데스크탑 스니펫 전체를 등록 대기 상태로 올린다.

    스니펫 하나에 서버가 여러 개 있어도 각각 별칭이 유도되고 각각 승인 요청이
    생긴다. 자동 승인은 없다 — `parse_claude_desktop_snippet()`의 계약 그대로다.
    """
    parsed: list[ParsedSnippetServer] = parse_claude_desktop_snippet(raw)
    taken = {e.alias for e in registry.list()}
    staged: list[PendingRegistration] = []
    for p in parsed:
        chosen = unique_alias(derive_alias(p.suggested_alias, p.command, p.args), taken)
        taken.add(chosen)
        staged.append(
            stage_registration(
                registry,
                consent_store,
                original_name=p.suggested_alias,
                command=p.command,
                args=p.args,
                env=p.env,
                alias=chosen,
                source="claude_desktop_snippet",
            )
        )
    return staged


@dataclass
class ProbeReport:
    """1회 연결로 알아낸 것 전부. 이식 판정의 근거가 되는 문서다."""

    alias: str
    ok: bool
    error: str | None = None
    protocol_version: str | None = None
    reported_name: str | None = None
    reported_version: str | None = None
    tools: list[dict[str, Any]] = field(default_factory=list)
    oversized_tools: list[str] = field(default_factory=list)
    mojibake_in_tool_metadata: bool = False
    active_probe_tool: str | None = None
    active_probe_mojibake: bool | None = None
    active_probe_error: str | None = None
    active_probe_structured_content: bool | None = None

    @property
    def tool_count(self) -> int:
        return len(self.tools)


async def probe_server(
    entry: ServerEntry,
    consent_store: ConsentStore,
    log_dir: Path,
    *,
    probe_tool: str | None = None,
    probe_arguments: dict[str, Any] | None = None,
    startup_timeout_seconds: float = 90.0,
    audit_log: AuditLog | None = None,
    force_unallowed_tool: bool = False,
) -> ProbeReport:
    """서버를 한 번만 띄워 "무엇을 주는 서버인지" 전부 확인하고 다시 내린다.

    승인된 서버만 뜬다(`client.start()`가 `require_server_approved()`를 부른다).
    실패해도 예외를 밖으로 던지지 않고 `ok=False`인 리포트로 돌려준다 — 여러
    서버를 훑을 때 하나가 죽어서 전체가 멈추면 안 되기 때문이다.

    `startup_timeout_seconds`가 기본 60초가 아니라 90초인 이유: probe는 보통
    **그 서버를 이 컴퓨터에서 처음 실행하는 순간**이라 `npx`/`uvx`가 패키지를
    내려받는 시간이 여기에만 얹힌다. 정상 서비스 중의 connect보다 넉넉해야 한다.
    """
    handle = UpstreamServerHandle(
        entry, consent_store, log_dir, startup_timeout_seconds=startup_timeout_seconds
    )
    report = ProbeReport(alias=entry.alias, ok=False)
    try:
        init_result = await handle.start()
        report.protocol_version = init_result.protocolVersion
        if init_result.serverInfo:
            report.reported_name = init_result.serverInfo.name
            report.reported_version = init_result.serverInfo.version

        tools = await handle.list_tools()
        metadata_blob_parts: list[str] = []
        for t in tools:
            report.tools.append(
                {
                    "name": t.name,
                    "description": t.description,
                    "qualified_name_len": len(entry.alias) + 2 + len(t.name),
                }
            )
            metadata_blob_parts.append(t.name)
            if t.description:
                metadata_blob_parts.append(t.description)
        report.oversized_tools = [
            t["name"] for t in report.tools if t["qualified_name_len"] > 64
        ]
        # 층 1 — 수동적 스캔. 호출 없음, 부작용 없음, 모든 서버에 적용 가능.
        report.mojibake_in_tool_metadata = quirks.contains_mojibake(
            "".join(metadata_blob_parts)
        )

        # 층 2 — 능동적 왕복. 사람이 지정한 툴만 부른다.
        if probe_tool:
            report.active_probe_tool = probe_tool
            # 이 호출은 upstream 툴을 **실제로 실행한다.** `dispatch_call()`과
            # 달리 게이트웨이를 우회하므로, 여기서 allowlist와 감사 로그를
            # 직접 걸지 않으면 consent.py가 세운 통제 두 개(§3 툴 allowlist,
            # §4 감사 로그)가 probe 경로에서만 조용히 무력화된다 — 서버 승인만
            # 받은 상태에서 부작용 있는 툴(주문/이체)을 아무 흔적 없이 부를 수
            # 있게 된다. 발견 단계라 allowlist가 아직 빌 수 있으므로 우회는
            # 허용하되 **명시적으로**(force) 하게 하고, 어느 쪽이든 감사에 남긴다.
            allowed = consent_store.is_tool_allowed(entry.alias, probe_tool)
            if not allowed and not force_unallowed_tool:
                report.active_probe_error = (
                    f"{probe_tool!r}은 allowlist에 없다. "
                    f"`athena-mcp allow {entry.alias} {probe_tool}`로 허용하거나, "
                    "정말 한 번만 시험 호출하려면 --force-tool을 붙여라 "
                    "(어느 쪽이든 감사 로그에 남는다)"
                )
                report.ok = True
                return report
            try:
                fixed = quirks.normalize_known_args(probe_tool, probe_arguments or {})
                raw = await handle.call_tool(probe_tool, fixed)
                parsed = parse_call_tool_result(raw)
                report.active_probe_structured_content = parsed.status == "structured"
                if parsed.status == "error":
                    report.active_probe_error = parsed.error_message
                # `structuredContent`만 있고 text 블록이 없는 서버가 있다
                # (`@drfirst` 계열). 그 경우 raw_text가 None이라 raw_text만 보면
                # 손상을 놓친다 — 실측된 손상은 양쪽 모두에 나타났다(§9-④).
                # 두 표면을 합쳐서 검사한다.
                surfaces = [parsed.raw_text or ""]
                if parsed.data is not None and parsed.status != "text":
                    surfaces.append(json.dumps(parsed.data, ensure_ascii=False, default=str))
                smoke = quirks.run_encoding_smoke_test(
                    probe_text=json.dumps(probe_arguments or {}, ensure_ascii=False),
                    response_text="".join(surfaces),
                )
                report.active_probe_mojibake = smoke.mojibake_detected
            except Exception as exc:  # 능동 probe 실패가 전체 probe를 죽이지 않는다
                report.active_probe_error = describe_exception(exc)
            finally:
                # 성공이든 실패든 남긴다. `dispatch_call()`과 같은 형식이되
                # `probe:` 접두사로 "게이트웨이 경유가 아닌 시험 호출"임을
                # 구분한다. 인자와 응답 본문은 여기서도 기록하지 않는다.
                if audit_log is not None:
                    audit_log.record(
                        entry.alias,
                        f"probe:{probe_tool}",
                        success=report.active_probe_error is None,
                    )
        report.ok = True
    except Exception as exc:
        report.error = describe_exception(exc)
    finally:
        try:
            await handle.close()
        except Exception:  # 정리 실패는 리포트 내용을 바꾸지 않는다
            pass
    return report


def apply_probe_findings(
    registry: ServerRegistry, report: ProbeReport
) -> None:
    """probe가 알아낸 것 중 **영속시켜야 하는 것**만 레지스트리에 반영한다.

    자가보고 정보(신뢰하지 않음, 기록만)와 인코딩 손상 경고 두 가지다.
    능동 probe를 돌렸으면 그 결과를 우선한다 — 실측(§9-④)에서 손상은 툴
    메타데이터가 아니라 응답 본문에 나타났으므로 응답 쪽이 더 강한 증거다.
    """
    if not report.ok:
        return
    registry.record_self_reported_info(
        report.alias,
        reported_name=report.reported_name,
        reported_version=report.reported_version,
        protocol_version=report.protocol_version,
    )
    detected = report.mojibake_in_tool_metadata
    if report.active_probe_mojibake is not None:
        detected = detected or report.active_probe_mojibake
    registry.record_encoding_smoke_test(report.alias, detected)

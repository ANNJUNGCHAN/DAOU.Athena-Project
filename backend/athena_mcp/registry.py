"""서버 레지스트리 — 사용자가 등록한 upstream MCP 서버의 `{command, args, env}` CRUD.

## 영속 위치 — 홈 디렉토리, 프로젝트 상대경로 아님 (택일 근거)

`~/.athena/mcp_servers.json` (기본값, `ATHENA_MCP_REGISTRY_PATH`로 재정의 가능).

이유:
1. 레지스트리는 "이 git 체크아웃"의 상태가 아니라 **이 컴퓨터를 쓰는 사용자**의 상태다.
   클로드 데스크탑이 `claude_desktop_config.json`을 프로젝트가 아니라 사용자 홈(OS별
   앱 설정 디렉토리)에 두는 것과 동일한 패턴 — 여러 프로젝트 작업 디렉토리를 오가도
   등록된 서버 목록이 유지돼야 한다.
2. `env`에는 실제 API 키(DART, NAVER 등)가 들어간다. 프로젝트 상대경로(예:
   `backend/athena_mcp/data/`)에 두면 `.gitignore` 실수 한 번으로 비밀값이 커밋될
   위험이 상시 존재한다. 홈 디렉토리는 애초에 git 추적 대상이 아니라 이 위험이
   구조적으로 없다. (공통 규칙 4: 비밀값 하드코딩·커밋 금지)

## 네임스페이스 키는 별칭(alias)이지 `serverInfo.name`이 아니다

W0 S2 실측(`plan/mcp-실행계획.md` §8): `pykrx-mcp` · `@drfirst/korea-stock-mcp` ·
`jjlabsio` 세 서버가 전부 `serverInfo.name`을 `korea-stock-mcp`류로 보고했다.
`serverInfo.name`을 키로 쓰면 서로 다른 서버가 충돌한다. 그래서 등록 시 **사용자가
직접 부여하는 별칭**만 네임스페이스 키로 쓴다 — upstream이 뭐라고 자칭하든 무관하다.

## 별칭 길이 상한 — 64자 규칙의 역산

MCP 툴 이름 길이 상한은 64자(`^[A-Za-z0-9_-]{1,64}$`)이고, aggregator가 노출하는
합성 이름은 `별칭__툴명`이다. 별칭 자체가 너무 길면 어떤 툴 이름과 합쳐도 64자를
넘는다 — W0 S2 실측이 92자 위반을 실제로 재현했다
(`user-registered-very-long-server-name-for-korean-market-data__get_market_fundamental_by_date`,
`spike/mcp-client/RESULT.md` L67).

실측 캡처 전량(`spike/captures/*tools*.json`, 서버 7개·툴 76개 전수조사)에서
관측된 가장 긴 실제 툴 이름은 `naver-search-mcp`의
`datalab_shopping_keyword_by_device` = 34자다. 이 값을 예약 폭으로 삼아 별칭
상한을 역산한다:

    MAX_ALIAS_LEN = 64 - len("__") - OBSERVED_MAX_TOOL_NAME_LEN
                  = 64 - 2 - 34 = 28

이건 등록 시점의 **1차 방어선**이다(아직 upstream에 연결하지 않은 상태라 실제 툴
이름 길이를 모르므로 관측치 기반 추정만 가능하다). 34자보다 긴 툴 이름을 가진
서버가 나타날 가능성은 배제할 수 없으므로, `aggregator.py`가 **실제 툴 이름을
받은 뒤 진짜 64자 규칙으로 2차 방어**한다(조용히 자르지 않고 그 툴만 스킵 +
사유를 기록). 두 층 모두 필요하다 — 여기서는 등록 UX를 위한 근사치일 뿐이다.

## `serverInfo.version`을 믿지 마라

W0 S2 실측: `pykrx-mcp`는 자기 버전이 아니라 mcp SDK 버전(1.28.1)을 보고했고,
`@drfirst/korea-stock-mcp`는 npm 최신 버전과 실행 중 보고 버전이 달랐다.
그래서 이 모듈은 연결 후 관측된 `serverInfo`를 `self_reported_server_info`라는
필드명으로만 저장한다 — "서버가 스스로 이렇게 주장했다"는 사실 그 이상을
의미하지 않는다는 걸 필드명 자체가 말하게 한다.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

ALIAS_CHARSET_RE = re.compile(r"^[A-Za-z0-9_-]+$")
QUALIFIED_NAME_SEPARATOR = "__"
MAX_QUALIFIED_NAME_LEN = 64
# 실측 근거는 모듈 docstring 참조. spike/captures/*tools*.json 전수조사로 확정.
OBSERVED_MAX_TOOL_NAME_LEN = 34
MAX_ALIAS_LEN = MAX_QUALIFIED_NAME_LEN - len(QUALIFIED_NAME_SEPARATOR) - OBSERVED_MAX_TOOL_NAME_LEN

SourceKind = Literal["manual", "claude_desktop_snippet"]


class AliasValidationError(ValueError):
    """별칭이 문자집합/길이 규칙을 위반했다."""


class DuplicateAliasError(ValueError):
    """이미 등록된 별칭이다."""


class InvalidServerSpecError(ValueError):
    """`command`/`args`/`env`가 문자열이 아니다.

    stdio spawn은 전부 문자열을 요구한다(`StdioServerParameters`가 pydantic으로
    강제). 그런데 클로드 데스크탑 스니펫은 사람이 손으로 쓴 JSON이라
    `{"env": {"DEBUG": true}}`처럼 문자열 아닌 값이 섞여 들어온다 — JSON에서는
    자연스러운 표기지만 환경변수로는 성립하지 않는다.

    이걸 등록 시점에 안 막으면 spawn 시점까지 살아남아서, 훨씬 나쁜 자리에서
    터진다. 여기서 이유를 붙여 거부한다.
    """


def validate_server_spec(command: str, args: list[str], env: dict[str, str]) -> None:
    """spawn 가능한 형태인지 등록 시점에 확인한다."""
    if not isinstance(command, str) or not command.strip():
        raise InvalidServerSpecError(f"command는 비어 있지 않은 문자열이어야 한다: {command!r}")
    for i, a in enumerate(args):
        if not isinstance(a, str):
            raise InvalidServerSpecError(
                f"args[{i}]가 문자열이 아니다: {a!r} ({type(a).__name__}). "
                "JSON에서 따옴표를 빠뜨렸는지 확인하라."
            )
    for k, v in env.items():
        if not isinstance(k, str):
            raise InvalidServerSpecError(f"환경변수 키가 문자열이 아니다: {k!r}")
        if not isinstance(v, str):
            raise InvalidServerSpecError(
                f"환경변수 {k!r}의 값이 문자열이 아니다 ({type(v).__name__}). "
                "환경변수는 전부 문자열이어야 한다 — JSON에서 따옴표를 빠뜨렸는지 "
                f'확인하라 (예: {{"{k}": "true"}}). 값 자체는 여기 표시하지 않는다.'
            )


class UnknownAliasError(KeyError):
    """등록되지 않은 별칭을 조회/삭제하려 했다."""


def validate_alias(alias: str) -> None:
    """`^[A-Za-z0-9_-]{1,MAX_ALIAS_LEN}$` 를 강제한다. 위반 시 이유를 담아 raise한다."""
    if not alias:
        raise AliasValidationError("별칭은 비어 있을 수 없다")
    if len(alias) > MAX_ALIAS_LEN:
        raise AliasValidationError(
            f"별칭이 {len(alias)}자다 — 상한 {MAX_ALIAS_LEN}자를 넘는다. "
            f"({MAX_QUALIFIED_NAME_LEN}자 툴 이름 규칙 - '__' 2자 - 관측된 최장 "
            f"툴 이름 {OBSERVED_MAX_TOOL_NAME_LEN}자로 역산된 상한이다.)"
        )
    if not ALIAS_CHARSET_RE.match(alias):
        raise AliasValidationError(
            f"별칭 {alias!r}은 [A-Za-z0-9_-]만 허용한다"
        )


@dataclass
class SelfReportedServerInfo:
    """upstream이 스스로 보고한 정보. **신뢰하지 말고 그대로 표시만 한다.**

    실측(§8): `serverInfo.version`이 실제 패키지 버전과 다른 사례가 확인됐다.
    """

    reported_name: str | None
    reported_version: str | None
    protocol_version: str | None
    observed_at: str  # ISO8601, UTC


@dataclass
class ServerEntry:
    alias: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    source: SourceKind = "manual"
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    self_reported_server_info: SelfReportedServerInfo | None = None
    encoding_smoke_test_warning: bool = False
    notes: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ServerEntry:
        info = d.get("self_reported_server_info")
        entry = cls(
            alias=d["alias"],
            command=d["command"],
            args=list(d.get("args", [])),
            env=dict(d.get("env", {})),
            source=d.get("source", "manual"),
            created_at=d.get("created_at", datetime.now(UTC).isoformat()),
            self_reported_server_info=SelfReportedServerInfo(**info) if info else None,
            encoding_smoke_test_warning=bool(d.get("encoding_smoke_test_warning", False)),
            notes=d.get("notes"),
        )
        return entry

    def full_command_text(self) -> str:
        """등록 승인 화면(consent.py)에 자르지 않고 노출할 실행 명령 전문."""
        parts = [self.command, *self.args]
        return " ".join(parts)


def default_registry_path() -> Path:
    override = os.environ.get("ATHENA_MCP_REGISTRY_PATH")
    if override:
        return Path(override)
    return Path.home() / ".athena" / "mcp_servers.json"


class ServerRegistry:
    """`{alias: ServerEntry}` CRUD + JSON 영속."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_registry_path()
        self._entries: dict[str, ServerEntry] = {}
        if self.path.exists():
            self._load()

    # -- 영속 --------------------------------------------------------------

    def _load(self) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self._entries = {
            alias: ServerEntry.from_dict(d) for alias, d in raw.get("servers", {}).items()
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"servers": {alias: e.to_dict() for alias, e in self._entries.items()}}
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    # -- CRUD ----------------------------------------------------------------

    def add(
        self,
        alias: str,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        source: SourceKind = "manual",
        notes: str | None = None,
    ) -> ServerEntry:
        validate_alias(alias)
        if alias in self._entries:
            raise DuplicateAliasError(f"별칭 {alias!r}은 이미 등록돼 있다")
        validate_server_spec(command, list(args or []), dict(env or {}))
        entry = ServerEntry(
            alias=alias,
            command=command,
            args=list(args or []),
            env=dict(env or {}),
            source=source,
            notes=notes,
        )
        self._entries[alias] = entry
        self.save()
        return entry

    def get(self, alias: str) -> ServerEntry:
        try:
            return self._entries[alias]
        except KeyError:
            raise UnknownAliasError(alias) from None

    def remove(self, alias: str) -> None:
        if alias not in self._entries:
            raise UnknownAliasError(alias)
        del self._entries[alias]
        self.save()

    def list(self) -> list[ServerEntry]:
        return list(self._entries.values())

    def record_self_reported_info(
        self,
        alias: str,
        reported_name: str | None,
        reported_version: str | None,
        protocol_version: str | None,
    ) -> None:
        entry = self.get(alias)
        entry.self_reported_server_info = SelfReportedServerInfo(
            reported_name=reported_name,
            reported_version=reported_version,
            protocol_version=protocol_version,
            observed_at=datetime.now(UTC).isoformat(),
        )
        self.save()

    def record_encoding_smoke_test(self, alias: str, mojibake_detected: bool) -> None:
        entry = self.get(alias)
        entry.encoding_smoke_test_warning = mojibake_detected
        self.save()

    def rename(self, old_alias: str, new_alias: str) -> ServerEntry:
        """별칭 이름을 바꾼다. 등록 정보만 옮긴다 — in-flight 호출 안전성은
        aggregator.py의 리졸루션 테이블이 별도로 보장한다(등록소 rename과
        무관하게 옛 qualified name 매핑을 유지)."""
        if old_alias not in self._entries:
            raise UnknownAliasError(old_alias)
        validate_alias(new_alias)
        if new_alias in self._entries:
            raise DuplicateAliasError(f"별칭 {new_alias!r}은 이미 등록돼 있다")
        entry = self._entries.pop(old_alias)
        entry.alias = new_alias
        self._entries[new_alias] = entry
        self.save()
        return entry


# ---------------------------------------------------------------------------
# 클로드 데스크탑 스니펫 파서 — §2가 요구하는 1급 입력 경로
# ---------------------------------------------------------------------------


@dataclass
class ParsedSnippetServer:
    """스니펫에서 뽑아낸 등록 후보. 아직 registry에 add()되지 않은 상태 —
    호출자가 별칭을 부여하고 명시 승인한 뒤 add()해야 한다(consent.py 참고)."""

    suggested_alias: str
    command: str
    args: list[str]
    env: dict[str, str]


class SnippetParseError(ValueError):
    pass


def parse_claude_desktop_snippet(raw: str) -> list[ParsedSnippetServer]:
    """`{"mcpServers": {"이름": {"command":...,"args":[...],"env":{...}}}}` 를
    그대로 받아 등록 후보 리스트로 변환한다.

    스니펫의 서버 이름을 `suggested_alias`로 제안하되 **그대로 신뢰해 별칭으로
    쓰지 않는다** — 길이/문자집합 위반 가능성이 있으므로 호출자가 `add()` 시
    최종 확정한다(자동 승인 아님, consent.py가 승인 게이트를 담당).
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SnippetParseError(f"스니펫이 유효한 JSON이 아니다: {exc}") from exc

    if not isinstance(data, dict) or "mcpServers" not in data:
        raise SnippetParseError('스니펫에 최상위 "mcpServers" 키가 없다')

    servers = data["mcpServers"]
    if not isinstance(servers, dict) or not servers:
        raise SnippetParseError('"mcpServers"가 비어 있거나 객체가 아니다')

    results: list[ParsedSnippetServer] = []
    for name, cfg in servers.items():
        if not isinstance(cfg, dict) or "command" not in cfg:
            raise SnippetParseError(f'서버 {name!r} 항목에 "command"가 없다')
        results.append(
            ParsedSnippetServer(
                suggested_alias=name,
                command=cfg["command"],
                args=list(cfg.get("args", [])),
                env=dict(cfg.get("env", {})),
            )
        )
    return results

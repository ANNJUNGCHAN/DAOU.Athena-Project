
from __future__ import annotations

import hashlib
import json
import os
import re
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from .atomic_json_state import atomic_write_json, exclusive_state_lock

ALIAS_CHARSET_RE = re.compile(r"^[A-Za-z0-9_-]+$")
QUALIFIED_NAME_SEPARATOR = "__"
MAX_QUALIFIED_NAME_LEN = 64
OBSERVED_MAX_TOOL_NAME_LEN = 34

SECRET_SENTINEL = "__ATHENA_SAFESTORAGE__"
MAX_ALIAS_LEN = MAX_QUALIFIED_NAME_LEN - len(QUALIFIED_NAME_SEPARATOR) - OBSERVED_MAX_TOOL_NAME_LEN

SourceKind = Literal["manual", "claude_desktop_snippet"]


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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


class MissingSecretEnvError(RuntimeError):
    pass


def resolve_secret_env(alias: str, env: dict[str, str]) -> dict[str, str]:
    """센티널 값을 `ATHENA_MCP_ENV__{alias}__{key}` 환경변수의 실값으로 치환한다.

    센티널이 아닌 값(마이그레이션 전이거나 `athena-mcp register --env`로 방금
    수동 등록한 경우)은 그대로 통과시킨다 — 이 함수는 "센티널만 골라 푼다"이지
    "모든 env를 재해석한다"가 아니다. 원본 dict는 건드리지 않고 새 dict를 돌려준다.
    """
    resolved: dict[str, str] = {}
    for key, value in env.items():
        if value != SECRET_SENTINEL:
            resolved[key] = value
            continue
        var_name = f"ATHENA_MCP_ENV__{alias}__{key}"
        real = os.environ.get(var_name)
        if real is None:
            raise MissingSecretEnvError(
                f"{alias!r}의 env {key!r}가 센티널이지만 환경변수 {var_name!r}가 "
                "이 프로세스에 없다 — 앱이 주입해야 할 복호화 값이 도달하지 않았다. "
                "앱(Electron)을 거치지 않고 이 서버를 직접 spawn할 수는 없다."
            )
        resolved[key] = real
    return resolved


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


@dataclass(frozen=True)
class RegistrySnapshot:
    revision: int
    fingerprint: str
    servers: tuple[dict[str, Any], ...]


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
        self._revision = 0
        self._fingerprint = _canonical_hash({})
        if self.path.exists():
            self._load()

    # -- 영속 --------------------------------------------------------------

    def _load(self) -> None:
        entries, revision, fingerprint = self._read_disk_state()
        self._entries = entries
        self._revision = revision
        self._fingerprint = fingerprint

    def _read_disk_state(self) -> tuple[dict[str, ServerEntry], int, str]:
        if not self.path.exists():
            return {}, 0, _canonical_hash({})
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        servers = raw.get("servers", {})
        entries = {alias: ServerEntry.from_dict(d) for alias, d in servers.items()}
        canonical = {alias: entry.to_dict() for alias, entry in entries.items()}
        fingerprint = _canonical_hash(canonical)
        stored = raw.get("fingerprint")
        if stored is not None and stored != fingerprint:
            raise ValueError("registry fingerprint mismatch")
        return entries, int(raw.get("revision", 0)), fingerprint

    def _payload(self, entries: dict[str, ServerEntry], revision: int) -> dict[str, Any]:
        servers = {alias: entry.to_dict() for alias, entry in entries.items()}
        return {
            "revision": revision,
            "fingerprint": _canonical_hash(servers),
            "servers": servers,
        }

    def _mutate(self, mutation):
        lock_path = self.path.with_name(f".{self.path.name}.lock")
        with exclusive_state_lock(lock_path):
            entries, revision, _ = self._read_disk_state()
            working = deepcopy(entries)
            result = mutation(working)
            next_revision = revision + 1
            payload = self._payload(working, next_revision)
            atomic_write_json(self.path, payload)
            self._entries = working
            self._revision = next_revision
            self._fingerprint = payload["fingerprint"]
            return result

    def save(self) -> None:
        desired = deepcopy(self._entries)
        self._mutate(lambda entries: (entries.clear(), entries.update(desired)))

    @property
    def revision(self) -> int:
        return self._revision

    @property
    def fingerprint(self) -> str:
        return self._fingerprint

    def reload(self) -> RegistrySnapshot:
        lock_path = self.path.with_name(f".{self.path.name}.lock")
        with exclusive_state_lock(lock_path):
            self._load()
        return self.snapshot()

    def snapshot(self) -> RegistrySnapshot:
        servers: list[dict[str, Any]] = []
        for alias in sorted(self._entries):
            entry = self._entries[alias]
            data = entry.to_dict()
            data["env"] = {
                key: SECRET_SENTINEL if value == SECRET_SENTINEL else "__ATHENA_REDACTED__"
                for key, value in sorted(entry.env.items())
            }
            servers.append(data)
        return RegistrySnapshot(
            revision=self._revision,
            fingerprint=self._fingerprint,
            servers=tuple(deepcopy(servers)),
        )

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
        validate_server_spec(command, list(args or []), dict(env or {}))
        def mutation(entries: dict[str, ServerEntry]) -> ServerEntry:
            if alias in entries:
                raise DuplicateAliasError(f"별칭 {alias!r}은 이미 등록돼 있다")
            entry = ServerEntry(
                alias=alias,
                command=command,
                args=list(args or []),
                env=dict(env or {}),
                source=source,
                notes=notes,
            )
            entries[alias] = entry
            return entry
        return self._mutate(mutation)

    def get(self, alias: str) -> ServerEntry:
        try:
            return self._entries[alias]
        except KeyError:
            raise UnknownAliasError(alias) from None

    def remove(self, alias: str) -> None:
        def mutation(entries: dict[str, ServerEntry]) -> None:
            if alias not in entries:
                raise UnknownAliasError(alias)
            del entries[alias]
        self._mutate(mutation)

    def list(self) -> list[ServerEntry]:
        return list(self._entries.values())

    def record_self_reported_info(
        self,
        alias: str,
        reported_name: str | None,
        reported_version: str | None,
        protocol_version: str | None,
    ) -> None:
        def mutation(entries: dict[str, ServerEntry]) -> None:
            if alias not in entries:
                raise UnknownAliasError(alias)
            entries[alias].self_reported_server_info = SelfReportedServerInfo(
                reported_name=reported_name,
                reported_version=reported_version,
                protocol_version=protocol_version,
                observed_at=datetime.now(UTC).isoformat(),
            )
        self._mutate(mutation)

    def record_encoding_smoke_test(self, alias: str, mojibake_detected: bool) -> None:
        def mutation(entries: dict[str, ServerEntry]) -> None:
            if alias not in entries:
                raise UnknownAliasError(alias)
            entries[alias].encoding_smoke_test_warning = mojibake_detected
        self._mutate(mutation)

    def set_env_sentinel(self, alias: str, key: str) -> None:
        """`env[key]`를 `SECRET_SENTINEL`로 치환한다 — 마이그레이션 전용 연산.

        실값을 인자로 받지 않는다: 호출자(앱)가 이미 그 값을 Electron
        `safeStorage`에 옮겨놨다는 게 전제다. 이 메서드는 "레지스트리에서
        평문을 지운다"만 한다 — 값 자체를 여기서 다루지 않으므로 이 프로세스가
        평문을 아는 순간이 아예 없다.
        """
        def mutation(entries: dict[str, ServerEntry]) -> None:
            if alias not in entries:
                raise UnknownAliasError(alias)
            entry = entries[alias]
            if key not in entry.env:
                raise KeyError(f"{alias!r}에 env 키 {key!r}가 없다")
            entry.env[key] = SECRET_SENTINEL
        self._mutate(mutation)

    def rename(self, old_alias: str, new_alias: str) -> ServerEntry:
        """별칭 이름을 바꾼다. 등록 정보만 옮긴다 — in-flight 호출 안전성은
        aggregator.py의 리졸루션 테이블이 별도로 보장한다(등록소 rename과
        무관하게 옛 qualified name 매핑을 유지)."""
        validate_alias(new_alias)
        def mutation(entries: dict[str, ServerEntry]) -> ServerEntry:
            if old_alias not in entries:
                raise UnknownAliasError(old_alias)
            if new_alias in entries:
                raise DuplicateAliasError(f"별칭 {new_alias!r}은 이미 등록돼 있다")
            entry = entries.pop(old_alias)
            entry.alias = new_alias
            entries[new_alias] = entry
            return entry
        return self._mutate(mutation)


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

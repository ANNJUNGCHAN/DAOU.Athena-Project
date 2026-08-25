
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# 위험 패턴 경고
# ---------------------------------------------------------------------------

_RM_RF_RE = re.compile(r"\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bdel\s+/s\b", re.IGNORECASE)
_HOME_SSH_RE = re.compile(r"\.ssh\b|~[/\\]|\$HOME\b|%USERPROFILE%", re.IGNORECASE)
_NETWORK_RE = re.compile(r"\bcurl\b|\bwget\b|\bnc\b|\bnetcat\b|Invoke-WebRequest", re.IGNORECASE)

_RISK_PATTERNS: dict[str, re.Pattern[str]] = {
    "sudo/관리자 권한": re.compile(r"\bsudo\b|\brunas\b", re.IGNORECASE),
    "rm -rf / 재귀삭제": _RM_RF_RE,
    "홈 디렉토리/SSH 키 접근": _HOME_SSH_RE,
    "시스템 경로 접근": re.compile(r"/etc/|C:\\Windows|/System/", re.IGNORECASE),
    "네트워크 명령": _NETWORK_RE,
}

# env 값이 아니라 env **키 이름 자체**가 코드 실행 경로인 환경변수들.
# `command`/`args` 전문에는 전혀 나타나지 않으면서 실행 중인 인터프리터가
# 암묵적으로 읽어 임의 코드를 로드하게 만들 수 있다 — 예를 들어
# `command="node"`만 봐서는 무해해 보이지만 `env={"NODE_OPTIONS":
# "--require /tmp/evil.js"}`가 같이 등록되면 spawn 시점에 그 파일이 그대로
# require된다. env 값은 여전히 스캔하지 않는다(비밀값 노출 회피) — 여기서는
# 키 이름만 알려진 위험 변수 목록과 대조한다.
_DANGEROUS_ENV_KEYS = frozenset(
    {
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "NODE_OPTIONS",
        "PYTHONSTARTUP",
        "PYTHONPATH",
        "BASH_ENV",
        "ENV",
        "PERL5OPT",
        "PERL5LIB",
        "RUBYOPT",
        "GIT_SSH_COMMAND",
        "PATH",
    }
)


def scan_risk_patterns(command: str, args: list[str], env: dict[str, str]) -> list[str]:
    """실행 명령 전문(command+args) + env **키 이름**을 스캔해 매치된 위험
    패턴 이름을 반환한다.

    env **값**은 스캔하지 않는다 — API 키 같은 비밀값이 위험 패턴과 우연히
    매치되어 로그/UI에 노출되는 걸 피한다. env 키는 두 가지로 검사한다:
    1) `_RISK_PATTERNS`와의 문자열 매치(기존)
    2) 알려진 위험 환경변수 이름(`_DANGEROUS_ENV_KEYS`)과의 정확 매치(신규) —
       `command`/`args` 전문만 봐서는 절대 드러나지 않는, env 값 경유
       코드실행 우회 경로를 잡는다.
    """
    haystack = " ".join([command, *args, *env.keys()])
    warnings = [label for label, pattern in _RISK_PATTERNS.items() if pattern.search(haystack)]
    dangerous_keys = sorted(
        k for k in env if k.upper() in _DANGEROUS_ENV_KEYS
    )
    if dangerous_keys:
        warnings.append(
            "위험한 환경변수 키 사용 (" + ", ".join(dangerous_keys) + ") — "
            "값은 표시하지 않지만 인터프리터가 암묵적으로 로드하는 코드 경로일 수 있다"
        )
    return warnings


# ---------------------------------------------------------------------------
# 승인 상태
# ---------------------------------------------------------------------------


@dataclass
class ConsentRecord:
    alias: str
    full_command_text: str
    risk_warnings: list[str]
    approved: bool
    approved_at: str | None
    approved_tools: set[str] = field(default_factory=set)

    def to_dict(self) -> dict:
        return {
            "alias": self.alias,
            "full_command_text": self.full_command_text,
            "risk_warnings": self.risk_warnings,
            "approved": self.approved,
            "approved_at": self.approved_at,
            "approved_tools": sorted(self.approved_tools),
        }

    @classmethod
    def from_dict(cls, d: dict) -> ConsentRecord:
        return cls(
            alias=d["alias"],
            full_command_text=d["full_command_text"],
            risk_warnings=list(d.get("risk_warnings", [])),
            approved=bool(d.get("approved", False)),
            approved_at=d.get("approved_at"),
            approved_tools=set(d.get("approved_tools", [])),
        )


class ConsentNotGrantedError(PermissionError):
    """서버가 아직 승인되지 않았다 — spawn 금지."""


class ConsentStore:
    """서버별 승인 상태 + 툴별 allowlist. JSON 영속(레지스트리와 분리 —
    "등록"과 "승인"은 서로 다른 이벤트이고, 등록 파서(claude 데스크탑 스니펫)가
    자동으로 승인까지 겸하면 §5가 막으려는 구멍이 그대로 재현된다).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._records: dict[str, ConsentRecord] = {}
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self._records = {alias: ConsentRecord.from_dict(d) for alias, d in raw.items()}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {alias: r.to_dict() for alias, r in self._records.items()}
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def request_consent(
        self, alias: str, command: str, args: list[str], env: dict[str, str]
    ) -> ConsentRecord:
        """등록 화면에 노출할 승인 대상을 만든다. **아직 승인되지 않은 상태**로
        생성한다 — 이 함수 호출만으로는 spawn이 허용되지 않는다."""
        full_text = " ".join([command, *args])
        record = ConsentRecord(
            alias=alias,
            full_command_text=full_text,
            risk_warnings=scan_risk_patterns(command, args, env),
            approved=False,
            approved_at=None,
        )
        self._records[alias] = record
        self.save()
        return record

    def approve(self, alias: str, approved_tools: set[str] | None = None) -> ConsentRecord:
        """사용자의 명시 승인. `approved_tools`가 None이면 "서버 시작"만 승인하고
        툴 allowlist는 비워둔다(별도로 `allow_tool()`을 호출해야 aggregator가
        노출한다) — "서버 등록 = 모든 툴 자동 허용"을 피한다."""
        if alias not in self._records:
            raise KeyError(f"승인 요청이 먼저 필요하다: {alias!r}")
        record = self._records[alias]
        record.approved = True
        record.approved_at = datetime.now(UTC).isoformat()
        if approved_tools is not None:
            record.approved_tools |= set(approved_tools)
        self.save()
        return record

    def revoke(self, alias: str) -> None:
        if alias not in self._records:
            raise KeyError(alias)
        record = self._records[alias]
        record.approved = False
        record.approved_at = None
        record.approved_tools = set()
        self.save()

    def allow_tool(self, alias: str, tool_name: str) -> None:
        record = self._records.get(alias)
        if record is None or not record.approved:
            raise ConsentNotGrantedError(f"{alias!r} 서버가 아직 승인되지 않았다")
        record.approved_tools.add(tool_name)
        self.save()

    def disallow_tool(self, alias: str, tool_name: str) -> None:
        """`allow_tool()`의 역연산 — 툴별 allowlist에서 하나를 뺀다.

        `allow_tool()`은 "서버가 아직 승인 안 됐다"를 이유로 막지만
        (`ConsentNotGrantedError`), 이 함수는 **그 확인을 하지 않는다** —
        일부러다. 권한을 부여하는 쪽은 전제조건이 있어야 안전하지만, 권한을
        회수하는 쪽은 반대다: 서버가 미승인이든, 그 툴을 애초에 allow한 적이
        없든, 이 호출이 끝나면 "이 툴은 허용 안 됨"이라는 목표 상태는 이미
        달성돼 있다. 그래서 두 경우 다 예외 없이 조용히 성공한다
        (`set.discard()`와 같은 멱등 연산) — 없는 걸 지우라는 요청을 에러로
        만들면 "혹시 몰라 한 번 더 disallow" 같은 방어적 호출이 쓸데없이
        실패한다. `조용히 자르지 않는다` 원칙과는 충돌하지 않는다 — 결과를
        숨기거나 왜곡하는 게 아니라 이미 도달한 상태를 정확히 보고할 뿐이다.
        """
        record = self._records.get(alias)
        if record is None:
            return
        record.approved_tools.discard(tool_name)
        self.save()

    def is_server_approved(self, alias: str) -> bool:
        record = self._records.get(alias)
        return bool(record and record.approved)

    def is_tool_allowed(self, alias: str, tool_name: str) -> bool:
        record = self._records.get(alias)
        return bool(record and record.approved and tool_name in record.approved_tools)

    def require_server_approved(self, alias: str) -> None:
        """`client.py`가 spawn 직전에 호출한다 — 승인 없이는 프로세스를 못 띄운다."""
        if not self.is_server_approved(alias):
            raise ConsentNotGrantedError(
                f"{alias!r} 서버는 아직 승인되지 않았다 — 명령 실행(spawn) 자체가 금지된다"
            )

    def rename(self, old_alias: str, new_alias: str) -> None:
        """승인 기록을 새 별칭으로 옮긴다.

        승인 기록은 별칭을 키로 쓰므로, 레지스트리만 rename하고 여기를 안 옮기면
        **이미 승인한 서버가 조용히 미승인 상태로 되돌아간다**(다음 spawn이
        `ConsentNotGrantedError`로 막힌다). 승인은 "이 명령을 실행해도 좋다"는
        판단이지 "이 이름을 신뢰한다"가 아니므로, 명령이 그대로인 rename에서
        승인은 따라가는 게 맞다. 기록이 없으면 조용히 아무것도 하지 않는다
        (등록만 하고 승인 요청 전인 서버의 rename은 정상 흐름이다).
        """
        record = self._records.pop(old_alias, None)
        if record is None:
            return
        record.alias = new_alias
        self._records[new_alias] = record
        self.save()

    def get(self, alias: str) -> ConsentRecord | None:
        return self._records.get(alias)


# ---------------------------------------------------------------------------
# 감사 로그 — 호출 시각·툴명·성공여부만. 인자/응답 본문 금지.
# ---------------------------------------------------------------------------


class AuditLog:
    """서버별 감사 로그. append-only JSON Lines.

    **인자와 응답 본문은 절대 로그에 남기지 않는다** — 계좌 정보 등 민감
    데이터가 흐를 수 있어서다(공통 규칙 4, W1-5 요구사항). 로그에는 시각·별칭·
    툴명·성공여부만 남는다.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, alias: str, tool_name: str, success: bool) -> None:
        entry = {
            "ts": datetime.now(UTC).isoformat(),
            "alias": alias,
            "tool": tool_name,
            "success": success,
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def read_all(self) -> list[dict]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]

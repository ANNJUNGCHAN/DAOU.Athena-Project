
from __future__ import annotations

from dataclasses import dataclass

CORP_CODE_TARGET_LEN = 8

# 실측: chrisryugj/korean-dart-mcp 기본값 100_000자가 636,059자 사업보고서의
# 84%를 자른다. 최대 관측치보다 넉넉히 여유를 둔 기본 제안값.
KOREAN_DART_MCP_MIN_TRUNCATE_AT = 700_000
KOREAN_DART_MCP_DEFAULT_TRUNCATE_AT = 100_000

MOJIBAKE_CHAR = "�"  # U+FFFD REPLACEMENT CHARACTER


def normalize_corp_code(value: object) -> str:
    """`corp_code`를 8자리 문자열로 정규화한다.

    실측: 서버가 정수(126380)로 준다 -> 문자열화 후 왼쪽을 0으로 채운다
    ("00126380"). 이미 8자리 문자열이면 그대로 통과한다.
    """
    s = str(value).strip()
    if not s.isdigit():
        raise ValueError(f"corp_code가 숫자로 구성돼 있지 않다: {value!r}")
    return s.zfill(CORP_CODE_TARGET_LEN)


def contains_mojibake(text: str | None) -> bool:
    """U+FFFD 치환 문자가 섞여 있으면 인코딩 손상으로 간주한다."""
    if not text:
        return False
    return MOJIBAKE_CHAR in text


@dataclass(frozen=True)
class EncodingSmokeTestResult:
    probe_text: str
    response_text: str
    mojibake_detected: bool


def run_encoding_smoke_test(probe_text: str, response_text: str) -> EncodingSmokeTestResult:
    """등록 시 한글 왕복 스모크 테스트. 응답에 U+FFFD가 섞이면 경고 대상.

    `probe_text` 자체에는 (우리가 보낸 값이므로) U+FFFD가 없다고 가정한다 —
    있다면 우리 쪽 버그이지 서버 문제가 아니므로 별개로 다뤄야 한다.
    """
    return EncodingSmokeTestResult(
        probe_text=probe_text,
        response_text=response_text,
        mojibake_detected=contains_mojibake(response_text),
    )


def suggested_truncate_at(server_package_hint: str, requested: int | None) -> int:
    """`korean-dart-mcp`류로 알려진 서버에는 더 큰 기본값을 제안한다.

    `server_package_hint`는 등록 시 사용자가 입력한 command/args 문자열
    (예: "npx -y korean-dart-mcp") 중 일부와의 부분 문자열 매칭으로 판정한다 —
    정확한 패키지 메타데이터가 없으므로 휴리스틱이다.
    """
    if requested is not None:
        return requested
    if "korean-dart-mcp" in server_package_hint:
        return KOREAN_DART_MCP_MIN_TRUNCATE_AT
    return KOREAN_DART_MCP_DEFAULT_TRUNCATE_AT


# 인자 이름 기반 corp_code 자동 정규화 — aggregator/client가 upstream 호출 직전에
# 적용한다. 실측된 필드명만 등록한다(추측 금지).
CORP_CODE_ARG_NAMES = frozenset({"corp_code"})


def normalize_known_args(tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
    """알려진 결함 필드를 인자 딕셔너리에서 자동 보정한다.

    `tool_name`은 현재 로직에서 쓰이지 않지만(모든 corp_code류 필드에 공통
    적용) 향후 툴별 예외가 생길 때를 대비해 시그니처에 남겨둔다.
    """
    del tool_name
    fixed = dict(arguments)
    for key in CORP_CODE_ARG_NAMES:
        if key in fixed and fixed[key] is not None:
            fixed[key] = normalize_corp_code(fixed[key])
    return fixed

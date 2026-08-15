"""서버별 알려진 결함 보정 — W0/W0.9 실측으로 확정된 것만 넣는다. 추측 금지.

## 1. `corp_code` 정규화

DART 계열 서버가 `corp_code`를 **숫자**로 반환한다(선행 0 소실). 실측
(`spike/captures/S2B-jjlabsio-corp-code.json`): `get_corp_code("삼성전자")` ->
`{"corp_code": 126380, ...}` — 원래 값은 `"00126380"`(8자리 문자열)인데 126380으로
온다. 그런데 하위 호출(`search_disclosure` 등)은 `minLength:8` 문자열을 요구한다.
정규화 없이 넘기면 `MCP error -32602: Expected string, received number`로 즉시
실패한다(`plan/mcp-실행계획.md` §9-③).

## 2. 인코딩 스모크 테스트

`@drfirst/korea-stock-mcp`가 서버->클라이언트 방향으로 한글을 비가역 손상시킨다.
실측(`spike/captures/S2-drfirst-response.json`): 같은 응답 안에서 `name` 필드가
`"�궪�꽦�쟾�옄"`(U+FFFD 혼입)로 오는 호출과 `"삼성전자"`(정상)로 오는 호출이
공존한다 — 툴에 따라 갈린다. 손상 방향은 서버->클라이언트만이고
클라이언트->서버는 정상(우리가 보낸 "삼성전자"를 서버가 정확히 재인코딩해 씀).
반증 대조군 3개(`naver-search-mcp`·`pykrx-mcp`·`jjlabsio`, 전부 Node/Python
혼재)는 U+FFFD 0건 — Windows 자식 프로세스 stdio 문제가 아니라 해당 서버
구현 문제일 가능성이 크다(§9-④). 근본 원인은 미규명이므로 **탐지만 하고
자동 복구는 시도하지 않는다** — 손상된 텍스트를 되돌릴 신뢰할 방법이 없다.

## 3. `truncate_at` 기본값 상향

`korean-dart-mcp`의 기본 `truncate_at=100,000`자는 실측 최대 사업보고서
636,059자의 84%를 자른다(`plan/mcp-실행계획.md` §3 신규②). 등록 시 이 서버로
알려진 툴 호출에는 더 큰 기본값을 제안한다.
"""

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

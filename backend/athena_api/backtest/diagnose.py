"""오류 진단 — 파이썬 역추적을 사람 말로 옮기고, 고칠 수 있으면 diff까지 낸다(Paper 보드 09).

**왜 역추적을 그대로 보여주지 않나.** 사용자는 파이썬을 모른다는 전제다(사용자 지시 원문).
`ValueError: cannot mask with non-boolean array containing NA / NaN values`는 파이썬을 아는
사람에게도 즉시 읽히지 않는다. 그래도 원문을 버리지는 않는다 — 화면이 "파이썬 원문 보기"로
접어둔다. 번역이 틀렸을 때 사용자가 진짜 문구에 닿을 길을 없애면 안 된다.

**왜 수정안을 자동으로 적용하지 않나.** 라우틴 `draft`에 `confirm`이 없는 것과 같은 규율이다
(§7.3). 모델이나 규칙이 코드를 바꿔놓고 사람은 옛 코드가 도는 줄 아는 경로를 만들지 않는다.
이 모듈은 새 소스를 **계산만** 하고, 적용은 사람이 누른 뒤 버전 저장소가 한다.

**왜 규칙표인가 — LLM이 아니라.** 여기서 틀리면 초심자는 틀린 수정안을 그대로 적용한다.
규칙은 자기가 확신하는 경우에만 diff를 내고, 모르면 `suggestion=None`으로 정직하게 비운다.
설명(왜 났는가)은 항상 내고, 고치는 방법은 확신할 때만 낸다 — 이 둘을 분리한 것이 핵심이다.
"""

from __future__ import annotations

import ast
import difflib
import re
from dataclasses import dataclass, field
from typing import Any

# 샌드박스가 막는 모듈(§7.2 허용목록의 여집합) — 차단 사유를 사람 말로 옮길 때 쓴다.
_BLOCKED_HINT = {
    "os": "파일과 환경변수",
    "sys": "파이썬 실행 환경",
    "subprocess": "다른 프로그램 실행",
    "socket": "네트워크",
    "urllib": "네트워크",
    "httpx": "네트워크",
    "requests": "네트워크",
    "pathlib": "파일 경로",
}


@dataclass(frozen=True, slots=True)
class Fix:
    """수정안 하나. `new_source`가 적용될 전체 소스이고 `diff_lines`는 화면이 그리는 줄들."""

    summary: str
    new_source: str
    diff_lines: tuple[tuple[str, str], ...]  # ("+"|"-"|" ", 줄 내용)
    added: int
    removed: int


@dataclass(frozen=True, slots=True)
class Diagnosis:
    """진단 한 장. `suggestion`이 None이면 "왜"까지만 말하고 고치는 건 사람에게 맡긴다."""

    title: str
    detail: str
    why: str
    line: int | None
    raw: str
    suggestion: Fix | None = None
    unknown_reason: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)


def _last_user_line(traceback_text: str, filename_hint: str = "strategy") -> int | None:
    """역추적에서 사용자 파일의 마지막 줄 번호. 사용자 코드 밖(pandas 내부)은 무시한다 —
    "20번째 줄에서 멈췄습니다"가 pandas의 3000번째 줄이면 아무 의미가 없다."""
    hits = re.findall(r'File "([^"]*)", line (\d+)', traceback_text)
    for path, lineno in reversed(hits):
        if filename_hint in path or path in {"<string>", "<strategy>"}:
            return int(lineno)
    return None


def _make_fix(summary: str, old_source: str, new_source: str) -> Fix:
    old_lines = old_source.splitlines()
    new_lines = new_source.splitlines()
    diff: list[tuple[str, str]] = []
    added = removed = 0
    for line in difflib.unified_diff(old_lines, new_lines, lineterm="", n=1):
        if line.startswith(("---", "+++", "@@")):
            continue
        mark, body = line[0], line[1:]
        if mark == "+":
            added += 1
        elif mark == "-":
            removed += 1
        diff.append((mark, body))
    return Fix(
        summary=summary, new_source=new_source,
        diff_lines=tuple(diff), added=added, removed=removed,
    )


def _replace_line(source: str, lineno: int, new_text: str) -> str:
    lines = source.splitlines()
    lines[lineno - 1] = new_text
    return "\n".join(lines) + ("\n" if source.endswith("\n") else "")


def _indent_of(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _boolean_names(source: str) -> set[str]:
    """진입 신호처럼 쓰이는 불리언 변수 이름들 — `.where(entry)` 수정안의 대상 후보다."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    out: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        for child in ast.walk(node.value):
            is_cross = (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr.startswith("cross_")
            )
            if isinstance(child, (ast.Compare, ast.BoolOp)) or is_cross:
                out.update(names)
                break
    return out


def _nan_mask_fix(source: str, lineno: int | None) -> Fix | None:
    """NaN 마스크 오류의 전형적 원인 — 워밍업 구간이 있는 지표로 만든 값을 매 봉 비교에 쓴 것.

    자동 수정을 내는 조건을 좁게 잡는다: 문제 줄이 단순 대입이고, 같은 함수 안에 진입
    불리언이 있으며, 그 대입에 이미 `.where(...)`가 없을 때만. 조건을 넓히면 엉뚱한 줄을
    고쳐놓고 "고쳤다"고 말하게 된다.
    """
    if lineno is None:
        return None
    lines = source.splitlines()
    if not (1 <= lineno <= len(lines)):
        return None
    target = lines[lineno - 1]
    if ".where(" in target or "=" not in target:
        return None
    bools = _boolean_names(source)
    entry_name = "entry" if "entry" in bools else next(iter(sorted(bools)), None)
    if entry_name is None:
        return None
    lhs, _, rhs = target.partition("=")
    if lhs.strip() == entry_name or not rhs.strip():
        return None
    indent = _indent_of(target)
    new_text = (
        f"{indent}{lhs.strip()} = ({rhs.strip()}) \\\n"
        f"{indent}    .where({entry_name}).ffill()"
    )
    return _make_fix(
        f"{lineno}줄 — 진입한 날에만 값을 남기고 그 값을 이어붙입니다",
        source,
        _replace_line(source, lineno, new_text),
    )


def _blocked_import_fix(source: str, module: str) -> Fix | None:
    """차단된 모듈 import 줄을 지운다 — 지우기만 하면 되는 경우에만 낸다."""
    lines = source.splitlines()
    keep = [
        ln for ln in lines
        if not re.match(rf"^\s*(import\s+{re.escape(module)}\b|from\s+{re.escape(module)}\b)", ln)
    ]
    if len(keep) == len(lines):
        return None
    return _make_fix(
        f"{module} import 줄을 지웁니다",
        source,
        "\n".join(keep) + ("\n" if source.endswith("\n") else ""),
    )


def _nearest(name: str, candidates: list[str]) -> str | None:
    matches = difflib.get_close_matches(name, candidates, n=1, cutoff=0.6)
    return matches[0] if matches else None


def diagnose(
    error_text: str,
    source: str,
    *,
    known_indicators: list[str] | None = None,
    known_params: list[str] | None = None,
) -> Diagnosis:
    """샌드박스가 남긴 오류 텍스트와 소스로 진단을 만든다.

    `known_indicators`/`known_params`는 "가장 비슷한 이름"을 제안할 때만 쓴다 — 없으면
    제안 없이 설명만 낸다.
    """
    raw = error_text.strip()
    line = _last_user_line(raw)
    indicators = known_indicators or []
    params = known_params or []

    # ── 문법 ────────────────────────────────────────────────────────────────
    if "SyntaxError" in raw or "IndentationError" in raw:
        m = re.search(r"line (\d+)", raw)
        lineno = int(m.group(1)) if m else line
        indented = "IndentationError" in raw
        return Diagnosis(
            title=f"{lineno}번째 줄을 파이썬이 읽지 못했습니다" if lineno
            else "코드를 파이썬이 읽지 못했습니다",
            detail="실행은 시작도 하지 않았습니다. 저장된 결과가 없습니다.",
            why=(
                "들여쓰기가 어긋났습니다. 파이썬은 줄 앞의 빈칸으로 코드 덩어리를 구분해서, "
                "같은 덩어리 안의 줄은 빈칸 개수가 같아야 합니다."
                if indented else
                "괄호나 따옴표가 짝이 맞지 않거나, 문장이 중간에 끊겼을 때 나는 오류입니다. "
                "표시된 줄과 바로 윗줄을 같이 보세요."
            ),
            line=lineno, raw=raw, tags=("syntax",),
            unknown_reason="문법 오류는 고칠 방법이 여러 가지여서 자동 수정안을 내지 않습니다",
        )

    # ── 차단된 import ───────────────────────────────────────────────────────
    m = re.search(r"(?:차단|blocked|not allowed).*?['\"]?([a-zA-Z_][\w.]*)['\"]?", raw)
    blocked = None
    for mod in _BLOCKED_HINT:
        if re.search(rf"\b{re.escape(mod)}\b", raw) and (
            "import" in raw.lower() or "차단" in raw or "allow" in raw.lower()
        ):
            blocked = mod
            break
    if blocked is None and m and m.group(1) in _BLOCKED_HINT:
        blocked = m.group(1)
    if blocked is not None:
        what = _BLOCKED_HINT[blocked]
        return Diagnosis(
            title=f"{blocked} 모듈은 전략 코드에서 쓸 수 없습니다",
            detail="전략 코드는 자격증명도 계좌도 네트워크도 닿지 않는 별도 프로세스에서 돕니다.",
            why=(
                f"{blocked}는 {what}에 닿는 모듈이라 막혀 있습니다. 전략이 쓸 수 있는 것은 "
                "pandas·numpy·math·statistics·datetime과 athena_bt뿐입니다. "
                "필요한 지표는 athena_bt에 있는지 먼저 보세요."
            ),
            line=line, raw=raw, tags=("sandbox", "import"),
            suggestion=_blocked_import_fix(source, blocked),
        )

    # ── 알 수 없는 지표 ─────────────────────────────────────────────────────
    m = re.search(r"has no attribute ['\"]([\w]+)['\"]", raw)
    if m:
        wanted = m.group(1)
        near = _nearest(wanted, indicators)
        fix = None
        if near is not None and wanted in source:
            fix = _make_fix(
                f"{wanted} → {near}로 바꿉니다",
                source,
                re.sub(rf"\b{re.escape(wanted)}\b", near, source),
            )
        return Diagnosis(
            title=f"athena_bt에 {wanted}(이)라는 지표가 없습니다",
            detail="이름이 틀렸거나 아직 등록되지 않은 지표입니다.",
            why=(
                f"쓸 수 있는 지표 이름 중 가장 비슷한 것은 {near}입니다."
                if near else
                "지표 목록은 설계 폼의 ‘지표 추가’에서 볼 수 있습니다. "
                "목록에 없는 지표는 pandas로 직접 계산해도 됩니다."
            ),
            line=line, raw=raw, tags=("indicator",), suggestion=fix,
            unknown_reason=None if near else "비슷한 이름을 찾지 못해 수정안을 내지 않습니다",
        )

    # ── 없는 파라미터 ───────────────────────────────────────────────────────
    m = re.search(r"KeyError: ['\"]([\w]+)['\"]", raw)
    if m:
        wanted = m.group(1)
        near = _nearest(wanted, params)
        fix = None
        if near is not None:
            fix = _make_fix(
                f"p[\"{wanted}\"] → p[\"{near}\"]로 바꿉니다",
                source,
                source.replace(f'p["{wanted}"]', f'p["{near}"]').replace(
                    f"p['{wanted}']", f"p['{near}']"
                ),
            )
        return Diagnosis(
            title=f"PARAMS에 {wanted}(이)가 없습니다",
            detail="코드가 쓰려는 조절값이 PARAMS에 선언되어 있지 않습니다.",
            why=(
                f"PARAMS에 있는 이름 중 가장 비슷한 것은 {near}입니다."
                if near else
                f"p[\"{wanted}\"]를 쓰려면 PARAMS에 {wanted} 항목을 먼저 추가해야 합니다. "
                "PARAMS에 적은 이름이 그대로 설계 폼의 슬라이더가 됩니다."
            ),
            line=line, raw=raw, tags=("params",), suggestion=fix,
        )

    # ── NaN 비교 ────────────────────────────────────────────────────────────
    if "NA / NaN" in raw or "boolean value of NA" in raw or "cannot mask" in raw:
        return Diagnosis(
            title=(f"{line}번째 줄에서 멈췄습니다 — 아직 값이 없는 칸을 계산에 썼습니다"
                   if line else "아직 값이 없는 칸을 계산에 썼습니다"),
            detail=(
                "신호를 한 개도 만들지 못했습니다. "
                "백테스트는 실행되지 않았고 저장된 결과도 없습니다."
            ),
            why=(
                "이동평균·ATR 같은 지표는 앞 봉이 일정 개수 모여야 첫 값이 나옵니다. "
                "그전 칸은 빈칸(NaN)이라, 그 빈칸이 섞인 값으로 크기를 비교하면 파이썬이 "
                "참인지 거짓인지 정할 수 없어 멈춥니다. 손절선처럼 특정 시점에만 정해지는 값은 "
                "그 시점에만 남기고 다음까지 끌고 가야 합니다."
            ),
            line=line, raw=raw, tags=("nan", "warmup"),
            suggestion=_nan_mask_fix(source, line),
            unknown_reason=(
                None if _nan_mask_fix(source, line)
                else "어느 줄을 어떻게 고칠지 확신하지 못해 수정안을 내지 않습니다"
            ),
        )

    # ── 계약 위반 ───────────────────────────────────────────────────────────
    if "entry" in raw and "exit" in raw and ("열" in raw or "column" in raw):
        return Diagnosis(
            title="돌려준 값이 entry·exit 두 열이 아닙니다",
            detail="엔진은 이 두 열만 받습니다.",
            why=(
                "마지막 return이 entry와 exit 두 개의 참/거짓 열을 가진 표여야 합니다. "
                "수익률이나 가격을 돌려주면 앱이 받지 못합니다 — 성과 계산은 앱의 몫입니다."
            ),
            line=line, raw=raw, tags=("contract",),
        )

    # ── 시간 초과 ───────────────────────────────────────────────────────────
    if "Timeout" in raw or "시간" in raw and "초과" in raw:
        return Diagnosis(
            title="코드가 제한 시간 안에 끝나지 않았습니다",
            detail="전략 코드는 정해진 시간이 지나면 강제로 멈춥니다.",
            why=(
                "봉을 하나씩 도는 반복문(for/while)이 있으면 느려지거나 끝나지 않을 수 있습니다. "
                "pandas는 열 전체를 한 번에 계산하므로 반복문 없이 쓰는 쪽이 훨씬 빠릅니다."
            ),
            line=line, raw=raw, tags=("timeout",),
        )

    # ── 이름 오타 ───────────────────────────────────────────────────────────
    m = re.search(r"NameError: name ['\"]([\w]+)['\"]", raw)
    if m:
        wanted = m.group(1)
        return Diagnosis(
            title=f"{wanted}(이)라는 이름을 찾지 못했습니다",
            detail="쓰기 전에 만들어지지 않은 변수입니다.",
            why=(
                "변수는 쓰기 전에 먼저 만들어야 합니다. 철자가 틀렸거나, 만드는 줄이 "
                "쓰는 줄보다 아래에 있을 때 납니다."
            ),
            line=line, raw=raw, tags=("name",),
        )

    # ── 그 외 ───────────────────────────────────────────────────────────────
    first = raw.splitlines()[-1] if raw else "알 수 없는 오류"
    return Diagnosis(
        title=(f"{line}번째 줄에서 멈췄습니다" if line else "실행 중에 멈췄습니다"),
        detail=first,
        why="이 오류는 아직 사람 말로 옮기는 규칙이 없습니다. 파이썬 원문을 그대로 보여줍니다.",
        line=line, raw=raw, tags=("unknown",),
        unknown_reason="아는 유형이 아니라 수정안을 내지 않습니다",
    )


def to_payload(d: Diagnosis) -> dict[str, Any]:
    return {
        "title": d.title,
        "detail": d.detail,
        "why": d.why,
        "line": d.line,
        "raw": d.raw,
        "tags": list(d.tags),
        "unknown_reason": d.unknown_reason,
        "suggestion": None if d.suggestion is None else {
            "summary": d.suggestion.summary,
            "new_source": d.suggestion.new_source,
            "added": d.suggestion.added,
            "removed": d.suggestion.removed,
            "diff_lines": [{"mark": m, "text": t} for m, t in d.suggestion.diff_lines],
        },
    }


__all__ = ["Diagnosis", "Fix", "diagnose", "to_payload"]

"""원장 — 발화/근접/억제 판정 기록. "왜 안 불렀나"에 답하는 유일한 장부.

규율(감사 로그 함정 ⑫와 동형): 조건식 원문·계좌 정보·upstream 본문을 싣지
않는다. 컬럼은 식별자·숫자·판정 사유뿐이다. reason은 필수다 — 이유 없는
침묵은 디버깅 불가다(감시에이전트-실행계획 §6).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

Verdict = Literal["fired", "near", "suppressed"]

_ALLOWED_VERDICTS: tuple[str, ...] = ("fired", "near", "suppressed")


class LedgerError(ValueError):
    """원장 기록 계약 위반 — 호출부 버그이지 런타임 강등 대상이 아니다."""


class RoutineLedger:
    """append-only jsonl. 파일 경로는 호출자가 주입한다(테스트 격리)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path:
        return self._path

    def record(
        self,
        verdict: Verdict,
        *,
        routine_id: str,
        symbol: str,
        source: str,
        observed: float | bool | str | None,
        threshold: float | bool | str | None,
        reason: str,
        ts: datetime | None = None,
    ) -> dict[str, Any]:
        if verdict not in _ALLOWED_VERDICTS:
            raise LedgerError(f"unknown verdict: {verdict!r}")
        if not reason or not reason.strip():
            raise LedgerError("reason은 비울 수 없다 — 이유 없는 판정은 기록 불가")
        row = {
            "ts": (ts or datetime.now(UTC)).isoformat(),
            "routine_id": routine_id,
            "symbol": symbol,
            "source": source,
            "verdict": verdict,
            "observed": observed,
            "threshold": threshold,
            "reason": reason.strip(),
        }
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        return row

    def read_all(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in self._path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
        return rows

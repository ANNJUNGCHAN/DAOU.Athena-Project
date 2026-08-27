"""브리핑 본문 전용 스토어 — engagement.py와 분리 소유(P4).

브리핑 실행 시 생성된 본문(자유형식 텍스트)을 append-only jsonl로 보관한다.
engagement.py(메타데이터: status/duration/destination)와 관심사가 다르다 —
본문은 재생성 불가능한 유일 데이터라 engagement의 "손실 감내 가능" 신뢰
등급과 다르다. 같은 이유로 read_all()도 ledger.py와 동형(손상 라인에
관대하지 않음)이고, archive.py 롤오버도 lenient=False로 태운다.

최대 저장 길이 max_content_chars(기본 4000자)를 넘으면 잘라 저장하고
truncated=True로 표기한다(무제한 성장 방지, 잘린 사실은 숨기지 않는다 — P3).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MAX_CONTENT_CHARS = 4000


class BriefingError(ValueError):
    """브리핑 기록 계약 위반 — 호출부 버그이지 런타임 강등 대상이 아니다."""


class BriefingStore:
    """append-only jsonl. 파일 경로는 호출자가 주입한다(테스트 격리)."""

    def __init__(self, path: Path, *, max_content_chars: int = MAX_CONTENT_CHARS) -> None:
        self._path = path
        self._max_content_chars = max_content_chars
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def record(
        self,
        *,
        routine_id: str,
        fired_at: str,
        title: str,
        content: str,
        model: str | None,
        effort: str | None,
        destination: str,
        ts: datetime | None = None,
    ) -> dict[str, Any]:
        """본문 1건 기록. fired_at은 ledger의 fired 행 ts(서버 authoritative)와
        같은 값이어야 한다 — runs 병합(api/routines.py)이 이 키로 상관한다."""
        if not fired_at or not fired_at.strip():
            raise BriefingError("fired_at은 비울 수 없다 — 발화와 상관 불가")
        truncated = len(content) > self._max_content_chars
        row = {
            "ts": (ts or datetime.now(UTC)).isoformat(),
            "routine_id": routine_id,
            "fired_at": fired_at,
            "title": title,
            "content": content[: self._max_content_chars],
            "truncated": truncated,
            "model": model,
            "effort": effort,
            "destination": destination,
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

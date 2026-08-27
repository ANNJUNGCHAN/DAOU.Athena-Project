"""라우틴 append-only jsonl 스토어(ledger·engagement·briefings 공용)의
분기별 아카이브 롤오버 — 삭제 없이 오래된 행만 별도 파일로 옮긴다.

크래시 안전 순서(R3): 아카이브 append(durable, 여러 분기 파일에 걸쳐
있을 수 있다) 먼저 → 원본을 tmp-then-rename으로 원자 교체(store.py·
read_marks.py와 동형). 이 순서라 교체 전에 죽으면 원본이 그대로 남아
다음 실행이 같은 행을 다시 아카이브에 append한다 — 최악의 결과는
"아카이브 중복"이지 "유실"이 아니다.

lenient는 손상 라인 처리 철학을 호출자가 고른다(ledger.py/engagement.py의
기존 차이와 동형): lenient=False는 ArchiveError로 즉시 중단(분류만 하고
아직 아무 파일도 쓰지 않은 시점이라 원본·아카이브 둘 다 무수정), lenient=
True는 손상 라인을 원본에 그대로 남겨둔다(나이를 알 수 없는 행을 함부로
아카이브로 옮기지 않는다 — read_all()이 이미 조용히 건너뛰므로 눈에 보이는
손실은 없다).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


class ArchiveError(ValueError):
    """롤오버 계약 위반(엄격 모드의 손상 라인) — 호출부가 처리해야 한다."""


@dataclass
class RolloverResult:
    moved: int = 0
    archive_files: list[Path] = field(default_factory=list)


def _quarter_key(ts: datetime) -> str:
    quarter = (ts.month - 1) // 3 + 1
    return f"{ts.year}Q{quarter}"


def rollover_jsonl(
    path: Path,
    *,
    ts_field: str,
    archive_dir: Path,
    cutoff_days: int = 90,
    now: datetime | None = None,
    lenient: bool = False,
) -> RolloverResult:
    """path의 각 행을 ts_field 기준 나이로 분류해 cutoff_days보다 오래된
    행만 archive_dir/{stem}-{YYYY}Q{n}.jsonl(행 자신의 ts가 속한 분기)로
    옮긴다. 최근 행은 원본에 그대로 남는다 — 삭제는 없다."""
    if not path.exists():
        return RolloverResult()

    cutoff = (now or datetime.now(UTC)) - timedelta(days=cutoff_days)
    keep_lines: list[str] = []
    by_quarter: dict[str, list[str]] = {}

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            row: dict[str, Any] = json.loads(line)
            ts = datetime.fromisoformat(row[ts_field])
        except Exception as exc:
            if not lenient:
                raise ArchiveError(f"{path.name}의 손상 라인: {line[:80]!r}") from exc
            keep_lines.append(line)  # 나이를 알 수 없는 행은 옮기지 않는다
            continue
        if ts < cutoff:
            by_quarter.setdefault(_quarter_key(ts), []).append(line)
        else:
            keep_lines.append(line)

    if not by_quarter:
        return RolloverResult()

    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_files: list[Path] = []
    moved = 0
    for quarter, lines in by_quarter.items():
        archive_path = archive_dir / f"{path.stem}-{quarter}.jsonl"
        with archive_path.open("a", encoding="utf-8") as fh:
            for line in lines:
                fh.write(line + "\n")
        archive_files.append(archive_path)
        moved += len(lines)

    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(line + "\n" for line in keep_lines), encoding="utf-8")
    tmp.replace(path)

    return RolloverResult(moved=moved, archive_files=archive_files)

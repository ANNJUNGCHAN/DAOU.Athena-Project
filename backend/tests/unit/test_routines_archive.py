"""ledger·engagement 90일 롤오버(R3) — 경계·다분기·크래시 안전·lenient 차등."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.routines.archive import ArchiveError, rollover_jsonl
from athena_api.routines.engagement import EngagementStore

_NOW = datetime(2026, 8, 27, 9, 0, 0, tzinfo=UTC)


def _write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )


def _read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _row(days_ago: int, routine_id: str) -> dict:
    ts = _NOW - timedelta(days=days_ago)
    return {"ts": ts.isoformat(), "routine_id": routine_id, "verdict": "fired"}


def _quarter_name(stem: str, days_ago: int) -> str:
    ts = _NOW - timedelta(days=days_ago)
    quarter = (ts.month - 1) // 3 + 1
    return f"{stem}-{ts.year}Q{quarter}.jsonl"


# ---------- 89일/91일 경계 ----------


def test_89_days_kept_91_days_archived(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    archive_dir = tmp_path / "archive"
    row_89 = _row(89, "r1")
    row_91 = _row(91, "r2")
    _write_rows(ledger_path, [row_89, row_91])

    result = rollover_jsonl(
        ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
    )

    assert result.moved == 1
    assert _read_rows(ledger_path) == [row_89]
    archived = _read_rows(archive_dir / _quarter_name("ledger", 91))
    assert archived == [row_91]


def test_no_old_rows_leaves_original_untouched(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    archive_dir = tmp_path / "archive"
    row_1 = _row(1, "r1")
    _write_rows(ledger_path, [row_1])

    result = rollover_jsonl(
        ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
    )

    assert result.moved == 0
    assert result.archive_files == []
    assert not archive_dir.exists()  # 옮길 게 없으면 아카이브 디렉터리도 안 만든다
    assert _read_rows(ledger_path) == [row_1]


# ---------- 다분기 최초 롤오버 ----------


def test_first_rollover_spans_multiple_quarters(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    archive_dir = tmp_path / "archive"
    row_recent = _row(1, "r-recent")
    row_q_a = _row(200, "r-a")
    row_q_b = _row(400, "r-b")
    _write_rows(ledger_path, [row_recent, row_q_a, row_q_b])

    result = rollover_jsonl(
        ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
    )

    assert result.moved == 2
    assert len(result.archive_files) == 2
    assert _read_rows(ledger_path) == [row_recent]
    assert _read_rows(archive_dir / _quarter_name("ledger", 200)) == [row_q_a]
    assert _read_rows(archive_dir / _quarter_name("ledger", 400)) == [row_q_b]


# ---------- 크래시 안전(append 먼저 durable → 원본 교체는 나중, 유실 0·중복 허용) ----------


def test_crash_before_atomic_replace_loses_nothing_on_retry(tmp_path, monkeypatch):
    ledger_path = tmp_path / "ledger.jsonl"
    archive_dir = tmp_path / "archive"
    row_recent = _row(1, "r-recent")
    row_old = _row(91, "r-old")
    _write_rows(ledger_path, [row_recent, row_old])

    tmp_target = ledger_path.with_suffix(".tmp")
    original_replace = Path.replace

    def boom(self: Path, target):
        if self == tmp_target:
            raise OSError("simulated crash before atomic replace")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", boom)
    with pytest.raises(OSError):
        rollover_jsonl(
            ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
        )

    # 크래시 시점: 아카이브는 이미 durable하게 써졌고, 원본은 교체 전이라 그대로 남는다.
    archived_before = _read_rows(archive_dir / _quarter_name("ledger", 91))
    assert archived_before == [row_old]
    assert _read_rows(ledger_path) == [row_recent, row_old]  # 유실 없음 — 원본 무수정

    monkeypatch.setattr(Path, "replace", original_replace)

    # 재실행 — 유실 0, 중복은 허용된다(아카이브에 같은 행이 다시 append됨).
    result = rollover_jsonl(
        ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
    )
    assert result.moved == 1
    archived_after = _read_rows(archive_dir / _quarter_name("ledger", 91))
    assert archived_after == [row_old, row_old]  # 중복 허용
    assert _read_rows(ledger_path) == [row_recent]  # 최종적으로 유실은 없다


# ---------- lenient 차등(ledger=엄격, engagement=관대) ----------


def test_strict_mode_raises_on_corrupt_line_and_writes_nothing(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    archive_dir = tmp_path / "archive"
    row_old = _row(91, "r-old")
    ledger_path.write_text(
        json.dumps(row_old, ensure_ascii=False) + "\n" + "{broken json\n", encoding="utf-8"
    )

    with pytest.raises(ArchiveError):
        rollover_jsonl(
            ledger_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=False
        )

    assert not archive_dir.exists()  # 쓰기 전에 파싱이 전부 끝나므로 원본·아카이브 둘 다 무수정
    raw = ledger_path.read_text(encoding="utf-8")
    assert "broken json" in raw  # 원본은 그대로


def test_lenient_mode_skips_corrupt_line_but_keeps_it_and_archives_valid_rows(tmp_path):
    engagement_path = tmp_path / "engagement.jsonl"
    archive_dir = tmp_path / "archive"
    row_old = _row(91, "r-old")
    row_recent = _row(1, "r-recent")
    engagement_path.write_text(
        json.dumps(row_old, ensure_ascii=False)
        + "\n{broken json\n"
        + json.dumps(row_recent, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )

    result = rollover_jsonl(
        engagement_path, ts_field="ts", archive_dir=archive_dir, cutoff_days=90, now=_NOW, lenient=True
    )

    assert result.moved == 1
    assert _read_rows(archive_dir / _quarter_name("engagement", 91)) == [row_old]
    remaining_raw = engagement_path.read_text(encoding="utf-8")
    assert "broken json" in remaining_raw  # 나이를 모르는 행은 원본에 남는다
    # EngagementStore.read_all()은 원래부터 손상 라인을 조용히 건너뛴다(engagement.py 정책) —
    # 그 관대함 덕에 원본에 손상 라인이 남아 있어도 읽기 결과는 유효 행만 보인다.
    assert EngagementStore(engagement_path).read_all() == [row_recent]


# ---------- briefings.jsonl도 롤오버 대상(R1, 3단계) ----------


def test_archive_once_rolls_over_briefings_too(tmp_path):
    """runtime._archive_once()가 ledger·engagement에 더해 briefings.jsonl도
    90일 경계로 옮긴다 — 본문은 유일 데이터라 lenient=False(엄격)로 태운다."""
    from athena_api.config import Settings
    from athena_api.routines.briefings import BriefingStore
    from athena_api.routines.runtime import _archive_once

    settings = Settings(
        _env_file=None,
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_briefings_path=tmp_path / "briefings.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
    )
    store = BriefingStore(settings.routines_briefings_path)
    old_kwargs = dict(
        routine_id="r-old", fired_at="2026-05-01T07:30:00+09:00", title="옛 브리핑",
        content="본문", model=None, effort=None, destination="chat",
    )
    store.record(**old_kwargs, ts=datetime.now(UTC) - timedelta(days=91))
    recent = store.record(
        routine_id="r-new", fired_at="2026-08-27T07:30:00+09:00", title="최근 브리핑",
        content="본문", model=None, effort=None, destination="chat",
    )

    _archive_once(settings)

    assert store.read_all() == [recent]  # 최근 행만 원본에 남는다
    archived = list((tmp_path / "archive").glob("briefings-*.jsonl"))
    assert len(archived) == 1
    assert _read_rows(archived[0])[0]["routine_id"] == "r-old"


# ---------- 부재 파일 ----------


def test_missing_file_is_a_noop(tmp_path):
    result = rollover_jsonl(
        tmp_path / "nope.jsonl", ts_field="ts", archive_dir=tmp_path / "archive", now=_NOW
    )
    assert result.moved == 0
    assert result.archive_files == []

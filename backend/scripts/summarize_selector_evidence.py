"""셀렉터 ablation 증거에서 커밋 가능한 요약본을 뽑는다.

`evaluate_selector_ablations.py --output`이 내는 원본은 파일당 77~136MB다. 부피의
99%는 `variants[].cases[].compatibility_trace` **한 키**이고(케이스당 약 58KB),
판정에 필요한 필드 — `id` · `correct` · `decision` · `expected_refs` ·
`selected_operation_ref` · `*_margin` · `compatibility_reason_codes` ·
`identity_control_plane_trace` — 는 전부 그 키 **밖에** 있다.

그래서 그 키 하나만 떼어내고 나머지는 통째로 보존한다. 케이스 수도, 변형 수도
줄이지 않는다 — 표본을 깎으면 요약이 아니라 다른 증거가 된다.

원본은 로컬에 그대로 두고 `.gitignore`로 막는다. 저장소에는 이 요약본이 남는다.
`_summary_provenance`에 원본 파일명과 sha256을 적으므로, 원본을 다시 만들면
해시 불일치로 낡음을 알 수 있다.

사용:
    python scripts/summarize_selector_evidence.py ../plan/selector-*.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

# 이 키 하나만 뗀다. 목록을 늘리기 전에 실제로 부피를 차지하는지 먼저 재라.
DROPPED_CASE_KEYS = ("compatibility_trace",)

SUMMARY_SUFFIX = ".summary.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def summarize(payload: dict[str, Any], *, source: Path, source_sha256: str) -> dict[str, Any]:
    """원본 구조를 보존하고 DROPPED_CASE_KEYS만 제거한 사본을 만든다."""
    summary = dict(payload)
    dropped = 0
    variants = []
    for variant in payload.get("variants", []):
        cases = []
        for case in variant.get("cases", []):
            trimmed = {k: v for k, v in case.items() if k not in DROPPED_CASE_KEYS}
            dropped += len(case) - len(trimmed)
            cases.append(trimmed)
        variants.append({**variant, "cases": cases})
    if "variants" in payload:
        summary["variants"] = variants
    summary["_summary_provenance"] = {
        "source_file": source.name,
        "source_sha256": source_sha256,
        "dropped_case_keys": list(DROPPED_CASE_KEYS),
        "dropped_field_count": dropped,
        "generator": "backend/scripts/summarize_selector_evidence.py",
        "note": (
            "원본은 로컬 보관(.gitignore). 케이스·변형은 전량 보존하고 "
            "compatibility_trace만 제거했다."
        ),
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="원본 증거 JSON")
    parser.add_argument(
        "--outdir",
        type=Path,
        default=None,
        help="요약본 출력 디렉토리 (기본: 원본과 같은 위치)",
    )
    args = parser.parse_args()

    rows: list[str] = []
    for source in args.inputs:
        if source.name.endswith(SUMMARY_SUFFIX):
            continue  # 요약본을 다시 요약하지 않는다
        if not source.is_file():
            raise SystemExit(f"입력이 파일이 아니다: {source}")

        source_sha256 = _sha256(source)
        payload = json.loads(source.read_text(encoding="utf-8"))
        summary = summarize(payload, source=source, source_sha256=source_sha256)

        outdir = args.outdir or source.parent
        outdir.mkdir(parents=True, exist_ok=True)
        target = outdir / (source.stem + SUMMARY_SUFFIX)
        # 콘솔 인코딩(cp949)에 의존하지 않는다 — CLAUDE.md §8 함정
        target.write_text(
            json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        before = source.stat().st_size
        after = target.stat().st_size
        rows.append(
            f"{source.name}: {before / 1048576:.1f}MB -> "
            f"{target.name} {after / 1048576:.2f}MB "
            f"({after / before * 100:.2f}%)"
        )

    for row in rows:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

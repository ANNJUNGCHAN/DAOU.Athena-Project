"""평가 run 집계기 — eval-runs/<run>/ 의 raw-result.json 전수를 모아
지연 통계와 채점용 기계 사실(machine facts)을 낸다.

사용: backend/.venv/Scripts/python.exe datasets/aggregate_run.py eval-runs/2026-08-19-intraday-ui

출력 (run 디렉토리 아래):
  _aggregate/latency.json       — 케이스별 지연 분해(총·첫 카드·상태 전이·audit 타임라인)
  _aggregate/stats.json         — 분포(p50/p90/p95/max), 그룹별·카드별 요약
콘솔에는 아무 판정도 쓰지 않는다 — cp949 함정(CLAUDE.md §8), 파일이 정본이다.
"""

from __future__ import annotations

import json
import statistics
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE / "앱-검증-200.jsonl"


def load_dataset() -> dict[str, dict]:
    out = {}
    for line in DATASET.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            c = json.loads(line)
            out[c["id"]] = c
    return out


def pct(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = max(0, min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[k]


def parse_ts(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def main() -> int:
    if len(sys.argv) < 2:
        print("USAGE: aggregate_run.py <run-dir>")
        return 2
    run_dir = (HERE / sys.argv[1]).resolve() if not Path(sys.argv[1]).is_absolute() else Path(sys.argv[1])
    if not run_dir.exists():
        print(f"NOT FOUND: {run_dir}")
        return 2

    dataset = load_dataset()
    agg_dir = run_dir / "_aggregate"
    agg_dir.mkdir(exist_ok=True)

    rows = []
    for case_dir in sorted(run_dir.iterdir()):
        rr = case_dir / "raw-result.json"
        if not rr.is_file():
            continue
        r = json.loads(rr.read_text(encoding="utf-8"))
        case = dataset.get(r.get("case_id"), {})

        # 상태 전이에서 judging 구간(= 모델 첫 판단까지)과 calling 구간을 뽑는다.
        judging_ms = calling_ms = None
        transitions = r.get("state_transitions") or []
        if transitions and isinstance(transitions[0], dict):
            t_judging = next((t["at_ms"] for t in transitions if t["state"] == "judging"), None)
            t_calling = next((t["at_ms"] for t in transitions if t["state"] == "calling"), None)
            t_idle_back = next((t["at_ms"] for t in reversed(transitions) if t["state"] == "idle"), None)
            if t_judging is not None and t_calling is not None:
                judging_ms = t_calling - t_judging
            if t_calling is not None and t_idle_back is not None and t_idle_back > t_calling:
                calling_ms = t_idle_back - t_calling

        # audit 타임라인 — 케이스 시작(ran_at) 기준 상대 초. alias가 없는 행은
        # kiwoom-selector-timing.jsonl(백엔드 소요 계측)에서 온 부속 행이라
        # 호출 수에 넣지 않는다 — 처음엔 이걸 이중 호출로 오인했다(LIV-074).
        audit_timeline = []
        ran_at = parse_ts(r.get("ran_at", "").replace("Z", "+00:00"))
        ev = case_dir / "evidence" / "audit-delta.jsonl"
        if ev.is_file() and ran_at:
            for line in ev.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    a = json.loads(line)
                except Exception:
                    continue
                if not a.get("alias"):
                    continue  # 타이밍 부속 행 — 호출 아님
                ts = parse_ts(str(a.get("ts", "")))
                at_s = round((ts - ran_at).total_seconds(), 1) if ts else None
                audit_timeline.append({
                    "at_s": at_s,
                    "alias": a.get("alias"),
                    "tool": a.get("tool"),
                    "success": a.get("success"),
                    "backend_ms": a.get("backend_ms"),
                })
            # 별칭별 파일을 이어붙인 순서라 시간순이 아니다 — 정렬해야 간격이 의미를 갖는다.
            audit_timeline.sort(key=lambda x: (x["at_s"] is None, x["at_s"]))

        rows.append({
            "case_id": r.get("case_id"),
            "group": case.get("group"),
            "persona": case.get("persona"),
            "harness": r.get("harness", "run-cases-ui.js"),
            "completed": r.get("completed"),
            "timed_out": r.get("timed_out", False),
            "duration_s": r.get("duration_s"),
            "first_card_ms": r.get("first_card_ms"),
            "judging_ms": judging_ms,
            "calling_ms": calling_ms,
            "answer_chars": r.get("answer_chars"),
            "cards": r.get("card_types_rendered"),
            "audit_call_count": len(audit_timeline),
            "audit_timeline": audit_timeline,
        })

    latency_path = agg_dir / "latency.json"
    latency_path.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- 분포 통계 ----
    def dist(vals: list[float]) -> dict:
        vals = sorted(v for v in vals if isinstance(v, (int, float)))
        if not vals:
            return {"n": 0}
        return {
            "n": len(vals),
            "min": vals[0],
            "p50": pct(vals, 50),
            "p90": pct(vals, 90),
            "p95": pct(vals, 95),
            "max": vals[-1],
            "mean": round(statistics.fmean(vals), 1),
        }

    ui_rows = [r for r in rows if not r["harness"].startswith("run-cases-appmode")]
    by_group: dict[str, list] = {}
    for r in ui_rows:
        by_group.setdefault(r["group"] or "?", []).append(r)

    stats = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "total_cases": len(rows),
        "ui_cases": len(ui_rows),
        "completed": sum(1 for r in rows if r["completed"]),
        "timed_out": sum(1 for r in rows if r.get("timed_out")),
        "duration_s": dist([r["duration_s"] for r in ui_rows]),
        "first_card_s": dist([r["first_card_ms"] / 1000 for r in ui_rows if r["first_card_ms"]]),
        "judging_s": dist([r["judging_ms"] / 1000 for r in ui_rows if r["judging_ms"]]),
        "calling_s": dist([r["calling_ms"] / 1000 for r in ui_rows if r["calling_ms"]]),
        "by_group": {
            g: {
                "n": len(rs),
                "duration_s": dist([r["duration_s"] for r in rs]),
                "completed": sum(1 for r in rs if r["completed"]),
            }
            for g, rs in sorted(by_group.items())
        },
        "slowest_10": [
            {"case_id": r["case_id"], "duration_s": r["duration_s"], "group": r["group"],
             "audit_call_count": r["audit_call_count"], "first_card_ms": r["first_card_ms"]}
            for r in sorted(ui_rows, key=lambda x: -(x["duration_s"] or 0))[:10]
        ],
        "no_card_cases": [r["case_id"] for r in ui_rows if not r["cards"]],
    }
    stats_path = agg_dir / "stats.json"
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"WROTE {latency_path}")
    print(f"WROTE {stats_path}")
    print(f"cases={len(rows)} completed={stats['completed']} timed_out={stats['timed_out']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

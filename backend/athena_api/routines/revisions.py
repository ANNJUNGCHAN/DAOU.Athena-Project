"""코드 감시 알람의 고침 이력 — 한 바퀴(물어봄 → 고침 → 검사 → 다시 그림) 한 판.

고침이 일어나는 자리는 단 하나다: 감시 코드 파일을 덮어쓰는 순간
(`POST /routines/watch/code`). 그 순간 이전 파일 바이트와 **그때까지의 마지막
검사**(노드 값·울린 날)를 한 판으로 접어 둔다. 뒤따르는 재검사가 새 값을 만들면
두 판을 맞대어 무엇이 바뀌었는지·울림이 몇 번에서 몇 번이 되었는지가 나온다 —
지어낸 수가 하나도 없다.

되돌리기는 이 판을 그대로 되쓰는 일이다: 접어 둔 원문을 파일에 다시 쓰고
`version_hash`를 그 원문의 해시로 돌린다.

이 모듈은 순수하다 — 파일도 저장소도 만지지 않는다(부르는 쪽 몫).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# 이력은 루틴 JSON 안에 원문째 산다 — 무한히 쌓이면 저장 파일이 커진다.
# 사람이 한 알람을 열 번 넘게 고쳤다면 그 앞은 되돌릴 일이 없다.
MAX_REVISIONS = 10

# 되돌리기가 열리는 상태 — 켜져 있는 알람은 못 되돌린다(api/routines.py의 문과 같다).
ROLLBACK_STATUSES = ("draft", "paused")


@dataclass(frozen=True)
class WatchRevision:
    """고침 직전의 한 판 — 그때의 코드 원문과 그때까지의 마지막 검사 통째로.

    검사를 쪼개지 않고 통째로 쥐는 것은 되돌리기 때문이다: 되돌리면 그 검사가
    다시 「마지막 검사」가 되어야 하는데, 그것은 이 코드 바이트가 실제로 낸
    결과다 — 조각을 다시 조립하면 없는 칸을 지어내게 된다.
    """

    version_hash: str
    fixed_at: str  # ISO8601 — 이 판이 접힌 시각(= 덮어쓴 시각)
    source: str
    check: dict[str, Any] = field(default_factory=dict)

    @property
    def nodes(self) -> list[dict[str, Any]]:
        return list(self.check.get("nodes") or [])

    @property
    def ok(self) -> bool:
        """그때의 검사가 실제로 세었는지 — 안 통과한 검사의 0건은 센 값이 아니다."""
        return self.check.get("ok") is True

    @property
    def fire_count(self) -> int | None:
        return self.check.get("count")

    @property
    def fires(self) -> list[dict[str, Any]]:
        return list(self.check.get("fires") or [])

    @property
    def lookback_days(self) -> int | None:
        return self.check.get("lookback_days")

    def to_dict(self) -> dict[str, Any]:
        return {
            "version_hash": self.version_hash,
            "fixed_at": self.fixed_at,
            "source": self.source,
            "check": dict(self.check),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> WatchRevision:
        return cls(
            version_hash=str(raw.get("version_hash") or ""),
            fixed_at=str(raw.get("fixed_at") or ""),
            source=str(raw.get("source") or ""),
            check=dict(raw.get("check") or {}),
        )


def push(history: list[dict[str, Any]], entry: WatchRevision) -> list[dict[str, Any]]:
    """한 판을 이력 끝에 붙이고 상한을 넘는 앞판을 버린다."""
    return [*history, entry.to_dict()][-MAX_REVISIONS:]


def _node_index(nodes: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for node in nodes or []:
        if isinstance(node, dict) and node.get("fn"):
            out[str(node["fn"])] = node
    return out


def _input_index(node: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in node.get("inputs") or []:
        if isinstance(row, dict) and row.get("name") is not None:
            out[str(row["name"])] = row.get("value")
    return out


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "참" if value else "거짓"
    return str(value)


def diff_inputs(before: Any, after: Any) -> list[dict[str, str]]:
    """두 판의 노드 들어감 값을 맞대어 실제로 달라진 칸만 낸다.

    차례는 뒤판(after)의 노드 차례 그대로다 — 영수증 번호가 흐름 순서와 같아야 한다.
    """
    prev = _node_index(before)
    rows: list[dict[str, str]] = []
    for node in after or []:
        if not isinstance(node, dict):
            continue
        old = prev.get(str(node.get("fn") or ""))
        if old is None:
            continue
        old_inputs = _input_index(old)
        for row in node.get("inputs") or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            if name not in old_inputs:
                continue
            was, now = _text(old_inputs[name]), _text(row.get("value"))
            if was == now:
                continue
            rows.append({"label": name, "before": was, "after": now})
    return rows


def mark_fixed_nodes(before: Any, after: Any) -> list[dict[str, Any]]:
    """뒤판 노드에 「방금 바뀜」 표시를 붙이고 바뀐 칸 값을 「앞 → 뒤」로 겹쳐 그린다.

    앱의 노드 카드는 `inputs[].value`를 글자 그대로 그린다(watch-nodes.nodeCards) —
    그래서 화살표는 여기서 만든다. 앞판에 없던 노드는 손대지 않는다.
    """
    prev = _node_index(before)
    out: list[dict[str, Any]] = []
    for node in after or []:
        if not isinstance(node, dict):
            out.append(node)
            continue
        old = prev.get(str(node.get("fn") or ""))
        if old is None:
            out.append(dict(node))
            continue
        old_inputs = _input_index(old)
        rows: list[dict[str, Any]] = []
        changed = False
        for row in node.get("inputs") or []:
            if not isinstance(row, dict):
                rows.append(row)
                continue
            name = str(row.get("name") or "")
            row = dict(row)
            if name in old_inputs:
                was, now = _text(old_inputs[name]), _text(row.get("value"))
                if was != now:
                    row["value"] = f"{was} → {now}"
                    changed = True
            rows.append(row)
        marked = dict(node)
        marked["inputs"] = rows
        marked["changed"] = changed
        out.append(marked)
    return out


def _fire_dates(fires: Any) -> list[str]:
    return [str(f.get("dt")) for f in (fires or []) if isinstance(f, dict) and f.get("dt")]


def fix_cycle(history: Any, check: Any, *, status: str | None = None) -> dict[str, Any] | None:
    """마지막 판과 지금 검사를 맞댄 「한 바퀴」 — 이력이나 검사가 없으면 None.

    울림 수는 앞판의 검사 결과와 지금 검사 결과 둘 다 **통과한** 검사일 때만 낸다.
    코드가 터졌거나 칸 값을 못 읽은 검사도 노드는 채운 채 `count=0`·`fires=[]`로
    돌아오므로(watch/check.run_check), 그 0을 그대로 실으면 화면이 「고쳐서
    조용해졌다」고 말하게 된다. 통과 여부(`ok`)와 못 센 까닭(`skip_reason`)을 같이
    실어 화면이 판정 줄을 접을 수 있게 한다.
    """
    items = list(history or [])
    if not items or not isinstance(check, dict):
        return None
    prev = WatchRevision.from_dict(items[-1])
    changes = diff_inputs(prev.nodes, check.get("nodes"))
    passed = check.get("ok") is True
    return {
        "fix_count": len(items),
        "past_count": len(items) - 1,
        "fixed_at": prev.fixed_at,
        "checked_at": check.get("checked_at"),
        "lookback_days": check.get("lookback_days") or prev.lookback_days,
        "duration_ms": check.get("duration_ms"),
        "ok": passed,
        "skip_reason": check.get("skip_reason"),
        # 점 띠의 마지막 칸 — 검사가 실제로 센 마지막 날(어제, KST)이다.
        "counted_through": check.get("counted_through"),
        "fires_before": prev.fire_count if prev.ok else None,
        "fires_after": check.get("count") if passed else None,
        "fires_before_dates": _fire_dates(prev.fires) if prev.ok else [],
        "fires_after_dates": _fire_dates(check.get("fires")) if passed else [],
        "changes": changes,
        "changed_nodes": sum(
            1
            for n in mark_fixed_nodes(prev.nodes, check.get("nodes"))
            if isinstance(n, dict) and n.get("changed")
        ),
        "can_rollback": status in ROLLBACK_STATUSES,
    }


def history_view(history: Any) -> list[dict[str, Any]]:
    """「지난 고침」 목록 — 되돌릴 수 있는 판을 뺀 앞판들의 요약이다."""
    out: list[dict[str, Any]] = []
    for raw in list(history or [])[:-1]:
        entry = WatchRevision.from_dict(raw)
        out.append(
            {
                "fixed_at": entry.fixed_at,
                "fire_count": entry.fire_count,
                "lookback_days": entry.lookback_days,
            }
        )
    return out

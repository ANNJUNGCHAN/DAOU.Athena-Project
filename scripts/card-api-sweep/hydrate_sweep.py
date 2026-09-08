"""보드 전수 하이드레이션 — 실제 백엔드 API(board-hydrate)를 보드마다 호출한다."""
from __future__ import annotations
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("ATHENA_BASE", "http://127.0.0.1:8010")
PATH = "/api/v1/internal/canvas/board-hydrate"


def token() -> str:
    text = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.strip().startswith("ATHENA_LOCAL_BEARER_TOKEN="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def target_bag() -> dict:
    raw = os.environ.get("SWEEP_TARGET")
    if raw:
        return json.loads(raw)
    return {"stk_cd": "005930"}


def post(body: dict, tok: str, timeout: float = 60.0):
    req = urllib.request.Request(
        BASE + PATH,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {tok}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, {"detail": exc.read().decode("utf-8", "replace")[:400]}
    except Exception as exc:  # noqa: BLE001
        return 0, {"detail": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    sys.path.insert(0, str(ROOT / "backend"))
    from athena_api.card_surface_templates import get_registry

    registry = get_registry()
    tok = token()
    bag = target_bag()
    only = [b for b in (os.environ.get("SWEEP_BOARDS") or "").split(",") if b]
    boards = [b for b in registry.boards.values() if not only or b.board_id in only]
    out = {"target": bag, "boards": [], "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for index, board in enumerate(boards, 1):
        binding = {slot.slot_id for slot in board.binding_slots}
        status, payload = post({"board_id": board.board_id, "target": bag}, tok)
        contract = (payload or {}).get("surface_contract") or {}
        filled = {entry["slot_id"] for entry in contract.get("slot_values", [])}
        reasons: dict[str, int] = {}
        for op in (payload or {}).get("operations", []):
            key = op.get("reason") or op.get("status") or "unknown"
            reasons[key] = reasons.get(key, 0) + 1
        record = {
            "board_id": board.board_id,
            "card_id": board.card_id,
            "http": status,
            "binding_slots": len(binding),
            "filled": len(filled & binding),
            "unfilled": sorted(binding - filled),
            "operations": (payload or {}).get("operations", []),
            "op_reasons": reasons,
            "detail": (payload or {}).get("detail") if status >= 400 else None,
        }
        out["boards"].append(record)
        print(
            f"[{index}/{len(boards)}] {board.board_id} http={status} "
            f"filled={record['filled']}/{record['binding_slots']} {reasons}",
            flush=True,
        )
    total_binding = sum(b["binding_slots"] for b in out["boards"])
    total_filled = sum(b["filled"] for b in out["boards"])
    out["totals"] = {
        "boards": len(out["boards"]),
        "binding_slots": total_binding,
        "filled": total_filled,
        "unfilled": total_binding - total_filled,
    }
    dest = Path(os.environ.get("SWEEP_OUT", ROOT / "app" / "captures" / "card-api-sweep" / "HYDRATE-SWEEP.json"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out["totals"]), flush=True)
    print(f"wrote {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

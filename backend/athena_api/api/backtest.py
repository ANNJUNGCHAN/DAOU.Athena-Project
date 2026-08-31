"""백테스트 라우트 — docs/architecture/backtest-mode-plan.md §6.6(계약 고정, 바꾸지 않는다).

`routines.py`와 같은 규율을 따른다: 인증은 별도로 걸지 않고(bearer는 internal 전용
라우트만), `_store()`/`_runner()`가 서브시스템 비활성을 503으로 gate한다(`_runtime()`과
동형). 조회 라우트는 상태를 바꾸지 않는다 — `data/backfill`과 `runs`(POST/DELETE)만
바꾼다(계획서 규율 그대로).

**실행당 대상 1종목.** `engine.run_backtest()`는 단일 캔들 df를 받는다 — `DataSpec.symbols`가
여러 개면 이 라우트가 명시적으로 거부한다(조용히 첫 종목만 쓰지 않는다).
"""

from __future__ import annotations

import ast
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from athena_api.backtest import indicators as indicators_mod
from athena_api.backtest import presets as presets_mod
from athena_api.backtest.data import compute_plan, kiwoom_fetch_page
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.schema import from_kis_yaml
from athena_api.backtest.store import BacktestStore, Candle, Coverage
from athena_api.dependencies import KiwoomClientDep

router = APIRouter(prefix="/api/v1/backtest", tags=["backtest"])


def _store(request: Request) -> BacktestStore:
    store = getattr(request.app.state, "backtest_store", None)
    if store is None:
        raise HTTPException(
            status_code=503,
            detail="백테스트 서브시스템이 비활성이다 (ATHENA_BACKTEST_ENABLED=true 필요)",
        )
    return store


def _runner(request: Request) -> BacktestRunner:
    runner = getattr(request.app.state, "backtest_runner", None)
    if runner is None:
        raise HTTPException(
            status_code=503,
            detail="백테스트 서브시스템이 비활성이다 (ATHENA_BACKTEST_ENABLED=true 필요)",
        )
    return runner


def _parse_range_body(body: dict[str, Any]) -> tuple[str, str, bool, str, str]:
    try:
        stk_cd = str(body["stk_cd"])
        period = str(body["period"])
        adjusted = bool(body["adjusted"])
        from_dt = str(body["from_dt"])
        to_dt = str(body["to_dt"])
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"필수 필드가 없다: {exc}") from None
    return stk_cd, period, adjusted, from_dt, to_dt


def _missing_segments(from_dt: str, to_dt: str, coverage: Coverage | None) -> list[dict[str, str]]:
    """`data.compute_plan`(§5.2 추정)과 같은 앞/뒤 두 조각 규칙을, 날짜 문자열 구간으로
    돌려준다 — `data._missing_calendar_days`는 일수만 돌려줘서 화면에 못 쓴다."""
    start = datetime.strptime(from_dt, "%Y%m%d").date()
    end = datetime.strptime(to_dt, "%Y%m%d").date()
    if coverage is None:
        return [{"from_dt": from_dt, "to_dt": to_dt}]
    covered_first = datetime.strptime(coverage.first_dt, "%Y%m%d").date()
    covered_last = datetime.strptime(coverage.last_dt, "%Y%m%d").date()
    segments: list[dict[str, str]] = []
    if start < covered_first:
        before_end = min(end, covered_first - timedelta(days=1))
        if start <= before_end:
            segments.append(
                {"from_dt": start.strftime("%Y%m%d"), "to_dt": before_end.strftime("%Y%m%d")}
            )
    if end > covered_last:
        after_start = max(start, covered_last + timedelta(days=1))
        if after_start <= end:
            segments.append(
                {"from_dt": after_start.strftime("%Y%m%d"), "to_dt": end.strftime("%Y%m%d")}
            )
    return segments


def _candles_to_frame(candles: tuple[Candle, ...]) -> pd.DataFrame:
    index = pd.to_datetime([c.dt for c in candles], format="%Y%m%d")
    return pd.DataFrame(
        {
            "open": [c.open for c in candles],
            "high": [c.high for c in candles],
            "low": [c.low for c in candles],
            "close": [c.close for c in candles],
            "volume": [c.volume for c in candles],
        },
        index=index,
    )


def _metrics_view(metrics_json: str | None) -> tuple[dict[str, Any] | None, list[str]]:
    """저장된 metrics_json에서 사람이 읽는 지표와 정직 표기 flags를 분리한다(engine.py
    §6.4 "가정" 섹션, runner.py가 costs_flag를 여기 얹어 저장했다)."""
    if not metrics_json:
        return None, []
    payload = json.loads(metrics_json)
    flags = payload.pop("flags", [])
    return payload, flags


# ── 조회 전용 ─────────────────────────────────────────────────────────────────


@router.get("/presets")
async def list_presets_route() -> dict[str, Any]:
    items = []
    for preset_id in presets_mod.list_presets():
        yaml_text = presets_mod.preset_yaml(preset_id)
        spec = from_kis_yaml(yaml_text)
        items.append(
            {
                "id": preset_id,
                "name": spec.metadata.name,
                "category": spec.strategy.category,
                "yaml": yaml_text,
            }
        )
    return {"presets": items}


@router.get("/indicators")
async def list_indicators_route() -> dict[str, Any]:
    items = []
    for spec in indicators_mod.list_all():
        items.append(
            {
                "id": spec.id,
                "params": {
                    name: {
                        "type": p.type,
                        "default": p.default,
                        "min": p.min,
                        "max": p.max,
                        "step": p.step,
                    }
                    for name, p in spec.params.items()
                },
                "source": spec.source,
                "outputs": list(spec.outputs),
            }
        )
    return {"indicators": items}


@router.post("/validate")
async def validate_route(body: dict[str, Any]) -> dict[str, Any]:
    """파싱·계약 검사만 — 실행하지 않는다. python은 `ast.parse` + 최상위 `signals` 함수
    존재만 확인한다(샌드박스 기동은 안 한다 — 검증에 프로세스 기동은 과하다)."""
    kind = body.get("kind")
    source = body.get("source")
    if not isinstance(source, str) or not source.strip():
        return {"ok": False, "errors": [{"message": "source는 비어 있지 않은 문자열이어야 한다"}]}
    if kind == "yaml":
        try:
            from_kis_yaml(source)
        except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 결과를 그대로 옮긴다
            return {"ok": False, "errors": [{"message": str(exc)}]}
        return {"ok": True, "errors": []}
    if kind == "python":
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            return {"ok": False, "errors": [{"message": str(exc)}]}
        has_signals_fn = any(
            isinstance(node, ast.FunctionDef) and node.name == "signals" for node in tree.body
        )
        if not has_signals_fn:
            return {
                "ok": False,
                "errors": [{"message": "최상위에 def signals(df, p): 함수가 없다(§7.1 계약)"}],
            }
        return {"ok": True, "errors": []}
    return {"ok": False, "errors": [{"message": f"알 수 없는 kind: {kind!r}"}]}


@router.get("/data/coverage")
async def data_coverage(
    request: Request, stk_cd: str, period: str, adjusted: bool
) -> dict[str, Any]:
    store = _store(request)
    coverage = await store.coverage(stk_cd, period, adjusted)
    rows = len(await store.candles(stk_cd, period, adjusted))
    return {
        "stk_cd": stk_cd,
        "period": period,
        "adjusted": adjusted,
        "first_dt": coverage.first_dt if coverage is not None else None,
        "last_dt": coverage.last_dt if coverage is not None else None,
        "rows": rows,
    }


@router.post("/data/plan")
async def data_plan(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    store = _store(request)
    stk_cd, period, adjusted, from_dt, to_dt = _parse_range_body(body)
    coverage = await store.coverage(stk_cd, period, adjusted)
    cached = await store.candles(stk_cd, period, adjusted, start=from_dt, end=to_dt)
    plan = compute_plan(
        stk_cd=stk_cd, period=period, adjusted=adjusted,
        from_dt=from_dt, to_dt=to_dt, coverage=coverage,
    )
    return {
        "cached_rows": len(cached),
        "needed_pages": plan.estimated_pages,
        "est_seconds": plan.estimated_seconds,
        "segments": _missing_segments(from_dt, to_dt, coverage),
    }


# ── 상태 변경: 백필 ──────────────────────────────────────────────────────────


@router.post("/data/backfill")
async def start_backfill(
    request: Request, body: dict[str, Any], kiwoom_client: KiwoomClientDep
) -> JSONResponse:
    runner = _runner(request)
    stk_cd, period, adjusted, from_dt, to_dt = _parse_range_body(body)
    job_id = str(uuid4())
    fetch_page = kiwoom_fetch_page(kiwoom_client)
    # base_dt=to_dt — backfill()은 base_dt에서 과거 방향으로 from_dt까지 채운다(§5.3).
    runner.start_backfill(
        job_id, fetch_page=fetch_page, stk_cd=stk_cd, period=period, adjusted=adjusted,
        base_dt=to_dt, from_dt=from_dt,
    )
    return JSONResponse(status_code=202, content={"job_id": job_id})


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str) -> dict[str, Any]:
    runner = _runner(request)
    job = runner.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="잡이 존재하지 않는다")
    progress = None
    if job.progress is not None:
        progress = {
            "page": job.progress.page,
            "rows": job.progress.rows,
            "oldest_dt": job.progress.oldest_dt,
        }
    return {
        "job_id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": progress,
        "error": job.error,
    }


# ── 상태 변경: 실행 ──────────────────────────────────────────────────────────


@router.post("/runs")
async def start_run(request: Request, body: dict[str, Any]) -> JSONResponse:
    store = _store(request)
    runner = _runner(request)
    yaml_text = body.get("yaml")
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        raise HTTPException(status_code=422, detail="yaml은 비어 있지 않은 문자열이어야 한다")
    params = body.get("params")
    if params is not None and not isinstance(params, dict):
        raise HTTPException(status_code=422, detail="params는 객체여야 한다")

    try:
        spec = from_kis_yaml(yaml_text)
    except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 결과를 그대로 옮긴다
        raise HTTPException(status_code=422, detail=str(exc)) from None

    if spec.data is None:
        raise HTTPException(
            status_code=422, detail="전략에 data(종목·기간·주기)가 채워지지 않았다"
        )
    if len(spec.data.symbols) != 1:
        raise HTTPException(
            status_code=422,
            detail="이 실행 경로는 종목 1개만 지원한다(§2 — 실행당 대상 지정이 기본)",
        )
    stk_cd = spec.data.symbols[0]
    period, adjusted = spec.data.period, spec.data.adjusted
    from_dt, to_dt = spec.data.from_, spec.data.to

    coverage = await store.coverage(stk_cd, period, adjusted)
    plan = compute_plan(
        stk_cd=stk_cd, period=period, adjusted=adjusted,
        from_dt=from_dt, to_dt=to_dt, coverage=coverage,
    )
    if plan.estimated_pages > 0:
        # 캐시 부족 — 실행하지 않는다(계획서 §6.6). 사람이 승인 카드(data/backfill)를
        # 먼저 통과해야 한다.
        raise HTTPException(
            status_code=409,
            detail={"needed_pages": plan.estimated_pages, "est_seconds": plan.estimated_seconds},
        )

    candles = await store.candles(stk_cd, period, adjusted, start=from_dt, end=to_dt)
    df = _candles_to_frame(candles)

    now = datetime.now(UTC)
    # POST /runs는 {yaml, params}만 받는다 — 저장된 전략 CRUD(§6.6의 strategies 라우트군)는
    # 이 스코프 밖이다. 그래도 bt_run.strategy_version_id는 FK(NOT NULL)라 매 실행마다
    # 익명 전략+버전 한 쌍을 즉석에서 만든다 — 재현성의 축(store.py 문서)은 지킨다.
    strategy_id = str(uuid4())
    version_id = str(uuid4())
    await store.create_strategy(strategy_id, spec.metadata.name, "yaml", created_at=now)
    await store.add_version(
        version_id, strategy_id, 1, yaml_text, origin="form", created_at=now, active=True,
    )

    run_id = str(uuid4())
    params_json = json.dumps(params or {}, ensure_ascii=False)
    spec_hash = hashlib.sha256(f"{yaml_text}\n{params_json}".encode()).hexdigest()
    await store.create_run(
        run_id, version_id, params_json=params_json, spec_hash=spec_hash,
        status="running", started_at=now,
    )
    runner.start_run(run_id, spec=spec, df=df, overrides=params)
    return JSONResponse(status_code=202, content={"run_id": run_id})


@router.get("/runs")
async def list_runs(request: Request) -> dict[str, Any]:
    store = _store(request)
    rows = await store.runs()
    items = []
    for r in rows:
        metrics, _flags = _metrics_view(r.metrics_json)
        items.append(
            {
                "run_id": r.id,
                "status": r.status,
                "started_at": r.started_at,
                "finished_at": r.finished_at,
                "metrics": metrics,
            }
        )
    return {"runs": items}


@router.get("/runs/{run_id}")
async def get_run(request: Request, run_id: str) -> dict[str, Any]:
    store = _store(request)
    row = await store.run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="실행이 존재하지 않는다")
    equity = await store.equity(run_id)
    metrics, flags = _metrics_view(row.metrics_json)
    return {
        "run_id": row.id,
        "status": row.status,
        "metrics": metrics,
        "equity": [{"dt": p.dt, "equity": p.equity, "drawdown": p.drawdown} for p in equity],
        "stdout": row.stdout or "",
        "flags": flags,
        "error": row.error,
    }


@router.get("/runs/{run_id}/trades")
async def get_run_trades(request: Request, run_id: str) -> dict[str, Any]:
    store = _store(request)
    row = await store.run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="실행이 존재하지 않는다")
    trades = await store.trades(run_id)
    return {
        "trades": [
            {
                "seq": t.seq,
                "side": t.side,
                "dt": t.dt,
                "price": t.price,
                "qty": t.qty,
                "fee": t.fee,
                "tax": t.tax,
                "pnl": t.pnl,
                "reason": t.reason,
            }
            for t in trades
        ]
    }


@router.delete("/runs/{run_id}")
async def cancel_run(request: Request, run_id: str) -> dict[str, Any]:
    """실행 중이면 취소한다(runner.cancel — asyncio.Task.cancel). 이력 자체를 지우지는
    않는다(store.py에 delete가 없다 — 재사용·수정 금지 범위)."""
    store = _store(request)
    runner = _runner(request)
    row = await store.run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="실행이 존재하지 않는다")
    if row.status == "running":
        runner.cancel(run_id)
    return {"ok": True}


__all__ = ["router"]

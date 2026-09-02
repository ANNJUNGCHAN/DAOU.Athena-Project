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
import difflib
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from athena_api.backtest import codegen as codegen_mod
from athena_api.backtest import deploy as deploy_mod
from athena_api.backtest import diagnose as diagnose_mod
from athena_api.backtest import flow as flow_mod
from athena_api.backtest import indicators as indicators_mod
from athena_api.backtest import mapmodel as mapmodel_mod
from athena_api.backtest import optimize as optimize_mod
from athena_api.backtest import presets as presets_mod
from athena_api.backtest import user_strategies as user_strategies_mod
from athena_api.backtest import youtube as youtube_mod
from athena_api.backtest.data import compute_plan, kiwoom_fetch_page
from athena_api.backtest.runner import BacktestRunner, _align_signals, _run_code_signals
from athena_api.backtest.sandbox.guard import BLOCKED_TOP_LEVEL_IMPORTS
from athena_api.backtest.schema import StrategySpec, from_kis_yaml
from athena_api.backtest.store import (
    BacktestStore,
    Candle,
    Coverage,
    StrategyVersion,
    VersionBundle,
    hash_bundle,
    sha256_text,
)
from athena_api.dependencies import KiwoomClientDep
from athena_api.projects.store import venv_packages, venv_python

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


def _metrics_view(
    metrics_json: str | None,
) -> tuple[dict[str, Any] | None, list[str], list[float]]:
    """저장된 metrics_json에서 사람이 읽는 지표와 정직 표기 flags를 분리한다(engine.py
    §6.4 "가정" 섹션, runner.py가 costs_flag를 여기 얹어 저장했다).

    매수보유 곡선(benchmark)도 같이 떼낸다 — 지표 타일이 읽는 값이 아니라 자산곡선이
    쓰는 봉 수만큼의 배열이라, 목록 라우트가 실행 수만큼 그걸 실어 나르지 않게 한다."""
    if not metrics_json:
        return None, [], []
    payload = json.loads(metrics_json)
    flags = payload.pop("flags", [])
    benchmark = payload.pop("benchmark", [])
    return payload, flags, benchmark


def _yaml_error_detail(exc: Exception) -> str:
    """전략 yaml 파싱 실패를 사람이 읽는 한 문장으로 옮긴다.

    pydantic 원본 덤프는 "N validation errors for StrategySpec"과 errors.pydantic.dev
    링크까지 통째로 실려 온다 — 앱 오류 패널이 그 문장을 그대로 보여줘 사용자가 어느
    칸을 고쳐야 하는지 알 수 없었다(2026-09-02 실측). 어긋난 필드 이름만 남긴다.
    """
    if not isinstance(exc, ValidationError):
        return f"전략 yaml을 읽지 못했다: {exc}"
    fields = list(dict.fromkeys(".".join(str(x) for x in err["loc"]) for err in exc.errors()))
    return f"전략 yaml을 읽지 못했다 — 확인이 필요한 항목: {', '.join(fields)}"


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
    # 진행의 모양은 잡 종류마다 다르다(백필 page/rows, 환경 구성 step/line) — 각 진행
    # 객체가 자기 직렬화를 갖고 여기서는 그것을 그대로 싣는다(runner.py `to_dict`).
    progress = job.progress.to_dict() if job.progress is not None else None
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
    # 코드 경로(§6.2). `yaml`은 여전히 필수다 — data(종목·기간)·costs·risk는 코드가 아니라
    # 폼이 쥔다. 코드가 대신하는 것은 signals 생성 한 곳뿐이다.
    source = body.get("source")
    if source is not None and not isinstance(source, str):
        raise HTTPException(status_code=422, detail="source는 문자열이어야 한다")
    code_source = source if source and source.strip() else None
    # 어느 프로젝트의 코드인가 — 있으면 그 폴더의 가상환경으로 돈다. yaml 경로는 이 값을
    # 쓰지 않는다(폼 전략에는 사용자 환경이라는 개념이 없다).
    project_id = body.get("project_id")
    if project_id is not None and not isinstance(project_id, str):
        raise HTTPException(status_code=422, detail="project_id는 문자열이어야 한다")

    # 코드 경로에서는 폼의 진입/청산 조건이 읽히지 않는다 — 그 칸이 비었다고 실행을
    # 막으면 쓰지도 않는 규칙이 코드 전략을 가둔다(2026-09-02 실측). 완화는 조건 개수
    # 하나뿐이고, data·costs·risk·params는 폼 경로와 똑같이 검증된다.
    try:
        spec = from_kis_yaml(yaml_text, require_conditions=code_source is None)
    except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 실패를 422로 옮긴다
        raise HTTPException(status_code=422, detail=_yaml_error_detail(exc)) from None

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
    # `allow_partial`은 "보유 구간만으로 실행"(Paper 보드 04·10)이다. 이 출구가 없으면
    # 계획서 §11-9의 휴장일 함정에서 사용자가 영원히 빠져나오지 못한다 — 휴장일을 `from`으로
    # 주면 채울 수 없는 하루가 남아 백필을 아무리 돌려도 `needed_pages`가 0이 되지 않고,
    # 승인 카드를 눌러도 같은 자리로 돌아온다. 대신 이 경로로 들어온 실행에는 `partial`
    # 플래그를 남긴다 — 요청 구간 전부를 돌린 결과인 척하지 않는다.
    allow_partial = bool(body.get("allow_partial", False))
    if plan.estimated_pages > 0 and not allow_partial:
        # 캐시 부족 — 실행하지 않는다(계획서 §6.6). 사람이 승인 카드(data/backfill)를
        # 먼저 통과해야 한다.
        raise HTTPException(
            status_code=409,
            detail={"needed_pages": plan.estimated_pages, "est_seconds": plan.estimated_seconds},
        )

    candles = await store.candles(stk_cd, period, adjusted, start=from_dt, end=to_dt)
    if not candles:
        raise HTTPException(
            status_code=422,
            detail="캐시에 이 구간의 봉이 하나도 없다 — 먼저 수집해야 한다",
        )
    df = _candles_to_frame(candles)
    partial_flag = (
        f"보유 구간만 실행 · {candles[0].dt}~{candles[-1].dt}"
        if plan.estimated_pages > 0
        else None
    )

    # 프로젝트 가상환경으로 실행한다 — 사용자가 자기 폴더에 깐 패키지를 코드가 실제로
    # 쓸 수 있어야 "내 전략"이 성립한다. 가상환경이 아직 없으면 막지 않고 기본
    # 인터프리터로 돈다(pandas/numpy만 쓰는 코드는 그대로 돌아간다).
    #
    # 행을 만들기 **전에** 푼다 — 없는 프로젝트로 들어온 요청이 404로 끝날 때, 뒤에서
    # 풀면 status="running" 실행 행이 이미 남아 있고 아무도 그걸 거두지 않는다(store에
    # 묵은 실행을 쓸어내는 길이 없다). 이력에 영원히 도는 행이 생긴다.
    python_exe: str | None = None
    allowed_imports: list[str] | None = None
    if code_source and project_id:
        project_root = _project_root(project_id)
        if project_root is None:
            raise HTTPException(status_code=404, detail=f"프로젝트가 존재하지 않는다: {project_id}")
        interpreter = venv_python(project_root)
        if interpreter is not None:
            python_exe = str(interpreter)
            # 차단목록은 자식(guard.py)이 다시 적용한다 — 여기서 빼는 것은 "애초에 보내지
            # 않는다"는 두 번째 그물이지 유일한 그물이 아니다.
            allowed_imports = sorted(
                set(venv_packages(project_root)) - BLOCKED_TOP_LEVEL_IMPORTS
            )

    now = datetime.now(UTC)
    # POST /runs는 {yaml, params, source}만 받는다 — 저장된 전략 CRUD(§6.6의 strategies 라우트군)는
    # 이 스코프 밖이다. 그래도 bt_run.strategy_version_id는 FK(NOT NULL)라 매 실행마다
    # 익명 전략+버전 한 쌍을 즉석에서 만든다 — 재현성의 축(store.py 문서)은 지킨다.
    strategy_id = str(uuid4())
    version_id = str(uuid4())
    # 재현성의 축은 저장된 소스다 — 코드 경로면 실제로 돌린 파이썬을 버전으로 남긴다.
    # yaml만 남기면 나중에 그 실행을 다시 만들 수 없다(store.py 계약).
    kind = "python" if code_source else "yaml"
    await store.create_strategy(strategy_id, spec.metadata.name, kind, created_at=now)
    await store.add_version(
        version_id, strategy_id, 1, code_source or yaml_text,
        origin="human" if code_source else "form", created_at=now, active=True,
    )

    run_id = str(uuid4())
    params_json = json.dumps(params or {}, ensure_ascii=False)
    hash_input = (
        f"{yaml_text}\n{code_source}\n{params_json}"
        if code_source
        else f"{yaml_text}\n{params_json}"
    )
    spec_hash = hashlib.sha256(hash_input.encode()).hexdigest()
    await store.create_run(
        run_id, version_id, params_json=params_json, spec_hash=spec_hash,
        status="running", started_at=now,
    )
    runner.start_run(
        run_id, spec=spec, df=df, overrides=params, extra_flags=partial_flag, source=code_source,
        python_exe=python_exe, allowed_imports=allowed_imports,
    )
    # strategy_id·version_id를 같이 돌려준다 — 파일을 한 번 돌린 뒤 곧바로 배포로 넘어가려면
    # 화면이 "방금 그 실행이 어느 전략 버전이었는가"를 알아야 한다(추측하면 다른 행을 배포한다).
    return JSONResponse(
        status_code=202,
        content={
            "run_id": run_id,
            "partial": partial_flag,
            "strategy_id": strategy_id,
            "version_id": version_id,
        },
    )


@router.get("/runs")
async def list_runs(request: Request) -> dict[str, Any]:
    store = _store(request)
    rows = await store.runs()
    items = []
    for r in rows:
        metrics, _flags, _benchmark = _metrics_view(r.metrics_json)
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
    metrics, flags, benchmark = _metrics_view(row.metrics_json)
    return {
        "run_id": row.id,
        "status": row.status,
        "metrics": metrics,
        "equity": [{"dt": p.dt, "equity": p.equity, "drawdown": p.drawdown} for p in equity],
        # 자산곡선의 두 번째 선 — equity와 같은 길이·같은 봉이다(보드 03 "전략 vs 매수보유").
        "benchmark": benchmark,
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


# ── 코드 플로우 · 오류 진단 (조회 전용) ───────────────────────────────────────


@router.post("/flow")
async def flow_route(body: dict[str, Any]) -> dict[str, Any]:
    """전략 파이썬 소스를 단계 지도로 옮긴다(Paper 보드 08). 실행하지 않는다 —
    `ast`로 읽기만 하므로 사용자 코드가 이 요청에서 도는 일은 없다."""
    source = body.get("source")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=422, detail="source는 비어 있지 않은 문자열이어야 한다")
    return flow_mod.to_payload(flow_mod.build_flow(source))


@router.post("/map")
async def map_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """흐름 지도 — 폼(`yaml`)이든 코드(`source`)든 같은 지도 한 장으로 옮긴다(보드 11~14).
    실행하지 않는다: 폼은 스펙을 읽고, 코드는 `ast`로만 읽는다.

    `run_id`가 있으면 그 실행이 남긴 값으로 칸 오른쪽의 "사실"을 채운다 — 지도가 숫자를
    다시 계산하지 않는 이유는 그 순간 사실이 추정이 되기 때문이다(mapmodel.py 머리말).
    """
    yaml_text = body.get("yaml")
    source = body.get("source")
    has_yaml = isinstance(yaml_text, str) and bool(yaml_text.strip())
    has_source = isinstance(source, str) and bool(source.strip())
    if has_yaml == has_source:
        raise HTTPException(
            status_code=422, detail="yaml(폼)이나 source(코드) 중 하나만 줘야 한다"
        )
    spec: StrategySpec | None = None
    if has_yaml:
        try:
            spec = from_kis_yaml(str(yaml_text))
        except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 실패를 422로 옮긴다
            raise HTTPException(status_code=422, detail=_yaml_error_detail(exc)) from None

    result: dict[str, Any] | None = None
    run_id = body.get("run_id")
    if isinstance(run_id, str) and run_id:
        row = await _store(request).run(run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="실행이 존재하지 않는다")
        result, _flags, _benchmark = _metrics_view(row.metrics_json)

    error = body.get("error") if isinstance(body.get("error"), dict) else None
    version = body.get("version") if isinstance(body.get("version"), int) else None
    return mapmodel_mod.build_map(
        spec=spec,
        source=str(source) if has_source else None,
        result=result,
        error=error,
        version=version,
    )


@router.post("/codegen")
async def codegen_route(body: dict[str, Any]) -> dict[str, Any]:
    """지도(폼 yaml) 뒤에 놓을 전략 코드를 만든다. **저장하지 않는다** — 소스를 돌려줄
    뿐이고, 버전으로 남기는 것은 사람이 누른 뒤 버전 라우트가 한다(§7.3, /diagnose와 같다)."""
    yaml_text = body.get("yaml")
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        raise HTTPException(status_code=422, detail="yaml은 비어 있지 않은 문자열이어야 한다")
    try:
        spec = from_kis_yaml(yaml_text)
    except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 실패를 422로 옮긴다
        raise HTTPException(status_code=422, detail=_yaml_error_detail(exc)) from None
    source = codegen_mod.spec_to_python(spec)
    return {"source": source, "lines": len(source.splitlines())}


@router.post("/diagnose")
async def diagnose_route(body: dict[str, Any]) -> dict[str, Any]:
    """오류 텍스트와 소스로 진단·수정안을 만든다(Paper 보드 09). **적용하지 않는다** —
    새 소스를 계산해 돌려줄 뿐이고, 저장은 사람이 누른 뒤 버전 라우트가 한다(§7.3)."""
    error_text = body.get("error")
    source = body.get("source")
    if not isinstance(error_text, str) or not error_text.strip():
        raise HTTPException(status_code=422, detail="error는 비어 있지 않은 문자열이어야 한다")
    if not isinstance(source, str):
        raise HTTPException(status_code=422, detail="source는 문자열이어야 한다")
    known_indicators = [s.id for s in indicators_mod.list_all()]
    known_params = body.get("params") if isinstance(body.get("params"), list) else None
    return diagnose_mod.to_payload(
        diagnose_mod.diagnose(
            error_text, source,
            known_indicators=known_indicators,
            known_params=known_params,
        )
    )


# ── 전략 · 버전 (§6.6 strategies 라우트군) ────────────────────────────────────


@router.get("/strategies")
async def list_strategies_route(request: Request) -> dict[str, Any]:
    store = _store(request)
    return {
        "strategies": [
            {"id": s.id, "name": s.name, "kind": s.kind, "created_at": s.created_at}
            for s in await store.strategies()
        ]
    }


@router.post("/strategies")
async def create_strategy_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    store = _store(request)
    name = body.get("name")
    kind = body.get("kind")
    source = body.get("source")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="name은 비어 있지 않은 문자열이어야 한다")
    if kind not in ("yaml", "python"):
        raise HTTPException(status_code=422, detail="kind는 yaml 또는 python이어야 한다")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=422, detail="source는 비어 있지 않은 문자열이어야 한다")
    now = datetime.now(UTC)
    strategy_id = str(uuid4())
    version_id = str(uuid4())
    await store.create_strategy(strategy_id, name, kind, created_at=now)
    # 첫 버전은 사람이 만든 것이므로 바로 활성이다(§7.3 — 사람의 편집은 사람의 클릭이다).
    await store.add_version(
        version_id, strategy_id, 1, source, origin="human", created_at=now, active=True,
    )
    return {"strategy_id": strategy_id, "version_id": version_id, "version": 1}


@router.get("/strategies/{strategy_id}/versions")
async def list_versions_route(request: Request, strategy_id: str) -> dict[str, Any]:
    store = _store(request)
    if await store.strategy(strategy_id) is None:
        raise HTTPException(status_code=404, detail="전략이 존재하지 않는다")
    return {
        "versions": [
            {
                "id": v.id,
                "version": v.version,
                "source": v.source,
                "note": v.note,
                "origin": v.origin,
                "created_at": v.created_at,
                "active": v.active,
            }
            for v in await store.versions(strategy_id)
        ]
    }


@router.get("/strategies/{strategy_id}/versions/{version_id}")
async def get_version_route(
    request: Request, strategy_id: str, version_id: str
) -> dict[str, Any]:
    """버전 하나를 bundle까지 펼쳐 돌려준다.

    목록 라우트는 소스만 준다 — 지난 시각 버전을 **다시 열어** 그래프를 보려면 graph와
    source map, 그리고 그때의 compiler version이 있어야 한다(재현성). 없으면 화면은
    "예전 그래프"를 새로 추정할 수밖에 없고, 그건 재현이 아니라 창작이다.
    """
    store = _store(request)
    if await store.strategy(strategy_id) is None:
        raise HTTPException(status_code=404, detail="전략이 존재하지 않는다")
    version = await store.version(version_id)
    if version is None or version.strategy_id != strategy_id:
        raise HTTPException(status_code=404, detail="그 전략에 속한 버전이 아니다")
    bundle = version.bundle
    return {
        "id": version.id,
        "version": version.version,
        "source": version.source,
        "note": version.note,
        "origin": version.origin,
        "created_at": version.created_at,
        "active": version.active,
        # `is_active`는 §8 receipt가 쓰는 이름이고 `active`는 기존 목록 라우트가 쓰는
        # 이름이다 — 같은 값이다. 호출자가 둘 중 무엇을 읽어도 같은 답을 보게 둔다.
        "is_active": version.active,
        "graph": None if bundle is None else json.loads(bundle.graph_json),
        "spec_yaml": None if bundle is None else bundle.spec_yaml,
        "source_map": None if bundle is None else json.loads(bundle.source_map_json),
        "hashes": None if bundle is None else json.loads(bundle.hashes_json),
        "compiler_version": None if bundle is None else bundle.compiler_version,
        "apply_receipt": (
            None
            if bundle is None or bundle.apply_receipt_json is None
            else json.loads(bundle.apply_receipt_json)
        ),
    }


# ── 시각 버전 저장 (visual · code_only) ──────────────────────────────────────

# 사람이 patch를 검토하고 눌렀다는 증거. 하나라도 없으면 "그냥 versions API를 불렀다"와
# 구분되지 않으므로 저장하지 않는다(연구 문서 §사용자 적용 이후 서버 처리).
_RECEIPT_FIELDS = (
    "base_version_id",
    "base_graph_hash",
    "base_artifact_hash",
    "patch_id",
    "patch_hash",
    "applied_at",
)


def _apply_receipt(body: dict[str, Any]) -> dict[str, str]:
    raw = body.get("apply_receipt")
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=422, detail="origin=visual은 apply_receipt가 필요하다(사람의 적용 증거)"
        )
    missing = [
        field
        for field in _RECEIPT_FIELDS
        if not isinstance(raw.get(field), str) or not str(raw[field]).strip()
    ]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"apply_receipt 필수 필드가 없다: {', '.join(missing)}"
        )
    return {field: str(raw[field]) for field in _RECEIPT_FIELDS}


def _visual_bundle(
    body: dict[str, Any], source: str, receipt: dict[str, str]
) -> VersionBundle:
    """bundle을 검사하고 hash를 **다시 계산**한다 — 클라이언트가 보낸 hash를 믿지 않는다.

    hash를 그대로 저장하면 그래프와 코드가 어긋난 bundle도 "일치한다"고 서명해 준다.
    재유도한 값과 다르면 저장하지 않는다.
    """
    raw = body.get("bundle")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="origin=visual은 bundle 객체가 필요하다")
    graph = raw.get("graph")
    spec_yaml = raw.get("spec_yaml")
    source_map = raw.get("source_map")
    compiler_version = raw.get("compiler_version")
    claimed = raw.get("hashes")
    if not isinstance(graph, dict):
        raise HTTPException(status_code=422, detail="bundle.graph는 객체여야 한다")
    if not isinstance(spec_yaml, str) or not spec_yaml.strip():
        raise HTTPException(status_code=422, detail="bundle.spec_yaml은 비어 있지 않아야 한다")
    if not isinstance(source_map, dict):
        raise HTTPException(status_code=422, detail="bundle.source_map은 객체여야 한다")
    if not isinstance(compiler_version, str) or not compiler_version.strip():
        raise HTTPException(
            status_code=422, detail="bundle.compiler_version은 비어 있지 않아야 한다"
        )
    if not isinstance(claimed, dict):
        raise HTTPException(status_code=422, detail="bundle.hashes는 객체여야 한다")
    derived = hash_bundle(graph, spec_yaml, source)
    mismatched = sorted(name for name, value in derived.items() if claimed.get(name) != value)
    if mismatched:
        raise HTTPException(
            status_code=422,
            detail=f"bundle hash가 본문에서 다시 계산한 값과 다르다: {', '.join(mismatched)}",
        )
    return VersionBundle(
        graph_json=json.dumps(graph, ensure_ascii=False, sort_keys=True),
        spec_yaml=spec_yaml,
        source_map_json=json.dumps(source_map, ensure_ascii=False, sort_keys=True),
        hashes_json=json.dumps(derived, ensure_ascii=False, sort_keys=True),
        compiler_version=compiler_version,
        apply_receipt_json=json.dumps(receipt, ensure_ascii=False, sort_keys=True),
    )


def _check_base_is_fresh(
    existing: tuple[StrategyVersion, ...], receipt: dict[str, str]
) -> None:
    """optimistic concurrency — patch가 본 base가 아직 이 전략의 머리인지 확인한다.

    409를 내는 이유는 요청이 잘못돼서(422)가 아니라 **그 사이 세상이 바뀌어서**다.
    화면은 다시 읽어 patch를 새로 만들어야 하며, 그 구분이 사용자에게 보여야 한다.
    """
    if not existing:
        raise HTTPException(status_code=409, detail="base로 삼을 버전이 없다")
    head = max(existing, key=lambda v: v.version)
    if receipt["base_version_id"] != head.id:
        raise HTTPException(
            status_code=409,
            detail="base 버전이 최신이 아니다 — 최신 버전을 다시 읽고 patch를 만들어야 한다",
        )
    if receipt["base_artifact_hash"] != sha256_text(head.source):
        raise HTTPException(status_code=409, detail="base 코드가 그 사이 바뀌었다")
    # 그래프 없는 base(사람이 손으로 쓴 첫 버전) 위에 첫 시각 버전을 만드는 길은 막지
    # 않는다 — 대조할 저장된 그래프가 없을 뿐, 코드 hash는 위에서 이미 대조했다.
    if head.bundle is not None:
        stored = json.loads(head.bundle.hashes_json)
        if receipt["base_graph_hash"] != stored.get("graph_hash"):
            raise HTTPException(status_code=409, detail="base 그래프가 그 사이 바뀌었다")


async def _add_inactive_version(
    store: BacktestStore,
    strategy_id: str,
    body: dict[str, Any],
    *,
    source: str,
    origin: str,
    existing: tuple[StrategyVersion, ...],
) -> dict[str, Any]:
    """`visual`·`code_only` 버전을 **항상 비활성으로** 저장한다.

    저장이 곧 활성화가 아니다 — 활성화는 `/activate`의 사람 클릭이고, 실행은 `/runs`다.
    클라이언트가 `active: true`를 보내면 조용히 무시하지 않고 거부한다: 무시하면 화면은
    켜졌다고 믿고 서버는 껐다고 믿는 상태가 남는다.
    """
    if body.get("active") is not None and bool(body.get("active")):
        raise HTTPException(
            status_code=422,
            detail=f"origin={origin} 버전은 활성으로 저장할 수 없다 — 활성화는 /activate 전용이다",
        )
    receipt: dict[str, str] | None = None
    bundle: VersionBundle | None = None
    if origin == "visual":
        receipt = _apply_receipt(body)
        _check_base_is_fresh(existing, receipt)
        bundle = _visual_bundle(body, source, receipt)
    elif body.get("bundle") is not None:
        # code-only 분기는 "코드가 그래프로 표현되지 않는다"는 뜻이다 — 여기에 그래프를
        # 같이 저장하면 동기화됐다고 표시하는 것과 같다(연구 문서 §표현 불가능한 코드 수정).
        raise HTTPException(
            status_code=422, detail="origin=code_only 버전은 bundle을 가질 수 없다"
        )
    before = await store.active_version_id(strategy_id)
    next_version = max((v.version for v in existing), default=0) + 1
    version_id = str(uuid4())
    await store.add_version(
        version_id, strategy_id, next_version, source,
        note=body.get("note"), origin=origin,
        created_at=datetime.now(UTC), active=False, bundle=bundle,
    )
    after = await store.active_version_id(strategy_id)
    if after != before:
        # 저장층이 같은 불변식을 이미 지키지만, 뚫렸다면 조용히 200을 돌려주면 안 된다.
        raise HTTPException(status_code=500, detail="저장 중 활성 버전이 바뀌었다")
    # 응답은 저장된 값을 **다시 읽어** 만든다 — 보낸 값을 되돌려주면 receipt가 아니다.
    saved = await store.version(version_id)
    if saved is None:  # pragma: no cover - 같은 트랜잭션에서 방금 쓴 행이다
        raise HTTPException(status_code=500, detail="저장된 버전을 다시 읽지 못했다")
    return {
        "version_id": saved.id,
        "version": saved.version,
        "active": saved.active,
        "is_active": saved.active,
        "origin": saved.origin,
        "active_version_id": after,
        "hashes": None if saved.bundle is None else json.loads(saved.bundle.hashes_json),
        "compiler_version": None if saved.bundle is None else saved.bundle.compiler_version,
        "apply_receipt": receipt,
    }


@router.post("/strategies/{strategy_id}/versions")
async def add_version_route(
    request: Request, strategy_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """새 버전을 만든다.

    `origin`이 `llm_draft`면 **활성화하지 않는다** — 모델이 코드를 바꿔놓고 사람은 옛 코드가
    도는 줄 아는 경로를 원천 차단한다(§7.3). `human`은 즉시 활성이다(사람의 편집은 사람의
    클릭이다). 이 분기가 이 라우트의 존재 이유다. `visual`·`code_only`는 세 번째 갈래로,
    저장은 하되 절대 켜지 않는다 — 그 갈래는 `_add_inactive_version()`이 맡는다.
    """
    store = _store(request)
    if await store.strategy(strategy_id) is None:
        raise HTTPException(status_code=404, detail="전략이 존재하지 않는다")
    source = body.get("source")
    origin = body.get("origin", "human")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=422, detail="source는 비어 있지 않은 문자열이어야 한다")
    if origin not in ("human", "form", "llm_draft", "visual", "code_only"):
        raise HTTPException(
            status_code=422, detail="origin은 human|form|llm_draft|visual|code_only여야 한다"
        )
    existing = await store.versions(strategy_id)
    if origin in ("visual", "code_only"):
        return await _add_inactive_version(
            store, strategy_id, body, source=source, origin=origin, existing=existing
        )
    next_version = max((v.version for v in existing), default=0) + 1
    version_id = str(uuid4())
    await store.add_version(
        version_id, strategy_id, next_version, source,
        note=body.get("note"), origin=origin,
        created_at=datetime.now(UTC), active=origin != "llm_draft",
    )
    return {"version_id": version_id, "version": next_version, "active": origin != "llm_draft"}


@router.post("/strategies/{strategy_id}/activate")
async def activate_version_route(
    request: Request, strategy_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """버전을 활성화한다 — **사람 클릭 전용**이다(MCP에는 이 액션이 없다, §9)."""
    store = _store(request)
    version_id = body.get("version_id")
    if not isinstance(version_id, str) or not version_id:
        raise HTTPException(status_code=422, detail="version_id가 필요하다")
    versions = await store.versions(strategy_id)
    if not any(v.id == version_id for v in versions):
        raise HTTPException(status_code=404, detail="그 전략에 속한 버전이 아니다")
    await store.activate_version(strategy_id, version_id)
    return {"ok": True, "active_version_id": version_id}


@router.get("/strategies/{strategy_id}/diff")
async def diff_versions_route(
    request: Request, strategy_id: str, base: str, head: str
) -> dict[str, Any]:
    """두 버전의 줄 단위 diff(Paper 보드 05 "코드 diff"). 라이브러리 없이 difflib 하나로
    낸다 — 전략 파일은 수백 줄 규모라 그 이상이 필요하지 않다(§7.4)."""
    store = _store(request)
    versions = {v.id: v for v in await store.versions(strategy_id)}
    if base not in versions or head not in versions:
        raise HTTPException(status_code=404, detail="그 전략에 속한 버전이 아니다")
    base_lines = versions[base].source.splitlines()
    head_lines = versions[head].source.splitlines()
    lines: list[dict[str, str]] = []
    added = removed = 0
    for line in difflib.unified_diff(base_lines, head_lines, lineterm="", n=2):
        if line.startswith(("---", "+++")):
            continue
        mark = line[0] if line and line[0] in "+-@" else " "
        if mark == "+":
            added += 1
        elif mark == "-":
            removed += 1
        lines.append({"mark": mark, "text": line[1:] if mark in "+- " else line})
    return {
        "base_version": versions[base].version,
        "head_version": versions[head].version,
        "added": added,
        "removed": removed,
        "lines": lines,
    }


# ── 최적화 (Paper 보드 06) ───────────────────────────────────────────────────


def _parse_ranges(raw: Any) -> list[optimize_mod.ParamRange]:
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=422, detail="ranges는 비어 있지 않은 배열이어야 한다")
    out: list[optimize_mod.ParamRange] = []
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="ranges 항목은 객체여야 한다")
        try:
            out.append(
                optimize_mod.ParamRange(
                    name=str(item["name"]),
                    start=float(item["start"]),
                    stop=float(item["stop"]),
                    step=float(item["step"]),
                    is_int=bool(item.get("is_int", True)),
                )
            )
        except KeyError as exc:
            raise HTTPException(status_code=422, detail=f"필수 필드가 없다: {exc}") from None
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    return out


@router.post("/optimize/plan")
async def optimize_plan_route(body: dict[str, Any]) -> dict[str, Any]:
    """실행 전에 조합 수만 센다 — 보드 06의 "조합 276개 · 예상 ~2초"가 이 값을 쓴다.
    상한을 넘는지도 여기서 알려준다(눌러 놓고 거절당하지 않게)."""
    ranges = _parse_ranges(body.get("ranges"))
    ascending = body.get("ascending")
    constraint = (
        optimize_mod.ascending_constraint(*ascending)
        if isinstance(ascending, list) and len(ascending) >= 2
        else None
    )
    try:
        total = optimize_mod.count_combinations(ranges, constraint)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return {
        "combinations": total,
        "max_combinations": optimize_mod.MAX_COMBINATIONS,
        "over_limit": total > optimize_mod.MAX_COMBINATIONS,
        "values_per_param": {r.name: len(r.values()) for r in ranges},
    }


@router.post("/optimize")
async def optimize_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """그리드·랜덤 서치를 돌린다. **캐시만 쓴다** — 캐시 밖 구간이 있으면 409로 거절하고
    수집 승인을 먼저 받게 한다(보드 06 "추가 TR 호출 없음")."""
    store = _store(request)
    yaml_text = body.get("yaml")
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        raise HTTPException(status_code=422, detail="yaml은 비어 있지 않은 문자열이어야 한다")
    try:
        spec = from_kis_yaml(yaml_text)
    except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 결과를 그대로 옮긴다
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if spec.data is None or len(spec.data.symbols) != 1:
        raise HTTPException(status_code=422, detail="data에 종목 1개와 기간이 있어야 한다")

    ranges = _parse_ranges(body.get("ranges"))
    unknown = [r.name for r in ranges if r.name not in spec.strategy.params]
    if unknown:
        raise HTTPException(status_code=422, detail=f"알 수 없는 전략 파라미터: {unknown}")

    stk_cd = spec.data.symbols[0]
    coverage = await store.coverage(stk_cd, spec.data.period, spec.data.adjusted)
    plan = compute_plan(
        stk_cd=stk_cd, period=spec.data.period, adjusted=spec.data.adjusted,
        from_dt=spec.data.from_, to_dt=spec.data.to, coverage=coverage,
    )
    if plan.estimated_pages > 0:
        raise HTTPException(
            status_code=409,
            detail={"needed_pages": plan.estimated_pages, "est_seconds": plan.estimated_seconds},
        )
    candles = await store.candles(
        stk_cd, spec.data.period, spec.data.adjusted, start=spec.data.from_, end=spec.data.to
    )
    if not candles:
        raise HTTPException(status_code=422, detail="캐시에 이 구간의 봉이 하나도 없다")
    df = _candles_to_frame(candles)

    ascending = body.get("ascending")
    constraint = (
        optimize_mod.ascending_constraint(*ascending)
        if isinstance(ascending, list) and len(ascending) >= 2
        else None
    )
    method = body.get("method", "grid")
    if method not in ("grid", "random"):
        raise HTTPException(status_code=422, detail="method는 grid 또는 random이어야 한다")
    try:
        result = optimize_mod.optimize(
            spec, df, ranges,
            method=method,
            samples=body.get("samples"),
            seed=body.get("seed"),
            constraint=constraint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    payload: dict[str, Any] = {
        "method": result.method,
        "best": None if result.best is None else {
            "params": result.best.params,
            "sharpe": result.best.sharpe,
            "total_return": result.best.total_return,
            "mdd": result.best.mdd,
            "trades": result.best.trades,
        },
        "neighbour_mean_sharpe": result.neighbour_mean_sharpe,
        "plateau": None if result.plateau is None else {
            k: list(v) for k, v in result.plateau.items()
        },
        "warnings": [{"kind": w.kind, "message": w.message} for w in result.warnings],
        "trials": [
            {
                "params": t.params, "sharpe": t.sharpe, "total_return": t.total_return,
                "mdd": t.mdd, "trades": t.trades, "error": t.error,
            }
            for t in result.trials
        ],
    }
    if len(ranges) >= 2:
        payload["heatmap"] = optimize_mod.heatmap(result, ranges[0].name, ranges[1].name)
    return payload


# ── 배포 · 실전 적용 (Paper 보드 07) ─────────────────────────────────────────


def _limits_from(body: dict[str, Any]) -> deploy_mod.Limits:
    raw = body.get("limits")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="limits 객체가 필요하다")
    try:
        return deploy_mod.Limits(
            max_order_amount=float(raw["max_order_amount"]),
            max_orders_per_day=int(raw["max_orders_per_day"]),
            valid_from=str(raw["valid_from"]),
            valid_to=str(raw["valid_to"]),
            stop_on_drawdown_pct=float(raw["stop_on_drawdown_pct"]),
            stop_on_consecutive_losses=int(raw["stop_on_consecutive_losses"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"limits에 필수 필드가 없다: {exc}") from None
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


def _deployment_view(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "strategy_version_id": row.strategy_version_id,
        "run_id": row.run_id,
        "stk_cd": row.stk_cd,
        "period": row.period,
        "adjusted": row.adjusted,
        "mode": row.mode,
        "mode_label": deploy_mod.MODE_LABELS.get(row.mode, row.mode),
        "params": json.loads(row.params_json),
        "limits": json.loads(row.limits_json),
        "status": row.status,
        "created_at": row.created_at,
        "stopped_at": row.stopped_at,
    }


@router.get("/deployments")
async def list_deployments_route(request: Request) -> dict[str, Any]:
    store = _store(request)
    return {"deployments": [_deployment_view(d) for d in await store.deployments()]}


@router.post("/deployments")
async def create_deployment_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """배포를 만든다 — **사람 클릭 전용**이다. MCP에 이 액션을 두지 않는 이유는 배포가
    돈이 나가는 경로의 스위치이기 때문이다(`backfill`/`activate`와 같은 규율, §9)."""
    store = _store(request)
    version_id = body.get("strategy_version_id")
    mode = body.get("mode")
    stk_cd = body.get("stk_cd")
    if not isinstance(version_id, str) or not version_id:
        raise HTTPException(status_code=422, detail="strategy_version_id가 필요하다")
    if mode not in ("observe", "approve", "auto"):
        raise HTTPException(status_code=422, detail="mode는 observe|approve|auto여야 한다")
    if not isinstance(stk_cd, str) or not stk_cd:
        raise HTTPException(status_code=422, detail="stk_cd가 필요하다")
    limits = _limits_from(body)
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    deployment_id = str(uuid4())
    await store.create_deployment(
        deployment_id,
        strategy_version_id=version_id,
        run_id=body.get("run_id"),
        stk_cd=stk_cd,
        period=str(body.get("period", "day")),
        adjusted=bool(body.get("adjusted", True)),
        mode=mode,
        params_json=json.dumps(params, ensure_ascii=False),
        limits_json=json.dumps(
            {
                "max_order_amount": limits.max_order_amount,
                "max_orders_per_day": limits.max_orders_per_day,
                "valid_from": limits.valid_from,
                "valid_to": limits.valid_to,
                "stop_on_drawdown_pct": limits.stop_on_drawdown_pct,
                "stop_on_consecutive_losses": limits.stop_on_consecutive_losses,
            },
            ensure_ascii=False,
        ),
        created_at=datetime.now(UTC),
    )
    return {"deployment_id": deployment_id}


@router.delete("/deployments/{deployment_id}")
async def stop_deployment_route(request: Request, deployment_id: str) -> dict[str, Any]:
    store = _store(request)
    if await store.deployment(deployment_id) is None:
        raise HTTPException(status_code=404, detail="배포가 존재하지 않는다")
    await store.stop_deployment(deployment_id, stopped_at=datetime.now(UTC))
    return {"ok": True, "note": "이미 나간 주문은 취소되지 않는다"}


@router.get("/deployments/{deployment_id}/signals")
async def list_signals_route(request: Request, deployment_id: str) -> dict[str, Any]:
    store = _store(request)
    if await store.deployment(deployment_id) is None:
        raise HTTPException(status_code=404, detail="배포가 존재하지 않는다")
    return {
        "signals": [
            {
                "id": s.id, "dt": s.dt, "side": s.side, "stage": s.stage,
                "reason": s.reason, "basis": s.basis,
                "blocked_reason": s.blocked_reason, "fill_price": s.fill_price,
            }
            for s in await store.signals(deployment_id)
        ]
    }


@router.post("/deployments/{deployment_id}/evaluate")
async def evaluate_deployment_route(
    request: Request, deployment_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """마지막 봉으로 오늘의 신호를 판정한다. **주문을 내지 않는다** — 판정과 한도 검사만
    하고, 주문은 앱의 기존 주문 게이트가 사람 클릭으로 낸다(deploy.py 머리말)."""
    store = _store(request)
    row = await store.deployment(deployment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="배포가 존재하지 않는다")
    version = await store.version(row.strategy_version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="배포에 묶인 전략 버전을 찾을 수 없다")
    # 배포에 묶인 소스가 폼(yaml)인지 코드(python)인지는 전략의 kind가 쥔다. 코드 전략을
    # yaml로 읽으려 들면 파싱 오류 422로 끝나 — 만들 수는 있는데 영원히 판정할 수 없는
    # 배포가 남는다(2026-09-02 실측). 그 막다른 길을 여기서 없앤다.
    strategy = await store.strategy(version.strategy_id)
    spec: StrategySpec | None = None
    try:
        spec = from_kis_yaml(version.source)
    except Exception as exc:  # noqa: BLE001 — 저장된 소스가 yaml이 아닐 수 있다
        if strategy is None or strategy.kind != "python":
            raise HTTPException(
                status_code=422, detail=f"배포에 묶인 버전을 스펙으로 읽지 못했다: {exc}"
            ) from None

    candles = await store.candles(row.stk_cd, row.period, row.adjusted)
    if not candles:
        raise HTTPException(status_code=422, detail="캐시에 이 종목의 봉이 없다")
    df = _candles_to_frame(candles)

    limits_raw = json.loads(row.limits_json)
    deployment = deploy_mod.Deployment(
        id=row.id,
        strategy_version_id=row.strategy_version_id,
        run_id=row.run_id,
        stk_cd=row.stk_cd,
        period=row.period,
        adjusted=row.adjusted,
        mode=row.mode,  # type: ignore[arg-type]
        params=json.loads(row.params_json),
        limits=deploy_mod.Limits(**limits_raw),
        status=row.status,  # type: ignore[arg-type]
    )
    signals = None
    if spec is None:
        # 코드 전략의 신호는 실행 라우트와 **같은 샌드박스**가 만든다(§6.2) — 여기서 두 번째
        # 신호 생성 경로를 만들면 배포가 낸 신호와 백테스트가 낸 신호가 갈라진다.
        # 파라미터 우선순위도 그쪽과 같다: 코드 PARAMS 기본값 < 배포에 저장된 params.
        outcome = await _run_code_signals(version.source, df, deployment.params or None)
        if not outcome["ok"]:
            err = outcome["error"]
            # 사용자 코드가 터진 사실을 yaml 파싱 오류로 바꿔 말하지 않는다.
            raise HTTPException(
                status_code=422, detail=f"{err['type']}: {err['message']}"
            )
        signals = _align_signals(outcome["signals_df"], df.index)

    today = str(body.get("today") or deploy_mod.today_str())
    decision = deploy_mod.evaluate_latest(
        spec, df, deployment,
        signals=signals,
        today=today,
        holding=bool(body.get("holding", False)),
        orders_today=int(body.get("orders_today", 0)),
        order_amount=float(body.get("order_amount", 0.0)),
        consecutive_losses=int(body.get("consecutive_losses", 0)),
        drawdown_pct=float(body.get("drawdown_pct", 0.0)),
    )

    signal_id = None
    # 조건이 안 맞은 날은 기록하지 않는다 — 조용한 날로 이력을 채우면 사람이 못 읽는다.
    if decision.stage != "skipped":
        signal_id = str(uuid4())
        await store.add_signal(
            signal_id,
            deployment_id=deployment_id,
            dt=decision.dt,
            side=decision.side,
            stage=decision.stage,
            reason=decision.reason,
            basis=decision.basis,
            blocked_reason=decision.blocked_reason,
            created_at=datetime.now(UTC),
        )
    return {
        "signal_id": signal_id,
        "dt": decision.dt,
        "side": decision.side,
        "stage": decision.stage,
        "reason": decision.reason,
        "basis": decision.basis,
        "blocked_reason": decision.blocked_reason,
    }


# ── 유튜브 브리프 · 사용자 전략 등록부 (결정 D5 · D2·D3) ──────────────────────


@router.post("/youtube/brief")
async def youtube_brief_route(body: dict[str, Any]) -> dict[str, Any]:
    """영상 주소 하나로 자막(없으면 설명)을 평문 브리프로 돌려준다(결정 D5).

    **여기서 나온 text는 데이터다, 지시가 아니다** — 모델에게 줄 자료일 뿐이라
    실행 경로로는 가지 않는다(youtube.py 모듈 주석).
    """
    url = body.get("url")
    if not isinstance(url, str) or not url.strip():
        raise HTTPException(status_code=422, detail="url은 비어 있지 않은 문자열이어야 한다")
    try:
        return await youtube_mod.fetch_brief(url)
    except youtube_mod.BriefError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from None


def _user_strategies(request: Request) -> user_strategies_mod.UserStrategyRegistry:
    """등록부는 sqlite 옆에 JSON 한 장으로 산다 — 파일이 진실이라(D2) 스키마를 늘릴
    이유가 없다. 서브시스템 비활성 gate는 `_store`와 같은 규율을 쓴다."""
    _store(request)
    path = request.app.state.settings.backtest_db_path.parent / "user-strategies.json"
    registry = user_strategies_mod.UserStrategyRegistry(path)
    registry.load()
    return registry


def _project_root(project_id: str) -> Path | None:
    """프로젝트 폴더 해석은 `athena_api/projects`가 소유한다 — 아직 없을 수 있어서 함수
    안에서 늦게 import하고, 없으면 503으로 말한다(조용히 빈 결과를 주지 않는다).

    등록되지 않은 프로젝트(KeyError)는 None이다 — 목록은 그걸 exists=false로 보여주고,
    등록은 404로 거절한다.
    """
    try:
        from athena_api.projects.store import resolve_project_path
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="프로젝트 저장소가 아직 없다") from exc
    try:
        return Path(resolve_project_path(project_id))
    except KeyError:
        return None


@router.post("/user-strategies")
async def register_user_strategy_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """내 폴더의 .py 하나를 프리셋처럼 고를 수 있게 등록한다(결정 D2·D3).

    소스를 복사하지 않는다 — {project_id, 상대경로}만 남긴다. 파일이 진실이라, 등록한
    뒤 파일을 고치면 다음 실행이 고친 파일을 읽는다.
    """
    registry = _user_strategies(request)
    project_id = body.get("project_id")
    raw_path = body.get("path")
    name = body.get("name")
    if not isinstance(project_id, str) or not project_id.strip():
        raise HTTPException(status_code=422, detail="project_id는 비어 있지 않은 문자열이어야 한다")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=422, detail="path는 비어 있지 않은 문자열이어야 한다")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="name은 비어 있지 않은 문자열이어야 한다")
    root = _project_root(project_id)
    if root is None:
        raise HTTPException(status_code=404, detail=f"프로젝트가 존재하지 않는다: {project_id}")
    try:
        rel = user_strategies_mod.relative_python_path(root, raw_path)
    except user_strategies_mod.UserStrategyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    target = root / rel
    if not target.is_file():
        raise HTTPException(status_code=422, detail=f"파일이 없다: {rel}")
    try:
        source = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail=f"파일을 UTF-8로 읽지 못했다: {rel}") from None
    # 계약 검사는 POST /validate(kind=python)를 그대로 부른다 — 같은 규칙을 두 번 적어
    # 두면 언젠가 두 곳이 서로 다른 말을 한다.
    verdict = await validate_route({"kind": "python", "source": source})
    if not verdict["ok"]:
        raise HTTPException(status_code=422, detail=verdict["errors"][0]["message"])
    entry = registry.add(
        name=name.strip(),
        project_id=project_id,
        path=rel,
        created_at=datetime.now(UTC).isoformat(),
    )
    return entry.to_dict()


@router.get("/user-strategies")
async def list_user_strategies_route(request: Request) -> dict[str, Any]:
    """`exists`도 `params`도 저장된 값이 아니라 지금 디스크를 본 결과다 — 파일이
    진실이라(D2) 등록부가 파일을 대신 말하면 안 된다. `params`는 프리셋과 같은 모양의
    슬라이더를 그리라고 `PARAMS` 기본값을 읽어 주는 것이다."""
    registry = _user_strategies(request)
    items: list[dict[str, Any]] = []
    for entry in registry.list_all():
        root = _project_root(entry.project_id)
        target = None if root is None else root / entry.path
        exists = target is not None and target.is_file()
        params: dict[str, Any] = {}
        if exists and target is not None:
            try:
                params = dict(flow_mod.params_defaults(target.read_text(encoding="utf-8")))
            except (OSError, UnicodeDecodeError):
                params = {}
        items.append(
            {
                "id": entry.id,
                "name": entry.name,
                "project_id": entry.project_id,
                "path": entry.path,
                "exists": exists,
                "params": params,
            }
        )
    return {"strategies": items}


@router.delete("/user-strategies/{strategy_id}")
async def unregister_user_strategy_route(request: Request, strategy_id: str) -> dict[str, Any]:
    """등록만 지운다 — 파일은 사용자 폴더의 것이라 우리가 지울 물건이 아니다(D2)."""
    registry = _user_strategies(request)
    if not registry.remove(strategy_id):
        raise HTTPException(status_code=404, detail="등록된 전략이 아니다")
    return {"ok": True, "note": "등록만 지웠다 — 파일은 그대로다"}


__all__ = ["router"]

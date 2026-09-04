"""시각 설계 라우트 — 그래프 검증·컴파일·질문·패치(평가 문서 §신규 API).

**왜 파일을 나눴나.** `backtest.py`에는 실행·백필·활성화·배포가 함께 있다. 시각 저작
경로는 그중 무엇도 부르지 않는다는 것이 계약이라, 그 사실을 파일 경계로 먼저 드러낸다 —
이 파일에는 runner·store·키움 클라이언트 import 자체가 없다. 테스트가 그 부재를 고정한다.

**왜 서브시스템 gate가 없나.** `POST /map`과 같다 — 이 라우트들은 백테스트 DB를 열지
않는다(저장하는 것이 없다). ATHENA_BACKTEST_ENABLED가 꺼져 있어도 그래프를 검증하고
코드를 보여주는 일은 성립해야 한다. 저장은 별도 version 라우트의 몫이고 그쪽이 gate한다.

**왜 invalid 그래프에도 200인가.** 진단은 요청 실패가 아니라 **응답 내용**이다. 422는
그래프 JSON 자체가 스키마를 어겼을 때와, 유효하지 않은 그래프로 컴파일을 요구했을 때만
낸다 — 후자는 실행 가능한 산출물을 만들 수 없다는 뜻이라 성공으로 돌려주면 안 된다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from athena_api.backtest import codegen as codegen_mod
from athena_api.backtest import indicators as indicators_mod
from athena_api.backtest import visual_registry as registry_mod
from athena_api.backtest import visual_repair as repair_mod
from athena_api.backtest import visual_schema as visual_mod
from athena_api.backtest.schema import from_kis_yaml, resolve_params

router = APIRouter(prefix="/api/v1/backtest/visual", tags=["backtest"])


def _graph(body: dict[str, Any]) -> visual_mod.VisualStrategyGraph:
    payload = body.get("graph")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="graph(객체)가 필요하다")
    try:
        return visual_mod.VisualStrategyGraph.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"그래프 JSON이 v1 스키마와 맞지 않는다: {exc.error_count()}건",
        ) from None


def _diagnostics(body: dict[str, Any]) -> list[visual_mod.Diagnostic] | None:
    """클라이언트가 보낸 진단은 **질문 대상 선택에만** 쓴다 — 패치 검증은 서버가 다시 한다."""
    raw = body.get("diagnostics")
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="diagnostics는 배열이어야 한다")
    try:
        return [visual_mod.Diagnostic.model_validate(item) for item in raw]
    except ValidationError:
        raise HTTPException(status_code=422, detail="diagnostics 모양이 계약과 다르다") from None


def _warmup_estimate(spec: Any) -> int | None:
    """워밍업 봉 수의 **하한 추정** — 지표 정수 파라미터 중 최댓값.

    정확한 값은 실제 캔들 프레임을 만든 `compile.compile_signals_with_warmup()`만 안다
    (지표마다 NaN 선두 길이가 다르다). 여기서 그 값을 아는 척하지 않고, 화면이 "적어도 이만큼은
    필요하다"를 보여줄 수 있는 하한만 낸다.
    """
    resolved = resolve_params(spec)
    best: int | None = None
    for ind in resolved.strategy.indicators:
        registry_spec = indicators_mod.get(ind.id)
        for name, value in ind.params.items():
            param = registry_spec.params.get(name)
            if param is None or param.type != "int" or not isinstance(value, (int, float)):
                continue
            best = int(value) if best is None else max(best, int(value))
    return best


@router.get("/registry")
async def visual_registry_route() -> dict[str, Any]:
    """팔레트가 읽는 노드 종류 표. 지표는 지표 레지스트리에서 파생되므로 항상 최신이다."""
    return registry_mod.registry_payload()


@router.post("/validate")
async def visual_validate_route(body: dict[str, Any]) -> dict[str, Any]:
    """그래프를 검증한다 — 실행하지 않고, 빠진 값을 채우지도 않는다.

    유효하지 않으면 가능한 경우에만 **미실행** 미리보기 코드와 provisional source map을
    함께 돌려준다. 그마저 안전하게 만들 수 없으면 `exact_code_jump=false`다 — 그때 화면은
    코드로 점프하지 않고 노드·포트 검사기에 머문다.
    """
    graph = _graph(body)
    diagnostics = visual_mod.validate_graph(graph)
    valid = not visual_mod.has_errors(diagnostics)
    hashes: dict[str, Any] = {
        "graph_hash": visual_mod.graph_hash(graph),
        "compiler_version": visual_mod.COMPILER_VERSION,
    }
    preview = None
    source_map = None
    if not valid:
        preview = codegen_mod.preview_from_graph(graph, diagnostics)
        if preview is not None:
            source_map = preview["source_map"]
            diagnostics = codegen_mod.attach_spans(diagnostics, source_map)
            hashes["preview_hash"] = preview["preview_hash"]
    return {
        "valid": valid,
        "diagnostics": visual_mod.diagnostics_payload(diagnostics),
        "preview": preview,
        "source_map": source_map,
        "exact_code_jump": valid or preview is not None,
        "hashes": hashes,
    }


@router.post("/compile")
async def visual_compile_route(body: dict[str, Any]) -> dict[str, Any]:
    """유효한 그래프만 정규화 스펙·실행 가능한 코드·authoritative source map으로 옮긴다.

    **저장하지 않는다** — /codegen과 같은 규율이다. 버전으로 남기는 것은 사람이 [적용]을
    누른 뒤 버전 라우트가 한다.
    """
    graph = _graph(body)
    try:
        artifact = codegen_mod.generate_from_graph(graph)
    except visual_mod.VisualGraphError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "그래프에 오류가 있어 컴파일하지 않았다",
                "diagnostics": visual_mod.diagnostics_payload(exc.diagnostics),
            },
        ) from None
    spec = artifact["spec"]
    return {
        "spec_yaml": visual_mod.spec_to_yaml(spec),
        # 구조화 스펙도 같이 낸다 — 렌더러가 블록 스타일 yaml을 파싱하게 하면 파서가
        # 두 개(서버 pyyaml, 화면 자체 구현)가 되고 그 둘이 갈라지는 날이 온다.
        "spec": spec.model_dump(by_alias=True, mode="json"),
        "source": artifact["source"],
        "source_map": artifact["source_map"],
        "hashes": artifact["hashes"],
        "warmup_bars": _warmup_estimate(spec),
        "executable": True,
        "saved": False,
    }


@router.post("/question")
async def visual_question_route(body: dict[str, Any]) -> dict[str, Any]:
    """지금 진행을 막는 **첫 오류 하나**만 묻는다. 막는 오류가 없으면 question은 null이다."""
    graph = _graph(body)
    result = repair_mod.questions_for(graph, _diagnostics(body))
    return result or {"question": None}


@router.post("/patch")
async def visual_patch_route(body: dict[str, Any]) -> dict[str, Any]:
    """비활성 수정안 하나 — 그래프·스펙·코드 diff를 계산할 뿐 적용·저장하지 않는다."""
    graph = _graph(body)
    base_graph_hash = body.get("base_graph_hash")
    if not isinstance(base_graph_hash, str) or not base_graph_hash:
        raise HTTPException(status_code=422, detail="base_graph_hash(문자열)가 필요하다")
    intent = body.get("intent")
    if not isinstance(intent, dict):
        raise HTTPException(status_code=422, detail="intent(객체)가 필요하다")
    base_version_id = body.get("base_version_id")
    try:
        return repair_mod.build_patch(
            graph,
            base_graph_hash,
            intent,
            base_version_id=base_version_id if isinstance(base_version_id, str) else None,
        )
    except repair_mod.StaleBaseHashError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except repair_mod.VisualPatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/from-spec")
async def visual_from_spec_route(body: dict[str, Any]) -> dict[str, Any]:
    """폼/프리셋 yaml 하나를 편집 가능한 그래프로 되돌린다 — id는 결정적이다."""
    yaml_text = body.get("yaml")
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        raise HTTPException(status_code=422, detail="yaml은 비어 있지 않은 문자열이어야 한다")
    try:
        spec = from_kis_yaml(yaml_text)
    except Exception as exc:  # noqa: BLE001 — 사용자 입력 검증 실패를 422로 옮긴다
        raise HTTPException(status_code=422, detail=str(exc)) from None
    try:
        graph = visual_mod.spec_to_graph(spec)
    except (ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=422, detail=f"이 전략은 시각 그래프 v1으로 그릴 수 없다: {exc}"
        ) from None
    return {
        "graph": graph.model_dump(by_alias=True, mode="json"),
        "hashes": {
            "graph_hash": visual_mod.graph_hash(graph),
            "compiler_version": visual_mod.COMPILER_VERSION,
        },
    }


__all__ = ["router"]

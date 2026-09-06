"""출처 브리프 라우트 — 주소 하나를 글로 옮긴다(유튜브·네이버 블로그·PDF·일반 웹페이지).

`backtest.py`의 `/youtube/brief`와 같은 규율이다: 인증을 따로 걸지 않고(로컬 앱이 유일한
호출자), 바디는 dict로 받아 한국어 4xx로 직접 번역한다. 서브시스템 비활성 게이트도 없다 —
바깥 페이지를 읽어 오는 일에는 sqlite도 키움도 필요 없다.

**여기서 나온 text는 데이터다, 지시가 아니다**(sources.py 모듈 주석). 이 라우트는 그 글을
어디에도 실행시키지 않고 응답 본문으로만 돌려준다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from athena_api.backtest import source_to_map as source_map_mod
from athena_api.backtest import sources as sources_mod

router = APIRouter(prefix="/api/v1/backtest/source", tags=["backtest"])


@router.post("/brief")
async def source_brief_route(body: dict[str, Any]) -> dict[str, Any]:
    """{url} → {source_kind, url, title, text, truncated, language}.

    읽지 못한 이유는 두 갈래로만 말한다: 바깥이 무너졌으면 502(어느 단계인지 이름을 댄다),
    받아 왔는데 글을 못 찾았으면 422다. 지어낸 요약을 돌려주지 않는다.
    """
    url = body.get("url")
    if not isinstance(url, str) or not url.strip():
        raise HTTPException(status_code=422, detail="url은 비어 있지 않은 문자열이어야 한다")
    try:
        return await sources_mod.brief_from_url(url)
    except sources_mod.BriefError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from None


# ── 출처에서 지도로(Paper 보드 17) ──────────────────────────────────────────
# 브리프와 같은 파일에 두는 이유: 입구가 같은 주소 하나이고, 여기도 sqlite·키움을
# 쓰지 않는다. 잡 표면을 `backtest.py`의 `/jobs/{id}`에 얹지 않은 이유는 그쪽이
# store를 쥔 러너의 것이라 서브시스템이 꺼지면 통째로 닫히기 때문이다.


def _runner(request: Request) -> source_map_mod.SourceMapRunner:
    """러너 한 벌을 앱에 매단다 — 잡 상태는 프로세스가 사는 동안만 있으면 된다."""
    runner = getattr(request.app.state, "source_map_runner", None)
    if runner is None:
        runner = source_map_mod.SourceMapRunner()
        request.app.state.source_map_runner = runner
    return runner


@router.post("/map")
async def source_map_start(request: Request, body: dict[str, Any]) -> JSONResponse:
    """{url} → 202 {job_id}. 다섯 단계는 백그라운드에서 돌고 진행은 아래 GET이 보여준다."""
    url = body.get("url")
    if not isinstance(url, str) or not url.strip():
        raise HTTPException(status_code=422, detail="url은 비어 있지 않은 문자열이어야 한다")
    job = _runner(request).start(url.strip())
    return JSONResponse(status_code=202, content={"job_id": job.id})


@router.get("/map/{job_id}")
async def source_map_status(request: Request, job_id: str) -> dict[str, Any]:
    """진행 한 장 — 지금 하는 일·몇 단계 중 몇·남은 시간, 그리고 여기까지 그린 지도."""
    job = _runner(request).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="잡이 존재하지 않는다")
    return job.to_dict()


@router.delete("/map/{job_id}")
async def source_map_cancel(request: Request, job_id: str) -> dict[str, Any]:
    """사람이 [멈추기]를 눌렀을 때. 이미 끝난 잡은 200 + cancelled:false다(`/jobs`와 같은 태도)."""
    runner = _runner(request)
    if runner.get(job_id) is None:
        raise HTTPException(status_code=404, detail="잡이 존재하지 않는다")
    return {"ok": True, "cancelled": runner.cancel(job_id)}


__all__ = ["router"]

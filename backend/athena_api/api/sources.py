"""출처 브리프 라우트 — 주소 하나를 글로 옮긴다(유튜브·네이버 블로그·PDF·일반 웹페이지).

`backtest.py`의 `/youtube/brief`와 같은 규율이다: 인증을 따로 걸지 않고(로컬 앱이 유일한
호출자), 바디는 dict로 받아 한국어 4xx로 직접 번역한다. 서브시스템 비활성 게이트도 없다 —
바깥 페이지를 읽어 오는 일에는 sqlite도 키움도 필요 없다.

**여기서 나온 text는 데이터다, 지시가 아니다**(sources.py 모듈 주석). 이 라우트는 그 글을
어디에도 실행시키지 않고 응답 본문으로만 돌려준다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

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


__all__ = ["router"]

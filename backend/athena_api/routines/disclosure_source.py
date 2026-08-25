
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"

# 종목코드(6자리) → DART corp_code(8자리) 해석기. 프로덕션 배선은 corp_code
# 매핑 파일/조회가 필요하다 — 해석 실패(None)는 폴링 skip이지 에러가 아니다.
CorpCodeResolver = Callable[[str], Awaitable[str | None]]


class DisclosureSourceError(RuntimeError):
    """소스 실패 — upstream 원문을 담지 않는 도메인 에러."""


def parse_list_payload(payload: Any) -> list[dict[str, str]]:
    """DART list.json 응답에서 (rcept_no, title, date)만 뽑는다.

    status '000'=정상, '013'=조회 결과 없음(정상 빈 목록). 그 외는 소스 실패.
    """
    if not isinstance(payload, dict):
        raise DisclosureSourceError("DART 응답 형상이 아니다")
    status = str(payload.get("status", ""))
    if status == "013":
        return []
    if status != "000":
        raise DisclosureSourceError(f"DART status {status}")
    items = payload.get("list")
    if not isinstance(items, list):
        return []
    out: list[dict[str, str]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        rcept_no = str(row.get("rcept_no", "")).strip()
        title = str(row.get("report_nm", "")).strip()
        if rcept_no and title:
            out.append(
                {
                    "rcept_no": rcept_no,
                    "title": title,
                    "date": str(row.get("rcept_dt", "")).strip(),
                }
            )
    return out


@dataclass
class DartDisclosureSource:
    """대상 종목의 신규 공시 제목을 가져온다. 이미 본 rcept_no는 걸러낸다."""

    api_key: str
    resolve_corp_code: CorpCodeResolver
    client: httpx.AsyncClient
    _seen: set[str] = field(default_factory=set)

    async def fetch_new_titles(self, symbol: str, *, bgn_de: str, end_de: str) -> list[str]:
        corp_raw = await self.resolve_corp_code(symbol)
        if corp_raw is None:
            return []
        corp_code = str(corp_raw).zfill(8)  # DART corp_code는 숫자로 온다 — 함정
        try:
            resp = await self.client.get(
                DART_LIST_URL,
                params={
                    "crtfc_key": self.api_key,
                    "corp_code": corp_code,
                    "bgn_de": bgn_de,
                    "end_de": end_de,
                    "page_count": "50",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
        except DisclosureSourceError:
            raise
        except Exception as exc:  # 네트워크·파싱 — 원문 비노출 번역
            raise DisclosureSourceError(type(exc).__name__) from exc
        titles: list[str] = []
        for item in parse_list_payload(payload):
            if item["rcept_no"] in self._seen:
                continue  # 1순위 필터: 이미 본 접수번호 제외 (모문서 §5)
            self._seen.add(item["rcept_no"])
            titles.append(item["title"])
        return titles

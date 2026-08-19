"""DART corp_code 카탈로그 — 종목코드(6자리) → corp_code(8자리) 해석.

DART corpCode.xml(zip)을 최초 1회 내려받아 로컬에 캐시하고, 이후 조회는
메모리 사전이다. 다운로드 실패는 공시 폴러 강등이지 기동 실패가 아니다.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"


class CorpCatalogError(RuntimeError):
    """카탈로그 확보 실패 — upstream 원문 비노출."""


def parse_corp_xml(xml_bytes: bytes) -> dict[str, str]:
    """CORPCODE.xml에서 stock_code(6자리) → corp_code(8자리) 사전을 만든다."""
    mapping: dict[str, str] = {}
    root = ET.fromstring(xml_bytes)
    for node in root.iter("list"):
        stock = (node.findtext("stock_code") or "").strip()
        corp = (node.findtext("corp_code") or "").strip()
        if len(stock) == 6 and stock.isdigit() and corp:
            mapping[stock] = corp.zfill(8)  # 숫자로 오는 corp_code 함정
    return mapping


def extract_corp_xml(zip_bytes: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if name.upper().endswith(".XML"):
                return zf.read(name)
    raise CorpCatalogError("corpCode.xml이 zip 안에 없다")


@dataclass
class CorpCatalog:
    api_key: str
    cache_path: Path
    client: httpx.AsyncClient
    _mapping: dict[str, str] | None = field(default=None)

    async def _ensure_loaded(self) -> None:
        if self._mapping is not None:
            return
        if self.cache_path.exists():
            self._mapping = parse_corp_xml(self.cache_path.read_bytes())
            return
        try:
            resp = await self.client.get(
                CORP_CODE_URL, params={"crtfc_key": self.api_key}
            )
            resp.raise_for_status()
            xml_bytes = extract_corp_xml(resp.content)
        except CorpCatalogError:
            raise
        except Exception as exc:
            raise CorpCatalogError(type(exc).__name__) from exc
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_suffix(".tmp")
        tmp.write_bytes(xml_bytes)
        tmp.replace(self.cache_path)
        self._mapping = parse_corp_xml(xml_bytes)

    async def resolve(self, symbol: str) -> str | None:
        await self._ensure_loaded()
        assert self._mapping is not None
        return self._mapping.get(symbol)

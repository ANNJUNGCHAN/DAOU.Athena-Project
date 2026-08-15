"""
pykrx-mcp 6/8 툴 실패 원인 진단 — data.krx.co.kr (공개 웹사이트 스크래핑 엔드포인트,
KRX 오픈API와 무관·인증 불필요)에 직접 POST 해서 원문 응답을 본다.
"""
import json
from pathlib import Path

import requests

CAPTURES = Path(__file__).resolve().parents[2] / "spike" / "captures"
CAPTURES.mkdir(parents=True, exist_ok=True)

URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd",
}

# 전종목시세 (get_market_ticker_list 가 쓰는 bld)
params_ticker_list = {
    "bld": "dbms/MDC/STAT/standard/MDCSTAT01501",
    "trdDd": "20240102",
    "mktId": "STK",
}

# 개별종목 시세 (get_stock_ohlcv 가 쓰는 bld - 성공한 경로, 대조군)
params_ohlcv = {
    "bld": "dbms/MDC/STAT/standard/MDCSTAT01701",
    "isuCd": "KR7005930003",
    "strtDd": "20240102",
    "endDd": "20240112",
    "adjStkPrc": "2",
    "adjStkPrc_check": "Y",
}

results = {}
for label, params in [("ticker_list_bld_MDCSTAT01501", params_ticker_list), ("ohlcv_bld_MDCSTAT01701_control", params_ohlcv)]:
    try:
        r = requests.post(URL, data=params, headers=HEADERS, timeout=15)
        try:
            body_json = r.json()
        except Exception as e:
            body_json = None
        results[label] = {
            "status_code": r.status_code,
            "content_length": len(r.content),
            "content_type": r.headers.get("Content-Type"),
            "body_text_head": r.text[:1500],
            "body_json_ok": body_json is not None,
        }
    except Exception as e:
        results[label] = {"exception": repr(e)}

# 헤더 없이(User-Agent/Referer 없이) 같은 요청 - pykrx 기본 동작 재현
for label, params in [("ticker_list_no_headers", params_ticker_list)]:
    try:
        r = requests.post(URL, data=params, timeout=15)
        results[label] = {
            "status_code": r.status_code,
            "content_length": len(r.content),
            "content_type": r.headers.get("Content-Type"),
            "body_text_head": r.text[:1500],
        }
    except Exception as e:
        results[label] = {"exception": repr(e)}

out_path = CAPTURES / "KRX-pykrx-raw-endpoint-probe.json"
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"WROTE {out_path}")

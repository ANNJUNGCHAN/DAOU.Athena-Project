"""ka10173 이종 메시지 실측 스파이크.

목적: 같은 TR(ka10173, trnm=CNSRREQ 실시간 타입) 아래 병존하는 두 메시지의 실제 봉투를 캡처한다.
  1. 조회 응답 — data = LIST of jmcode (조건 충족 종목 목록)
  2. 실시간 푸시 — trnm=REAL, data = LIST of FID values (편입/이탈 이벤트)

전제:
  - backend/.env 에 ATHENA_KIWOOM_ACCOUNTS(모의계좌 app_key/secret_key)가 있어야 한다.
  - 조건식은 영웅문4에서 미리 만들어야 CNSRLST 목록에 잡힌다 (registry.py ka10171 명세).
  - 자격증명은 프로세스 메모리에만 둔다. 캡처 파일에 토큰·키를 기록하지 않는다.

산출물 (전부 UTF-8, spike/captures/ 불변 증거):
  KA10173-cnsrlst.json          조건식 목록 (ka10171)
  KA10173-query-envelope.json   ka10172 일반 조회 응답 봉투 (비교 기준)
  KA10173-realtime-ack.json     ka10173 실시간 등록(search_type=1) 응답 봉투
  KA10173-realtime-push.json    REAL 푸시 프레임들 (관찰 창 동안 수집, 0건이면 그 사실 기록)

실행: python spike/cond-realtime/probe_ka10173.py [--watch-seconds 120]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import websockets

SPIKE_DIR = Path(__file__).resolve().parent
REPO = SPIKE_DIR.parent.parent
CAPTURE_DIR = REPO / "spike" / "captures"
ENV_PATH = REPO / "backend" / ".env"

REST_BASE = "https://mockapi.kiwoom.com"
WS_URL = "wss://mockapi.kiwoom.com:10000/api/dostk/websocket"
TOKEN_ENDPOINT = "/oauth2/token"

SECRET_KEYS = {"token", "app_key", "secret_key", "appkey", "secretkey"}


def load_credentials() -> dict:
    if not ENV_PATH.exists():
        sys.exit("차단: backend/.env 가 없다. ATHENA_KIWOOM_ACCOUNTS 를 설정해야 실측 가능.")
    accounts_line = None
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("ATHENA_KIWOOM_ACCOUNTS="):
            accounts_line = line.split("=", 1)[1]
    if not accounts_line:
        sys.exit("차단: backend/.env 에 ATHENA_KIWOOM_ACCOUNTS 항목이 없다.")
    accounts = json.loads(accounts_line)
    acct = accounts[0]
    if not acct.get("app_key") or not acct.get("secret_key"):
        sys.exit("차단: ATHENA_KIWOOM_ACCOUNTS 의 app_key/secret_key 가 비어 있다.")
    return acct


def scrub(obj):
    """캡처에서 비밀값 필드를 재귀 제거한다 (계좌 정보 로깅 금지 원칙)."""
    if isinstance(obj, dict):
        return {k: ("<redacted>" if k.lower() in SECRET_KEYS else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(x) for x in obj]
    return obj


def save(name: str, payload) -> None:
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = CAPTURE_DIR / name
    doc = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "source": "mockapi.kiwoom.com (모의계좌)",
        "payload": scrub(payload),
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {path.relative_to(REPO)}")


async def issue_token(acct: dict) -> str:
    async with httpx.AsyncClient(base_url=REST_BASE, timeout=15) as client:
        resp = await client.post(
            TOKEN_ENDPOINT,
            json={
                "grant_type": "client_credentials",
                "appkey": acct["app_key"],
                "secretkey": acct["secret_key"],
            },
        )
        resp.raise_for_status()
        body = resp.json()
    token = body.get("token") or body.get("access_token")
    if not token:
        sys.exit(f"차단: 토큰 응답에 token 이 없다: return_code={body.get('return_code')}")
    return token


async def ws_call(ws, frame: dict, want_trnm: str, timeout: float = 15) -> dict:
    await ws.send(json.dumps(frame))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout)
        msg = json.loads(raw)
        if msg.get("trnm") == "PING":
            await ws.send(raw)
            continue
        if msg.get("trnm") == want_trnm:
            return msg


async def main(watch_seconds: int) -> None:
    acct = load_credentials()
    token = await issue_token(acct)
    async with websockets.connect(WS_URL) as ws:
        login = await ws_call(ws, {"trnm": "LOGIN", "token": token}, "LOGIN")
        if str(login.get("return_code")) != "0":
            sys.exit(f"차단: LOGIN 거부 return_code={login.get('return_code')}")

        # 1) 조건식 목록 (ka10171)
        cnsrlst = await ws_call(ws, {"trnm": "CNSRLST"}, "CNSRLST")
        save("KA10173-cnsrlst.json", cnsrlst)
        conditions = cnsrlst.get("data") or []
        if not conditions:
            save(
                "KA10173-realtime-push.json",
                {
                    "blocked": "조건식 0건 — 영웅문4에서 조건식을 먼저 만들어야 한다",
                    "판정_보류_사유": "조회/실시간 봉투 실측 불가",
                },
            )
            sys.exit("차단: 조건식이 없다. 영웅문4에서 조건식 생성 후 재실행.")
        seq = str(conditions[0][0] if isinstance(conditions[0], list) else conditions[0].get("seq", "0"))

        # 2) 일반 조회 (ka10172, search_type=0) — 비교 기준 봉투
        query = await ws_call(
            ws,
            {"trnm": "CNSRREQ", "seq": seq, "search_type": "0", "stex_tp": "K"},
            "CNSRREQ",
        )
        save("KA10173-query-envelope.json", query)

        # 3) 실시간 등록 (ka10173, search_type=1) — ack 봉투
        ack = await ws_call(
            ws,
            {"trnm": "CNSRREQ", "seq": seq, "search_type": "1", "stex_tp": "K"},
            "CNSRREQ",
        )
        save("KA10173-realtime-ack.json", ack)

        # 4) REAL 푸시 관찰 창
        pushes: list[dict] = []
        deadline = asyncio.get_event_loop().time() + watch_seconds
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), min(10, watch_seconds))
            except TimeoutError:
                continue
            msg = json.loads(raw)
            if msg.get("trnm") == "PING":
                await ws.send(raw)
            elif msg.get("trnm") == "REAL":
                pushes.append(msg)
        save(
            "KA10173-realtime-push.json",
            {
                "watch_seconds": watch_seconds,
                "push_count": len(pushes),
                "note": "0건이면 관찰 창 내 편입/이탈이 없었다는 사실 기록 — 봉투 부재와 혼동 금지",
                "frames": pushes,
            },
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=120)
    args = parser.parse_args()
    asyncio.run(main(args.watch_seconds))

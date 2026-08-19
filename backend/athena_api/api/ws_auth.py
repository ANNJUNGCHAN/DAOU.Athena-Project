"""WS 다운스트림 인증 — stream.py에서 추출한 공유 헬퍼.

의미론은 **배타적 2모드**이며 순차 폴백이 아니다(실행계획 프리모템 4 —
추출 중 루프백이 우회 경로로 오작동하는 보안 회귀 방지):
- 모드 A(베어러 토큰 설정 배포): Authorization 헤더 **또는** 첫 메시지 auth
  envelope 중 하나가 반드시 유효해야 한다. **루프백 호스트는 어떤 경우에도
  우회 경로가 아니다.**
- 모드 B(토큰 미설정 로컬 기본): 루프백 호스트 제한이 유일 게이트다.
동작 불변은 기존 stream WS 테스트 전건 + 신규 회귀 테스트(토큰 설정 +
루프백 무인증 → 1008)가 고정한다.
"""

from __future__ import annotations

import secrets

from fastapi import WebSocket, WebSocketDisconnect

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def _valid_bearer(value: str | None, expected: str) -> bool:
    if value is None or not expected.strip():
        return False
    scheme, _, token = value.partition(" ")
    return scheme.lower() == "bearer" and secrets.compare_digest(token.strip(), expected)


async def authenticate_downstream_ws(websocket: WebSocket) -> bool:
    """accept() 이후 호출한다. False면 이미 close(1008)까지 처리된 상태다."""
    expected = getattr(websocket.app.state, "local_bearer_token", None)
    host = websocket.client.host if websocket.client is not None else ""
    authorization = websocket.headers.get("authorization")

    if expected is not None:
        if authorization is not None:
            if not _valid_bearer(authorization, expected):
                await websocket.close(code=1008)
                return False
        else:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                return False
            except ValueError:
                await websocket.close(code=1008)
                return False
            if (
                not isinstance(message, dict)
                or message.get("type") != "auth"
                or not isinstance(message.get("token"), str)
                or not secrets.compare_digest(message["token"], expected)
            ):
                await websocket.close(code=1008)
                return False
    elif host not in _LOOPBACK_HOSTS:
        await websocket.close(code=1008)
        return False
    return True

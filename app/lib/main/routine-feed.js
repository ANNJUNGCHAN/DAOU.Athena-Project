// 루틴 알림 구독 — 백엔드 /api/v1/ws/routines를 메인 프로세스가 구독한다.
//
// 인증은 첫 메시지 auth envelope 경로를 쓴다(브라우저 호환 WebSocket API는
// 커스텀 헤더를 못 싣는다 — 백엔드 배타 2모드의 envelope 갈래가 정확히 이
// 상황용이다). 토큰 미설정 로컬 기본 배포에서는 평문 연결(루프백 게이트).
// 재연결은 지수 백오프(기본 1s, 상한 30s) — 백엔드 재시작을 조용히 견딘다.
'use strict';

class RoutineFeed {
  constructor(opts) {
    this._url = opts.url;
    this._token = opts.token || null;
    this._WebSocketImpl = opts.WebSocketImpl || globalThis.WebSocket;
    this._onEvent = opts.onEvent;
    this._onStatus = opts.onStatus || (() => {});
    this._baseDelayMs = opts.baseDelayMs ?? 1000;
    this._maxDelayMs = opts.maxDelayMs ?? 30_000;
    this._setTimeout = opts.setTimeoutImpl || setTimeout;
    this._clearTimeout = opts.clearTimeoutImpl || clearTimeout;
    this._ws = null;
    this._timer = null;
    this._delayMs = this._baseDelayMs;
    this._stopped = true;
  }

  start() {
    if (!this._WebSocketImpl) {
      this._onStatus({ state: 'unsupported' });
      return;
    }
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    if (this._timer) { this._clearTimeout(this._timer); this._timer = null; }
    if (this._ws) {
      try { this._ws.close(); } catch { /* 이미 닫힘 */ }
      this._ws = null;
    }
  }

  _connect() {
    if (this._stopped) return;
    let ws;
    try {
      ws = new this._WebSocketImpl(this._url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    ws.onopen = () => {
      this._delayMs = this._baseDelayMs; // 성공 — 백오프 리셋
      if (this._token) {
        ws.send(JSON.stringify({ type: 'auth', token: this._token }));
      }
      this._onStatus({ state: 'connected' });
    };
    ws.onmessage = (msg) => {
      let event;
      try {
        event = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
      } catch { return; } // 해석 불가 프레임은 버린다 — 재연결 사유 아님
      this._onEvent(event);
    };
    ws.onclose = () => {
      this._ws = null;
      this._onStatus({ state: 'disconnected' });
      this._scheduleReconnect();
    };
    ws.onerror = () => { /* onclose가 뒤따른다 — 이중 재연결 방지 */ };
  }

  _scheduleReconnect() {
    if (this._stopped || this._timer) return;
    const delay = this._delayMs;
    this._delayMs = Math.min(this._delayMs * 2, this._maxDelayMs);
    this._timer = this._setTimeout(() => {
      this._timer = null;
      this._connect();
    }, delay);
  }
}

module.exports = { RoutineFeed };

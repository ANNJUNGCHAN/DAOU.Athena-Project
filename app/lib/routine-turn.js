// IIFE 스코프 격리(2026-08-18 렌더러 격리) — canvas-layout.js와 같은 UMD 패턴.
(function () {
// 능동 턴·토스트의 결정론 템플릿 — LLM 0 (실행계획 §7-4: 알림 본문은 원장
// 행의 1:1 렌더링이라 지어낼 수가 없다). 시점 정직성: 발화 시각 배지와
// 감시 방식 표기는 여기서 만들어져 모든 표면(토스트·능동 턴)이 공유한다.
'use strict';

function describeMode(mode) {
  return mode === 'realtime-ws' ? '실시간 (WS)' : '주기 확인';
}

function relativeText(firedAtIso, nowMs) {
  const fired = Date.parse(firedAtIso);
  if (!Number.isFinite(fired)) return null;
  const diffS = Math.max(0, Math.floor((nowMs - fired) / 1000));
  if (diffS < 60) return '방금';
  const m = Math.floor(diffS / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분 전`;
}

function badgeText(firedAtIso) {
  const fired = new Date(firedAtIso);
  if (Number.isNaN(fired.getTime())) return '발화';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(fired.getHours())}:${p(fired.getMinutes())} 발화`;
}

// event → 능동 턴 렌더 모델. kind: fired | expired | restore-failed | unknown.
function buildTurnModel(event, nowMs) {
  if (!event || typeof event !== 'object') {
    return { kind: 'unknown', body: '해석할 수 없는 알림을 받았다.' };
  }
  if (event.type === 'routine-fired') {
    return {
      kind: 'fired',
      badge: badgeText(event.fired_at),
      relative: relativeText(event.fired_at, nowMs),
      modeText: describeMode(event.mode),
      sourceLabel: `루틴 '${event.note || event.routine_id}' · 에이전트 발화 — 묻지 않은 턴입니다`,
      body:
        `${event.symbol} 조건 도달 — 관측값 ${event.observed} (임계 ${event.threshold}). ` +
        '값은 발화 시점 기준입니다 — 최신 확인은 다시 물어봐 주세요.',
    };
  }
  if (event.type === 'routine-expired') {
    return {
      kind: 'expired',
      modeText: null,
      sourceLabel: '루틴 만료 안내 — 묻지 않은 턴입니다',
      body: `루틴 '${event.note || event.routine_id}'이 만료로 종료됐다. 계속 필요하면 다시 등록해 달라.`,
    };
  }
  if (event.type === 'routine-restore-failed') {
    return {
      kind: 'restore-failed',
      modeText: null,
      sourceLabel: '감시 복원 실패 — 강제 알림',
      body: event.note || '저장된 루틴을 복원하지 못했다 — 감시가 비어 있다.',
    };
  }
  return { kind: 'unknown', body: '해석할 수 없는 알림을 받았다.' };
}

// OS 토스트용 — Electron Notification의 title/body.
function buildToast(event) {
  const model = buildTurnModel(event, Date.now ? Date.now() : 0);
  if (model.kind === 'fired') {
    return {
      title: `${event.symbol} 조건 도달 — ${describeMode(event.mode)}`,
      body: `${event.note || ''} · 관측 ${event.observed}`,
    };
  }
  if (model.kind === 'expired') {
    return { title: '루틴 만료', body: model.body };
  }
  if (model.kind === 'restore-failed') {
    return { title: '감시 복원 실패', body: model.body };
  }
  return { title: 'Athena 알림', body: model.body };
}

const __exports = { describeMode, relativeText, badgeText, buildTurnModel, buildToast };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RoutineTurn = __exports;
}

})();

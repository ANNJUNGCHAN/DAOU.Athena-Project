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

// 급변 판정 배율(board-31⑤ 캡션 "변동성 급등"). 관측값이 임계치의 이 배수
// 이상이면 정상 발화가 아니라 급변으로 본다 — 근거 데이터 없이 잡은 최초값
// 이라 캘리브레이션 여지가 있다(실사용 피드백으로 조정 예정).
const SURGE_RATIO = 1.5;

/** 관측값이 임계치를 SURGE_RATIO배 이상 초과했는지 — 급변(놀람) 여부.
 * 숫자 파싱·검증은 relativeText의 Date.parse+Number.isFinite 관례를 그대로
 * 옮긴 것이다: 파싱 실패나 임계 0(나눗셈 불능)이면 판정하지 않는다(false).
 * 부호는 배율에만 관여하고 방향은 안 본다 — 급락 감시(threshold가 음수)도
 * 같은 배율로 급변을 잰다. */
function exceedRatio(observed, threshold) {
  const o = Number(observed);
  const t = Number(threshold);
  if (!Number.isFinite(o) || !Number.isFinite(t) || t === 0) return false;
  return Math.abs(o / t) >= SURGE_RATIO;
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
      // 보드 37 구조 분해 렌더용 — body와 같은 원장 필드의 1:1 재배열(지어낸 값 없음).
      symbolText: String(event.symbol),
      bodyText: `조건 도달 — 관측값 ${event.observed} (임계 ${event.threshold})`,
      bodyNote: '값은 발화 시점 기준입니다 — 최신 확인은 다시 물어봐 주세요.',
      // 감시 조건 행 — 페이로드가 단일 조건(threshold·observed)이라 1행이 정직한
      // 전부다(보드 37의 다조건 예시는 스키마가 늘 때 따라온다). 라벨은 note —
      // "사람이 읽는 유일한 조건 표현"(backend models.py:101)이라 원장 소스다.
      conditions: [{ met: true, label: event.note || event.routine_id, value: String(event.observed) }],
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
      sourceLabel: '복원 실패 — 이전 세션의 능동 턴', // 보드 09(6XE-0) 어휘
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

const __exports = { describeMode, relativeText, badgeText, buildTurnModel, buildToast, exceedRatio };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RoutineTurn = __exports;
}

})();

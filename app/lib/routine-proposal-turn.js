// IIFE 스코프 격리(2026-08-18 렌더러 격리) — routine-control-turn.js와 같은 UMD 패턴.
(function () {
// 제어 제안 턴(Paper 보드 07 · 432Z-1)의 순수 계산 — DOM은 만들지 않는다
// (chat.js가 renderControlProposalTurn에서 조립). 모델이 낸 제어 제안 다섯이
// 여기 한 표로 산다: A 작업 설정 · B 알람 모두 읽음 · C 제안 채택 · D 뷰 이동 ·
// E 놓친 예약 지금 실행.
//
// 규율(4333-1): 사람 칩 클릭이 게이트다 — 이 모듈은 무엇도 실행하지 않는다.
// 규율(437R-1): D 뷰 이동만 게이트 없이 렌더러가 옮긴다 — 칩이 없다.
//
// 값은 전부 봉투에서 온다. `current`는 모델이 쓴 값이 아니라 백엔드 목록의 그 행이고
// (routine_tools.py가 GET /api/v1/routines에서 찾아 넣는다), 읽지 않은 알람 수는
// 렌더러가 알람 센터에서 세어 넘긴다 — 지어낼 자리가 없다.
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;
const WatchNodes = isNode ? require('./watch-nodes') : window.AthenaLib.WatchNodes;

// control → 배지·상태 알약·칩 두 짝. Paper 432Z-1의 다섯 열이 이 표다.
// 여기 없는 control(confirm·pause·cancel 등)은 Paper가 제안 턴으로 그리지 않았다.
const PROPOSAL_KINDS = {
  update: { badge: '작업 설정', statusPill: '제안', accept: '이렇게 바꿔줘', decline: '그대로 둘게', needsRoutine: true },
  ack_all: { badge: '알람', statusPill: '제안', accept: '모두 읽음', decline: '그대로 둘게', needsRoutine: false },
  adopt: { badge: '제안 채택', statusPill: '제안', accept: '루틴으로', decline: '보류', needsRoutine: false },
  view: { badge: '뷰 이동', statusPill: '완료', accept: null, decline: null, needsRoutine: false },
  fire: { badge: '지금 실행', statusPill: '제안', accept: '지금 실행', decline: '건너뛰기', needsRoutine: true },
};

// D 열의 상태 행(435E-1·435F-1) — 게이트가 없으니 칩 대신 이 두 마디가 선다.
const VIEW_STATUS = Object.freeze(['이동함', '· 칩 없음']);

// 편집 제안이 만질 수 있는 다섯 필드(routine_tools.py _UPDATABLE_FIELDS)의 화면 이름.
// 라벨과 단위는 06 설정 폼이 이미 쓰는 것 그대로다 — 같은 값에 두 표기를 만들지 않는다.
const FIELD_LABELS = { note: '설명', cooldown_s: '쿨다운', expires_days: '만료', briefing_model: '브리핑 모델', briefing_effort: '노력' };
const FIELD_UNITS = { cooldown_s: '초', expires_days: '일' };
const FIELD_ORDER = ['note', 'cooldown_s', 'expires_days', 'briefing_model', 'briefing_effort'];

// 뷰 이동 봉투의 두 마디 → 화면 이름(agent-canvas.js VIEWS·TABS와 같은 라벨).
const VIEW_LABELS = { tasks: '작업', alerts: '알람', live: '라이브', proactive: '제안' };
const FILTER_LABELS = { all: '모두', active: '활성', paused: '일시중지' };

function obj(value) { return (value && typeof value === 'object') ? value : {}; }
function text(value) { return String(value == null ? '' : value).trim(); }

function fieldValue(key, raw) {
  const value = text(raw);
  if (!value) return '';
  return `${value}${FIELD_UNITS[key] || ''}`;
}

/** 「쿨다운 300초 → 600초」 — 바뀌는 칸만, 아는 것만. */
function updateDiffLine(current, proposed) {
  const cur = obj(current);
  const next = obj(proposed);
  const parts = [];
  for (const key of FIELD_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const to = fieldValue(key, next[key]);
    if (!to) continue;
    const from = fieldValue(key, cur[key]);
    parts.push(from && from !== to ? `${FIELD_LABELS[key]} ${from} → ${to}` : `${FIELD_LABELS[key]} ${to}`);
  }
  return parts.join(' · ');
}

/** 「쿨다운 600초 반영」 — 반영된 뒤의 결과 턴 리드(4330-1 성공 열). */
function updateAppliedLead(proposed) {
  const next = obj(proposed);
  const parts = [];
  for (const key of FIELD_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const to = fieldValue(key, next[key]);
    if (to) parts.push(`${FIELD_LABELS[key]} ${to}`);
  }
  return parts.length ? `${parts.join(' · ')} 반영` : '';
}

/** 「읽지 않은 알람 3건 읽음」 — 읽음 게이트가 끝난 뒤의 결과 턴 리드. */
function ackAppliedLead(count) {
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? `읽지 않은 알람 ${n}건 읽음` : '';
}

/** 「07:30 발화 기록」 — 놓친 예약 실행 게이트가 끝난 뒤의 결과 턴 리드.
 *  시각은 서버가 ledger에 쓴 fired_at이다 — 없으면 시각 없이 상태만 낸다. */
function fireAppliedLead(firedAt) {
  const clock = WatchNodes.clockLabel(firedAt);
  return clock ? `${clock} 발화 기록` : '발화 기록';
}

/** 「작업 › 일시중지」 — 모르는 마디는 그냥 빠진다. */
function viewPath(view) {
  const v = obj(view);
  return [VIEW_LABELS[v.tab], FILTER_LABELS[v.filter]].filter(Boolean).join(' › ');
}

// 채택 제안의 대상은 루틴 행이 아니라 제안값이다(아직 루틴이 아니니까).
function adoptSubject(envelope) {
  const p = obj(obj(envelope).proposed);
  return text(p.note) || text(p.title) || subjectOf(obj(envelope).current);
}

function subjectOf(routine) {
  const r = obj(routine);
  return text(r.note) || text(r.symbol);
}

/** control별 리드 한 줄. 빈 문자열이면 그릴 것이 없다는 뜻이다. */
function proposalLead(envelope, context) {
  const e = obj(envelope);
  const ctx = obj(context);
  const subject = subjectOf(e.current);
  if (e.control === 'update') {
    // 바뀌는 칸이 없으면 제안이 아니다 — 대상 이름만 남은 줄은 그리지 않는다.
    const diff = updateDiffLine(e.current, e.proposed);
    return diff ? [subject, diff].filter(Boolean).join(' — ') : '';
  }
  if (e.control === 'ack_all') {
    const unread = Number(ctx.unread);
    if (!Number.isFinite(unread) || unread <= 0) return '읽지 않은 알람 없음';
    return `읽지 않은 알람 ${unread}건 — 모두 읽음`;
  }
  if (e.control === 'adopt') {
    return [adoptSubject(e), '감시로 등록'].filter(Boolean).join(' — ');
  }
  if (e.control === 'view') return viewPath(e.view);
  if (e.control === 'fire') {
    const clock = WatchNodes.clockLabel(obj(e.current).next_fire_at);
    return [subject, clock ? `${clock} 놓침` : ''].filter(Boolean).join(' — ');
  }
  return '';
}

/** 제어 제안 봉투 → 제안 턴 모델. 그릴 수 없으면 null이다(빈 껍데기를 세우지 않는다). */
function buildProposalTurn(envelope, context) {
  const e = obj(envelope);
  const shape = Object.prototype.hasOwnProperty.call(PROPOSAL_KINDS, e.control)
    ? PROPOSAL_KINDS[e.control] : null;
  if (!shape) return null;
  const routineId = text(e.routineId);
  // 게이트를 부를 대상이 없으면 제안도 없다 — 눌러도 아무 일 없는 칩을 만들지 않는다.
  if (shape.needsRoutine && !routineId) return null;
  const lead = proposalLead(e, context);
  if (!lead) return null;
  const unread = Number(obj(context).unread);
  // 읽을 알람이 0건이면 누를 게이트가 없다 — 칩 없이 빈 상태만 정직하게 남긴다.
  const gateless = e.control === 'ack_all' && !(Number.isFinite(unread) && unread > 0);
  const chips = (shape.accept && !gateless)
    ? [{ label: shape.accept, role: 'accept' }, { label: shape.decline, role: 'decline' }]
    : [];
  return {
    control: e.control,
    routineId,
    badge: shape.badge,
    statusPill: shape.statusPill,
    lead,
    rationale: text(e.rationale) ? `근거: ${text(e.rationale)}` : '',
    chips,
    status: e.control === 'view' ? VIEW_STATUS.slice() : [],
    // 초안 게이트가 입력창에 얹을 대상 이름 — 리드에서 다시 잘라내지 않는다.
    subject: e.control === 'adopt' ? adoptSubject(e) : subjectOf(e.current),
    proposed: obj(e.proposed),
    // 결과 턴의 사실행(4330-1)이 쓰는 원장 행 — 지어내지 않고 그대로 넘긴다.
    current: obj(e.current),
    view: e.control === 'view' ? { tab: obj(e.view).tab, filter: obj(e.view).filter } : null,
  };
}

const __exports = {
  PROPOSAL_KINDS, VIEW_STATUS, FIELD_LABELS, VIEW_LABELS, FILTER_LABELS,
  updateDiffLine, updateAppliedLead, ackAppliedLead, fireAppliedLead,
  viewPath, proposalLead, buildProposalTurn,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RoutineProposalTurn = __exports;
}

})();

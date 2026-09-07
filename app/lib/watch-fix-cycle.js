// IIFE 스코프 격리(2026-08-18 렌더러 격리) — watch-nodes.js와 같은 UMD 패턴.
(function () {
'use strict';

// 고침 한 바퀴(Paper 보드 11 · 44HD-1)의 순수 계산 — DOM은 만들지 않는다
// (agent-canvas.js가 renderCodeDetail에서 조립). 백엔드 상세의 `fix_cycle`
// 봉투(routines/revisions.py)를 사람이 읽는 문구와 점 띠로 바꾸는 일만 한다.
//
// 규율은 watch-nodes.js와 같다: 값이 없으면 지어내지 않고 그 줄을 안 만든다.
// 「4번 → 2번 울림」도 「회색 두 칸」도 실제로 센 두 검사에서만 나온다.

const CHIP_CYCLE = '순환';
const CYCLE_TEXT = '물어봄 → 고침 → 검사 → 다시 그림 · 한 바퀴 끝';
const RECHECK_TITLE = '다시 검사';
const RECHECK_AUTO = '자동';
const RECEIPT_TITLE = '한 바퀴 영수증';
const ROLLBACK = '되돌리기';
const RECEIPT_NOTE = '코드는 AI가, 판단은 사람이 · 승인 전까지 실행 없음';
const RECEIPT_MARK = '✓';
const ARROW = '→';

// 점 한 칸의 세 갈래. 회색(silenced)이 Paper가 설명한 그 칸이다.
const DOT_SILENCED = 'silenced';
const DOT_FIRED = 'fired';
const DOT_QUIET = 'quiet';

function isCount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

// 'YYYY-MM-DD...' → UTC 자정 Date. 파싱 실패는 null(날짜를 지어내지 않는다).
function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → '8/26'. watch-nodes.shortDate와 같은 규칙이다. */
function shortDate(dt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dt || ''));
  if (!m) return String(dt || '').trim();
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 밀리초 → '9초'. 검사는 초 단위로만 말한다(0.5초 미만은 줄을 안 만든다). */
function secondsLabel(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 500) return '';
  return `${Math.round(value / 1000)}초`;
}

/**
 * 지난 N일 점 띠 — 검사가 센 구간(어제까지) 하루가 한 칸이다.
 *
 * 고치기 전에 울렸는데 지금은 안 울리는 날이 회색이고, 지금도 울리는 날이 표시,
 * 나머지는 조용한 날이다. 구간이나 마지막 날을 모르면 띠를 만들지 않는다.
 *
 * 마지막 칸은 검사가 실제로 센 마지막 날(`counted_through`)이다 — 울린 날은
 * 거래일(KST)인데 검사 시각은 UTC라, 시각으로 창을 잡으면 새벽에 하루가 밀린다.
 */
function dotStrip(cycle) {
  const c = cycle || {};
  const days = Number(c.lookback_days);
  const last = parseDay(c.counted_through);
  if (!last || !Number.isFinite(days) || days <= 0 || days > 366) return [];
  const before = new Set((c.fires_before_dates || []).map((d) => String(d).slice(0, 10)));
  const after = new Set((c.fires_after_dates || []).map((d) => String(d).slice(0, 10)));
  const cells = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(last.getTime() - back * 86400000);
    const key = dayKey(date);
    let state = DOT_QUIET;
    if (after.has(key)) state = DOT_FIRED;
    else if (before.has(key)) state = DOT_SILENCED;
    cells.push({ date: key, state });
  }
  return cells;
}

/**
 * 상세 봉투의 `fix_cycle` → 화면 모델. 봉투가 없으면 null이다(고친 적 없는 알람).
 *
 * 반환 모델의 빈 문자열·빈 배열은 「그 줄을 그리지 않는다」는 뜻이다.
 */
function cycleModel(cycle) {
  const c = (cycle && typeof cycle === 'object') ? cycle : null;
  if (!c) return null;
  const fixCount = isCount(c.fix_count) ? c.fix_count : 0;
  const days = Number(c.lookback_days);
  const hasDays = Number.isFinite(days) && days > 0;
  const took = secondsLabel(c.duration_ms);
  // 다시 검사가 통과했을 때만 센 값이 있다 — 코드가 터진 검사도 0번·빈 목록으로
  // 돌아오므로(백엔드 fix_cycle) 그 0을 그리면 「고쳐서 조용해졌다」는 거짓이 된다.
  const passed = c.ok === true;
  const dots = passed ? dotStrip(c) : [];
  const silenced = dots.filter((d) => d.state === DOT_SILENCED).length;
  const afterDates = (c.fires_after_dates || []).map(shortDate).filter((s) => s);

  const changes = (Array.isArray(c.changes) ? c.changes : [])
    .filter((row) => row && row.label && (row.before || row.after))
    .map((row, i) => ({
      mark: String(i + 1),
      text: `${row.label} ${row.before} ${ARROW} ${row.after}`,
    }));
  // 마지막 줄은 판정이다 — 다시 검사를 통과했고 몇 칸을 다시 그렸는지.
  // 검사 3/3(오늘 값으로 1회)은 켠 뒤의 일이라 여기서 통과했다고 말하지 않는다
  // (watch-progress-card.js LINE_TODAY와 같은 사실). 통과하지 못한 검사에는
  // 판정 줄 자체를 안 만든다 — 바꾼 칸 목록만 남는다.
  const changedNodes = isCount(c.changed_nodes) ? c.changed_nodes : 0;
  const receiptRows = changes.slice();
  if (passed && changedNodes > 0) {
    receiptRows.push({ mark: RECEIPT_MARK, text: `다시 검사 통과 · 노드 ${changedNodes}개 다시 그림` });
  }

  return {
    chip: CHIP_CYCLE,
    cycleText: CYCLE_TEXT,
    recheckTitle: hasDays ? `${RECHECK_TITLE} · 지난 ${days}일` : RECHECK_TITLE,
    recheckMeta: took ? `${RECHECK_AUTO} · ${took}` : RECHECK_AUTO,
    before: passed && isCount(c.fires_before) ? `${c.fires_before}번` : '',
    after: passed && isCount(c.fires_after) ? `${c.fires_after}번 울림` : '',
    arrow: ARROW,
    afterDates: passed ? afterDates.join(' · ') : '',
    dots,
    dotNote: silenced > 0 ? `회색 ${silenced}칸은 고치기 전에 울렸던 날 · 이제는 안 울림` : '',
    receiptTitle: fixCount > 0 ? `${RECEIPT_TITLE} · ${fixCount}번째 고침` : RECEIPT_TITLE,
    receiptRows,
    rollbackLabel: ROLLBACK,
    canRollback: c.can_rollback === true,
    pastLabel: isCount(c.past_count) && c.past_count > 0 ? `지난 고침 ${c.past_count}건` : '',
    note: RECEIPT_NOTE,
  };
}

/** 「지난 고침」 목록 한 줄씩 — 시각과 그때 센 울림 수만 말한다. */
function historyRows(history) {
  return (Array.isArray(history) ? history : []).map((entry) => {
    const raw = entry || {};
    const day = parseDay(raw.fixed_at);
    return {
      when: day ? shortDate(dayKey(day)) : '',
      fires: isCount(raw.fire_count) ? `${raw.fire_count}번 울림` : '',
    };
  });
}

function compactJson(value) {
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return ''; }
}

function numberSetting(name, value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? `${name}=${number}` : '';
}

function ownValue(detail, summary, key) {
  return Object.prototype.hasOwnProperty.call(detail, key) ? detail[key] : summary[key];
}

function mergeRepairContext(summary, detail) {
  const raw = summary && typeof summary === 'object' ? summary : {};
  const current = detail && typeof detail === 'object' ? detail : {};
  return {
    repair: true,
    reason: raw.repairReason || ownValue(current, raw, 'activation_blocker'),
    routineId: raw.routineId || raw.id,
    title: raw.title || raw.note,
    symbol: ownValue(current, raw, 'symbol'),
    watch: ownValue(current, raw, 'watch'),
    condition: ownValue(current, raw, 'condition'),
    cooldown_s: ownValue(current, raw, 'cooldown_s'),
    expires_days: ownValue(current, raw, 'expires_days'),
    expires_at: ownValue(current, raw, 'expires_at'),
    note: ownValue(current, raw, 'note'),
  };
}

/**
 * 승인 차단된 코드 감시를 채팅에서 복구할 때 사람이 검토할 시작 문장.
 * 기존 초안의 식별자와 설정만 옮기며 새 조건이나 프로젝트를 추측하지 않는다.
 */
function repairSeedText(detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const watch = d.watch && typeof d.watch === 'object' ? d.watch : {};
  const title = String(d.title || d.note || '코드 감시 초안').trim();
  const routineId = String(d.routineId || d.id || '').trim() || '확인 필요';
  const reason = String(d.reason || d.activation_blocker || '').trim() || '감시 코드 파일을 찾지 못함';
  const settings = [
    watch.project_id ? `project_id=${watch.project_id}` : '',
    watch.path ? `path=${watch.path}` : '',
    d.symbol ? `symbol=${d.symbol}` : '',
    d.condition ? `condition=${compactJson(d.condition)}` : '',
    watch.params ? `params=${compactJson(watch.params)}` : '',
    numberSetting('poll_interval_s', watch.poll_interval_s),
    numberSetting('lookback_days', watch.lookback_days),
    numberSetting('cooldown_s', d.cooldown_s),
    d.expires_at ? `expires_at=${d.expires_at}` : '',
    numberSetting('expires_days', d.expires_days),
  ].filter(Boolean).join(', ');
  const missingProjectId = !watch.project_id;
  const missingProjectFolder = /프로젝트[^.]{0,20}(없음|미등록|찾지 못)/.test(reason);
  const repairAction = missingProjectId
    ? '현재 감시 프로젝트를 찾을 수 없음. 임의 프로젝트를 쓰지 말고 프로젝트 만들기 또는 폴더 열기로 작업 폴더부터 정한 뒤, 기존 상대 경로에 누락된 코드를 재생성해줘.'
    : missingProjectFolder
      ? '프로젝트를 다시 연결하거나 폴더 열기로 작업 폴더부터 정한 뒤, 임의 프로젝트로 바꾸지 말고 기존 상대 경로에 누락된 코드를 재생성해줘.'
      : '누락된 코드를 같은 경로에 재생성해줘.';
  return `"${title}" 감시 코드를 복구해줘. 루틴 id: ${routineId}. 실패 이유: ${reason}. 기존 감시 설정: ${settings || '확인 필요'}. 기존 조건과 설정은 바꾸지 말고 ${repairAction} 그다음 검사해줘. 검사 전에는 승인하지 마.`;
}

const __exports = {
  CHIP_CYCLE, CYCLE_TEXT, RECHECK_TITLE, RECEIPT_TITLE, ROLLBACK, RECEIPT_NOTE,
  DOT_SILENCED, DOT_FIRED, DOT_QUIET,
  shortDate, secondsLabel, dotStrip, cycleModel, historyRows, mergeRepairContext, repairSeedText,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.WatchFixCycle = __exports;
}

})();

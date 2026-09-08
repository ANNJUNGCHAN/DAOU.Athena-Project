// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 코드 알람(Step 7, Paper 보드 10·11·12)의 문구 계산은 lib/watch-nodes.js가
// 전담한다 — backtest-canvas.js가 세운 isNode 분기와 같은 방식으로 싣는다.
const isNode = typeof module !== 'undefined' && module.exports;
const WatchNodes = isNode ? require('./watch-nodes') : window.AthenaLib.WatchNodes;
// 고침 한 바퀴(Paper 보드 11)의 문구·점 띠 계산 — 같은 방식으로 싣는다.
const FixCycle = isNode ? require('./watch-fix-cycle') : window.AthenaLib.WatchFixCycle;
// 제어 결과 턴(Paper 보드 08 · 4330-1)의 판정·문구는 이 순수 모델이 쥔다.
const ControlTurn = isNode
  ? require('./routine-control-turn')
  : window.AthenaLib.RoutineControlTurn;

// 에이전트모드 캔버스(Paper 보드 39) — #agentCanvas 컨테이너를 완전히 소유하고
// 헤더·탭·통계 카드·리스트+상세를 전부 이 파일이 그린다. shell.html은 빈
// 컨테이너 하나만 갖는다(graph-mode의 graphSummaryTable/gridEmpty와 같은 자리 —
// 그리기는 JS가 전담, innerHTML 미사용). 7/9/10/11단계가 이 파일을 계속
// 확장한다(성향 제안, 알람 센터 등) — shell.html은 4단계 이후로 다시 손대지
// 않는다.
//
// 통계 카드 4장 중 "다음 실행"·"오늘 발화"·"성향 제안"은 3단계(F1-FE)부터
// 라이브다 — 앞 둘은 schedule.daily 백엔드(2단계)의 next_fire_at/fired_today,
// 성향 제안은 749행 suggestionsCache 계산(7단계와 동일 원천)을 재사용한다.
// "진행 중"은 활성 감시 루틴 목록에서만 계산한다. 진행률 스트림이 없으므로
// 개별 시세 수집·경과 시간은 표시하지 않는다. source 필드는 기존 canvasSource
// 컨벤션(chat.js)과 동형이다 —
// 지어낸 숫자가 아니라 "라이브로 잰 값인지"를 코드 차원에 남긴다(P3). DOM에도
// data-source 속성으로 새겨 둔다.
//
// 리스트("예약·감시")는 세 출처를 한 화면에 섞는다:
//   · 감시(watch) — GET /api/v1/routines 실데이터. status가 active/paused고
//     mode가 'scheduled'가 아닌 것(3단계부터 — 예약은 아래 schedule로 간다).
//   · 초안(draft, 8단계 추가) — status가 draft인 것(mode 무관). ◌ 점선 핑크
//     행으로 구분한다(Paper 보드 43 실측). draft→confirm은 채팅의 "작업
//     요약·초안" 카드 칩("바로 활성화"·코드 알람이면 "이 알람 승인")과
//     코드 알람 상세의 승인 패널, 두 입구가 같은 athena:routine-confirm을
//     부른다 — Paper 보드 10이 「채팅 칩으로도, 이 버튼으로도 — 같은
//     게이트」로 그 둘을 못박았다. 게이트가 하나뿐이라 입구가 둘이어도
//     "확정은 사람이 누른다"는 규칙은 그대로다.
//   · 예약(schedule) — 3단계부터 GET /api/v1/routines 실데이터(mode가
//     'scheduled'인 것). schedule.daily 벽시계 트리거가 2단계에서 백엔드에
//     생겼다 — 더 이상 fixture가 아니다.
// 탭(모두/활성/일시중지)·검색은 세 출처 모두에 동일하게 적용된다(화면
// 하나이므로 필터도 하나). "일시중지" 탭 외의 필터는 draft/watch/schedule을
// 가리지 않는다 — 'all' 탭에서 draft가 함께 보인다.
//
// 일시중지·재개 버튼은 여전히 감시(watch, live) 항목에서만 활성이다(6.5단계
// — 6단계 pause/resume 엔드포인트를 이 화면에 배선). 예약(schedule) 항목은
// 백엔드가 이제 같은 전이를 지원하지만(store.transition은 mode를 안 가린다),
// 이 화면에 그 배선을 잇는 건 F1 최소선(3단계) 스코프 밖이라 항상 비활성으로
// 남겨둔다(P5 — 스코프 규율, 다음 스코프로 이연). 상세 패널의 "최근 실행"
// 로그는 여전히 fixture다(ledger API 라이브 연결은 10단계 몫 — 예약도 watch와
// 마찬가지로 이 화면에선 아직 라이브 붙이지 않는다).
//
// 9단계(알람 센터·라이브 관제, Paper 보드 40) — 헤더에 뷰 탭이 생긴다(작업/알람/
// 라이브; 11단계에서 제안이 더해져 지금 4종). "작업" 뷰는 위 39번 화면 그대로(통계·리스트+상세·제안).
// "알람"·"라이브" 뷰는 보드 40의 두 컬럼(알람 피드+라이브 관제)을 한 화면에
// 같이 그린다 — Paper 아트보드가 둘을 분리해 그리지 않았다(제목 자체가
// "알람 센터 · 라이브 관제"로 하나다), 그래서 지어내지 않고 같은 내용을
// 공유한다. 알람 피드는 sidebar.js의 notifyRooms를 window.AthenaNotify로
// 승격한 것 — 실데이터는 routine-fired 한 종류뿐이다(handleRoutineEvent가
// 그 외 이벤트는 애초에 방을 안 만든다). 그 한 이벤트가 싣고 오는 mode로
// 카테고리 아이콘 2종을 가른다(◆ 조건 감시 발화 · ● 예약 실행 산출물 —
// alarmIcon() 참고). Paper 목업의 나머지 2종(⚠ 응답 지연 · ❚❚ 사용자
// 일시중지)은 대응하는 실이벤트가 없어 지어내지 않고 Paper를 정정했다(P3).
// 라이브 컬럼(진행바·"다음 24시간" 타임라인)은 fixture다(WS 진행률
// 스트림·예약 트리거 둘 다 백엔드 미보유, 재검증 확인). "● WS 연결됨"만
// 실데이터다 — main.js RoutineFeed의 onStatus를 이번에 처음 렌더러로
// 릴레이했다(이전엔 no-op이라 신호가 안 왔다, 재검증에서 확인).
//
// 10단계(실행 이력·결과, Paper 보드 41 "작업 드릴인") — 감시(watch) 항목의
// 상세 패널 "최근 실행" 캡션에 "전체 이력 보기 →"가 생긴다. draft·예약
// (schedule)은 이 링크가 없다 — draft는 실행된 적이 없고, schedule은 실제
// 백엔드 라우틴이 아니라 ledger에 대응 행이 있을 수 없다(P3). 드릴인 화면은
// 뷰 탭을 브레드크럼("작업 › 이름" + 상태 배지)으로 잠깐 대체한다 — Paper가
// 뷰 탭 대신 브레드크럼을 그린다(재검증 확인). "최근 30회"는 6단계
// GET /{id}/runs 실데이터, 상태 아이콘은 ledger의 실제 verdict 3종
// (fired/near/suppressed)만 쓴다 — 목업의 "재시도 ↻"·"대체 실행 ⚠"은 대응
// verdict가 없어 만들지 않는다(AC10). 통계 3타일("평균"(5단계)·"발화→열람"·
// "이어진 대화", F-stage5b-FE)은 전부 라이브다 — 지표 정의가 끝내 확정되지
// 않은 타일 1개는 3차 라운드(R2)에서 제거됐다(agent-mode-round3-plan.md
// 1단계). "오늘 07:30 산출물" 카드는 ledger 스키마에
// 근거가 없다(컬럼이 식별자·숫자·판정 사유뿐, ledger.py 머리말 참고) — 그래도
// 생략하지 않는다: 사용자 확정 규칙1("Paper에 있는 요소는 전부 구현")의
// 합의된 처리는 fixture+data-source="fixture" 표기이지 생략이 아니다(팀 리드
// 정정, 2026-08-27). 산출물 카드의 버튼 2종("캔버스에서 열기"·"채팅으로")은
// 뒷받침 데이터가 없어 비활성으로 둔다(기능 없는 버튼을 활성으로 두지 않는다, P3).
const VERDICT_ICON = {
  fired: { glyph: '●', colorVar: '--color-ok' },
  near: { glyph: '◐', colorVar: '--color-warn' },
  suppressed: { glyph: '○', colorVar: '--color-k-faint' },
};

// 상세 머리줄의 상태 배지 문구 — 일반 상세와 코드 알람 상세가 같은 말을 써야 한다.
function statusBadgeText(status) {
  if (status === 'paused') return '일시중지';
  if (status === 'draft') return '초안';
  return '활성';
}

// data-source="fixture"만으로는 사람이 샘플을 실시간으로 읽는다(베타 B-07).
function fixtureMark() {
  const badge = el('span', 'agent-demo-mark');
  badge.textContent = '데모';
  return badge;
}

// 11단계(프로액티브, Paper 보드 42) — 4번째 뷰 탭 "제안". "지금 읽히는 성향"
// 스트립·제안 카드 2장은 7단계와 같은 원천(GET /api/v1/brain/profile-summary,
// suggestionsCache)을 재사용한다 — 39번 좌측 미니 목록과 42번 전체 화면이
// 서로 다른 데이터를 보여주면 "두 개의 진실"이 생긴다(sidebar.js 머리말과
// 같은 원칙). 칩 "루틴으로"는 7단계 "추가"와 같은 seedChatInput 경로,
// "보류"는 세션 동안만 그 카드를 숨긴다(백엔드 저장이 없다 — 재시작하면
// 다시 보인다, 지어낸 영속성을 암시하지 않는다, P3). 말걸기 가드 패널은
// F-stage9부터 GET /api/v1/nudge-guard 라이브다 — 이 패널 자체엔 여전히
// 값을 바꾸는 버튼이 없다(편집은 채팅 확인 카드로만, 아래 참고, 죽은 버튼
// 금지 원칙은 유지). "그래프 모드에서 근거 보기 →"는
// 사이드바 모드 네비를 그대로 재사용한다(setView + setActive 둘 다 — 하나만
// 부르면 캔버스는 바뀌는데 사이드바 활성 표시는 안 바뀌는 불일치가 생긴다).

const TABS = [
  { key: 'all', label: '모두' },
  { key: 'active', label: '활성' },
  { key: 'paused', label: '일시중지' },
];

// 드릴인 안의 세그먼트(Paper 보드 03 우상단) — 위 두 층위와 또 다른 층위다.
// 드릴인에서만 보이므로 뷰 탭(VIEWS)과 자리를 다투지 않는다.
const HISTORY_TABS = [
  { key: 'runs', label: '이력' },
  { key: 'settings', label: '설정' },
];

// 상위 뷰 탭(9단계, 11단계에서 4번째 추가) — 위 TABS(리스트 필터, "작업" 뷰
// 내부용)와는 다른 층위다.
const VIEWS = [
  { key: 'tasks', label: '작업' },
  { key: 'alerts', label: '알람' },
  { key: 'live', label: '라이브' },
  { key: 'proactive', label: '제안' },
];

// 알람 피드가 접힌 상태에서 보이는 행 수(Paper 보드 02 실측 — 6행 + 나머지는
// "지난 알람 N건 더" 버튼 뒤). 드릴인 실행 목록의 HISTORY_RUNS_COLLAPSED와
// 같은 값이지만 서로 다른 화면의 서로 다른 결정이라 상수를 공유하지 않는다.
const ALERTS_COLLAPSED = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  return node;
}

// 3단계(사실11⑥) — active 상태를 3분기로 가른다. periodic·scheduled는 같은
// 색(--color-ok)을 쓰지만(39번 리스트는 item.sub/title 텍스트로도 이미
// 구분된다), 구조 자체는 3분기다 — 다음에 색을 분리하고 싶을 때 이진 삼항으로
// 되돌아가지 않도록.
function statusRowIcon(routine) {
  if (routine.status === 'draft') return { glyph: '◌', colorVar: '--color-brand' };
  // 코드 알람(Step 7) — 보드 12의 목록 범례가 ◆를 코드 감시에 못박는다(실시간은
  // ●, 예약도 ●). 일시중지된 코드 알람도 같은 ◆를 흐리게 쓴다(보드 12 4행).
  if (routine.mode === 'code-watch') {
    return { glyph: '◆', colorVar: routine.status === 'active' ? '--color-brand' : '--color-k-faint' };
  }
  if (routine.status === 'paused') return { glyph: '❚❚', colorVar: '--color-warn' };
  if (routine.status === 'active') {
    if (routine.mode === 'realtime-ws') return { glyph: '●', colorVar: '--color-info' };
    if (routine.mode === 'scheduled') return { glyph: '●', colorVar: '--color-ok' };
    return { glyph: '●', colorVar: '--color-ok' };
  }
  return { glyph: '○', colorVar: '--color-k-faint' }; // expired/cancelled/failed — 정직하게 흐리게
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- 드릴인 "설정" 편집 폼(Paper 보드 06) ----------
//
// 폼의 모양은 mode가 아니라 **소스 명세**가 정한다 — GET /{id}가 주는
// source_spec(ops·value_type·transport)이 곧 분기다(백엔드 models.py SOURCES가
// 원본). Paper가 나란히 그린 두 폼의 차이도 전부 여기서 갈린다: 연속 틱은
// transport === 'ws'에서만 있고("1~20 · 실시간 소스만"), 비교 목록은 그 소스가
// 허용하는 연산자뿐이다(예약은 "at 하나뿐").
//
// 코드 감시는 조건 행 자체가 없다 — 백엔드가 폼의 조건 변경을 422로 막고
// (api/routines.py update_routine), Paper 보드 12도 「폼으로 바꾸는 건
// 쿨다운·만료·설명」이라고 같은 말을 적었다.
const OP_GLYPH = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', at: 'at', contains: '포함' };

// 조건 값 뒤에 붙는 단위 — 백엔드 카탈로그에 단위 필드가 없어 표기만 여기 둔다.
// 카탈로그 라벨이 단위를 말한 것만 옮긴다("등락율(%)"·"체결강도(%)"). 전일 동시간
// 거래량 비율은 배수인지 백분율인지 카탈로그가 말하지 않아 단위를 비워 둔다.
const VALUE_UNIT = {
  'price.current': '원',
  'price.change_rate': '%',
  'trade.strength': '%',
};

// 읽기 전용 "모드" 칸의 말 — 발화 방식 둘(자동·예약)로 가른다. 목록 행의
// "실시간 감시 / 예약 실행"과는 층위가 다르다(그쪽은 소스까지 섞어 부른다).
const SETTINGS_MODE_LABEL = {
  'realtime-ws': '자동', periodic: '자동', scheduled: '예약', 'code-watch': WatchNodes.KIND_LABEL,
};

// 브리핑 모델·노력 선택지 — chat.js PILL_MODEL_CHIPS·settings-cards.js와 같은
// 어휘다. 빈 값은 저장 본문에서 null로 나가 "앱 기본"을 뜻한다(백엔드 R1).
const BRIEFING_MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
const BRIEFING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BRIEFING_DEFAULT_LABEL = '앱 기본';

function opsHint(ops) {
  const glyphs = ops.map((op) => OP_GLYPH[op] || op);
  return glyphs.length === 1 ? `${glyphs[0]} 하나뿐` : glyphs.join(' · ');
}

// 만료 칸은 빈 채로 연다 — 비워 두고 저장하면 expires_days를 아예 안 실어
// 보내 백엔드가 기존 만료를 그대로 둔다(api/routines.py "편집이 만료를 몰래
// 연장하지 않는다"). 그 규칙을 사람이 읽을 수 있게 지금 만료를 옆에 적는다.
function expiryHint(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `만료 ${iso} · 미변경 시 보존`;
  const pad = (n) => String(n).padStart(2, '0');
  return `만료 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} · 미변경 시 보존`;
}

function briefingOptions(values) {
  return [{ value: '', label: BRIEFING_DEFAULT_LABEL }]
    .concat(values.map((v) => ({ value: v, label: v })));
}

// 요약 한 줄(Paper "설정 — 요약") — 목록 행이 이미 쥔 값만 쓴다(왕복 없음).
function settingsSummaryLines(routine) {
  const parts = [SETTINGS_MODE_LABEL[routine.mode] || routine.mode];
  if (routine.cooldown_s != null) parts.push(`쿨다운 ${routine.cooldown_s}초`);
  if (routine.next_fire_at) parts.push(`다음 실행 ${formatDateTime(routine.next_fire_at)}`);
  if (routine.created_at) parts.push(`생성 ${formatDateTime(routine.created_at)}`);
  return { title: routine.note || routine.symbol || routine.id, meta: parts.join(' · ') };
}

// detail은 GET /{id}(조건 원문·source_spec), routine은 목록 행(생성·다음 실행 —
// 상세 응답에는 없는 값이다). 둘 다 실데이터라 지어낸 칸은 없다.
function settingsFormModel(detail, routine) {
  if (!detail || !detail.condition || !detail.source_spec) return null;
  const spec = detail.source_spec;
  const cond = detail.condition;
  const row = routine || {};

  const readonly = [];
  if (detail.symbol) readonly.push({ label: '종목', value: detail.symbol });
  readonly.push({ label: '모드', value: SETTINGS_MODE_LABEL[detail.mode] || detail.mode });
  readonly.push({ label: '소스', value: spec.label, tag: '변경 불가' });
  if (row.next_fire_at) readonly.push({ label: '다음 실행', value: formatDateTime(row.next_fire_at) });

  const fields = [];
  if (spec.transport !== 'code') {
    fields.push({
      key: 'op',
      label: '조건 비교',
      kind: 'select',
      options: spec.ops.map((op) => ({ value: op, label: OP_GLYPH[op] || op })),
      value: cond.op,
      hint: opsHint(spec.ops),
    });
    fields.push({
      key: 'value',
      label: '조건 값',
      kind: spec.value_type === 'bool' ? 'select' : spec.value_type,
      options: spec.value_type === 'bool'
        ? [{ value: 'true', label: '예' }, { value: 'false', label: '아니오' }] : null,
      value: String(cond.value),
      unit: VALUE_UNIT[cond.source] || '',
      // schedule.daily 가지는 지금 제품에서 드릴인이 안 열린다(「전체 이력 보기 →」가
      // 감시·코드 알람에만 붙는다) — 단위 테스트만 도는 가지다.
      hint: spec.value_type === 'number' ? '숫자'
        : (cond.source === 'schedule.daily' ? '요일@시각 표기' : ''),
    });
    if (spec.transport === 'ws') {
      fields.push({
        key: 'consecutive_ticks',
        label: '연속 틱',
        kind: 'number',
        value: String(cond.consecutive_ticks || 1),
        hint: '1~20 · 실시간 소스만',
      });
    }
  }
  fields.push({ key: 'cooldown_s', label: '쿨다운(초)', kind: 'number', value: String(detail.cooldown_s) });
  fields.push({
    key: 'expires_days', label: '만료(일)', kind: 'number', value: '', hint: expiryHint(detail.expires_at),
  });
  fields.push({ key: 'note', label: '설명', kind: 'string', value: detail.note || '' });
  fields.push({
    key: 'briefing_model',
    label: '브리핑 모델',
    kind: 'select',
    options: briefingOptions(BRIEFING_MODELS),
    value: detail.briefing_model || '',
  });
  fields.push({
    key: 'briefing_effort',
    label: '노력',
    kind: 'select',
    options: briefingOptions(BRIEFING_EFFORTS),
    value: detail.briefing_effort || '',
  });

  const trailing = [];
  if (row.created_at) trailing.push({ label: '생성', value: formatDateTime(row.created_at) });
  return {
    title: detail.note || row.note || detail.id,
    readonly,
    fields,
    trailing,
    note: '종목·소스는 취소 후 새로 만들기',
  };
}

// 폼 값 → POST /{id}/update 본문. 백엔드가 받는 필드만 싣는다(_UPDATABLE_FIELDS·
// _UPDATABLE_CONDITION_FIELDS) — 만료는 비어 있으면 키 자체를 안 만든다.
function settingsUpdateBody(model, values) {
  const body = {};
  const condition = {};
  let conditionChanged = false;
  for (const field of model.fields) {
    const raw = values[field.key];
    const text = raw == null ? '' : String(raw).trim();
    const touched = text !== String(field.value);
    if (field.key === 'op') { condition.op = text; if (touched) conditionChanged = true; continue; }
    if (field.key === 'value') {
      if (touched) conditionChanged = true;
      if (field.kind === 'number') condition.value = Number(text);
      else if (field.options) condition.value = text === 'true';
      else condition.value = text;
      continue;
    }
    if (field.key === 'consecutive_ticks') {
      condition.consecutive_ticks = Number(text);
      if (touched) conditionChanged = true;
      continue;
    }
    if (field.key === 'expires_days') { if (text !== '') body.expires_days = Number(text); continue; }
    if (field.key === 'cooldown_s') { body.cooldown_s = Number(text); continue; }
    if (field.key === 'note') {
      // 설명 칸을 안 건드렸는데 조건이 바뀌었으면 note 키를 안 싣는다 — 백엔드가
      // 자동 생성문이었을 때만 새 조건으로 다시 쓴다(사람이 쓴 설명은 그대로).
      if (!touched && conditionChanged) continue;
      body.note = text;
      continue;
    }
    if (field.key === 'briefing_model' || field.key === 'briefing_effort') {
      body[field.key] = text === '' ? null : text;
      continue;
    }
    body[field.key] = text;
  }
  if (Object.keys(condition).length > 0) body.condition = condition;
  return body;
}

function createAgentCanvas(deps) {
  const {
    container, fetchRoutines, fetchFiredToday, onNewTaskClick, pauseRoutine, resumeRoutine,
    fetchProfileSummary, onAddSuggestion,
    fetchAlerts, markAllAlertsRead, getWsConnected,
    fetchRuns, fetchAvgDuration, fetchEngagement,
    fetchNudgeGuard,
    onOpenGraph,
    onOpenInChat,
    onEditInChat,
    // 코드 알람(Step 7) — 상세 1회 조회, 취소, 승인, 초안 검사 1회. 넷 다 사람
    // 클릭 전용 경로이고 canvas.js가 기존 routine-* 채널과 같은 모양으로 잇는다.
    fetchDetail,
    cancelRoutine,
    confirmRoutine,
    runWatchCheck,
    // 영수증의 [되돌리기](Paper 보드 11) — POST /{id}/watch/rollback 한 왕복.
    rollbackWatchFix,
    // 드릴인 설정 편집 폼의 [저장](Paper 보드 06) — POST /{id}/update 한 왕복.
    updateRoutine,
    // 제어 결과 턴(Paper 보드 08 · 4330-1) — 누른 결과를 같은 방에 남기는 길.
    // 캐널은 canvas.js가 정한다(플러그인 결과와 같은 자리의 CustomEvent).
    onControlResult,
  } = deps || {};
  if (!container) return { mount() {}, async refresh() {} };

  let activeTab = 'all';
  let searchQuery = '';
  let routinesCache = [];
  let routinesLoadState = 'pending';
  let firedTodayCache = null; // GET /api/v1/routines의 fired_today(3단계) — 독립 왕복.
  let requestId = 0; // stale-응답 가드 — sidebar.js 3단계(loadAgentRoutines)와 같은 이유.
  let suggestionsCache = [];
  let suggestRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.
  let activeView = 'tasks';
  let alertsCache = [];
  let historyItem = null; // 드릴인 중인 항목(10단계) — null이면 드릴인이 아니다.
  let historyTab = 'runs'; // 드릴인 세그먼트(Paper 보드 03) — 이력 | 설정.
  let heldSuggestionIds = new Set(); // "보류"한 제안(11단계) — 세션 동안만, 저장 안 됨.
  let historyRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.
  let historyRunsCache = []; // 최신 30건(정렬 완료) — 접기/펼치기가 같은 배열을 다시 그린다.
  let historyRunsExpanded = false; // "지난 실행 N건 더"를 눌렀는가. 드릴인을 새로 열면 접힌 상태로 돌아간다.
  let alertsExpanded = false; // 알람 피드의 같은 접기 상태 — 뷰를 떠나도 세션 동안 유지한다.
  let avgDurationCache = null; // GET /{id}/runs의 avg_duration_ms(5단계) — 드릴인 대상별로 갱신.
  let engagementCache = null; // GET /{id}/runs의 opened_rate/replied_count(F-stage5b-FE) — 드릴인 대상별로 갱신.
  let nudgeGuardCache = null; // GET /api/v1/nudge-guard(F-stage9) — 라이브.
  let nudgeGuardRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.

  // ---------- 통계 카드 4장의 값 계산(3단계부터 3장이 라이브) ----------
  // routinesCache/firedTodayCache/suggestionsCache 클로저가 필요해 createAgentCanvas
  // 안에 둔다(statusRowIcon()처럼 순수 함수가 아니다).

  // "진행 중" 타일은 활성 감시 목록의 집계만 표시한다. 개별 진행률 스트림은
  // 없으므로 종목·조건 단계·경과 시간은 표시하지 않는다.
  function activeMonitoringStat() {
    if (routinesLoadState === 'pending') return { key: 'in-progress', label: '진행 중', value: '불러오는 중', sub: '', source: 'live' };
    if (routinesLoadState === 'error') return { key: 'in-progress', label: '진행 중', value: '확인할 수 없음', sub: '감시 상태를 불러오지 못했습니다', source: 'live' };
    const active = routinesCache.filter((r) => r.status === 'active' && r.mode !== 'scheduled');
    return {
      key: 'in-progress', label: '진행 중',
      value: active.length ? `${active.length}건 감시 중` : '없음',
      sub: active.length ? '활성 감시 루틴 기준' : '활성 감시가 없습니다', source: 'live',
    };
  }

  // "다음 실행"(3단계 라이브) — routinesCache의 예약(mode==='scheduled')
  // 스펙 중 active만 보고 next_fire_at(2단계 백엔드, 순수 계산값)이 가장 이른
  // 것을 고른다. 활성 예약이 없으면 지어내지 않고 정직하게 "없음"을 보여준다(P3).
  function nextRunStat() {
    let best = null;
    for (const r of routinesCache) {
      if (r.mode !== 'scheduled' || r.status !== 'active' || !r.next_fire_at) continue;
      const t = Date.parse(r.next_fire_at);
      if (!Number.isFinite(t)) continue;
      if (!best || t < best.t) best = { t, r };
    }
    if (!best) {
      return { key: 'next-run', label: '다음 실행', value: '없음', sub: '활성 예약이 없습니다', source: 'live' };
    }
    const diffMin = Math.max(0, Math.round((best.t - Date.now()) / 60000));
    const relative = diffMin < 60 ? `${diffMin}분 후` : `${Math.floor(diffMin / 60)}시간 ${diffMin % 60}분 후`;
    return {
      key: 'next-run', label: '다음 실행',
      value: `${formatAlarmTime(best.t)} ${best.r.note || best.r.symbol || best.r.id}`,
      sub: `${relative} · 예약 실행`, source: 'live',
    };
  }

  // "오늘 발화"(3단계 라이브) — GET /api/v1/routines 응답의 fired_today(2단계,
  // ledger 단일 스캔 집계)를 그대로 쓴다. fetchFiredToday가 없거나 실패하면
  // firedTodayCache가 null로 남아 "—"로 정직하게 표시한다(지어낸 숫자 없음).
  function firedTodayStat() {
    if (firedTodayCache == null) {
      return { key: 'fired-today', label: '오늘 발화', value: '—', sub: '', source: 'live' };
    }
    return { key: 'fired-today', label: '오늘 발화', value: `${firedTodayCache}건`, sub: 'KST 기준', source: 'live' };
  }

  // "보류"하지 않은 성향 제안 수 — updateProactiveTabLabel()과 같은 계산을
  // 공유한다(재검증 사실5, "두 개의 진실" 방지 — 위 머리말).
  function visibleSuggestionCount() {
    return suggestionsCache.filter((e) => !heldSuggestionIds.has(e.entity_id)).length;
  }

  // "성향 제안"(3단계 라이브) — 7단계와 같은 원천(suggestionsCache)을 그대로
  // 재사용한다. 그래프 "신호 개수" 같은 지어낸 통계는 붙이지 않는다(P3 — 실제로
  // 아는 값은 "몇 건 대기 중인가"뿐이다).
  function suggestionsStat() {
    const n = visibleSuggestionCount();
    return {
      key: 'suggestions', label: '성향 제안',
      value: n > 0 ? `${n}건 대기` : '없음',
      sub: n > 0 ? '그래프 성향 기반' : '',
      source: 'live', accent: true,
    };
  }

  function buildStats() {
    return [nextRunStat(), activeMonitoringStat(), firedTodayStat(), suggestionsStat()];
  }

  // ---------- 헤더 ----------
  const head = el('div', 'agent-head');
  const title = el('div', 'agent-title');
  title.textContent = '에이전트';
  head.appendChild(title);

  // 뷰 탭 4종(작업/알람/라이브/제안, 위 머리말 참고) — 항상 보인다.
  const viewTabsWrap = el('div', 'agent-view-tabs');
  const viewTabButtons = {};
  for (const view of VIEWS) {
    const btn = el('button', view.key === activeView ? 'agent-view-tab is-active' : 'agent-view-tab');
    btn.type = 'button';
    // 사이드바 모드 네비(shell.html data-view)와 같은 관례 — 라벨이 아니라 키로 집는다.
    // lib/paper-screen-routes.js의 도달 절차가 이 셀렉터로 "제안" 뷰를 연다.
    btn.setAttribute('data-view', view.key);
    btn.textContent = view.label;
    btn.addEventListener('click', () => setActiveView(view.key));
    viewTabButtons[view.key] = btn;
    viewTabsWrap.appendChild(btn);
  }
  head.appendChild(viewTabsWrap);

  const markAllReadBtn = el('button', 'agent-mark-all-read');
  markAllReadBtn.type = 'button';
  markAllReadBtn.textContent = '모두 읽음으로';
  markAllReadBtn.hidden = true; // "작업" 뷰에서는 숨는다 — setActiveView가 토글.
  markAllReadBtn.addEventListener('click', () => {
    if (typeof markAllAlertsRead === 'function') markAllAlertsRead();
    renderAlarmColumn();
  });
  head.appendChild(markAllReadBtn);

  // 실행 이력 드릴인 브레드크럼(10단계, Paper 보드 41) — 뷰 탭 자리를 잠깐
  // 대체한다("작업 › 이름" + 상태 배지). openHistory/closeHistory가 토글한다.
  const breadcrumb = el('div', 'agent-breadcrumb');
  breadcrumb.hidden = true;
  const breadcrumbBack = el('button', 'agent-breadcrumb-back');
  breadcrumbBack.type = 'button';
  breadcrumbBack.textContent = '작업 ›';
  breadcrumbBack.addEventListener('click', () => closeHistory());
  breadcrumb.appendChild(breadcrumbBack);
  const breadcrumbTitle = el('span', 'agent-breadcrumb-title');
  breadcrumb.appendChild(breadcrumbTitle);
  // agent-status-badge와는 다른 클래스다(같은 이름을 쓰면 findByClass류 조회가
  // 상세 패널의 배지 대신 이 빈 배지를 먼저 집는다 — 실측: 기존 상세 패널
  // 테스트 3건이 이 충돌로 깨졌다). 시각은 .agent-breadcrumb-badge가 따로 진다.
  const breadcrumbBadge = el('span', 'agent-breadcrumb-badge');
  breadcrumb.appendChild(breadcrumbBadge);
  head.appendChild(breadcrumb);

  // 드릴인 세그먼트 [이력][설정](Paper 보드 03 우상단) — 브레드크럼과 같이
  // 드릴인에서만 보인다. "설정"은 읽기 전용 명세 + 채팅으로 고치기 한 경로다
  // (동선 규칙② "편집도 채팅으로 — 상세 패널은 보기 전용" 그대로 — 이 패널에
  // 값을 바꾸는 입력을 두면 그 규칙과 정면으로 어긋난다).
  const historyTabs = el('div', 'agent-history-tabs');
  historyTabs.hidden = true;
  const historyTabButtons = {};
  for (const tab of HISTORY_TABS) {
    const btn = el('button', tab.key === 'runs' ? 'agent-history-tab is-active' : 'agent-history-tab');
    btn.type = 'button';
    btn.setAttribute('data-key', tab.key); // 뷰 탭 data-view와 같은 관례 — 값이 아니라 키로 집는다
    btn.textContent = tab.label;
    btn.addEventListener('click', () => setHistoryTab(tab.key));
    historyTabButtons[tab.key] = btn;
    historyTabs.appendChild(btn);
  }
  head.appendChild(historyTabs);

  // "그래프 모드에서 근거 보기 →"(11단계, "제안" 뷰 전용) — 사이드바 모드
  // 네비를 그대로 재사용한다(위 머리말 참고).
  const graphLinkBtn = el('button', 'agent-graph-link');
  graphLinkBtn.type = 'button';
  graphLinkBtn.textContent = '그래프 모드에서 근거 보기 →';
  graphLinkBtn.hidden = true;
  graphLinkBtn.addEventListener('click', () => { if (typeof onOpenGraph === 'function') onOpenGraph(); });
  head.appendChild(graphLinkBtn);

  // "작업" 뷰 전용 머리(부제+리스트 필터 탭+검색+CTA) — .agent-head 레이아웃을
  // 그대로 물려받는다. "알람"·"라이브" 뷰에서는 숨는다(setActiveView).
  const tasksHead = el('div', 'agent-head agent-tasks-head');
  const subtitle = el('div', 'agent-subtitle');
  tasksHead.appendChild(subtitle);

  const tabsWrap = el('div', 'agent-tabs');
  const tabButtons = {};
  for (const tab of TABS) {
    const btn = el('button', tab.key === activeTab ? 'agent-tab is-active' : 'agent-tab');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => setActiveTab(tab.key));
    tabButtons[tab.key] = btn;
    tabsWrap.appendChild(btn);
  }
  tasksHead.appendChild(tabsWrap);

  const actions = el('div', 'agent-head-actions');
  const searchWrap = el('div', 'agent-search');
  const searchIcon = svgEl('svg', { width: 12, height: 12, viewBox: '0 0 12 12' });
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.appendChild(svgEl('circle', { cx: 5, cy: 5, r: 3.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }));
  searchIcon.appendChild(svgEl('path', { d: 'M7.6 7.6 10.4 10.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }));
  searchWrap.appendChild(searchIcon);
  const searchInput = el('input', 'agent-search-input');
  searchInput.type = 'text';
  searchInput.placeholder = '작업 검색';
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderPanels();
  });
  searchWrap.appendChild(searchInput);
  actions.appendChild(searchWrap);

  // 43번 "새 작업은 채팅에서" 원칙(동선 규칙①) — 시트를 열지 않는다. 시작
  // 문장을 심고 포커스만 옮기는 실제 동작은 canvas.js가 onNewTaskClick으로
  // 주입한다(8단계, shell.js seedChatInput 버스 — 7단계 제안 "추가"와 같은 경로).
  const cta = el('button', 'agent-cta');
  cta.type = 'button';
  cta.textContent = '＋ 새 작업 · 채팅에서';
  cta.addEventListener('click', () => { if (typeof onNewTaskClick === 'function') onNewTaskClick(); });
  actions.appendChild(cta);
  tasksHead.appendChild(actions);

  // ---------- 통계 카드 4장 ----------
  const stats = el('div', 'agent-stats');
  function renderStats() {
    while (stats.firstChild) stats.removeChild(stats.firstChild);
    for (const stat of buildStats()) {
      const card = el('div', stat.accent ? 'agent-stat-card is-accent' : 'agent-stat-card');
      card.setAttribute('data-source', stat.source); // 출처 표시(P3) — 지어낸 숫자가 아님을 코드 차원에 남긴다.
      const head = el('div', 'agent-stat-head');
      const label = el('div', 'agent-stat-label');
      label.textContent = stat.label;
      head.appendChild(label);
      if (stat.source === 'fixture') head.appendChild(fixtureMark());
      const value = el('div', 'agent-stat-value');
      value.textContent = stat.value;
      const sub = el('div', 'agent-stat-sub');
      sub.textContent = stat.sub;
      card.appendChild(head);
      card.appendChild(value);
      card.appendChild(sub);
      stats.appendChild(card);
    }
  }

  // ---------- 본문 — 좌측 "예약·감시" 리스트(330px) + 우측 상세(429px, 5단계) ----------
  let selectedId = null;
  // 사용자가 직접 행을 고르기 전까지는 "지금 첫 번째" 항목을 계속 따라간다.
  // mount()는 refresh()보다 먼저 돌아서(라이브 데이터가 아직 없다) 처음엔
  // fixture 예약 행이 첫 항목이 된다 — 그 상태에서 고정해버리면 뒤이어
  // 라이브 라우틴이 도착해도 상세 패널이 계속 fixture를 보여준다(실측
  // 버그). 사용자가 실제로 클릭하면 그때부터는 그 선택을 존중한다.
  let userSelected = false;

  const body = el('div', 'agent-body');
  const panels = el('div', 'agent-panels');
  const listCol = el('div', 'agent-list-col');
  const listCaption = el('div', 'agent-panel-caption');
  listCaption.textContent = '예약 · 감시';
  listCol.appendChild(listCaption);
  const watchList = el('div', 'agent-watch-list');
  listCol.appendChild(watchList);

  // ---------- 제안 — 그래프 성향 기반(7단계, Paper 보드 39 하단) ----------
  // GET /api/v1/brain/profile-summary(athena:brain-profile-summary IPC) 실데이터 —
  // graph-mode/summary-table.js(보드 07)가 이미 쓰는 것과 같은 엔드포인트다.
  // brain.py 5종 분석 중 이 필드 구성(entity_name·relation_kind·reinforcement·
  // rationale)이 Paper 목업의 "OO 성향 N회 보강 — 근거문" 패턴과 가장 가깝다 —
  // suggested-questions("불확실한 관계 되묻기")는 성격이 달라 억지로 끼워맞추지
  // 않는다(P3). 제목은 목업의 지어낸 태스크 문구 대신 entity_name을 정직하게
  // 쓴다. 신호가 없으면 섹션 자체를 숨긴다(빈 라벨을 노출하지 않는다, P3).
  const suggestSection = el('div', 'agent-suggest-section');
  suggestSection.hidden = true;
  const suggestDivider = el('div', 'agent-suggest-divider');
  suggestSection.appendChild(suggestDivider);
  const suggestCaption = el('div', 'agent-panel-caption');
  suggestCaption.textContent = '제안 — 그래프 성향 기반';
  suggestSection.appendChild(suggestCaption);
  const suggestList = el('div', 'agent-suggest-list');
  suggestSection.appendChild(suggestList);
  listCol.appendChild(suggestSection);

  // 추가 클릭 → 시트 없이 채팅으로(43 원칙). 실제 필드만 근거로 삼되, 확인 질문이
  // 아니라 초안·검사까지 끝내라는 완결형 요청을 보낸다. 활성화는 여전히 사람 전용이다.
  function suggestionRequestText(entry) {
    const name = entry.entity_name || entry.entity_id;
    const groundedRationale = `${entry.relation_kind} 성향 ${entry.reinforcement}회 보강`
      + (entry.rationale ? ` — ${entry.rationale}` : '');
    const evidenceLabel = entry.confidence ? `근거 신호(${entry.confidence})` : '근거 신호';
    return `"${name}" 관련 루틴을 완성해줘. ${evidenceLabel}: ${groundedRationale}. `
      + '대상 식별자와 기준값은 사용 가능한 조회 도구로 확인하고, 조건·확인 주기·쿨다운·만료는 지원되는 합리적인 기본값으로 네가 정해서 추가 질문이나 제안 확인 없이 실제 초안을 만들어줘. '
      + '고정 조건으로 표현할 수 없으면 감시 코드를 작성하고 초안을 만든 뒤 자동 검사까지 진행해서 승인 대기 상태로 준비해줘. '
      + '근거 신호를 내 투자 선호라고 단정하지 말고, 정한 조건·확인 주기·쿨다운·만료를 제안 설정으로 모두 밝혀줘. 실제 활성화는 내가 승인할 때만 해.';
  }

  function makeSuggestionRow(entry) {
    const row = el('div', 'agent-suggest-row');
    row.setAttribute('data-source', 'live'); // profile-summary는 실데이터다.
    const icon = el('span', 'agent-suggest-icon');
    icon.textContent = '◆';
    row.appendChild(icon);
    const textWrap = el('span', 'agent-suggest-text');
    const title = el('span', 'agent-suggest-title');
    title.textContent = entry.entity_name || entry.entity_id;
    textWrap.appendChild(title);
    const rationale = el('span', 'agent-suggest-rationale');
    rationale.textContent = `${entry.relation_kind} 성향 ${entry.reinforcement}회 보강` + (entry.rationale ? ` — ${entry.rationale}` : '');
    textWrap.appendChild(rationale);
    row.appendChild(textWrap);
    const addBtn = el('button', 'agent-suggest-add');
    addBtn.type = 'button';
    addBtn.textContent = '추가';
    addBtn.addEventListener('click', () => {
      if (typeof onAddSuggestion === 'function') onAddSuggestion(suggestionRequestText(entry));
    });
    row.appendChild(addBtn);
    return row;
  }

  function renderSuggestions() {
    while (suggestList.firstChild) suggestList.removeChild(suggestList.firstChild);
    suggestSection.hidden = suggestionsCache.length === 0;
    for (const entry of suggestionsCache) suggestList.appendChild(makeSuggestionRow(entry));
    renderProactiveView(); // 11단계 — 같은 캐시를 쓰는 "제안" 뷰도 함께 갱신한다(위 머리말).
    renderStats(); // 3단계 — "성향 제안" 통계 타일도 같은 캐시를 쓴다(위와 같은 이유).
  }

  // GET /api/v1/brain/profile-summary 실데이터 — requestId로 낡은 응답을 버린다
  // (routine 목록과 같은 이유·같은 패턴, 별개 요청이라 별개 카운터를 쓴다).
  async function refreshSuggestions() {
    const rid = ++suggestRequestId;
    let entries = [];
    try {
      entries = (typeof fetchProfileSummary === 'function') ? await fetchProfileSummary() : [];
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
    if (rid !== suggestRequestId) return;
    suggestionsCache = entries;
    renderSuggestions();
  }

  // GET /api/v1/nudge-guard 실데이터(F-stage9, 8단계 백엔드) — 다른 세 소스와
  // 무관한 독립 왕복이다(위 머리말 원칙).
  async function refreshNudgeGuard() {
    const rid = ++nudgeGuardRequestId;
    let settings = null;
    try {
      settings = (typeof fetchNudgeGuard === 'function') ? await fetchNudgeGuard() : null;
    } catch {
      settings = null;
    }
    if (rid !== nudgeGuardRequestId) return;
    nudgeGuardCache = settings;
    renderNudgeGuard();
  }

  const detailCol = el('div', 'agent-detail-col');
  panels.appendChild(listCol);
  panels.appendChild(detailCol);
  body.appendChild(panels);

  // ---------- 알람 센터 · 라이브 관제(9단계, Paper 보드 40) ----------
  // "알람"·"라이브" 뷰가 공유하는 한 화면 — 위 머리말 참고.
  const alarmLiveBody = el('div', 'agent-alarm-live');
  alarmLiveBody.hidden = true;

  const alarmCol = el('div', 'agent-alarm-col');
  const alarmCaption = el('div', 'agent-panel-caption');
  alarmCaption.textContent = '알람';
  alarmCol.appendChild(alarmCaption);
  const alarmList = el('div', 'agent-alarm-list');
  alarmCol.appendChild(alarmList);
  alarmLiveBody.appendChild(alarmCol);

  function updateAlertsTabLabel() {
    const unread = alertsCache.filter((a) => !a.read).length;
    viewTabButtons.alerts.textContent = unread > 0 ? `알람 ${unread}` : '알람';
  }

  function formatAlarmTime(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // 액센트 바 색으로 미확인(핑크)/읽음(라인색)을 구분한다(Paper 실측).
  //
  // 카테고리 아이콘은 실데이터로 갈리는 2종이다(Paper 보드 02의 ◆·● 두 갈래와
  // 같다). 근거는 routine-fired 이벤트의 mode 하나뿐이다 — sidebar.js가
  // notifyRooms에 실어 AthenaNotify.list()로 넘긴다.
  //   · scheduled  → ● 예약 실행이 산출물을 냈다("브리핑 카드 생성"·"실행 완료")
  //   · 그 외      → ◆ 조건 감시가 발화했다("조건 도달"·"성향 제안")
  // Paper 목업의 나머지 두 갈래(⚠ 응답 지연 · ❚❚ 사용자 일시중지)는 대응하는
  // 알람 이벤트가 아예 없다 — handleRoutineEvent가 routine-fired 외에는 방을
  // 만들지 않는다. 지어내지 않고 Paper 쪽을 실계약에 맞춰 정정했다(검수 대장
  // 결정 로그 2026-09-01 참고).
  function alarmIcon(alert) {
    return alert && alert.mode === 'scheduled'
      ? { glyph: '●', colorVar: '--color-ok' }
      : { glyph: '◆', colorVar: '--color-brand' };
  }

  function makeAlarmRow(alert) {
    const row = el('div', alert.read ? 'agent-alarm-row' : 'agent-alarm-row is-unread');
    const mark = alarmIcon(alert);
    const icon = el('span', 'agent-alarm-icon');
    icon.textContent = mark.glyph;
    icon.style.color = `var(${mark.colorVar})`;
    row.appendChild(icon);
    const textWrap = el('span', 'agent-alarm-text');
    const t = el('span', 'agent-alarm-title');
    t.textContent = alert.title;
    textWrap.appendChild(t);
    if (alert.sub) {
      const s = el('span', 'agent-alarm-sub');
      s.textContent = alert.sub;
      textWrap.appendChild(s);
    }
    row.appendChild(textWrap);
    const time = el('span', 'agent-alarm-time');
    time.textContent = formatAlarmTime(alert.firedAt);
    row.appendChild(time);
    return row;
  }

  // notifyRooms(sidebar.js가 소유)를 읽기만 한다 — IPC 왕복이 없어 동기다.
  function renderAlarmColumn() {
    while (alarmList.firstChild) alarmList.removeChild(alarmList.firstChild);
    const alerts = (typeof fetchAlerts === 'function') ? fetchAlerts() : [];
    alertsCache = Array.isArray(alerts) ? alerts : [];
    updateAlertsTabLabel();
    if (!alertsCache.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '받은 알람이 없습니다';
      alarmList.appendChild(empty);
      return;
    }
    // 실행 이력과 같은 접기 규칙(Paper 보드 02 실측 — 6행 + "지난 알람 24건 더").
    const shown = alertsExpanded ? alertsCache : alertsCache.slice(0, ALERTS_COLLAPSED);
    for (const alert of shown) alarmList.appendChild(makeAlarmRow(alert));
    const remaining = alertsCache.length - shown.length;
    if (remaining > 0) {
      const more = el('button', 'agent-list-more');
      more.type = 'button';
      more.textContent = `지난 알람 ${remaining}건 더`;
      more.addEventListener('click', () => { alertsExpanded = true; renderAlarmColumn(); });
      alarmList.appendChild(more);
    }
  }

  // 라이브 컬럼 — 진행바·"다음 24시간" 전부 fixture다(위 머리말). "WS 연결됨"만
  // getWsConnected(canvas.js가 athena:routine-feed-status를 구독해 준다)로 실데이터다.
  function fixtureLiveProgress() {
    return [
      { key: 'p1', label: '● 시세 수집 — 삼성전자', badge: '데모', sub: '조건 2/3 · 12초 전 확인', pct: 66 },
      { key: 'p2', label: '● 평일 아침 브리핑', badge: '대기 → 07:30', sub: '49분 후 · 소스 예열됨', pct: 92 },
    ];
  }

  // 시각·점 색까지 Paper 보드 02 실측 그대로다 — 시각이 없으면 "다음 24시간"이
  // 순서만 있고 언제인지는 없는 목록이 된다(원 목업의 핵심 열이 빠진 상태였다).
  // 점 색은 그 줄이 어떤 갈래인지를 말한다(예약=ok · 프로액티브=brand ·
  // 감시=info) — 리스트 행의 statusRowIcon 색 규칙과 같은 어휘를 쓴다.
  function fixtureTimeline() {
    return [
      { time: '07:30', label: '아침 브리핑', sub: '기존 채팅', colorVar: '--color-ok' },
      { time: '08:55', label: '장 시작 전 말걸기', sub: '프로액티브', colorVar: '--color-brand' },
      { time: '15:30', label: '감시 마감 확인', sub: '삼성 88,000', colorVar: '--color-info' },
      { time: '16:00', label: '성향 제안 검토', sub: '그래프 반영', colorVar: '--color-brand' },
    ];
  }

  const liveCol = el('div', 'agent-live-col');
  liveCol.setAttribute('data-source', 'fixture');
  const liveCaption = el('div', 'agent-panel-caption');
  liveCaption.textContent = '라이브';
  liveCaption.appendChild(fixtureMark());
  liveCol.appendChild(liveCaption);

  const liveProgressWrap = el('div', 'agent-live-progress');
  for (const p of fixtureLiveProgress()) {
    const row = el('div', 'agent-live-progress-row');
    const headRow = el('div', 'agent-live-progress-head');
    const label = el('span', 'agent-live-progress-label');
    label.textContent = p.label;
    headRow.appendChild(label);
    const badge = el('span', 'agent-live-progress-badge');
    badge.textContent = p.badge;
    headRow.appendChild(badge);
    row.appendChild(headRow);
    const sub = el('div', 'agent-live-progress-sub');
    sub.textContent = p.sub;
    row.appendChild(sub);
    const bar = el('div', 'agent-live-progress-bar');
    const fill = el('div', 'agent-live-progress-fill');
    fill.style.width = `${p.pct}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    liveProgressWrap.appendChild(row);
  }
  liveCol.appendChild(liveProgressWrap);

  const timelineCaption = el('div', 'agent-panel-caption');
  timelineCaption.textContent = '다음 24시간';
  timelineCaption.appendChild(fixtureMark());
  liveCol.appendChild(timelineCaption);
  const timelineWrap = el('div', 'agent-live-timeline');
  for (const t of fixtureTimeline()) {
    const row = el('div', 'agent-live-timeline-row');
    const time = el('span', 'agent-live-timeline-time');
    time.textContent = t.time;
    row.appendChild(time);
    const dot = el('span', 'agent-live-timeline-dot');
    dot.textContent = '●';
    dot.style.color = `var(${t.colorVar})`;
    row.appendChild(dot);
    const label = el('span', 'agent-live-timeline-label');
    label.textContent = t.label;
    row.appendChild(label);
    const sub = el('span', 'agent-live-timeline-sub');
    sub.textContent = t.sub;
    row.appendChild(sub);
    timelineWrap.appendChild(row);
  }
  liveCol.appendChild(timelineWrap);

  const wsRow = el('div', 'agent-live-ws');
  wsRow.setAttribute('data-source', 'live');
  const wsDot = el('span', 'agent-live-ws-dot');
  wsRow.appendChild(wsDot);
  const wsLabel = el('span', 'agent-live-ws-label');
  wsRow.appendChild(wsLabel);
  const wsCaption = el('div', 'agent-live-ws-caption');
  wsCaption.textContent = '발화는 채팅으로 도착 — 여긴 관제만';

  function renderWsStatus() {
    const connected = typeof getWsConnected === 'function' ? !!getWsConnected() : false;
    wsDot.textContent = '●';
    wsDot.style.color = connected ? 'var(--color-ok)' : 'var(--color-k-faint)';
    wsLabel.textContent = connected ? 'WS 연결됨' : 'WS 연결 안 됨';
  }

  alarmLiveBody.appendChild(liveCol);
  alarmLiveBody.appendChild(wsRow);
  alarmLiveBody.appendChild(wsCaption);

  // ---------- 실행 이력 · 결과 드릴인(10단계, Paper 보드 41) ----------
  const historyBody = el('div', 'agent-history-body');
  historyBody.hidden = true;

  const historyRunsCol = el('div', 'agent-history-runs-col');
  const historyRunsCaption = el('div', 'agent-panel-caption');
  historyRunsCaption.textContent = '최근 30회';
  historyRunsCol.appendChild(historyRunsCaption);
  const historyRunsList = el('div', 'agent-history-runs-list');
  historyRunsCol.appendChild(historyRunsList);
  historyBody.appendChild(historyRunsCol);

  // "평균"(5단계 라이브) — 4단계 GET /{id}/runs의 avg_duration_ms를 그대로
  // 쓴다. 아직 못 물어봤거나(초기 상태) 최근 30건에 duration_ms가 있는 행이
  // 하나도 없으면(구 jsonl 혼재) 지어낸 숫자 없이 "—"로 정직하게 표시한다(P3).
  function avgDurationTile() {
    if (avgDurationCache == null) return { key: 'avg', label: '평균', value: '—', source: 'live' };
    return { key: 'avg', label: '평균', value: `${(avgDurationCache / 1000).toFixed(1)}s`, source: 'live' };
  }

  // "발화→열람"(F-stage5b-FE 라이브) — GET /{id}/runs의 opened_rate(0~1,
  // 최근 30건 fired 기준 근사치, engagement.py 참고)를 %로 보여준다. null이면
  // (아직 못 물어봤거나 최근 fired가 0건이라 분모가 없으면) "—"로 정직하게 둔다.
  function openedRateTile() {
    if (!engagementCache || engagementCache.openedRate == null) {
      return { key: 'opened-rate', label: '발화→열람', value: '—', source: 'live' };
    }
    return { key: 'opened-rate', label: '발화→열람', value: `${Math.round(engagementCache.openedRate * 100)}%`, source: 'live' };
  }

  // "이어진 대화"(F-stage5b-FE 라이브) — GET /{id}/runs의 replied_count(최근
  // 30건 engagement 로그 기준, engagement.py 참고) 그대로.
  function repliedCountTile() {
    if (!engagementCache || engagementCache.repliedCount == null) {
      return { key: 'continued', label: '이어진 대화', value: '—', source: 'live' };
    }
    return { key: 'continued', label: '이어진 대화', value: `${engagementCache.repliedCount}건`, source: 'live' };
  }

  // 통계 3타일(평균·발화→열람·이어진 대화)은 F-stage5·5b-FE를 거쳐 전부
  // 라이브다 — 지표 정의가 끝내 확정되지 않은 타일 1개는 3차 라운드(R2)에서
  // 제거됐다(agent-mode-round3-plan.md 1단계, Paper 우선 역방향 적용).
  function buildHistoryStats() {
    return [
      avgDurationTile(),
      openedRateTile(),
      repliedCountTile(),
    ];
  }

  // "오늘 산출물" 카드 — 6단계에서 fixture를 실데이터(GET /{id}/runs의
  // briefing_title/briefing_content/truncated, 3단계 briefings 스토어)로 승격했다.
  // 오늘 발화된 브리핑 본문이 없으면 카드 자체를 렌더하지 않는다(기존 P3
  // fixture-부재 패턴 재사용 — 지어낸 산출물을 보여주지 않는다).
  const historyStatsCol = el('div', 'agent-history-stats-col');

  const historyOutputCaption = el('div', 'agent-panel-caption');
  historyOutputCaption.textContent = '오늘 산출물';
  historyOutputCaption.hidden = true;
  historyStatsCol.appendChild(historyOutputCaption);
  const historyOutputCard = el('div', 'agent-history-output-card');
  historyOutputCard.setAttribute('data-source', 'live');
  historyOutputCard.hidden = true;
  historyStatsCol.appendChild(historyOutputCard);

  // 본문은 자유형식 LLM 텍스트다 — 옛 fixture의 title+items(text/sub) 반복
  // 구조에 끼워 맞추지 않고 title+단일 본문 블록으로 단순화했다(P3).
  function renderHistoryOutput(sortedRuns) {
    while (historyOutputCard.firstChild) historyOutputCard.removeChild(historyOutputCard.firstChild);
    const today = new Date();
    const isToday = (iso) => {
      const d = new Date(iso);
      return !Number.isNaN(d.getTime())
        && d.getFullYear() === today.getFullYear()
        && d.getMonth() === today.getMonth()
        && d.getDate() === today.getDate();
    };
    const latest = (sortedRuns || []).find(
      (r) => r && r.verdict === 'fired' && typeof r.briefing_content === 'string' && isToday(r.ts),
    );
    if (!latest) {
      historyOutputCaption.hidden = true;
      historyOutputCard.hidden = true;
      return;
    }
    const t = new Date(latest.ts);
    historyOutputCaption.textContent =
      `오늘 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 산출물`;
    historyOutputCaption.hidden = false;
    historyOutputCard.hidden = false;
    const outputHead = el('div', 'agent-history-output-head');
    const outputTitle = el('span', 'agent-history-output-title');
    outputTitle.textContent = latest.briefing_title || '브리핑';
    outputHead.appendChild(outputTitle);
    const outputTag = el('span', 'agent-history-output-tag');
    outputTag.textContent = latest.briefing_destination === 'canvas' ? '캔버스 카드' : '채팅 답변';
    outputHead.appendChild(outputTag);
    historyOutputCard.appendChild(outputHead);
    const bodyRow = el('div', 'agent-history-output-item');
    const bodyText = el('div', 'agent-history-output-item-text');
    bodyText.textContent = latest.briefing_content;
    bodyRow.appendChild(bodyText);
    if (latest.truncated === true) {
      // 잘렸다는 사실을 숨기지 않는다(P3) — 3단계 저장 상한과 같은 숫자.
      const sub = el('div', 'agent-history-output-item-sub');
      sub.textContent = '…(이하 생략 — 저장 상한 4,000자에서 잘렸습니다)';
      bodyRow.appendChild(sub);
    }
    historyOutputCard.appendChild(bodyRow);
    const outputActions = el('div', 'agent-history-output-actions');
    for (const label of ['캔버스에서 열기', '채팅으로']) {
      const btn = el('button', 'agent-history-output-btn');
      btn.type = 'button';
      btn.textContent = label;
      // 재기동 후에는 원 캔버스 카드·채팅 턴 DOM이 사라져 있어 "열기"를 안정적으로
      // 구현할 방법이 없다 — 죽은 버튼을 활성으로 바꾸지 않는다(P3, ADR 후속 기록).
      btn.disabled = true;
      btn.title = '재기동 후 원 위치를 열 방법이 없어 아직 지원하지 않습니다';
      outputActions.appendChild(btn);
    }
    historyOutputCard.appendChild(outputActions);
  }

  const historyStatsCaption = el('div', 'agent-panel-caption');
  historyStatsCaption.textContent = '30회 통계';
  historyStatsCol.appendChild(historyStatsCaption);
  const historyStatsGrid = el('div', 'agent-history-stats-grid');
  historyStatsCol.appendChild(historyStatsGrid);
  historyBody.appendChild(historyStatsCol);

  // avgDurationCache가 드릴인 대상마다 바뀌므로(5단계) 최초 1회 구성이 아니라
  // refreshHistoryRuns() 완료 시마다 다시 그린다.
  function renderHistoryStats() {
    while (historyStatsGrid.firstChild) historyStatsGrid.removeChild(historyStatsGrid.firstChild);
    for (const tile of buildHistoryStats()) {
      const t = el('div', 'agent-history-stat-tile');
      t.setAttribute('data-source', tile.source);
      const l = el('div', 'agent-history-stat-label');
      l.textContent = tile.label;
      t.appendChild(l);
      const v = el('div', 'agent-history-stat-value');
      v.textContent = tile.value;
      t.appendChild(v);
      historyStatsGrid.appendChild(t);
    }
  }
  renderHistoryStats(); // 초기 페인트 — 드릴인 열기 전엔 "평균"이 "—"로 보인다.

  // 행에는 시각만 남는다 — 날짜는 위의 그룹 머리가 한 번만 말한다(Paper 보드 03
  // 실측: 행 좌측 열이 "07:30"·"07:31"이고 날짜는 "오늘 — 8/26 화" 머리에 있다).
  function formatRunTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  // 날짜 그룹 머리 문구(Paper 보드 03) — 오늘·어제만 이름을 붙이고 그 앞은
  // "8/22 금"처럼 날짜+요일만 쓴다. 파싱 실패한 ts는 그룹을 만들지 않는다(빈
  // 머리를 지어내지 않는다, P3) — 호출부가 null을 받으면 머리를 생략한다.
  function runDateGroupLabel(iso, now) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const dayOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((dayOf(now) - dayOf(d)) / 86400000);
    const stamp = `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_KO[d.getDay()]}`;
    if (diffDays === 0) return `오늘 — ${stamp}`;
    if (diffDays === 1) return `어제 — ${stamp}`;
    return stamp;
  }

  // ledger 실제 verdict 3종(fired/near/suppressed)만 쓴다 — 목업의 "재시도"·
  // "대체 실행"류는 대응 verdict가 없어 만들지 않는다(AC10, 위 머리말).
  function makeHistoryRunRow(run) {
    const icon = VERDICT_ICON[run.verdict] || { glyph: '?', colorVar: '--color-k-faint' };
    const row = el('div', 'agent-history-run');
    const time = el('span', 'agent-history-run-time');
    time.textContent = formatRunTime(run.ts);
    row.appendChild(time);
    const mark = el('span', 'agent-history-run-mark');
    mark.textContent = icon.glyph;
    mark.style.color = `var(${icon.colorVar})`;
    row.appendChild(mark);
    const textWrap = el('span', 'agent-history-run-text');
    const reason = el('span', 'agent-history-run-reason');
    reason.textContent = run.reason || '';
    textWrap.appendChild(reason);
    if (run.observed != null || run.threshold != null) {
      const detail = el('span', 'agent-history-run-detail');
      detail.textContent = `관측 ${run.observed} · 임계 ${run.threshold}`;
      textWrap.appendChild(detail);
    }
    row.appendChild(textWrap);
    return row;
  }

  // 접힌 상태에서 보이는 실행 행 수(Paper 보드 03 실측 — 6행 + "지난 실행 24건
  // 더"로 30건을 가린다). 푸터는 죽은 글자가 아니라 나머지를 펼치는 버튼이다.
  const HISTORY_RUNS_COLLAPSED = 6;

  // 그룹 머리 + 접기/펼치기를 한자리에서 그린다 — refreshHistoryRuns()(데이터
  // 도착)와 푸터 클릭(펼치기) 둘 다 이 함수만 부른다(단일 그리기 지점).
  function renderHistoryRuns() {
    while (historyRunsList.firstChild) historyRunsList.removeChild(historyRunsList.firstChild);
    if (!historyRunsCache.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '실행 이력이 없습니다';
      historyRunsList.appendChild(empty);
      return;
    }
    const shown = historyRunsExpanded
      ? historyRunsCache
      : historyRunsCache.slice(0, HISTORY_RUNS_COLLAPSED);
    const now = new Date();
    let lastGroup = null;
    for (const run of shown) {
      const group = runDateGroupLabel(run.ts, now);
      if (group && group !== lastGroup) {
        const head2 = el('div', 'agent-history-run-group');
        head2.textContent = group;
        historyRunsList.appendChild(head2);
        lastGroup = group;
      }
      historyRunsList.appendChild(makeHistoryRunRow(run));
    }
    const remaining = historyRunsCache.length - shown.length;
    if (remaining > 0) {
      const more = el('button', 'agent-list-more');
      more.type = 'button';
      more.textContent = `지난 실행 ${remaining}건 더`;
      more.addEventListener('click', () => { historyRunsExpanded = true; renderHistoryRuns(); });
      historyRunsList.appendChild(more);
    }
  }

  // GET /api/v1/routines/{id}/runs 실데이터(6단계) — requestId로 낡은 응답을
  // 버린다(routine 목록·제안과 같은 이유·같은 패턴). fetchAvgDuration(5단계)·
  // fetchEngagement(F-stage5b-FE)는 같은 엔드포인트의 다른 필드(avg_duration_ms·
  // opened_rate·replied_count)를 노린 별개 왕복이다 — fetchFiredToday와 같은
  // 이유(agent-canvas.js 머리말 "네 소스는 서로 무관한 왕복이다" 원칙 재사용),
  // fetchRuns의 기존 배열 계약을 안 건드리기 위함이다.
  async function refreshHistoryRuns() {
    if (!historyItem) return;
    const id = historyItem.id;
    const rid = ++historyRequestId;
    let runs = [];
    try {
      runs = (typeof fetchRuns === 'function') ? await fetchRuns(id) : [];
      if (!Array.isArray(runs)) runs = [];
    } catch {
      runs = [];
    }
    let avgDuration = null;
    try {
      const v = (typeof fetchAvgDuration === 'function') ? await fetchAvgDuration(id) : null;
      avgDuration = (typeof v === 'number') ? v : null;
    } catch {
      avgDuration = null;
    }
    let engagement = null;
    try {
      const v = (typeof fetchEngagement === 'function') ? await fetchEngagement(id) : null;
      engagement = (v && typeof v === 'object') ? v : null;
    } catch {
      engagement = null;
    }
    if (rid !== historyRequestId || !historyItem || historyItem.id !== id) return;
    avgDurationCache = avgDuration;
    engagementCache = engagement;
    renderHistoryStats();
    // ledger는 append-only(오래된 게 먼저)라 최신 먼저로 뒤집고 30건으로 자른다.
    const sorted = runs.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 30);
    renderHistoryOutput(sorted); // "오늘 산출물" 카드(6단계) — 같은 runs 응답 재사용.
    historyRunsCache = sorted;
    renderHistoryRuns();
  }

  // ---------- 드릴인 "설정" 탭 — 요약 + 편집 폼(Paper 보드 06) ----------
  // 두 층이다: 늘 보이는 「설정 — 요약」(목록 행이 이미 쥔 값만 쓰므로 왕복이
  // 없다)과 [설정 편집]이 여는 「상세 패널 — 설정 편집」 폼이다. 폼은 GET /{id}를
  // 1회 불러 조건 원문·소스 명세를 받은 뒤 그 명세로 자기 모양을 정하고
  // (settingsFormModel), [저장]은 POST /{id}/update 한 왕복으로 끝난다.
  // 「채팅에서 고치기 ↗」는 없어지지 않는다 — 폼 버튼 행에 그대로 남아 두 입구가
  // 같은 게이트를 쓴다(동선 규칙②의 "편집도 채팅으로"는 폼이 생겨도 유효하다).
  const historySettingsBody = el('div', 'agent-history-settings');
  historySettingsBody.hidden = true;

  let settingsFormOpen = false;
  let settingsFormState = null; // settingsFormModel() 결과 — 왕복 전에는 null이다
  let settingsFormMessage = ''; // 저장 실패 사유(백엔드 detail) — 성공은 요약 갱신이 말한다
  let settingsFormRequestId = 0; // stale-응답 가드 — 다른 드릴인으로 옮겨가면 버린다
  let settingsSaving = false;
  let settingsInputs = {}; // 필드 key → 입력 노드. [저장]이 여기서 값을 읽는다.
  let settingsFormValues = null; // 사용자가 친 값. null이면 아직 손대지 않았다.

  function appendReadonlyRow(parent, row) {
    const node = el('div', 'agent-settings-readonly');
    const label = el('span', 'agent-settings-label');
    label.textContent = row.label;
    const value = el('span', 'agent-settings-readonly-value');
    value.textContent = row.value;
    node.appendChild(label);
    node.appendChild(value);
    if (row.tag) {
      const tag = el('span', 'agent-settings-tag');
      tag.textContent = row.tag;
      node.appendChild(tag);
    }
    parent.appendChild(node);
  }

  // 재렌더는 폼을 통째로 다시 짓는다 — 저장 중·저장 실패로 다시 그릴 때 사용자가
  // 친 값이 처음 값으로 되돌아가면 고칠 수가 없으므로, 그린 값이 아니라 마지막으로
  // 읽은 값을 되돌려 놓는다(모델의 field.value는 원본으로 남는다 — 설명 칸을
  // 건드렸는지 재는 데 쓴다).
  function fieldValue(field) {
    if (settingsFormValues && field.key in settingsFormValues) return settingsFormValues[field.key];
    return field.value;
  }

  function readSettingsInputs() {
    const values = {};
    for (const key of Object.keys(settingsInputs)) values[key] = settingsInputs[key].value;
    settingsFormValues = values;
    return values;
  }

  function makeFieldControl(field) {
    if (field.kind === 'select') {
      const select = el('select', 'agent-settings-select');
      for (const option of field.options) {
        const node = el('option', '');
        node.value = option.value;
        node.textContent = option.label;
        select.appendChild(node);
      }
      select.value = fieldValue(field);
      return select;
    }
    const input = el('input', 'agent-settings-input');
    input.type = field.kind === 'number' ? 'number' : 'text';
    input.value = fieldValue(field);
    return input;
  }

  function appendFormField(parent, field) {
    const row = el('div', 'agent-settings-field');
    const label = el('span', 'agent-settings-label');
    label.textContent = field.label;
    row.appendChild(label);
    const control = makeFieldControl(field);
    settingsInputs[field.key] = control;
    row.appendChild(control);
    if (field.unit) {
      const unit = el('span', 'agent-settings-unit');
      unit.textContent = field.unit;
      row.appendChild(unit);
    }
    if (field.hint) {
      const hint = el('span', 'agent-settings-hint');
      hint.textContent = field.hint;
      row.appendChild(hint);
    }
    parent.appendChild(row);
  }

  function renderSettingsForm() {
    const form = el('div', 'agent-settings-form');
    const caption = el('div', 'agent-panel-caption');
    caption.textContent = '상세 패널 — 설정 편집';
    form.appendChild(caption);
    if (!settingsFormState) {
      // 왕복 중이거나 상세를 못 받았다 — 빈 폼을 그리느니 그 사실을 적는다(P3).
      const empty = el('div', 'agent-settings-empty');
      empty.textContent = settingsFormMessage || '설정을 불러오는 중입니다';
      form.appendChild(empty);
      return form;
    }
    const title = el('div', 'agent-settings-form-title');
    title.textContent = settingsFormState.title;
    form.appendChild(title);
    for (const row of settingsFormState.readonly) appendReadonlyRow(form, row);
    const note = el('div', 'agent-settings-note');
    note.textContent = settingsFormState.note;
    form.appendChild(note);
    const fields = el('div', 'agent-settings-fields');
    fields.setAttribute('data-source', 'live');
    for (const field of settingsFormState.fields) appendFormField(fields, field);
    form.appendChild(fields);
    for (const row of settingsFormState.trailing) appendReadonlyRow(form, row);

    const actions = el('div', 'agent-settings-actions');
    const saveBtn = el('button', 'agent-settings-save');
    saveBtn.type = 'button';
    saveBtn.textContent = '저장';
    saveBtn.disabled = settingsSaving;
    saveBtn.addEventListener('click', () => saveSettingsForm());
    actions.appendChild(saveBtn);
    // [설정 편집]과 다른 클래스를 쓴다 — 같은 클래스였을 때 라우트·프로브의
    // querySelector 첫 일치가 버튼 순서에 따라 조용히 뒤바뀐다(스타일만 공유한다).
    const chatBtn = el('button', 'agent-settings-chat');
    chatBtn.type = 'button';
    chatBtn.textContent = '채팅에서 고치기 ↗';
    chatBtn.addEventListener('click', () => {
      if (typeof onEditInChat === 'function') onEditInChat(historyItem.title);
    });
    actions.appendChild(chatBtn);
    form.appendChild(actions);

    if (settingsFormMessage) {
      const message = el('div', 'agent-settings-message');
      message.textContent = settingsFormMessage;
      form.appendChild(message);
    }
    return form;
  }

  function renderHistorySettings() {
    while (historySettingsBody.firstChild) historySettingsBody.removeChild(historySettingsBody.firstChild);
    settingsInputs = {};
    if (!historyItem) return;
    const caption = el('div', 'agent-panel-caption');
    caption.textContent = '설정 — 요약';
    historySettingsBody.appendChild(caption);

    const summary = el('div', 'agent-settings-summary');
    summary.setAttribute('data-source', 'live');
    const lines = settingsSummaryLines(historyItem.raw || {});
    const summaryTitle = el('div', 'agent-settings-summary-title');
    summaryTitle.textContent = lines.title;
    summary.appendChild(summaryTitle);
    const summaryMeta = el('div', 'agent-settings-summary-meta');
    summaryMeta.textContent = lines.meta;
    summary.appendChild(summaryMeta);
    historySettingsBody.appendChild(summary);

    const editBtn = el('button', 'agent-history-settings-edit');
    editBtn.type = 'button';
    editBtn.textContent = '설정 편집';
    editBtn.addEventListener('click', () => openSettingsForm());
    historySettingsBody.appendChild(editBtn);

    if (settingsFormOpen) historySettingsBody.appendChild(renderSettingsForm());
  }

  // 드릴인을 열고 닫을 때 폼 상태를 버린다 — 왕복이 돌고 있으면 그 응답도
  // 버려진다(settingsFormRequestId가 어긋난다).
  function closeSettingsForm() {
    settingsFormOpen = false;
    settingsFormState = null;
    settingsFormValues = null;
    settingsFormMessage = '';
    settingsFormRequestId += 1;
  }

  // [설정 편집] — 상세 1회 조회(목록에 없는 조건 원문·소스 명세를 여기서만 준다).
  async function openSettingsForm() {
    if (!historyItem) return;
    const id = historyItem.id;
    const rid = ++settingsFormRequestId;
    settingsFormOpen = true;
    settingsFormState = null;
    settingsFormValues = null;
    settingsFormMessage = '';
    renderHistorySettings();
    let detail = null;
    try {
      detail = (typeof fetchDetail === 'function') ? await fetchDetail(id) : null;
    } catch {
      detail = null;
    }
    if (rid !== settingsFormRequestId || !historyItem || historyItem.id !== id) return;
    settingsFormState = settingsFormModel(detail, historyItem.raw);
    if (!settingsFormState) settingsFormMessage = '설정을 불러오지 못했습니다';
    renderHistorySettings();
  }

  // [저장] — 폼 값 한 벌을 그대로 보낸다. 성공하면 목록 행의 값을 응답으로 덮어
  // 요약이 저장한 값으로 갱신되고(같은 객체를 리스트도 쥐고 있다) 폼은 닫힌다.
  async function saveSettingsForm() {
    if (!settingsFormState || !historyItem || settingsSaving) return;
    const id = historyItem.id;
    const body = settingsUpdateBody(settingsFormState, readSettingsInputs());
    settingsSaving = true;
    settingsFormMessage = '';
    renderHistorySettings();
    let saved = null;
    let failure = '';
    try {
      saved = (typeof updateRoutine === 'function') ? await updateRoutine(id, body) : null;
    } catch (e) {
      failure = String((e && e.message) || e);
    }
    settingsSaving = false;
    if (!historyItem || historyItem.id !== id) return;
    if (!saved) {
      settingsFormMessage = failure || '저장하지 못했습니다';
      renderHistorySettings();
      return;
    }
    const raw = historyItem.raw || {};
    for (const key of ['note', 'cooldown_s', 'expires_at', 'briefing_model', 'briefing_effort']) {
      if (key in saved) raw[key] = saved[key];
    }
    historyItem.title = raw.note || historyItem.title;
    breadcrumbTitle.textContent = historyItem.title;
    settingsFormOpen = false;
    settingsFormState = null;
    settingsFormValues = null;
    renderHistorySettings();
    renderPanels();
  }

  function setHistoryTab(key) {
    if (!historyTabButtons[key] || key === historyTab) return;
    // 탭을 떠나면 폼은 다음에 처음부터 다시 그려진다 — 떠나기 전에 사용자가 친
    // 값을 한 번 읽어 두어야 [이력]에 갔다 오는 것만으로 편집이 사라지지 않는다.
    if (historyTab === 'settings' && settingsFormOpen) readSettingsInputs();
    historyTab = key;
    for (const k of Object.keys(historyTabButtons)) {
      historyTabButtons[k].className = k === historyTab ? 'agent-history-tab is-active' : 'agent-history-tab';
    }
    const isRuns = historyTab === 'runs';
    historyBody.hidden = !isRuns;
    historySettingsBody.hidden = isRuns;
    if (!isRuns) renderHistorySettings();
  }

  function openHistory(item) {
    historyItem = item;
    historyRunsCache = [];
    historyRunsExpanded = false; // 다른 작업의 드릴인을 펼친 채로 물려받지 않는다.
    // 드릴인은 항상 "이력"으로 연다 — 지난 드릴인의 "설정" 상태를 물려받지 않는다.
    historyTab = 'runs';
    closeSettingsForm(); // 남의 작업 설정 폼을 열어 둔 채로 넘어가지 않는다.
    for (const k of Object.keys(historyTabButtons)) {
      historyTabButtons[k].className = k === 'runs' ? 'agent-history-tab is-active' : 'agent-history-tab';
    }
    historyTabs.hidden = false;
    historySettingsBody.hidden = true;
    tasksHead.hidden = true;
    stats.hidden = true;
    body.hidden = true;
    alarmLiveBody.hidden = true;
    proactiveBody.hidden = true;
    graphLinkBtn.hidden = true;
    markAllReadBtn.hidden = true;
    viewTabsWrap.hidden = true;
    for (const k of Object.keys(viewTabButtons)) viewTabButtons[k].className = 'agent-view-tab';
    breadcrumb.hidden = false;
    breadcrumbTitle.textContent = item.title;
    breadcrumbBadge.className = `agent-breadcrumb-badge is-${item.status}`;
    breadcrumbBadge.textContent = item.status === 'paused' ? '일시중지' : '활성';
    historyBody.hidden = false;
    return refreshHistoryRuns(); // 호출부(클릭 핸들러)가 await할 수 있게 돌려준다.
  }

  // "작업 ›" 클릭 — 드릴인은 항상 "작업" 뷰에서만 열리므로(위 머리말) 그
  // 상태로 직접 되돌린다(탭 활성 표시도 "작업"으로 되돌린다 — 실측: 이전엔
  // 이 복원이 빠져 있어 복귀 후 어떤 탭도 활성으로 안 보였다).
  function closeHistory() {
    historyItem = null;
    breadcrumb.hidden = true;
    historyTabs.hidden = true;
    historySettingsBody.hidden = true;
    historyTab = 'runs';
    closeSettingsForm();
    historyBody.hidden = true;
    viewTabsWrap.hidden = false;
    tasksHead.hidden = false;
    stats.hidden = false;
    body.hidden = false;
    proactiveBody.hidden = true;
    graphLinkBtn.hidden = true;
    activeView = 'tasks';
    for (const k of Object.keys(viewTabButtons)) {
      viewTabButtons[k].className = k === 'tasks' ? 'agent-view-tab is-active' : 'agent-view-tab';
    }
  }

  // ---------- 프로액티브(11단계, Paper 보드 42) ----------
  const proactiveBody = el('div', 'agent-proactive-body');
  proactiveBody.hidden = true;

  const proactiveStrip = el('div', 'agent-proactive-strip');
  const proactiveStripLabel = el('div', 'agent-panel-caption');
  proactiveStripLabel.textContent = '지금 읽히는 성향';
  proactiveStrip.appendChild(proactiveStripLabel);
  const proactiveStripValue = el('div', 'agent-proactive-strip-value');
  proactiveStrip.appendChild(proactiveStripValue);
  const proactiveStripSub = el('div', 'agent-proactive-strip-sub');
  proactiveStrip.appendChild(proactiveStripSub);
  proactiveBody.appendChild(proactiveStrip);

  const proactiveCardsWrap = el('div', 'agent-proactive-cards');
  proactiveBody.appendChild(proactiveCardsWrap);

  // 말걸기 가드(F-stage9부터 라이브) — GET /api/v1/nudge-guard(8단계)로 4개
  // 태그를 채운다. 편집은 여전히 채팅 경로로만(43 원칙, 아래 가드 확인 카드
  // 참고) — 이 패널 자체엔 값을 바꾸는 버튼을 두지 않는다(죽은 버튼 금지, P3).
  const nudgeGuard = el('div', 'agent-nudge-guard');
  const nudgeGuardCaption = el('div', 'agent-panel-caption');
  nudgeGuardCaption.textContent = '말걸기 가드';
  nudgeGuard.appendChild(nudgeGuardCaption);
  const nudgeGuardTags = el('div', 'agent-nudge-guard-tags');
  nudgeGuard.appendChild(nudgeGuardTags);
  const nudgeGuardNote = el('div', 'agent-nudge-guard-note');
  nudgeGuard.appendChild(nudgeGuardNote);
  proactiveBody.appendChild(nudgeGuard);

  // GuardSettings 4필드 → 패널 태그 4개(guard_settings.py "42번 패널의 기존
  // 4개 태그와 1:1 대응"과 같은 매핑).
  function guardTagLabels(settings) {
    const qh = settings.quiet_hours || {};
    return [
      `하루 최대 ${settings.max_daily_nudges}회`,
      `조용 시간 ${qh.start || '?'}–${qh.end || '?'}`,
      settings.show_rationale ? '근거 표시 항상' : '근거 표시 끔',
      settings.learn_from_dismissals ? '거절 반영 성향으로 학습' : '거절 학습 끔',
    ];
  }

  function renderNudgeGuard() {
    while (nudgeGuardTags.firstChild) nudgeGuardTags.removeChild(nudgeGuardTags.firstChild);
    nudgeGuard.setAttribute('data-source', 'live'); // 8단계부터 라이브 — fixture 폴백 없음(지어내지 않는다, P3).
    if (!nudgeGuardCache) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '가드 설정을 불러오는 중입니다';
      nudgeGuardTags.appendChild(empty);
      nudgeGuardNote.textContent = '';
      return;
    }
    for (const label of guardTagLabels(nudgeGuardCache)) {
      const tag = el('span', 'agent-nudge-guard-tag');
      tag.textContent = label;
      nudgeGuardTags.appendChild(tag);
    }
    nudgeGuardNote.textContent = '제안은 그래프 보강 15 이상일 때만 · 거절한 제안은 반복되지 않는다 → 발화 자체는 오른쪽 채팅에 도착';
  }
  renderNudgeGuard(); // 초기 페인트 — 라이브 데이터 도착 전엔 "불러오는 중"으로 정직하게 보인다.

  function updateProactiveTabLabel() {
    const n = visibleSuggestionCount(); // 3단계 — "성향 제안" 통계 타일과 같은 계산 공유.
    viewTabButtons.proactive.textContent = n > 0 ? `제안 ${n}` : '제안';
  }

  // "N분 전" — profile-summary가 실제로 주는 observed_at 중 가장 최근 것이다
  // (지어낸 신선도가 아니다, P3). 값이 없거나 파싱이 안 되면 이 조각을 통째로
  // 빼고 "신호 N"만 남긴다.
  function freshestSignalAge() {
    let newest = null;
    for (const e of suggestionsCache) {
      const t = Date.parse(e && e.observed_at);
      if (!Number.isFinite(t)) continue;
      if (newest === null || t > newest) newest = t;
    }
    if (newest === null) return '';
    const min = Math.max(0, Math.round((Date.now() - newest) / 60000));
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    return `${Math.floor(hr / 24)}일 전`;
  }

  function renderProactiveStrip() {
    const relations = [...new Set(suggestionsCache.map((e) => e.relation_kind).filter(Boolean))];
    proactiveStripValue.textContent = relations.length ? relations.join(' · ') : '아직 읽히는 성향이 없습니다';
    // 우측 메타(Paper 보드 04 실측 "신호 312 · 12분 전") — 신호 수와 신선도.
    if (!suggestionsCache.length) {
      proactiveStripSub.textContent = '';
      return;
    }
    const age = freshestSignalAge();
    proactiveStripSub.textContent = age
      ? `신호 ${suggestionsCache.length} · ${age}`
      : `신호 ${suggestionsCache.length}`;
  }

  function makeProactiveCard(entry) {
    const card = el('div', 'agent-proactive-card');
    card.setAttribute('data-source', 'live'); // profile-summary는 실데이터다(7단계와 같은 원천).
    const head2 = el('div', 'agent-proactive-card-head');
    const icon = el('span', 'agent-proactive-card-icon');
    icon.textContent = '◆';
    head2.appendChild(icon);
    const title = el('span', 'agent-proactive-card-title');
    title.textContent = entry.entity_name || entry.entity_id;
    head2.appendChild(title);
    const routineBtn = el('button', 'agent-proactive-chip is-primary');
    routineBtn.type = 'button';
    routineBtn.textContent = '루틴으로';
    routineBtn.addEventListener('click', () => {
      if (typeof onAddSuggestion === 'function') onAddSuggestion(suggestionRequestText(entry));
    });
    head2.appendChild(routineBtn);
    const holdBtn = el('button', 'agent-proactive-chip');
    holdBtn.type = 'button';
    holdBtn.textContent = '보류';
    holdBtn.addEventListener('click', () => {
      // 세션 동안만 숨긴다 — 저장 백엔드가 없어 재시작하면 다시 보인다(위 머리말, P3).
      heldSuggestionIds.add(entry.entity_id);
      // 보류는 서버 상태를 바꾸지 않는다 — 빈 변경이 정상이라고 결과 턴이 말한다(4380-1).
      if (typeof onControlResult === 'function') {
        onControlResult(ControlTurn.buildControlResultTurn({
          kind: 'reject',
          badge: '제안 채택',
          lead: '보류 — 목록 유지',
          fact: `${entry.entity_name || entry.entity_id} · 보류함 ${heldSuggestionIds.size}건`,
        }));
      }
      renderProactiveCards();
      updateProactiveTabLabel();
      renderStats(); // 3단계 — "성향 제안" 통계 타일도 heldSuggestionIds를 본다(위와 같은 이유).
    });
    head2.appendChild(holdBtn);
    card.appendChild(head2);
    // Paper 보드 04의 카드는 두 줄이다 — 사람이 읽는 설명(rationale)과 그 아래
    // "근거:" 한 줄(성향·보강 횟수). 39번 좌측 미니 목록은 좁아서 한 줄로
    // 합치지만(makeSuggestionRow), 전체 화면 카드는 원본대로 나눈다.
    if (entry.rationale) {
      const desc = el('div', 'agent-proactive-card-desc');
      desc.textContent = entry.rationale;
      card.appendChild(desc);
    }
    const rationale = el('div', 'agent-proactive-card-rationale');
    rationale.textContent = `근거: ${entry.relation_kind} 성향 ${entry.reinforcement}회 보강`;
    card.appendChild(rationale);
    return card;
  }

  function renderProactiveCards() {
    while (proactiveCardsWrap.firstChild) proactiveCardsWrap.removeChild(proactiveCardsWrap.firstChild);
    const visible = suggestionsCache.filter((e) => !heldSuggestionIds.has(e.entity_id));
    if (!visible.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '지금은 표시할 제안이 없습니다';
      proactiveCardsWrap.appendChild(empty);
    } else {
      for (const entry of visible) proactiveCardsWrap.appendChild(makeProactiveCard(entry));
    }
  }

  // suggestionsCache가 바뀔 때마다(refreshSuggestions) 같이 갱신된다 — 아래
  // renderSuggestions()가 부른다(단일 갱신 지점, 위 머리말 "두 개의 진실" 참고).
  function renderProactiveView() {
    renderProactiveStrip();
    renderProactiveCards();
    updateProactiveTabLabel();
  }

  // GET /api/v1/routines 실데이터 → 리스트 항목. status가 active/paused인
  // 것만 다룬다 — draft는 별도 kind('draft', 아래)로 다룬다.
  //
  // 전제(Critic 조건부 코멘트, 3단계): 이 함수는 호출자(allItems())가
  // mode !== 'scheduled'로 이미 걸렀다는 전제 위에서 동작한다 — 새 호출부를
  // 추가할 때도 이 전제를 지켜야 한다(그렇지 않으면 예약 항목이 "주기 확인"
  // sub 라벨을 잘못 받는다, 사실11③).
  function toWatchItem(routine) {
    // 코드 알람(Step 7, 보드 12) — 갈래가 다르므로 kind부터 갈린다. 여기서
    // 갈라 놓지 않으면 「주기 확인」 폴백으로 떨어진다(A-1이 막는 지점).
    if (routine.mode === 'code-watch') {
      return {
        id: routine.id, kind: 'code', source: 'live', status: routine.status, mode: routine.mode,
        title: routine.note || routine.symbol || routine.id,
        sub: WatchNodes.watchSubLabel(routine.watch),
        trailing: '',
        raw: routine,
      };
    }
    return {
      id: routine.id, kind: 'watch', source: 'live', status: routine.status, mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: routine.mode === 'realtime-ws' ? '실시간 감시' : '주기 확인',
      trailing: routine.mode === 'realtime-ws' ? '실시간' : '',
      raw: routine,
    };
  }

  // 예약(schedule, 3단계) — toWatchItem()과 대칭이다. mode==='scheduled'
  // 스펙만 이쪽으로 온다(allItems()의 상보 필터). trailing엔 2단계 백엔드가
  // 계산한 next_fire_at(순수 함수, 저장 안 함)을 쓴다 — 없으면 빈 문자열로
  // 정직하게 남긴다(지어내지 않는다, P3).
  function toScheduleItem(routine) {
    return {
      id: routine.id, kind: 'schedule', source: 'live', status: routine.status, mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: '예약 실행',
      trailing: routine.next_fire_at ? formatAlarmTime(Date.parse(routine.next_fire_at)) : '',
      raw: routine,
    };
  }

  // 초안(draft, 8단계) — 채팅의 "작업 요약·초안" 카드가 만드는 것과 같은
  // 실데이터다(위 머리말 참고). "채팅에서 만드는 중"이라는 출처만 알려줄 뿐
  // 지어낸 일정 문구를 붙이지 않는다(P3 — Paper 목업의 "매매일 15:40"류는
  // 예약 트리거 전용 예시라 실제 draft 필드에 대응이 없다).
  function toDraftItem(routine) {
    // 코드 알람 초안(Step 7) — 상세가 검사 요약과 「검사」 버튼을 내야 하므로
    // 갈래는 'code'로 두고 상태만 초안이다(아래 renderCodeDetail이 갈라 그린다).
    if (routine.mode === 'code-watch') {
      return {
        id: routine.id, kind: 'code', source: 'live', status: 'draft', mode: routine.mode,
        title: routine.note || routine.symbol || routine.id,
        sub: `${WatchNodes.KIND_LABEL} · 초안 — 채팅에서 만드는 중`,
        trailing: '지금',
        raw: routine,
      };
    }
    return {
      id: routine.id, kind: 'draft', source: 'live', status: 'draft', mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: '초안 — 채팅에서 만드는 중',
      trailing: '지금',
      raw: routine,
    };
  }

  // 3단계(사실11③) — watchItems 필터에 mode !== 'scheduled'를 추가해 예약을
  // 걷어낸다. scheduleItems가 그 상보 집합을 가져간다 — 같은 라우틴이 감시·
  // 예약 리스트 양쪽에 중복 노출되는 걸 구조적으로 막는다(toWatchItem 자체는
  // 무수정, 위 전제 주석 참고).
  function allItems() {
    const watchItems = routinesCache
      .filter((r) => (r.status === 'active' || r.status === 'paused') && r.mode !== 'scheduled')
      .map(toWatchItem);
    const draftItems = routinesCache.filter((r) => r.status === 'draft').map(toDraftItem);
    const scheduleItems = routinesCache
      .filter((r) => (r.status === 'active' || r.status === 'paused') && r.mode === 'scheduled')
      .map(toScheduleItem);
    return watchItems.concat(draftItems).concat(scheduleItems);
  }

  function matchesTab(item) {
    if (activeTab === 'active') return item.status === 'active';
    if (activeTab === 'paused') return item.status === 'paused';
    return true; // 'all'
  }

  function matchesSearch(item) {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return `${item.title} ${item.sub || ''}`.toLowerCase().includes(q);
  }

  function visibleItems() {
    return allItems().filter((item) => matchesTab(item) && matchesSearch(item));
  }

  function makeListRow(item) {
    let cls = 'agent-row';
    if (item.id === selectedId) cls += ' is-selected';
    if (item.status === 'draft') cls += ' is-draft'; // ◌ 점선 핑크(8단계, Paper 보드 43)
    const row = el('button', cls);
    row.type = 'button';
    row.setAttribute('data-source', item.source);
    const icon = statusRowIcon(item);
    const dot = el('span', 'agent-row-dot');
    dot.textContent = icon.glyph;
    dot.style.color = `var(${icon.colorVar})`;
    row.appendChild(dot);
    const textWrap = el('span', 'agent-row-text');
    const rowTitle = el('span', 'agent-row-title');
    rowTitle.textContent = item.title;
    textWrap.appendChild(rowTitle);
    if (item.sub) {
      const rowSub = el('span', 'agent-row-sub');
      rowSub.textContent = item.sub;
      textWrap.appendChild(rowSub);
    }
    row.appendChild(textWrap);
    if (item.trailing) {
      const trailing = el('span', 'agent-row-trailing');
      trailing.textContent = item.trailing;
      row.appendChild(trailing);
    }
    row.addEventListener('click', () => selectRow(item.id));
    return row;
  }

  // watch·schedule 둘 다 백엔드가 실제로 주는 필드만 쓴다(P3 — 지어내지
  // 않는다) — 3단계부터 schedule도 raw가 live 라우틴이라 같은 필드 조합을
  // 쓴다. schedule만 "다음 실행"(next_fire_at, 2단계 순수 계산값)이 추가로 붙는다.
  // 6단계부터 schedule에 "브리핑 모델"(3단계 briefing_model/briefing_effort,
  // null이면 앱 기본값 의미 그대로 표기)과 "실행 위치"(가장 최근 브리핑 보고의
  // destination — 실행 이력이 없으면 행 자체를 렌더하지 않는다)가 실데이터로 붙는다.
  let detailDestinationCache = { id: null, value: null }; // 선택 항목별 1회 조회 캐시
  function detailFieldsFor(item) {
    const r = item.raw;
    const fields = [['소스', r.source_label || '—'], ['쿨다운', `${r.cooldown_s}초`]];
    if (item.kind === 'schedule' && r.next_fire_at) fields.push(['다음 실행', formatDateTime(r.next_fire_at)]);
    if (item.kind === 'schedule') {
      fields.push(['브리핑 모델', r.briefing_model
        ? `${r.briefing_model}${r.briefing_effort ? ` · ${r.briefing_effort}` : ''}`
        : '앱 기본']);
      if (detailDestinationCache.id === item.id && detailDestinationCache.value) {
        fields.push(['실행 위치', detailDestinationCache.value === 'canvas' ? '캔버스' : '채팅']);
      }
    }
    if (r.expires_at) fields.push(['만료', formatDateTime(r.expires_at)]);
    if (r.created_at) fields.push(['생성', formatDateTime(r.created_at)]);
    return fields;
  }

  // ledger API 라이브 연결은 10단계 몫 — 이 단계는 감시/예약 어느 쪽이든
  // fixture 로그다(Paper 보드 39 실측 예시).
  function fixtureLogs() {
    return [
      { time: '오늘 07:30', ok: true, text: '브리핑 카드 생성 — 캔버스 2' },
      { time: '어제 07:30', ok: true, text: '긴급 항목 없음' },
      { time: '금 07:30', ok: false, text: 'DART 응답 지연 — 소스 2개로 실행' },
    ];
  }

  // ---------- 코드 알람 상세(Step 7, Paper 보드 10·11·12) ----------
  //
  // 조건 편집 폼이 없는 것이 이 화면의 계약이다(A-5) — 코드 알람의 조건은 감시
  // 함수 자체이고, 고치는 길은 채팅(말로) 하나뿐이다(R10).
  //
  // 노드 카드의 값은 전부 백엔드가 실제로 기록한 값이다(P2·D2) — 없으면 「—」로
  // 남기고 지어내지 않는다. 코드 원문은 v1에서 가져오지 않는다(R7 — 접힌 줄은
  // 경로만 보여준다).
  let codeDetailCache = { id: null, data: null };
  let codeDetailRequestId = 0;
  let codeFiresCache = { id: null, rows: [] };
  let selectedNodeFn = null; // 선택된 노드 칸 — 진한 테두리 + 칩 2개
  let codeSourceOpen = false; // 「코드 · 참고 · 펼치기」 토글
  let fixHistoryOpen = false; // 「지난 고침 N건」 토글

  // 제어 결과 한 건을 같은 방(채팅)에 남긴다(Paper 4330-1). 사실행은 원장 행의
  // 1:1 렌더링이라 지어낼 것이 없다 — 판정·칩은 순수 모델이 붙인다. 배선이 없으면
  // 조용히 넘어간다(다른 선택 배선들과 같은 규칙).
  function reportControl(kind, badge, item, lead, reason, retry) {
    if (typeof onControlResult !== 'function') return;
    onControlResult(ControlTurn.buildControlResultTurn({
      kind,
      badge,
      lead,
      reason,
      fact: ControlTurn.controlFactLine((item && item.raw) || null),
    }), retry);
  }

  // 제어 한 번 = 결과 한 건. 던지는 배선(canvas.js)의 오류를 여기서 판정으로 옮긴다.
  // 실패에는 다시 부를 손잡이를 함께 실어 보낸다 — 채팅의 「다시 시도」가 같은
  // 제어를 그대로 다시 부르고(결과는 새 턴으로 온다) 화면도 함께 다시 받아온다.
  async function runControl(action, badge, item, doneLead) {
    if (typeof action !== 'function') return;
    try {
      await action(item.id);
      reportControl('success', badge, item, doneLead);
    } catch (err) {
      reportControl('fail', badge, item, '', String((err && err.message) || err), async () => {
        await runControl(action, badge, item, doneLead);
        await refresh();
      });
    }
  }

  function loadCodeDetail(item) {
    if (codeDetailCache.id === item.id) return;
    codeDetailCache = { id: item.id, data: null };
    const rid = ++codeDetailRequestId;
    Promise.resolve((typeof fetchDetail === 'function') ? fetchDetail(item.id) : null)
      .then((data) => {
        if (rid !== codeDetailRequestId || !data) return;
        codeDetailCache = { id: item.id, data };
        if (selectedId === item.id) renderDetail();
      })
      .catch(() => {});
  }

  function loadCodeFires(item) {
    if (codeFiresCache.id === item.id) return;
    codeFiresCache = { id: item.id, rows: [] };
    Promise.resolve((typeof fetchRuns === 'function') ? fetchRuns(item.id) : [])
      .then((rows) => {
        if (codeFiresCache.id !== item.id || !Array.isArray(rows)) return;
        codeFiresCache = {
          id: item.id,
          rows: rows.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 3),
        };
        if (selectedId === item.id) renderDetail();
      })
      .catch(() => {});
  }

  // 채팅으로 넘기는 한 경로(동선 규칙② 재사용). 기존 호출부는 제목 하나만
  // 넘겼다 — 두 번째 인자는 코드 알람에서만 붙는 덤이라 옛 배선이 그대로 돈다.
  function seedEdit(item, opts) {
    if (typeof onEditInChat !== 'function') return;
    onEditInChat(item.id, Object.assign({ title: item.title }, opts || {}));
  }

  function makeNodeCard(card, item) {
    const selected = selectedNodeFn === card.fn;
    const node = el('div', selected ? 'agent-node-card is-selected' : 'agent-node-card');
    if (selected) node.style.border = '2px solid var(--color-brand)';

    const head = el('div', 'agent-node-head');
    const titleEl = el('span', 'agent-node-title');
    titleEl.textContent = card.titleKo;
    head.appendChild(titleEl);
    if (card.changed) {
      const changed = el('span', 'agent-node-badge');
      changed.textContent = WatchNodes.BADGE_CHANGED;
      head.appendChild(changed);
    }
    node.appendChild(head);

    const fnEl = el('div', 'agent-node-fn');
    fnEl.textContent = card.titleEnRef || card.titleEn;
    node.appendChild(fnEl);

    if (card.unused) {
      const unused = el('div', 'agent-node-unused');
      unused.textContent = WatchNodes.BADGE_UNUSED;
      node.appendChild(unused);
    }

    const inLabel = el('div', 'agent-node-io-label');
    inLabel.textContent = WatchNodes.LABEL_IN;
    node.appendChild(inLabel);
    const inputs = card.inputs.length ? card.inputs : [{ name: '', value: WatchNodes.DASH }];
    for (const row of inputs) {
      const line = el('div', 'agent-node-in');
      const name = el('span', 'agent-node-in-name');
      name.textContent = row.name;
      const value = el('span', 'agent-node-in-value');
      value.textContent = row.value;
      line.appendChild(name);
      line.appendChild(value);
      node.appendChild(line);
    }

    node.appendChild(el('div', 'agent-node-sep'));
    const outLabel = el('div', 'agent-node-io-label');
    outLabel.textContent = WatchNodes.LABEL_OUT;
    node.appendChild(outLabel);
    const outEl = el('div', 'agent-node-out');
    outEl.textContent = card.output;
    outEl.style.fontWeight = '600';
    node.appendChild(outEl);

    if (selected) {
      const chips = el('div', 'agent-node-chips');
      for (const [label, kind] of [[WatchNodes.CHIP_ODD, 'odd'], [WatchNodes.CHIP_ASK, 'ask']]) {
        const chip = el('button', 'agent-node-chip');
        chip.type = 'button';
        chip.textContent = label;
        chip.addEventListener('click', (event) => {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          seedEdit(item, { node: card.fn, nodeTitle: card.titleKo, kind });
        });
        chips.appendChild(chip);
      }
      node.appendChild(chips);
    }

    node.addEventListener('click', () => {
      selectedNodeFn = selected ? null : card.fn;
      renderDetail();
    });
    return node;
  }

  // 첫 검사 상태 띠(Paper 45BA-1). 검사 개수나 판 번호는 응답에 없으므로 세지 않는다.
  function makeCheckBand(item, watch, check) {
    const band = el('div', `agent-check-band${check && check.ok === true ? ' is-passed' : ''}`);
    const title = el('span', 'agent-check-band-title');
    title.textContent = `새 알람 · ${item.title}`;
    band.appendChild(title);
    const status = el('span', 'agent-check-band-status');
    status.textContent = `${!check ? '검사 전' : check.ok === true ? '검사 통과' : '검사 통과 못 함'} · 장중 ${WatchNodes.pollMinutes(watch)}분마다`;
    band.appendChild(status);
    if (check) {
      const values = el('span', 'agent-check-band-values');
      const nodes = Array.isArray(check.nodes) ? `노드 ${check.nodes.length}개` : '';
      const day = WatchNodes.dayLabel(check.checked_at);
      const clock = WatchNodes.clockLabel(check.checked_at);
      values.textContent = [nodes, day && clock ? `검사 ${day} ${clock}` : ''].filter(Boolean).join(' · ');
      band.appendChild(values);
    }
    return band;
  }

  // 첫 검사 결과(Paper 45F4-1). 실패 응답의 기본 count=0은 센 결과가 아니다.
  function makeCheckPanel(check) {
    const wrap = el('div', 'agent-check-result');
    const head = el('div', 'agent-fix-recheck-head');
    const title = el('span', 'agent-fix-recheck-title');
    const days = check && check.lookback_days;
    title.textContent = Number.isInteger(days) && days > 0 ? `검사 결과 · 지난 ${days}일 돌려 봄` : '검사 결과';
    head.appendChild(title);
    const passed = check && check.ok === true;
    const cooldown = WatchNodes.cooldownLabel(check && check.cooldown_s);
    if (passed && cooldown !== WatchNodes.DASH) {
      const meta = el('span', 'agent-fix-recheck-meta');
      meta.textContent = `쿨다운 ${cooldown} 반영`;
      head.appendChild(meta);
    }
    wrap.appendChild(head);
    const summary = el('div', 'agent-code-check-summary');
    summary.textContent = !check ? '아직 검사한 적 없음' : !passed ? '검사 통과 못 함'
      : Number.isInteger(check.count) && check.count >= 0 ? `${check.count}번 울림` : '울림 수 없음';
    wrap.appendChild(summary);

    if (passed) {
      const fires = Array.isArray(check.fires) ? check.fires : [];
      const fireText = (fire) => `${WatchNodes.shortDate(fire.dt)}${typeof fire.close === 'number' && Number.isFinite(fire.close) ? ` · 종가 ${WatchNodes.formatValue(fire.close)}` : ''}`;
      if (fires.length) {
        const last = el('div', 'agent-check-last-fire');
        last.textContent = `마지막 ${fireText(fires[fires.length - 1])}`;
        wrap.appendChild(last);
      }
      const dots = FixCycle.dotStrip({
        lookback_days: days, counted_through: check.counted_through,
        fires_after_dates: fires.map((fire) => fire.dt),
      });
      if (dots.length) {
        const strip = el('div', 'agent-fix-dots');
        for (const dot of dots) {
          const cell = el('span', `agent-fix-dot is-${dot.state}`);
          cell.setAttribute('data-day', dot.date);
          cell.setAttribute('title', `${dot.date} · ${dot.state === 'fired' ? '울림' : '울림 없음'}`);
          strip.appendChild(cell);
        }
        wrap.appendChild(strip);
      }
      const list = el('div', 'agent-check-fires');
      for (const fire of fires) {
        const row = el('span', 'agent-check-fire');
        row.textContent = fireText(fire);
        list.appendChild(row);
      }
      if (fires.length) wrap.appendChild(list);
      const note = el('div', 'agent-code-counted-until');
      note.textContent = check.counted_until || WatchNodes.COUNTED_UNTIL;
      wrap.appendChild(note);
    }
    if (check) {
      const diagnosis = check.diagnosis || {};
      const warnings = Array.isArray(check.warnings) ? check.warnings : [];
      for (const text of [check.skip_reason || check.reason, diagnosis.title, diagnosis.detail, ...warnings].filter(Boolean)) {
        const warning = el('div', 'agent-check-warning');
        warning.textContent = text;
        wrap.appendChild(warning);
      }
    }
    return wrap;
  }

  // 「순환」 띠(Paper 보드 11 상태 띠) — 고친 적이 있는 알람에만 선다.
  function makeFixBand(cycle) {
    const band = el('div', 'agent-fix-band');
    const chip = el('span', 'agent-fix-band-chip');
    chip.textContent = cycle.chip;
    band.appendChild(chip);
    const text = el('span', 'agent-fix-band-text');
    text.textContent = cycle.cycleText;
    band.appendChild(text);
    return band;
  }

  // 「다시 검사 · 지난 N일」 — 고치기 전과 지금을 나란히 놓고, 하루 한 칸으로
  // 어느 날이 조용해졌는지 보여준다. 센 값이 없는 줄은 만들지 않는다.
  function makeRecheckPanel(cycle) {
    const wrap = el('div', 'agent-fix-recheck');
    const head = el('div', 'agent-fix-recheck-head');
    const title = el('span', 'agent-fix-recheck-title');
    title.textContent = cycle.recheckTitle;
    head.appendChild(title);
    const meta = el('span', 'agent-fix-recheck-meta');
    meta.textContent = cycle.recheckMeta;
    head.appendChild(meta);
    wrap.appendChild(head);

    if (cycle.before || cycle.after) {
      const compare = el('div', 'agent-fix-compare');
      const before = el('span', 'agent-fix-before');
      before.textContent = cycle.before;
      compare.appendChild(before);
      const arrow = el('span', 'agent-fix-arrow');
      arrow.textContent = cycle.arrow;
      compare.appendChild(arrow);
      const after = el('span', 'agent-fix-after');
      after.textContent = cycle.after;
      compare.appendChild(after);
      if (cycle.afterDates) {
        const dates = el('span', 'agent-fix-dates');
        dates.textContent = cycle.afterDates;
        compare.appendChild(dates);
      }
      wrap.appendChild(compare);
    }

    if (cycle.dots.length) {
      const strip = el('div', 'agent-fix-dots');
      for (const dot of cycle.dots) {
        const cell = el('span', `agent-fix-dot is-${dot.state}`);
        cell.setAttribute('data-day', dot.date);
        strip.appendChild(cell);
      }
      wrap.appendChild(strip);
    }
    if (cycle.dotNote) {
      const note = el('div', 'agent-fix-dot-note');
      note.textContent = cycle.dotNote;
      wrap.appendChild(note);
    }
    return wrap;
  }

  // 「한 바퀴 영수증」 — 무엇을 바꿨는지 번호로 세고, 마지막에 판정을 붙인다.
  // [되돌리기]는 마지막 고침 하나를 무르는 문이고, [지난 고침 N건]은 그 앞판들이다.
  function makeReceiptPanel(item, cycle, history) {
    const wrap = el('div', 'agent-fix-receipt');
    const title = el('div', 'agent-fix-receipt-title');
    title.textContent = cycle.receiptTitle;
    wrap.appendChild(title);
    for (const row of cycle.receiptRows) {
      const line = el('div', 'agent-fix-receipt-row');
      const mark = el('span', 'agent-fix-receipt-mark');
      mark.textContent = row.mark;
      line.appendChild(mark);
      const text = el('span', 'agent-fix-receipt-text');
      text.textContent = row.text;
      line.appendChild(text);
      wrap.appendChild(line);
    }

    const actions = el('div', 'agent-fix-actions');
    if (cycle.canRollback) {
      const rollback = el('button', 'agent-fix-rollback');
      rollback.type = 'button';
      rollback.textContent = cycle.rollbackLabel;
      rollback.addEventListener('click', async () => {
        rollback.disabled = true;
        await runControl(rollbackWatchFix, cycle.rollbackLabel, item, '되돌림');
        codeDetailCache = { id: null, data: null };
        fixHistoryOpen = false;
        await refresh();
      });
      actions.appendChild(rollback);
    }
    if (cycle.pastLabel) {
      const past = el('button', 'agent-fix-past');
      past.type = 'button';
      past.textContent = cycle.pastLabel;
      past.addEventListener('click', () => { fixHistoryOpen = !fixHistoryOpen; renderDetail(); });
      actions.appendChild(past);
    }
    if (actions.childNodes.length) wrap.appendChild(actions);

    if (fixHistoryOpen) {
      const list = el('div', 'agent-fix-history');
      for (const row of FixCycle.historyRows(history)) {
        const line = el('div', 'agent-fix-history-row');
        const when = el('span', 'agent-fix-history-when');
        when.textContent = row.when;
        line.appendChild(when);
        const fires = el('span', 'agent-fix-history-fires');
        fires.textContent = row.fires;
        line.appendChild(fires);
        list.appendChild(line);
      }
      wrap.appendChild(list);
    }

    const note = el('div', 'agent-fix-note');
    note.textContent = cycle.note;
    wrap.appendChild(note);
    return wrap;
  }

  function renderCodeDetail(item) {
    const raw = item.raw || {};
    loadCodeDetail(item);
    const detail = (codeDetailCache.id === item.id && codeDetailCache.data) ? codeDetailCache.data : {};
    const watch = detail.watch || raw.watch || null;
    const lastRun = detail.last_run || null;
    const lastCheck = detail.last_check || null;
    // 고침 한 바퀴 — 백엔드가 직전 판과 지금 검사를 맞대 준 봉투다(없으면 null).
    const cycle = FixCycle.cycleModel(detail.fix_cycle);

    const caption = el('div', 'agent-panel-caption');
    caption.textContent = '상세';
    detailCol.appendChild(caption);

    const headRow = el('div', 'agent-detail-head');
    const badge = el('span', `agent-status-badge is-${item.status}`);
    badge.textContent = statusBadgeText(item.status);
    headRow.appendChild(badge);
    const titleEl = el('span', 'agent-detail-title');
    titleEl.textContent = item.title;
    headRow.appendChild(titleEl);
    const kindEl = el('span', 'agent-code-kind');
    kindEl.textContent = WatchNodes.versionLabel(watch);
    headRow.appendChild(kindEl);
    detailCol.appendChild(headRow);
    if (cycle) detailCol.appendChild(makeFixBand(cycle));
    else if (item.status === 'draft') detailCol.appendChild(makeCheckBand(item, watch, lastCheck));

    // 상태 제어 행(보드 12 두 번째 줄) — 초안은 아직 켤 것이 없어 멈춤·취소가 없다.
    const controls = el('div', 'agent-code-controls');
    if (item.status !== 'draft') {
      const willPause = item.status !== 'paused';
      const pauseBtn = el('button', 'agent-pause-btn');
      pauseBtn.type = 'button';
      pauseBtn.textContent = willPause ? '일시중지' : '재개';
      pauseBtn.addEventListener('click', async () => {
        pauseBtn.disabled = true;
        const action = willPause ? pauseRoutine : resumeRoutine;
        // 실패해도 여기서 던지지 않는다 — refresh()가 실제 상태를 다시 받아온다.
        await runControl(action, willPause ? '일시중지' : '재개', item,
          willPause ? '일시중지됨' : '다시 켬');
        await refresh();
      });
      controls.appendChild(pauseBtn);

      const cancelBtn = el('button', 'agent-code-cancel');
      cancelBtn.type = 'button';
      cancelBtn.textContent = '취소';
      cancelBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true;
        await runControl(cancelRoutine, '취소', item, '취소됨');
        await refresh();
      });
      controls.appendChild(cancelBtn);
    }
    if (item.status !== 'draft') detailCol.appendChild(controls);

    // 「오늘 확인 · HH:MM」 — 초안은 아직 돈 적이 없으니 검사 결과의 칸을 본다.
    const shown = item.status === 'draft' ? (lastCheck || lastRun) : (lastRun || lastCheck);
    const cards = WatchNodes.nodeCards(shown && shown.nodes);
    const clock = WatchNodes.clockLabel(shown && shown.checked_at);
    const checkCaption = el('div', 'agent-panel-caption');
    checkCaption.textContent = item.status === 'draft' ? '노드 · 흐름' : clock ? `오늘 확인 · ${clock}` : '오늘 확인';
    detailCol.appendChild(checkCaption);
    const nodeWrap = el('div', 'agent-node-cards');
    nodeWrap.setAttribute('data-source', item.source);
    if (!cards.length) {
      const empty = el('div', 'agent-node-empty');
      empty.textContent = '아직 확인한 값이 없음';
      nodeWrap.appendChild(empty);
    } else {
      for (const card of cards) nodeWrap.appendChild(makeNodeCard(card, item));
    }
    detailCol.appendChild(nodeWrap);
    const nodeHint = el('div', 'agent-node-hint');
    nodeHint.textContent = '칸을 누르면 그 칸에 대해 채팅으로 물어볼 수 있어';
    detailCol.appendChild(nodeHint);

    // 다시 검사 결과 + 한 바퀴 영수증(보드 11 45MB-1) — 노드 행 바로 아래다.
    if (cycle) {
      detailCol.appendChild(makeRecheckPanel(cycle));
      detailCol.appendChild(makeReceiptPanel(item, cycle, detail.fix_history));
    } else if (item.status === 'draft') {
      detailCol.appendChild(makeCheckPanel(lastCheck));
    }

    // 코드는 참고다(R7) — v1은 원문을 가져오지 않고 경로만 편다.
    const codeRow = el('div', 'agent-code-source');
    const toggle = el('button', 'agent-code-source-toggle');
    toggle.type = 'button';
    toggle.textContent = codeSourceOpen ? WatchNodes.CODE_EXPANDED : WatchNodes.CODE_COLLAPSED;
    toggle.addEventListener('click', () => { codeSourceOpen = !codeSourceOpen; renderDetail(); });
    codeRow.appendChild(toggle);
    if (codeSourceOpen) {
      const pathEl = el('div', 'agent-code-source-path');
      pathEl.textContent = (watch && watch.path) || WatchNodes.DASH;
      codeRow.appendChild(pathEl);
    }
    detailCol.appendChild(codeRow);

    if (item.status === 'draft') {
      // 초안 — 승인 전에 사람이 몇 번이든 다시 잴 수 있다(P4의 비대칭을 함께 적는다).
      const checkWrap = el('div', 'agent-code-check');
      if (cycle) {
        const summary = el('div', 'agent-code-check-summary');
        summary.textContent = !lastCheck ? '아직 검사한 적 없음' : lastCheck.ok === true
          ? WatchNodes.checkSummary(lastCheck) : '검사 통과 못 함';
        checkWrap.appendChild(summary);
        if (lastCheck && lastCheck.ok === true) {
          const countedUntil = el('div', 'agent-code-counted-until');
          countedUntil.textContent = lastCheck.counted_until || WatchNodes.COUNTED_UNTIL;
          checkWrap.appendChild(countedUntil);
        }
      }
      const checkBtn = el('button', 'agent-code-check-btn');
      checkBtn.type = 'button';
      checkBtn.textContent = '검사';
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        try {
          if (typeof runWatchCheck === 'function') await runWatchCheck(Object.assign({}, item, { watch }));
        } catch { /* 결과는 아래 refresh가 상세에서 다시 받아온다 */ }
        codeDetailCache = { id: null, data: null };
        await refresh();
      });
      checkWrap.appendChild(checkBtn);
      detailCol.appendChild(checkWrap);

      // 승인 패널(보드 10 45GD-1) — Paper가 「승인 전까지 실행 없음 · 채팅 칩으로도,
      // 이 버튼으로도 — 같은 게이트」로 입구 둘을 못박았다. 그 둘이 다른 게이트를
      // 타면 거짓말이 되므로 채팅 초안 카드의 「이 알람 승인」 칩과 같은
      // athena:routine-confirm 하나만 부른다(chat.js renderApprovalCard).
      const approveCaption = el('div', 'agent-panel-caption');
      approveCaption.textContent = '승인';
      detailCol.appendChild(approveCaption);
      const approve = el('div', 'agent-code-approve');
      const hasDetailBlocker = Object.prototype.hasOwnProperty.call(detail, 'activation_blocker');
      const activationBlocker = String(hasDetailBlocker ? (detail.activation_blocker || '') : (raw.activation_blocker || '')).trim();
      const cardState = Object.prototype.hasOwnProperty.call(detail, 'main_card_candidate') ? detail : raw;
      const mainCardPending = Boolean(cardState.main_card_candidate && !cardState.main_card);
      if (mainCardPending) {
        const cardNotice = el('div', 'agent-code-main-card-pending');
        cardNotice.textContent = '채팅에서 이 알람의 메인 카드를 먼저 확인해 주세요.';
        approve.appendChild(cardNotice);
      }
      if (activationBlocker) {
        const blocker = el('div', 'agent-code-approve-blocker');
        blocker.textContent = `지금은 켤 수 없음: ${activationBlocker}`;
        approve.appendChild(blocker);
        const repairBtn = el('button', 'agent-code-edit agent-code-repair-btn');
        repairBtn.type = 'button';
        repairBtn.textContent = '다시 만들기';
        repairBtn.addEventListener('click', () => {
          if (typeof onEditInChat === 'function') {
            onEditInChat(item.id, {
              repair: true,
              reason: activationBlocker,
              routineId: item.id,
              title: item.title,
              symbol: Object.prototype.hasOwnProperty.call(detail, 'symbol') ? detail.symbol : raw.symbol,
              watch: watch || undefined,
              condition: detail.condition || raw.condition || undefined,
              cooldown_s: Object.prototype.hasOwnProperty.call(detail, 'cooldown_s') ? detail.cooldown_s : raw.cooldown_s,
              expires_days: Object.prototype.hasOwnProperty.call(detail, 'expires_days') ? detail.expires_days : raw.expires_days,
              expires_at: Object.prototype.hasOwnProperty.call(detail, 'expires_at') ? detail.expires_at : raw.expires_at,
              note: Object.prototype.hasOwnProperty.call(detail, 'note') ? detail.note : raw.note,
            });
          }
        });
        approve.appendChild(repairBtn);
      }
      const approveLead = el('div', 'agent-code-approve-lead');
      approveLead.textContent = `승인하면 장중 ${WatchNodes.pollMinutes(watch)}분마다 이 함수를 돌리고, 울리면 이 대화에 알림 턴이 붙음`;
      approve.appendChild(approveLead);
      const approveRow = el('div', 'agent-code-approve-row');
      const approveBtn = el('button', 'agent-code-approve-btn');
      approveBtn.type = 'button';
      approveBtn.textContent = '이 알람 승인';
      approveBtn.disabled = Boolean(activationBlocker) || mainCardPending;
      approveBtn.addEventListener('click', async () => {
        if (activationBlocker || mainCardPending) return;
        approveBtn.disabled = true;
        await runControl(confirmRoutine, '이 알람 승인', item, '감시 시작');
        codeDetailCache = { id: null, data: null };
        await refresh();
      });
      approveRow.appendChild(approveBtn);
      // 초안의 「취소」 — draft → cancelled는 백엔드 전이표가 여는 길이다
      // (routines/models.py ALLOWED_TRANSITIONS). 켜진 알람의 취소와 같은 채널이다.
      const dropBtn = el('button', 'agent-code-cancel');
      dropBtn.type = 'button';
      dropBtn.textContent = '취소';
      dropBtn.addEventListener('click', async () => {
        dropBtn.disabled = true;
        await runControl(cancelRoutine, '취소', item, '취소됨');
        await refresh();
      });
      approveRow.appendChild(dropBtn);
      approve.appendChild(approveRow);
      const gateNote = el('div', 'agent-code-approve-note');
      gateNote.textContent = '승인 전까지 실행 없음 · 채팅 칩으로도, 이 버튼으로도 — 같은 게이트';
      approve.appendChild(gateNote);
      detailCol.appendChild(approve);
    } else {
      // 「울린 기록」 — 드릴인(10단계)과 같은 /runs 원천이다(두 개의 진실 금지).
      loadCodeFires(item);
      const firesCaptionRow = el('div', 'agent-panel-caption-row');
      const firesCaption = el('span', 'agent-panel-caption');
      firesCaption.textContent = '울린 기록 · 최근';
      firesCaptionRow.appendChild(firesCaption);
      const openHistoryBtn = el('button', 'agent-history-open');
      openHistoryBtn.type = 'button';
      openHistoryBtn.textContent = '전체 이력 보기 →';
      openHistoryBtn.addEventListener('click', () => openHistory(item));
      firesCaptionRow.appendChild(openHistoryBtn);
      detailCol.appendChild(firesCaptionRow);

      const firesWrap = el('div', 'agent-code-fires');
      firesWrap.setAttribute('data-source', 'live');
      const rows = codeFiresCache.id === item.id ? codeFiresCache.rows : [];
      if (!rows.length) {
        const empty = el('div', 'agent-code-fire-empty');
        empty.textContent = '아직 울린 적 없음';
        firesWrap.appendChild(empty);
      } else {
        for (const run of rows) {
          const line = el('div', 'agent-code-fire');
          const date = el('span', 'agent-code-fire-date');
          date.textContent = WatchNodes.shortDate(String(run.ts || '').slice(0, 10));
          const icon = VERDICT_ICON[run.verdict] || VERDICT_ICON.suppressed;
          const mark = el('span', 'agent-code-fire-mark');
          mark.textContent = icon.glyph;
          mark.style.color = `var(${icon.colorVar})`;
          const text = el('span', 'agent-code-fire-text');
          text.textContent = run.reason || '';
          const time = el('span', 'agent-code-fire-time');
          time.textContent = formatRunTime(run.ts);
          line.appendChild(date);
          line.appendChild(mark);
          line.appendChild(text);
          line.appendChild(time);
          // 보드 12는 울린 줄에만 문을 단다 — 억제된 줄은 열 턴이 없어 「—」다
          // (원장 45QX-1·45R2-1 대 45R7-1). 방은 루틴 단위라 이 알람의 알림 방을
          // 여는 것까지가 앱이 아는 전부다 — 상세 패널의 같은 이름 버튼과 같은 경로다.
          if (run.verdict === 'fired') {
            const openFire = el('button', 'agent-code-fire-open');
            openFire.type = 'button';
            openFire.textContent = '채팅에서 열기 ↗';
            openFire.addEventListener('click', () => {
              if (typeof onOpenInChat === 'function') onOpenInChat(item.id);
            });
            line.appendChild(openFire);
          } else {
            const noDoor = el('span', 'agent-code-fire-nodoor');
            noDoor.textContent = WatchNodes.DASH;
            line.appendChild(noDoor);
          }
          firesWrap.appendChild(line);
        }
      }
      detailCol.appendChild(firesWrap);
    }

    // 설정 요약 한 줄(보드 12) — 값을 바꾸는 입력은 없다(A-5).
    const fieldsCaption = el('div', 'agent-panel-caption');
    fieldsCaption.textContent = '설정';
    detailCol.appendChild(fieldsCaption);
    const fieldsWrap = el('div', 'agent-detail-fields');
    fieldsWrap.setAttribute('data-source', item.source);
    const fields = [['확인 주기', `장중 ${WatchNodes.pollMinutes(watch)}분`], ['쿨다운', WatchNodes.cooldownLabel(raw.cooldown_s)]];
    if (raw.expires_at) fields.push(['만료', WatchNodes.dayLabel(raw.expires_at)]);
    // code-watch 실행기의 assemble_frame 입력 계약(일봉 캐시 + 오늘 시세).
    // 현재 수신 여부를 뜻하지 않는다 — 검사만 돌릴 때는 완성 봉까지만 센다.
    fields.push(['데이터', '일봉 + 오늘 현재가']);
    for (const [label, value] of fields) {
      const fieldRow = el('div', 'agent-detail-field');
      const l = el('span', 'agent-detail-field-label');
      l.textContent = label;
      const v = el('span', 'agent-detail-field-value');
      v.textContent = value;
      fieldRow.appendChild(l);
      fieldRow.appendChild(v);
      fieldsWrap.appendChild(fieldRow);
    }
    detailCol.appendChild(fieldsWrap);
    const hint = el('div', 'agent-code-settings-hint');
    hint.textContent = '말로 바꾸는 건 쿨다운 · 만료 · 설명';
    detailCol.appendChild(hint);
  }

  function renderDetail() {
    while (detailCol.firstChild) detailCol.removeChild(detailCol.firstChild);
    const item = allItems().find((i) => i.id === selectedId);
    if (!item) {
      const empty = el('div', 'agent-detail-empty');
      empty.textContent = '선택된 항목이 없습니다';
      detailCol.appendChild(empty);
      return;
    }

    // 코드 알람은 상세 문법 자체가 다르다(보드 12) — 갈래별 분기 하나로 가른다.
    if (item.kind === 'code') { renderCodeDetail(item); return; }

    const caption = el('div', 'agent-panel-caption');
    caption.textContent = '상세';
    detailCol.appendChild(caption);

    const headRow = el('div', 'agent-detail-head');
    const badge = el('span', `agent-status-badge is-${item.status}`);
    badge.textContent = statusBadgeText(item.status);
    headRow.appendChild(badge);
    const titleEl = el('span', 'agent-detail-title');
    titleEl.textContent = item.title;
    headRow.appendChild(titleEl);
    if (item.kind !== 'draft') {
      // draft는 읽기 전용이다(동선 규칙③ "확정은 채팅 카드의 칩" — 위 머리말 참고).
      const headActions = el('span', 'agent-detail-head-actions');
      const pauseBtn = el('button', 'agent-pause-btn');
      pauseBtn.type = 'button';
      if (item.kind === 'watch') {
        // 감시(watch, live)만 pause/resume 엔드포인트가 있다 — 위 머리말 참고.
        const willPause = item.status !== 'paused';
        pauseBtn.textContent = willPause ? '❚❚ 일시중지' : '▶ 재개';
        pauseBtn.disabled = false;
        pauseBtn.addEventListener('click', async () => {
          pauseBtn.disabled = true;
          const action = willPause ? pauseRoutine : resumeRoutine;
          // 실패해도 조용히 넘어간다 — 아래 refresh()가 실제 상태를 다시 받아와
          // 반영한다(낙관적 갱신 없음, P3 — 성공한 척하지 않는다). 결과 한 줄은
          // 같은 방(채팅)에 남는다.
          await runControl(action, willPause ? '일시중지' : '재개', item,
            willPause ? '일시중지됨' : '다시 켬');
          await refresh();
        });
      } else {
        // 예약(schedule)은 백엔드가 이제 같은 pause/resume 전이를 지원하지만
        // (store.transition은 mode를 안 가린다), 이 화면에 그 배선을 잇는 건
        // F1 최소선(3단계) 스코프 밖이다 — 항상 비활성으로 남겨둔다(P5, 다음
        // 스코프로 이연. "백엔드에 없다"는 옛 사유는 더 이상 사실이 아니다).
        pauseBtn.textContent = '❚❚ 일시중지';
        pauseBtn.disabled = true;
        pauseBtn.title = '예약 항목의 일시중지 제어는 이번 스코프 밖입니다';
      }
      headActions.appendChild(pauseBtn);
      headRow.appendChild(headActions);
    }
    detailCol.appendChild(headRow);

    const desc = el('div', 'agent-detail-desc');
    if (item.kind === 'draft') {
      desc.textContent = '오른쪽 채팅의 "작업 요약·초안" 카드에서 바로 활성화하거나 고칠 수 있습니다.';
    } else {
      // watch·schedule 둘 다 3단계부터 raw가 live 라우틴이다 — 지어낸 설명문
      // 없이 실제 note만 쓴다(P3).
      desc.textContent = item.raw.note || '';
    }
    detailCol.appendChild(desc);

    const fieldsCaption = el('div', 'agent-panel-caption');
    fieldsCaption.textContent = '세부 정보';
    detailCol.appendChild(fieldsCaption);
    const fieldsWrap = el('div', 'agent-detail-fields');
    fieldsWrap.setAttribute('data-source', item.source);
    for (const [label, value] of detailFieldsFor(item)) {
      const fieldRow = el('div', 'agent-detail-field');
      const l = el('span', 'agent-detail-field-label');
      l.textContent = label;
      const v = el('span', 'agent-detail-field-value');
      v.textContent = value;
      fieldRow.appendChild(l);
      fieldRow.appendChild(v);
      fieldsWrap.appendChild(fieldRow);
    }
    detailCol.appendChild(fieldsWrap);

    // "실행 위치"(6단계) — 같은 runs 엔드포인트의 briefing_destination을 선택
    // 항목별 1회만 조회해 캐시하고, 값이 오면 아직 같은 항목이 선택돼 있을 때만
    // 다시 그린다. 이력이 없으면 행이 안 붙는다(위 detailFieldsFor 게이트).
    if (item.kind === 'schedule' && detailDestinationCache.id !== item.id) {
      detailDestinationCache = { id: item.id, value: null };
      Promise.resolve((typeof fetchRuns === 'function') ? fetchRuns(item.id) : [])
        .then((runs) => {
          if (!Array.isArray(runs) || detailDestinationCache.id !== item.id) return;
          const latest = runs
            .filter((x) => x && typeof x.briefing_destination === 'string' && x.briefing_destination)
            .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
          if (!latest) return;
          detailDestinationCache = { id: item.id, value: latest.briefing_destination };
          if (selectedId === item.id) renderDetail();
        })
        .catch(() => {});
    }

    // draft는 아직 한 번도 실행되지 않았다 — "최근 실행" 섹션 자체를 생략한다
    // (빈 로그를 지어내 보여주지 않는다, P3).
    if (item.kind !== 'draft') {
      const logsCaptionRow = el('div', 'agent-panel-caption-row');
      const logsCaption = el('span', 'agent-panel-caption');
      logsCaption.textContent = '최근 실행';
      logsCaption.appendChild(fixtureMark());
      logsCaptionRow.appendChild(logsCaption);
      // 드릴인(10단계)은 감시(watch)만 연다 — schedule도 3단계부터 실제
      // 라우틴이라 ledger에 대응 행이 생길 수 있지만, 이 화면에 그 배선을
      // 잇는 건 F1 최소선 스코프 밖이다(위 머리말, P5 — 다음 스코프로 이연).
      if (item.kind === 'watch') {
        const openHistoryBtn = el('button', 'agent-history-open');
        openHistoryBtn.type = 'button';
        openHistoryBtn.textContent = '전체 이력 보기 →';
        openHistoryBtn.addEventListener('click', () => openHistory(item));
        logsCaptionRow.appendChild(openHistoryBtn);
      }
      detailCol.appendChild(logsCaptionRow);
      const logsWrap = el('div', 'agent-detail-logs');
      logsWrap.setAttribute('data-source', 'fixture');
      for (const log of fixtureLogs()) {
        const logRow = el('div', 'agent-detail-log');
        const t = el('span', 'agent-detail-log-time');
        t.textContent = log.time;
        const mark = el('span', log.ok ? 'agent-detail-log-mark is-ok' : 'agent-detail-log-mark is-warn');
        mark.textContent = log.ok ? '✓' : '⚠';
        const text = el('span', 'agent-detail-log-text');
        text.textContent = log.text;
        logRow.appendChild(t);
        logRow.appendChild(mark);
        logRow.appendChild(text);
        logsWrap.appendChild(logRow);
      }
      detailCol.appendChild(logsWrap);

      // F-fix1(본편 이월 갭, Paper 39번 실측 AAG-0) — "채팅에서 열기 ↗".
      // watch·schedule 둘 다 대상이다(둘 다 능동 턴을 만들 수 있다, 3단계) —
      // draft만 위 가드로 이미 제외돼 있다. sidebar.js가 소유한 알림 방이
      // 있으면 selectNotifyRoom과 완전히 같은 경로(ack·opened 계측 자동
      // 정합, window.AthenaNotify.selectRoom 다리)를 타고, 없으면(이 세션에서
      // 아직 안 뜬 발화) 채팅 입력 포커스로 폴백한다 — 죽은 버튼을 만들지
      // 않는다(P3).
      const openInChatRow = el('div', 'agent-detail-open-chat');
      const openInChatCaption = el('span', 'agent-detail-open-chat-caption');
      openInChatCaption.textContent = '루틴 발화 — 묻지 않은 턴입니다';
      openInChatRow.appendChild(openInChatCaption);
      const openInChatBtn = el('button', 'agent-detail-open-chat-btn');
      openInChatBtn.type = 'button';
      openInChatBtn.textContent = '채팅에서 열기 ↗';
      openInChatBtn.addEventListener('click', () => {
        if (typeof onOpenInChat === 'function') onOpenInChat(item.id);
      });
      openInChatRow.appendChild(openInChatBtn);
      detailCol.appendChild(openInChatRow);
    }
  }

  function selectRow(id) {
    userSelected = true;
    if (id === selectedId) return;
    // 다른 항목으로 옮기면 코드 알람의 칸 선택·코드 펼침·멈춤 확인은 초기화한다
    // (앞 항목에서 고른 칸이 다음 항목에 남아 있으면 거짓말이 된다).
    selectedNodeFn = null;
    codeSourceOpen = false;
    selectedId = id;
    renderPanels();
  }

  function renderPanels() {
    const items = visibleItems();
    if (!userSelected || !items.find((i) => i.id === selectedId)) {
      selectedId = items.length ? items[0].id : null;
    }
    while (watchList.firstChild) watchList.removeChild(watchList.firstChild);
    if (!items.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '조건에 맞는 작업이 없습니다';
      watchList.appendChild(empty);
    } else {
      for (const item of items) watchList.appendChild(makeListRow(item));
    }
    renderDetail();
  }

  function updateSubtitle() {
    if (routinesLoadState !== 'success') {
      subtitle.textContent = routinesLoadState === 'error' ? '감시 상태를 확인할 수 없습니다' : '감시 상태 불러오는 중';
      return;
    }
    const activeCount = routinesCache.filter((r) => r.status === 'active' && r.mode !== 'scheduled').length;
    subtitle.textContent = `루틴 ${routinesCache.length} · 감시 ${activeCount} 진행 중`;
  }

  function setActiveTab(key) {
    if (!tabButtons[key] || key === activeTab) return;
    activeTab = key;
    for (const k of Object.keys(tabButtons)) {
      tabButtons[k].className = k === activeTab ? 'agent-tab is-active' : 'agent-tab';
    }
    renderPanels();
  }

  // 뷰 탭 4종 — "작업"은 39번 화면(통계+리스트/상세), "알람"·"라이브"는
  // 40번 화면(알람 피드+라이브 관제, 위 머리말 참고 — Paper가 하나로 그려서
  // 둘이 같은 내용을 공유한다).
  function setActiveView(key) {
    if (!viewTabButtons[key] || key === activeView) return;
    activeView = key;
    for (const k of Object.keys(viewTabButtons)) {
      viewTabButtons[k].className = k === activeView ? 'agent-view-tab is-active' : 'agent-view-tab';
    }
    const isTasks = activeView === 'tasks';
    const isAlarmLive = activeView === 'alerts' || activeView === 'live';
    const isProactive = activeView === 'proactive';
    tasksHead.hidden = !isTasks;
    stats.hidden = !isTasks;
    body.hidden = !isTasks;
    markAllReadBtn.hidden = !isAlarmLive;
    alarmLiveBody.hidden = !isAlarmLive;
    proactiveBody.hidden = !isProactive;
    graphLinkBtn.hidden = !isProactive;
    if (isAlarmLive) { renderAlarmColumn(); renderWsStatus(); }
    if (isProactive) renderProactiveView();
  }

  function mount() {
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(head);
    container.appendChild(tasksHead);
    container.appendChild(stats);
    container.appendChild(body);
    container.appendChild(alarmLiveBody);
    container.appendChild(historyBody);
    container.appendChild(historySettingsBody);
    container.appendChild(proactiveBody);
    renderStats();
    updateSubtitle();
    renderPanels();
    renderAlarmColumn(); // 배지 라벨(알람 N)은 뷰와 무관하게 항상 최신이어야 한다.
    renderWsStatus();
    renderProactiveView(); // 배지 라벨(제안 N)도 마찬가지 — 위와 같은 이유.
  }

  // GET /api/v1/routines 실데이터 — requestId로 낡은 응답을 버린다(sidebar.js
  // loadAgentRoutines()와 같은 이유·같은 패턴, 실사용 결함 재현으로 확인됨).
  // fetchFiredToday(3단계)는 같은 응답의 다른 필드(fired_today, 라우틴별이
  // 아닌 전체 집계)를 노린 별개 왕복이다 — "네 소스는 서로 무관한 왕복이다"
  // 원칙(위 머리말)을 그대로 따른다, 실패해도 routinesCache 갱신을 막지 않는다.
  async function refreshRoutines() {
    const rid = ++requestId;
    let rows = [];
    let loadState = 'success';
    try {
      rows = (typeof fetchRoutines === 'function') ? await fetchRoutines() : [];
      if (!Array.isArray(rows)) rows = [];
    } catch {
      rows = [];
      loadState = 'error';
    }
    let firedToday = null;
    try {
      const v = (typeof fetchFiredToday === 'function') ? await fetchFiredToday() : null;
      firedToday = (typeof v === 'number') ? v : null;
    } catch {
      firedToday = null;
    }
    if (rid !== requestId) return;
    if (loadState === 'success') routinesCache = rows;
    routinesLoadState = loadState;
    firedTodayCache = firedToday;
    updateSubtitle();
    renderStats();
    renderPanels();
  }

  // 네 소스는 서로 무관한 왕복이다 — 하나가 느려도(또는 실패해도) 다른 쪽을
  // 막지 않는다(Promise.all로 병렬, 실패는 각자의 try/catch가 이미 삼킨다).
  // 알람·WS 상태는 IPC 왕복이 없어(세션 메모리·캐시값) 동기로 같이 갱신한다.
  async function refresh() {
    renderAlarmColumn();
    renderWsStatus();
    // '실행 위치' 캐시 무효화(6단계) — 같은 항목을 계속 보고 있어도 refresh
    // 주기마다 최신 브리핑 보고를 다시 조회한다(선택 변경 없이는 영원히 낡은
    // 값이 남는 문제 방지). 다음 renderDetail이 1회 재조회한다.
    detailDestinationCache = { id: null, value: null };
    // 코드 알람 상세·울린 기록도 같은 이유로 주기마다 다시 잰다(보드 12의
    // 「오늘 확인 · 15:31」은 폴링마다 움직이는 값이다).
    codeDetailCache = { id: null, data: null };
    codeFiresCache = { id: null, rows: [] };
    const tasks = [refreshRoutines(), refreshSuggestions(), refreshNudgeGuard()];
    if (historyItem) tasks.push(refreshHistoryRuns()); // 드릴인 중이면 이력도 같이.
    await Promise.all(tasks);
  }

  return { mount, refresh, setActiveTab, selectRow, setActiveView, setHistoryTab, updateWsStatus: renderWsStatus };
}

const __exports = { createAgentCanvas, settingsSummaryLines, settingsFormModel, settingsUpdateBody };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AgentCanvas = __exports;
}

})();

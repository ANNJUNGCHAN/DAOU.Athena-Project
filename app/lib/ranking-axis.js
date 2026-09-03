// IIFE 스코프 격리 — column-fold.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

// 순위 모드의 축 카탈로그 — backend/athena_api/canvas_card_registry.py의
// OPERATION_PRESENTATION_OVERRIDES와 1:1이어야 한다(ranking-axis.test.js가
// 백엔드 원문을 읽어 동기화를 고정한다). 축 전환은 카드가 데이터를 직접
// 조회하지 않고 seedChatInput 버스로 질문을 심는다 — "새 작업은 채팅에서".
const RANKING_AXES = Object.freeze({
  'CC-03': Object.freeze([
    Object.freeze({
      group: '주식',
      items: Object.freeze([
        Object.freeze({ operationRef: 'base:ka10016', label: '신고저가', question: '신고가·신저가 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10017', label: '상하한가', question: '상한가·하한가 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10018', label: '고저가근접', question: '고저가 근접 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10019', label: '가격급등락', question: '가격 급등락 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10024', label: '거래량갱신', question: '거래량 갱신 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10025', label: '매물대집중', question: '매물대 집중 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10026', label: '고저 PER', question: '고저 PER 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10028', label: '시가대비 등락', question: '시가 대비 등락률 상위 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10054', label: 'VI 발동', question: 'VI 발동 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10055', label: '당일·전일 체결량', question: '당일 전일 체결량 비교 보여줘' }),
      ]),
    }),
    Object.freeze({
      group: 'ETF',
      items: Object.freeze([
        Object.freeze({ operationRef: 'base:ka40004', label: '전체시세', question: 'ETF 전체 시세 보여줘' }),
        Object.freeze({ operationRef: 'base:ka40001', label: '기간 수익률', question: 'ETF 기간 수익률 보여줘' }),
      ]),
    }),
    Object.freeze({
      group: 'ELW',
      items: Object.freeze([
        Object.freeze({ operationRef: 'base:ka30010', label: '잔량 순위', question: 'ELW 잔량 순위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka30009', label: '등락율 순위', question: 'ELW 등락률 순위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka30011', label: '근접율', question: 'ELW 근접율 보여줘' }),
        Object.freeze({ operationRef: 'base:ka30001', label: '가격급등락', question: 'ELW 가격 급등락 보여줘' }),
        Object.freeze({ operationRef: 'base:ka30002', label: '거래원별 순매매', question: 'ELW 거래원별 순매매 상위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka30005', label: '조건검색', question: 'ELW 조건검색 해줘' }),
      ]),
    }),
  ]),
  'CC-05': Object.freeze([
    Object.freeze({
      group: '수급',
      items: Object.freeze([
        Object.freeze({ operationRef: 'base:ka90003', label: '프로그램 순매수', question: '프로그램 순매수 상위 50 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10033', label: '신용비율 상위', question: '신용비율 상위 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10069', label: '대차 상위', question: '대차거래 상위 10 종목 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10036', label: '한도소진율 증가', question: '외국인 한도소진율 증가 상위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10065', label: '장중 투자자 상위', question: '장중 투자자별 매매 상위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka90009', label: '외국인·기관 상위', question: '외국인 기관 매매 상위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10039', label: '증권사별 상위', question: '증권사별 매매 상위 보여줘' }),
        Object.freeze({ operationRef: 'base:ka10062', label: '동일순매매', question: '동일 순매매 순위 보여줘' }),
        Object.freeze({ operationRef: 'base:kt20016', label: '신용융자 가능종목', question: '신용융자 가능 종목 보여줘' }),
      ]),
    }),
  ]),
});

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function axisGroupsFor(cardId) {
  return RANKING_AXES[clean(cardId)] || null;
}

function axesForEnvelope(envelope) {
  if (clean(envelope && envelope.mode) !== 'ranking') return null;
  const groups = axisGroupsFor(envelope && envelope.card_id);
  if (!groups) return null;
  const activeRef = clean(envelope && (envelope.operation_ref || envelope.operationRef));
  return groups.map((group) => ({
    group: group.group,
    items: group.items.map((item) => ({ ...item, active: item.operationRef === activeRef })),
  }));
}

// 축 스트립 DOM. 활성 축은 상태 표시(비클릭), 나머지는 onSelect(item)로 전환을
// 요청한다 — 값을 지어내지 않고, 조회는 채팅 동선이 소유한다.
function renderAxisStrip(envelope, onSelect, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const groups = axesForEnvelope(envelope);
  if (!groups) return null;
  const strip = doc.createElement('div');
  strip.className = 'ranking-axis-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', '순위 축 선택');
  for (const group of groups) {
    const groupNode = doc.createElement('div');
    groupNode.className = 'ranking-axis-group';
    const label = doc.createElement('span');
    label.className = 'ranking-axis-group-label';
    label.textContent = group.group;
    groupNode.appendChild(label);
    for (const item of group.items) {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = `ranking-axis-chip${item.active ? ' is-active' : ''}`;
      chip.textContent = item.label;
      // operationRef는 어떤 속성에도 싣지 않는다 — title·aria·data-* 전부 제품 UI의 원시
      // 식별자 누출로 잡힌다(verify-semantic-workspaces forbiddenPattern·forbiddenAttributeName,
      // 2026-09-04 elw-product 실측: title="base:ka10016"). 클릭은 클로저의 item으로 충분하다.
      chip.setAttribute('aria-pressed', String(!!item.active));
      if (item.active) {
        chip.disabled = true;
      } else if (typeof onSelect === 'function') {
        chip.addEventListener('click', () => onSelect(item));
      }
      groupNode.appendChild(chip);
    }
    strip.appendChild(groupNode);
  }
  return strip;
}

const __exports = { RANKING_AXES, axisGroupsFor, axesForEnvelope, renderAxisStrip };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RankingAxis = __exports;
}

})();

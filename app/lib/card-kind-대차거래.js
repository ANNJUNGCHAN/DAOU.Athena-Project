// 카드 v3(.omc/state/card-v3-plan.md §2.3, US-004 잔여 4종) 카드종 — "대차거래".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴).
//
// 실측 근거: .omc/state/card-v3-wave5-specs.json[3](대차거래카드 gap 분석)에
// ka10068 필드가 확인돼 있고, ka20068/ka90012/ka10069 나머지 3개 TR 필드는
// backend/athena_api/generated/models.py를 직접 대조해 확인했다(gap 분석
// 문서엔 ka10068만 상세 기술됐다):
//   - ka10068(대차거래추이요청)/ka20068(같은 요청의 종목별 변형) — 컨테이너
//     dbrt_trde_trnsn, 필드 dt/rmnd/dbrt_trde_cntrcnt/dbrt_trde_rpy 동일(모델
//     클래스명만 다르고 필드 세트가 완전히 같다).
//   - ka90012(대차거래내역요청) — 컨테이너 dbrt_trde_prps, dt가 없고 대신
//     stk_nm/stk_cd로 종목을 식별한다(rmnd/dbrt_trde_cntrcnt/dbrt_trde_rpy는
//     그대로 실재).
//   - ka10069(대차거래상위10종목요청)는 compound(스칼라 합계/비율 헤더 + 상위
//     10종목 리스트)인데 순위를 매기는 명시적 필드가 없다(리스트 순서로만
//     암시) — 배열 인덱스를 순위로 쓰는 것도 가능하지만 정렬 기준(체결/상환/
//     잔고 중 무엇 기준 top10인지)이 스키마에 없어 임의로 확정하지 않는다.
//     생략(.omc/state/phase3-list.md 기록).
//
// 그래서 이 렌더러는 두 "행" 모양(일자 기준 시계열 / 종목 기준 내역)을 하나의
// 판정 함수로 흡수한다 — 둘 다 잔고·체결·상환이라는 같은 3개 수치를 갖고,
// 식별자만 dt 아니면 stk_nm이다. compound(ka10069)는 envelope.data.rows가
// 없어 자연히 null → 범용 렌더로 폴백한다.
//
// 생략(구현 안 함, .omc/state/phase3-list.md 기록): "4 API" 배지·LENDING TR
// 카탈로그 목록 — Paper 문서 전용(카드-TR 보드 표현 규칙, 사용자 확정), 런타임
// 렌더 대상이 아니다. ka10069 top10 큐레이션 — 순위 기준 필드 부재로 생략.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow } = CardPrimitives;
const { formatNumeric, formatDatetime } = FactsCard;

// row(대차거래 한 행 — 일자 기준 또는 종목 기준) → 렌더용 모델 | null(식별자
// 및 잔고 중 하나라도 없으면 이 행을 생략한다).
function buildLendingLine(row) {
  if (!row) return null;
  const balance = row.rmnd;
  if (balance === undefined || balance === null || balance === '') return null;

  const dt = row.dt;
  const stkNm = row.stk_nm;
  const title = dt !== undefined && dt !== null && dt !== '' ? formatDatetime(dt) : stkNm;
  if (!title) return null; // 일자도 종목명도 없으면 무엇의 잔고인지 알 수 없다

  const parts = [];
  if (row.dbrt_trde_cntrcnt !== undefined && row.dbrt_trde_cntrcnt !== null && row.dbrt_trde_cntrcnt !== '') {
    parts.push(`체결 ${formatNumeric(row.dbrt_trde_cntrcnt)}주`);
  }
  if (row.dbrt_trde_rpy !== undefined && row.dbrt_trde_rpy !== null && row.dbrt_trde_rpy !== '') {
    parts.push(`상환 ${formatNumeric(row.dbrt_trde_rpy)}주`);
  }

  return {
    title,
    value: `${formatNumeric(balance)}주`,
    valueSub: parts.join(' · ') || null,
  };
}

function extractRows(envelope) {
  return envelope && envelope.data && Array.isArray(envelope.data.rows) ? envelope.data.rows : [];
}

function render대차거래(envelope) {
  const lines = extractRows(envelope).map(buildLendingLine).filter(Boolean);
  if (!lines.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'card-kind-대차거래-list';
  for (const line of lines) {
    wrap.appendChild(TwoLineRow({ title: line.title, value: line.value, valueSub: line.valueSub }));
  }
  return wrap;
}

const __exports = { buildLendingLine, render대차거래 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('대차거래', render대차거래);
}

})();

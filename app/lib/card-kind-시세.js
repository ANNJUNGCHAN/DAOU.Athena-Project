// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인1) 카드종 — "시세".
// IIFE 스코프 격리 + UMD(2026-08-18 렌더러 격리, chart-card.js와 같은 패턴).
//
// 근거: .omc/state/card-v3-specs.json "시세카드" gap 분석. Paper 목업(시세카드.png)의
// 핵심 시각 요소는 헤더 아래 탭(실시간/일별) + 4열 표(체결가·체결량(주)·등락률·거래량(주))
// 하나뿐이다 — QUOTES/STOCKINFO/WEBSOCKET TR 목록은 보드 문서화 레이어라 렌더 대상이
// 아니다(카드-TR 보드 표현 규칙, 사용자 확정).
//
// 라우팅 실측(backend/athena_api/canvas_transform.py, Wave 0-BE 반영 후):
// base:ka10003/ka10055/ka10084 + detail:ka10002:market_snapshot이 title="시세"로
// 잡힌다. ka10055(당일전일체결량요청, backend/athena_api/generated/models.py
// Ka10055ResponseTdyPredCntrQtyItem)의 필드(cntr_pric/cntr_qty/flu_rt/acc_trde_qty)가
// Paper의 4열과 정확히 1:1로 맞는 유일한 후보라 이 카드의 데이터 소스로 삼는다.
// 이 TR은 backend/ref/kiwoom-common-screen-manifest.json 실측상 layout=table이라
// (facts가 아니다) renderMcpTable을 거쳐 온다 — envelope.data.columns/rows 모양을 본다.
//
// 실렌더링 없음(의도적 축소, 사유는 완료 보고 참고): TabSwitcher(실시간/일별) —
// 이 렌더러는 순수 프레젠테이션(주어진 envelope 하나만 그린다, 재조회 없음)인데
// ka10055 응답 자체는 어느 tdy_pred로 조회했는지 스스로 표시하지 않는다. 탭이 있는데
// 눌러도 아무 일도 안 일어나면 있지도 않은 기능을 있는 척하는 장식 UI가 된다(soul.md
// §7/§8) — 그래서 이번 패스는 탭 없이 표만 그린다.
//
// 체결가 부호 수정(팀리드 지시, 2026-08-26 카드 데모 후속) — cntr_pric은 키움
// "부호가 포함된 숫자"라 부호가 기준가 대비 방향 표기이지 체결가의 부호가 아니다
// (card-primitives.js priceMagnitude 주석 — QuoteHeader/RangeBar에 적용한 것과 같은
// 근거). formatTickPrice가 이 표의 체결가 열에서만 부호를 걷어낸다 — 등락률(flu_rt)
// 열은 그대로 둔다(ChangeBadge는 부호를 방향 표시 그 자체로 써야 한다).
(function () {
'use strict';

const __isCjs = typeof module !== 'undefined' && module.exports;
function __dep(reqPath, globalName) {
  return __isCjs ? require(reqPath) : window.AthenaLib[globalName];
}
const { formatNumeric } = __dep('./facts-card', 'FactsCard');
const { ChangeBadge, priceMagnitude } = __dep('./card-primitives', 'CardPrimitives');

// 표시 상한 — Paper 목업은 "최신행 우선" 롤링을 전제한다(무한정 누적 방지).
const MAX_ROWS = 20;

// makeCard는 같은 canvas_type('mcp-table') 카드를 재조회 시 destroy+recreate한다
// (교체, append 아님 — canvas.js:1122) — DOM에는 누적 상태를 못 둔다. 이 모듈
// 스코프 Map이 재조회 사이 "최신 몇 행"을 흡수하는 자리다(canvas.js 생애주기 불변).
const ringBuffers = new Map(); // bufferKey → row[](최신행이 배열 앞쪽)

// 같은 행이 재조회로 다시 오는 경우를 흡수하는 합성 키 — 체결시간만으론 같은 초 안
// 복수 체결을 구분 못 해 체결가/체결량까지 묶는다.
function rowKey(row) {
  return ['cntr_tm', 'cntr_pric', 'cntr_qty'].map((k) => {
    const v = row ? row[k] : undefined;
    return v === null || v === undefined ? '' : String(v);
  }).join('|');
}

// 순수 함수(node --test 대상) — 기존 버퍼(최신행 앞쪽)에 새 rows를 중복 없이 앞쪽에
// 병합하고 maxRows로 자른다.
function mergeRollingRows(existingRows, newRows, maxRows) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(newRows) ? newRows : [];
  const seen = new Set(existing.map(rowKey));
  const merged = existing.slice();
  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.unshift(row);
  }
  return merged.slice(0, Math.max(0, maxRows));
}

// REST 데이터셋이면 dataset_id로 격리, 아니면(단발 라이브 조회) 싱글턴 키.
function bufferKeyFor(envelope) {
  const corr = envelope && envelope.correlation;
  if (corr && corr.dataset_id) return `ds:${corr.dataset_id}`;
  return '__single__';
}

// 순수 함수(node --test 대상) — table 모양 envelope에서 4열(체결가·체결량·등락률·
// 거래량) 전부가 있을 때만 rows를 돌려준다(all-or-nothing 핵심 판정). 컬럼 중 하나라도
// 없으면 null — ka10086/ka50100 등 다른 "시세" TR은 이 모양이 아니라 여기서 걸러진다.
function extractTickRows(envelope) {
  const data = envelope && envelope.data;
  const cols = data && Array.isArray(data.columns) ? data.columns : null;
  const rows = data && Array.isArray(data.rows) ? data.rows : null;
  if (!cols || !rows || !rows.length) return null;
  const keys = new Set(cols.map((c) => c && c.key));
  const required = ['cntr_pric', 'cntr_qty', 'flu_rt', 'acc_trde_qty'];
  if (!required.every((k) => keys.has(k))) return null;
  return rows;
}

// 순수 함수(node --test 대상) — 체결가 표시값을 만든다. cntr_pric도 키움 "부호가
// 포함된 숫자"(models.py 실측)라 부호는 기준가 대비 방향 표기이지 체결가의 부호가
// 아니다(card-primitives.js priceMagnitude 주석, 팀리드 지시로 2026-08-26 후속 수정
// — QuoteHeader/RangeBar에 이어 이 표의 체결가 열도 같은 문제였다). 등락률(flu_rt)
// 열은 건드리지 않는다 — ChangeBadge에서는 부호가 방향 표시 그 자체라 지우면 안 된다.
// DOM 없이 이 변환만 따로 검증 가능하게 뺐다(chart-card.js "순수 변환 분리" 관행).
function formatTickPrice(raw) {
  return formatNumeric(priceMagnitude(raw));
}

function renderTickerTable(rows) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-시세-ticker';
  const table = document.createElement('table');
  // fin-table 재사용(app/canvas.css) — 표 골격(패딩/보더/우측정렬/sticky 헤더)을
  // 새로 베끼지 않는다. card-kinds.css는 이 표 전용 여백만 보탠다.
  table.className = 'fin-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['체결가', '체결량(주)', '등락률', '거래량(주)']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const priceTd = document.createElement('td');
    priceTd.textContent = formatTickPrice(row.cntr_pric);
    const qtyTd = document.createElement('td');
    qtyTd.textContent = formatNumeric(row.cntr_qty);
    const changeTd = document.createElement('td');
    changeTd.appendChild(ChangeBadge({
      key: 'flu_rt',
      value: row.flu_rt,
      label: row.flu_rt === null || row.flu_rt === undefined || row.flu_rt === '' ? undefined : `${row.flu_rt}%`,
    }));
    const volTd = document.createElement('td');
    volTd.textContent = formatNumeric(row.acc_trde_qty);
    tr.appendChild(priceTd);
    tr.appendChild(qtyTd);
    tr.appendChild(changeTd);
    tr.appendChild(volTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// all-or-nothing renderFn(envelope) → HTMLElement|null (card-kinds.js 계약).
function render시세(envelope) {
  const rows = extractTickRows(envelope);
  if (!rows) return null;
  const key = bufferKeyFor(envelope);
  const merged = mergeRollingRows(ringBuffers.get(key), rows, MAX_ROWS);
  ringBuffers.set(key, merged);
  return renderTickerTable(merged);
}

const __exports = { mergeRollingRows, extractTickRows, formatTickPrice, render시세 };
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('시세', render시세);
}

})();

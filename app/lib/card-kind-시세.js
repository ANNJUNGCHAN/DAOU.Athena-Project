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

// REST 데이터셋이면 dataset_id+item_id로 격리, 아니면(단발 라이브 조회) 싱글턴 키.
// item_id까지 넣는 이유(2026-08-27 6종목 동시 실시간 프로브에서 실측) — dataset_id
// 만으로는 한 데이터셋 배치 안의 서로 다른 카드(예: 시세 6종목 일괄 조회)가 링버퍼
// 하나를 같이 써서 행이 뒤섞인다. item_id가 없으면(옛 단일 항목 배치) 예전 키 그대로다.
function bufferKeyFor(envelope) {
  const corr = envelope && envelope.correlation;
  if (corr && corr.dataset_id) {
    return corr.item_id != null ? `ds:${corr.dataset_id}:${corr.item_id}` : `ds:${corr.dataset_id}`;
  }
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

// 실시간/일별 탭(878-0 실측, 2026-08-27 확장) — "실시간"이 기본 활성이다. 다른
// 데이터를 새로 불러오지 않는다("재조회 없음" 원칙, 위 머리말 그대로) — "일별"은
// 그냥 갱신을 멈춘 스냅샷이다. wrap.dataset.live로 상태를 두는 이유는 이 모듈이
// DOM 밖 상태(모듈 스코프 Map 등)를 늘리지 않고, applyLiveTick 호출부(canvas.js)가
// 카드 하나의 상태를 그 카드 엘리먼트만 보고 판단하게 하려는 것이다.
function renderTabs(wrap) {
  const tabs = document.createElement('div');
  tabs.className = 'card-kind-시세-tabs';
  const realtimeTab = document.createElement('button');
  realtimeTab.type = 'button';
  realtimeTab.className = 'card-kind-시세-tab is-active';
  realtimeTab.textContent = '실시간';
  const dailyTab = document.createElement('button');
  dailyTab.type = 'button';
  dailyTab.className = 'card-kind-시세-tab';
  dailyTab.textContent = '일별';
  const activate = (tab) => {
    wrap.dataset.live = tab === realtimeTab ? 'true' : 'false';
    realtimeTab.classList.toggle('is-active', tab === realtimeTab);
    dailyTab.classList.toggle('is-active', tab === dailyTab);
  };
  realtimeTab.addEventListener('click', () => activate(realtimeTab));
  dailyTab.addEventListener('click', () => activate(dailyTab));
  tabs.append(realtimeTab, dailyTab);
  return tabs;
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
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-시세';
  wrap.dataset.live = 'true';
  wrap.appendChild(renderTabs(wrap));
  const tableHost = document.createElement('div');
  tableHost.className = 'card-kind-시세-table-host';
  tableHost.appendChild(renderTickerTable(merged));
  wrap.appendChild(tableHost);
  return wrap;
}

// 실시간 체결 1건을 이미 그려진 표에 그대로 이어붙인다(단계 8 확장, canvas.js의
// 실시간 세션 어댑터가 매 체결마다 이걸 부른다) — 재조회·destroy+recreate 없이
// 표만 다시 그린다. "일별"로 멈춰둔 카드(wrap.dataset.live==='false')나 표가 아직
// 없는 카드(재조회 사이 이미 사라졌다면)는 조용히 무시한다.
// tick: lib/main/chart-realtime.js parseRealTick 계약 그대로
// {symbol, at, price, volume, changeRate, accVolume} — changeRate/accVolume은
// 실프레임 미실측 필드라 null일 수 있다(카드종 서식 함수가 이미 null-safe다).
function applyLiveTick(wrap, envelope, tick) {
  if (!wrap || wrap.dataset.live === 'false') return;
  const host = wrap.querySelector('.card-kind-시세-table-host');
  if (!host || !tick) return;
  const key = bufferKeyFor(envelope);
  // cntr_tm 자리는 REST 응답의 체결시간 문자열(HHMMSS) 대신 tick.at(에폭초)을
  // 그대로 넣는다 — rowKey 중복판정의 유일한 목적(같은 초 안 복수 체결 구분)에는
  // 이 정도 고유성으로 충분하고, 표에는 아예 안 쓰이는 필드다.
  const row = {
    cntr_tm: String(tick.at),
    cntr_pric: tick.price,
    cntr_qty: tick.volume,
    flu_rt: tick.changeRate,
    acc_trde_qty: tick.accVolume,
  };
  const merged = mergeRollingRows(ringBuffers.get(key), [row], MAX_ROWS);
  ringBuffers.set(key, merged);
  host.replaceChildren(renderTickerTable(merged));
}

const __exports = { mergeRollingRows, extractTickRows, formatTickPrice, bufferKeyFor, render시세, applyLiveTick };
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('시세', render시세);
  // CardKinds.resolve(title)는 renderFn 하나만 돌려주는 계약이라(card-kinds.js) 여기
  // 안 맞는 applyLiveTick은 별도 네임스페이스로 낸다 — canvas.js의 실시간 세션
  // 어댑터가 이 카드종 표에 체결을 이어붙일 때 쓴다.
  window.AthenaLib.CardKindQuote = { applyLiveTick };
}

})();

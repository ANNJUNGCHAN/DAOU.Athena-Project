// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드 요약 뷰(보드 07)의 성향 신호 표. `render.js`(군집 지도 SVG)와 같은
// 층위의 대상 — 이쪽은 `GET /api/v1/brain/profile-summary`(athena:brain-profile-summary
// IPC)를 그린다. 군집 지도(cluster-map)와는 다른 엔드포인트다: 군집 지도는
// {entity_id, name, kind, cluster, degree}만 주고, 여기는 대상별 관계·근거·보강
// 수까지 준다 — 표에 필요한 필드는 이쪽에만 있다.
//
// **렌더링에 없는 것.** 보드 07은 히어로 축약(사실/추론/불확실 %)과 "지금 읽히는
// 성향" 한 줄, 필터 칩(최근 90일·보강 순 조정 UI)도 그린다. 이 파일은 그 셋을
// 만들지 않는다: 히어로 %는 페이로드의 `confidence`(EXTRACTED/INFERRED/AMBIGUOUS)와
// `tier`(deterministic/conversational)가 서로 다른 축이라(브레인 쪽 ontology.py
// 주석 "confidence와 출처 티어가 별개 축이다") 하나의 3분류로 합칠 근거가 없다 —
// 억지로 합치면 지어낸 값이 된다. 한 줄 요약 문장도 payload 어디에도 없다. 필터
// 칩은 `window_days`(기본 90 — 표시값과 이미 일치)·`limit` 조정 UI라 상호작용
// 컨트롤이 필요한데 이번 배선 범위는 표 렌더 + 행 클릭까지다.

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

// 대상 열 — 이름 + entity_id. entity_id가 종목 코드가 아닐 수도 있어(테마 등)
// 그대로 보조 텍스트로만 쓴다, 종목코드라고 새로 판정하지 않는다.
function renderTargetCell(entry) {
  const wrap = el('div', 'summary-row-target');
  const name = el('span', 'summary-row-name');
  name.textContent = entry.entity_name || entry.entity_id;
  wrap.appendChild(name);
  const id = el('span', 'summary-row-id');
  id.textContent = entry.entity_id;
  wrap.appendChild(id);
  return wrap;
}

function renderRow(entry) {
  const row = el('div', 'summary-row');
  row.setAttribute('data-entity-id', entry.entity_id);
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');

  row.appendChild(renderTargetCell(entry));

  const relation = el('span', 'summary-row-relation');
  relation.textContent = entry.relation_kind;
  row.appendChild(relation);

  // 근거(rationale)는 nullable이다(brain.py ProfileSummaryEntryOut) — 없으면
  // 빈 칸으로 둔다, 문구를 지어내지 않는다.
  const rationale = el('span', 'summary-row-rationale');
  rationale.textContent = entry.rationale || '';
  row.appendChild(rationale);

  const reinforcement = el('span', 'summary-row-reinforcement');
  reinforcement.textContent = String(entry.reinforcement);
  row.appendChild(reinforcement);

  return row;
}

// 순수 렌더 — DOM만 만든다, 클릭은 걸지 않는다(controller가 건다, render.js와
// 같은 분업). container는 통째로 다시 채운다.
function renderSummaryTable(container, entries) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const list = Array.isArray(entries) ? entries : [];
  const table = el('div', 'summary-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', `성향 신호 ${list.length}건`);
  for (const entry of list) {
    if (!entry || !entry.entity_id) continue;
    table.appendChild(renderRow(entry));
  }
  container.appendChild(table);
  return table;
}

function describeRendered(container) {
  const table = container && container.querySelector('.summary-table');
  if (!table) return { rendered: false, rows: 0 };
  return { rendered: true, rows: table.querySelectorAll('.summary-row').length };
}

// 표를 그리고 유지하는 배선 — fetch·클릭·selectEntity 호출까지 전부 여기 있다.
// canvas.js는 컨테이너 요소와 실제 IPC 호출·selectEntity만 주입하면 된다
// (controller.js의 "의존을 전부 주입받는다" 원칙과 같다).
function createSummaryTableController(deps) {
  const {
    container,          // 표를 그릴 DOM 노드
    fetchProfileSummary, // async () => { ok, entries, ... }
    selectEntity,       // (entityId, panelData) => void — window.AthenaCanvasMode.selectEntity
    limit,              // 보드 07은 "상위 5" — 기본 50을 그대로 쓰면 안 맞는다
    onError,            // (err) => void (선택)
  } = deps;

  let entries = [];

  function panelDataFor(entry) {
    // 페이로드에 실재하는 필드만 담는다 — 지어낸 값 없음.
    return {
      entityId: entry.entity_id,
      name: entry.entity_name,
      kind: entry.entity_kind,
      relation: entry.relation_kind,
      rationale: entry.rationale,
      reinforcement: entry.reinforcement,
    };
  }

  function wireRowClicks() {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    const rows = container.querySelectorAll('.summary-row');
    for (const row of rows) {
      if (typeof row.addEventListener !== 'function') continue;
      row.addEventListener('click', () => {
        const entityId = row.getAttribute('data-entity-id');
        const entry = entries.find((e) => e.entity_id === entityId);
        if (entry && typeof selectEntity === 'function') {
          selectEntity(entry.entity_id, panelDataFor(entry));
        }
      });
    }
  }

  async function load() {
    let res;
    try {
      res = await fetchProfileSummary({ limit });
    } catch (err) {
      if (onError) onError(err);
      renderSummaryTable(container, []);
      return null;
    }
    if (!res || !res.ok) {
      if (onError) onError(new Error((res && res.error) || '성향 신호를 받지 못했다'));
      renderSummaryTable(container, []);
      return null;
    }
    entries = Array.isArray(res.entries) ? res.entries : [];
    renderSummaryTable(container, entries);
    wireRowClicks();
    return entries;
  }

  return { load };
}

const __exports = { renderSummaryTable, describeRendered, createSummaryTableController };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphSummaryTable = __exports;
}

})();

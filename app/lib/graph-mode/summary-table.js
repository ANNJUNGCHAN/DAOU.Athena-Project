// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드 요약 뷰(보드 07)의 성향 신호 표. `render.js`(군집 지도 SVG)와 같은
// 층위의 대상 — 이쪽은 `GET /api/v1/brain/profile-summary`(athena:brain-profile-summary
// IPC)를 그린다. 군집 지도(cluster-map)와는 다른 엔드포인트다: 군집 지도는
// {entity_id, name, kind, cluster, degree}만 주고, 여기는 대상별 관계·근거·보강
// 수까지 준다 — 표에 필요한 필드는 이쪽에만 있다.
//
// **히어로(스텝3)** — "지금 읽히는 성향" 라벨 + 사실/추론/불확실 %. confidence
// (EXTRACTED/INFERRED/AMBIGUOUS) 값 자체가 이미 Paper의 3분류와 1:1로 대응해서
// `tier`(deterministic/conversational, 별개 축)와 합칠 필요가 없다 — 옛 주석은
// confidence+tier를 억지로 합쳐야 한다고 가정했는데 그 가정이 틀렸다. 다만
// "반도체 대형주 중심..." 같은 자연어 타이틀 문장은 payload 어디에도 없어 여전히
// 짓지 않는다(§0 정책) — 라벨과 %만 그린다.
//
// **확인 필요 배너(스텝3, 06 전용)** — `athena:brain-suggested-questions`(선택
// 주입)의 개수를 그대로 쓴다. "점수 8.5" 같은 근거 없는 수치는 없다.
//
// **여전히 안 그리는 것.** 필터 칩(최근 90일·보강 순 조정 UI)은 `window_days`
// (기본 90 — 표시값과 이미 일치)·`limit` 조정 UI라 상호작용 컨트롤이 필요한데
// Paper가 활성/비활성 시각 차이·인터랙션 스펙을 안 그려서(정찰 보고서, 열린 질문
// 5) 정적 라벨로만 둔다 — 그 정적 마크업은 shell.html/canvas.js(스텝2) 소관이라
// 여기 없다.

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

// 출처 열(06 §7-1) — 계획 원안은 `entry.source`(없음) 유무로 이 열을 넣을지
// 정하라 했지만, 그 필드는 없어도 같은 의미를 `entry.tier`가 이미 담고 있다
// (backend/athena_api/brain/ontology.py의 SourceTier: "DETERMINISTIC은
// 체결·잔고처럼... CONVERSATIONAL은 대화에서 LLM이 추론한 것") — 그래서 없는
// 필드를 기다리지 않고 tier를 출처로 번역해 넣는다.
const SOURCE_TIER_LABELS = { deterministic: '체결·잔고', conversational: '대화' };

// 최근 열(06 §7-1) — 일/주 단위 상대 시간. routine-turn.js의 relativeText는
// 분/시간 단위(능동 턴 배지용)라 이 용도엔 맞지 않아 따로 둔다.
function relativeDaysText(observedAtIso, nowMs) {
  const t = Date.parse(observedAtIso);
  if (!Number.isFinite(t)) return '';
  const now = nowMs === undefined ? Date.now() : nowMs;
  const days = Math.floor(Math.max(0, now - t) / 86400000);
  if (days <= 0) return '오늘';
  if (days < 7) return `${days}일 전`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}주 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

// dot 인코딩(06 §7-1) — Paper가 정확한 배정 함수를 안 줘서(정찰 보고서: "손으로
// 배정된 값으로 보인다, 정확한 함수 불명") confidence/tier 축으로 매핑한다:
// 사실+체결기반(EXTRACTED && deterministic)만 채움 검정, 불확실(AMBIGUOUS)은
// 채움 주황(경고), 나머지(추론 등)는 테두리만 — 실행자 판단이므로 title로
// 신호한다(원칙5 "근거 불명확한 추정 분류").
function dotClass(entry) {
  if (entry.confidence === 'EXTRACTED' && entry.tier === 'deterministic') return 'summary-row-dot-fact';
  if (entry.confidence === 'AMBIGUOUS') return 'summary-row-dot-warn';
  return 'summary-row-dot-soft';
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

  const dot = el('span', `summary-row-dot ${dotClass(entry)}`);
  dot.setAttribute('title', '확정성 추정(confidence·출처 기반 분류)');
  row.appendChild(dot);

  row.appendChild(renderTargetCell(entry));

  // 관계 배지 — pill 스타일(canvas.css).
  const relation = el('span', 'summary-row-relation');
  relation.textContent = entry.relation_kind;
  row.appendChild(relation);

  // 근거(rationale)는 nullable이다(brain.py ProfileSummaryEntryOut) — 없으면
  // 빈 칸으로 둔다, 문구를 지어내지 않는다.
  const rationale = el('span', 'summary-row-rationale');
  rationale.textContent = entry.rationale || '';
  row.appendChild(rationale);

  const source = el('span', 'summary-row-source');
  source.textContent = SOURCE_TIER_LABELS[entry.tier] || '';
  row.appendChild(source);

  const reinforcement = el('span', 'summary-row-reinforcement');
  reinforcement.textContent = String(entry.reinforcement);
  row.appendChild(reinforcement);

  const recent = el('span', 'summary-row-recent');
  recent.textContent = relativeDaysText(entry.observed_at);
  row.appendChild(recent);

  return row;
}

// 열 머리글 행(06 §7-1). 텍스트 없는 아이콘 칸 하나 + 이름 붙은 6열.
const COLUMN_HEADS = [
  { key: 'icon', label: '' },
  { key: 'target', label: '대상' },
  { key: 'relation', label: '관계' },
  { key: 'rationale', label: '근거' },
  { key: 'source', label: '출처' },
  { key: 'reinforcement', label: '보강' },
  { key: 'recent', label: '최근' },
];

function renderColumnHeads() {
  const row = el('div', 'summary-table-columns');
  for (const col of COLUMN_HEADS) {
    const cell = el('span', `summary-col summary-col-${col.key}`);
    cell.textContent = col.label;
    row.appendChild(cell);
  }
  return row;
}

// 히어로(보드 06 §5) — confidence 3종 분포를 %로. entries가 이미 fetch된(대개
// "상위 N") 표본이라 이 %는 "지금 표에 보이는 신호들의" 분포이지 전체 모집단
// 정확 통계라는 보장은 아니다 — profile-summary가 총건수를 안 줘서(정직 기록)
// 더 정밀한 표본을 구할 방법이 없다.
function computeConfidenceBreakdown(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const counts = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };
  let counted = 0;
  for (const entry of list) {
    const c = entry && entry.confidence;
    if (Object.prototype.hasOwnProperty.call(counts, c)) {
      counts[c] += 1;
      counted += 1;
    }
  }
  if (counted === 0) return { fact: 0, inference: 0, ambiguous: 0, total: 0 };
  return {
    fact: Math.round((counts.EXTRACTED / counted) * 100),
    inference: Math.round((counts.INFERRED / counted) * 100),
    ambiguous: Math.round((counts.AMBIGUOUS / counted) * 100),
    total: counted,
  };
}

function heroStat(label, pct, kind) {
  const col = el('div', `summary-hero-stat summary-hero-stat-${kind}`);
  const value = el('span', 'summary-hero-stat-value');
  value.textContent = `${pct}%`;
  col.appendChild(value);
  const lab = el('span', 'summary-hero-stat-label');
  lab.textContent = label;
  col.appendChild(lab);
  return col;
}

// 순수 렌더 — entries가 비었으면(아직 못 읽음) 히어로 자체를 안 그린다. "성향을
// 0%씩 나눠 보여준다"보다 아예 없는 편이 정직하다(§0 정책).
function renderSummaryHero(container, entries) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const breakdown = computeConfidenceBreakdown(entries);
  if (breakdown.total === 0) return null;
  const wrap = el('div', 'summary-hero');
  const label = el('span', 'summary-hero-label');
  label.textContent = '지금 읽히는 성향';
  wrap.appendChild(label);
  const stats = el('div', 'summary-hero-stats');
  stats.appendChild(heroStat('사실', breakdown.fact, 'fact'));
  stats.appendChild(heroStat('추론', breakdown.inference, 'inference'));
  stats.appendChild(heroStat('불확실', breakdown.ambiguous, 'ambiguous'));
  wrap.appendChild(stats);
  container.appendChild(wrap);
  return wrap;
}

// 확인 필요 배너(보드 06 §6, 06 전용). hintCount는 호출자가 이미
// athena:brain-suggested-questions로 계산해 온 값(없으면 null/0) — 여기서는
// 받은 수만 그린다, 지어내지 않는다. 0/null이면 배너 자체를 숨긴다("확인이
// 필요한 것 0건"은 모순이다).
function renderConfirmBanner(container, hintCount, onCtaClick) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!Number.isFinite(hintCount) || hintCount <= 0) {
    container.hidden = true;
    return null;
  }
  container.hidden = false;
  const dot = el('span', 'confirm-banner-dot');
  container.appendChild(dot);
  const title = el('span', 'confirm-banner-title');
  title.textContent = `확인이 필요한 것 ${hintCount}건`;
  container.appendChild(title);
  const body = el('span', 'confirm-banner-body');
  body.textContent = '체결과 대화가 어긋나는 성향이 있습니다 — 답하시면 그대로 그래프가 갱신됩니다';
  container.appendChild(body);
  const cta = el('button', 'confirm-banner-cta');
  cta.setAttribute('type', 'button');
  cta.textContent = '채팅에서 답하기';
  if (typeof onCtaClick === 'function') cta.addEventListener('click', onCtaClick);
  container.appendChild(cta);
  return container;
}

// 순수 렌더 — DOM만 만든다, 클릭은 걸지 않는다(controller가 건다, render.js와
// 같은 분업). container는 통째로 다시 채운다.
function renderSummaryTable(container, entries) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const list = Array.isArray(entries) ? entries : [];

  const wrap = el('div', 'summary-table-wrap');

  // 섹션 헤더(06/07 §7 공통) — "전체 M개 보기"는 안 넣는다: profile-summary
  // 응답(ProfileSummaryResponse)엔 entries 목록만 있고 총건수 필드가 없어 M을
  // 정직하게 채울 방법이 없다(§0 정책).
  const head = el('div', 'summary-table-head');
  const title = el('span', 'summary-table-title');
  title.textContent = '성향 신호';
  head.appendChild(title);
  const subtitle = el('span', 'summary-table-subtitle');
  subtitle.textContent = `상위 ${list.length}`;
  head.appendChild(subtitle);
  wrap.appendChild(head);

  const table = el('div', 'summary-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', `성향 신호 ${list.length}건`);
  table.appendChild(renderColumnHeads());
  for (const entry of list) {
    if (!entry || !entry.entity_id) continue;
    table.appendChild(renderRow(entry));
  }
  wrap.appendChild(table);

  container.appendChild(wrap);
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
    selectEntity,       // (entityId, panelData) => void — window.AthenaGraphMode.selectEntity
    limit,              // 보드 07은 "상위 5" — 기본 50을 그대로 쓰면 안 맞는다
    onError,            // (err) => void (선택)
    heroContainer,           // 선택 — 히어로(사실/추론/불확실 %) 렌더 대상(스텝3)
    bannerContainer,         // 선택 — 확인 필요 배너 렌더 대상(스텝3, 06 전용)
    fetchSuggestedQuestions, // 선택 — async () => { ok, questions }(배너 개수원)
    onConfirmCta,            // 선택 — 배너 CTA 클릭 시 호출(예: 채팅 입력 포커스)
  } = deps;

  let entries = [];

  // 표와 같은 fetch 결과로 히어로·배너도 채운다(둘 다 "얹는" 부가 정보라 이
  // 함수가 던지지 않는다 — 실패해도 표는 이미 그려졌다).
  async function renderExtras(list) {
    renderSummaryHero(heroContainer, list);
    if (!bannerContainer) return;
    if (typeof fetchSuggestedQuestions !== 'function') {
      renderConfirmBanner(bannerContainer, null, onConfirmCta);
      return;
    }
    let hintCount = null;
    try {
      const qRes = await fetchSuggestedQuestions();
      hintCount = qRes && qRes.ok && Array.isArray(qRes.questions) ? qRes.questions.length : null;
    } catch (err) {
      hintCount = null;
    }
    renderConfirmBanner(bannerContainer, hintCount, onConfirmCta);
  }

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
      await renderExtras([]);
      return null;
    }
    if (!res || !res.ok) {
      if (onError) onError(new Error((res && res.error) || '성향 신호를 받지 못했다'));
      renderSummaryTable(container, []);
      await renderExtras([]);
      return null;
    }
    entries = Array.isArray(res.entries) ? res.entries : [];
    renderSummaryTable(container, entries);
    wireRowClicks();
    await renderExtras(entries);
    return entries;
  }

  return { load };
}

const __exports = {
  renderSummaryTable,
  describeRendered,
  createSummaryTableController,
  computeConfidenceBreakdown,
  renderSummaryHero,
  renderConfirmBanner,
  dotClass,
  relativeDaysText,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphSummaryTable = __exports;
}

})();

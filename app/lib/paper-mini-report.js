'use strict';

// `app/captures/paper-gates/PAPER-MINI.json` — 카드미니 게이트 두 층이 함께 쓰는
// 한 파일의 형상과 병합(설계서 §5.3.3).
//
// 정적(`verify:paper-mini-static`)은 실카드 192장이 대장과 같은 것을 말하는가를,
// 견본(`verify:paper-mini-template`)은 문법 10종이 실제 오브에서 그려지는가를 잰다.
// 두 층은 서로 다른 보드를 재므로 배열도 따로 두고(`boards[]` / `templates[]`),
// 병합은 자기 층만 갈아 끼운다 — 층이 서로를 지우면 리포트 내용이 「누가 마지막에
// 돌았나」로 정해지고, 그건 게이트가 아니라 경주다(PAPER-CARDS.json과 같은 규칙).

const SCHEMA_VERSION = 1;

/** 이전 파일(없거나 스키마가 다르면 빈 껍데기). */
function baseOf(existing) {
  if (existing && existing.schema_version === SCHEMA_VERSION) return existing;
  return { schema_version: SCHEMA_VERSION, layers: {}, boards: [], templates: [] };
}

function assemble(base, layers, payload) {
  return {
    schema_version: SCHEMA_VERSION,
    gate: 'verify:paper-mini',
    generated_at: payload.generated_at,
    canonical_decision: payload.canonical_decision ?? base.canonical_decision ?? null,
    totals: payload.totals ?? base.totals ?? null,
    baseline: payload.baseline ?? base.baseline ?? null,
    grammar_coverage: payload.grammar_coverage ?? base.grammar_coverage ?? null,
    layers,
    gate_failures: payload.gate_failures ?? base.gate_failures ?? [],
    boards: payload.boards ?? base.boards ?? [],
    templates: payload.templates ?? base.templates ?? [],
  };
}

/**
 * 정적 층을 얹는다. 실카드 명부(`boards[]`)와 `totals`·`baseline`의 주인은 정적 층이고,
 * 견본 층이 쓴 `templates[]`와 런타임 `grammar_coverage`는 건드리지 않는다.
 *
 * 단 하나 예외가 `grammar_coverage`다 — 정적 층도 견본 11장이 문법 10종을 이름으로
 * 덮는지 먼저 잰다(설계서 §5.3.2: "먼저 정적으로 확인"). 정적이 나중에 돌면 그 값이
 * 최신이므로 갈아 끼운다. 런타임이 잰 것은 `templates[]`에 남는다.
 */
function mergeStaticLayer(existing, report) {
  const base = baseOf(existing);
  const layers = {
    ...base.layers,
    static: {
      gate: 'verify:paper-mini-static',
      generated_at: report.generated_at,
      boards: report.boards.length,
    },
  };
  return assemble(base, layers, {
    generated_at: report.generated_at,
    canonical_decision: report.canonical_decision,
    totals: report.totals,
    baseline: report.baseline,
    grammar_coverage: report.grammar_coverage,
    gate_failures: report.gate_failures,
    boards: report.boards,
  });
}

/**
 * 견본 층을 얹는다. `templates[]`만 갈아 끼우고 실카드 판정은 그대로 둔다.
 * `grammar_coverage`에는 런타임이 실제로 그린 문법을 적는다 — 이름이 덮는 것과
 * 그려지는 것은 다른 사실이고, 게이트가 재려는 것은 뒤쪽이다.
 */
function mergeTemplateLayer(existing, runtime) {
  const base = baseOf(existing);
  const layers = {
    ...base.layers,
    template: {
      gate: 'verify:paper-mini-template',
      generated_at: runtime.generated_at,
      templates: runtime.templates.length,
      rendered: runtime.rendered,
      elapsed_ms: runtime.elapsed_ms ?? null,
    },
  };
  const failures = [
    ...(base.gate_failures || []).filter((failure) => failure.layer !== 'template'),
    ...(runtime.gate_failures || []),
  ];
  return assemble(base, layers, {
    generated_at: runtime.generated_at,
    grammar_coverage: runtime.grammar_coverage,
    gate_failures: failures,
    templates: runtime.templates,
  });
}

module.exports = { SCHEMA_VERSION, mergeStaticLayer, mergeTemplateLayer };

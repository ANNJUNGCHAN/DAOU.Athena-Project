'use strict';

// `app/captures/paper-gates/PAPER-CARDS.json` — 카드 96장 게이트 두 층이 함께 쓰는
// 한 파일의 형상과 병합(설계서 §3.7).
//
// 정적(`verify:paper-cards-static`)은 「Paper 원장과 템플릿이 같은 카드를 말하는가」를,
// 마운트(`verify:paper-cards-mount`)는 「그 템플릿이 실앱 셸에서 서는가」를 잰다.
// 판정이 붙는 곳은 같은 보드라 §3.7은 배열 하나(`boards[]`)에 두 층의 실패를
// `layer` 필드로 섞어 담는 형상을 규정한다 — §6.4 변환기가 읽는 배열도 그 하나다.
//
// 병합은 **자기 층만 갈아 끼운다.** 어느 쪽이 나중에 돌든 상대 층의 판정은 남는다.
// 층이 서로를 지우면 리포트 내용이 「누가 마지막에 돌았나」로 정해지고, 그건
// 게이트가 아니라 경주다.
//
// 부분 실행(`ATHENA_VERIFY_BOARD_IDS` 샤딩)은 **잰 보드만** 갈아 끼우고 무엇을 쟀는지
// `layers.mount`에 적는다. `totals`는 전부 파일에 실제로 들어 있는 것을 센 값이라
// 부분 실행이 전수 수치를 참칭하지 않는다 — 몇 장이 마운트를 실제로 거쳤는지는
// `totals.mount_measured`가 따로 말한다(§3.7 totals에 더한 한 칸이고, 이것이 없으면
// 「96장 중 32장 빨강」이 2장만 잰 실행 뒤에도 그대로 남는다).

const SCHEMA_VERSION = 1;

/** 층 하나가 남긴 실패만 걷어낸다 — 상대 층 실패는 그대로 둔다. */
function withoutLayer(failures, layer) {
  return (failures || []).filter((failure) => failure.layer !== layer);
}

/** 마운트 층 근거(통과 측정값 또는 실패)가 이 보드에 실제로 들어 있는가. */
function hasMountEvidence(board) {
  return Boolean(board.mount) || (board.failures || []).some((failure) => failure.layer === 'mount');
}

/** 실패 목록에서 status를 정한다 — 상태는 언제나 목록의 함수다. */
function sealBoard(board) {
  const sealed = {
    board_id: board.board_id,
    card_id: board.card_id ?? null,
    name: board.name ?? null,
    status: board.failures.length ? 'fail' : 'pass',
    failures: board.failures,
  };
  if (board.mount) sealed.mount = board.mount;
  return sealed;
}

/**
 * 파일에 실제로 들어 있는 것만 센다. 층이 아직 안 돌았으면 그 층의 칸은 null이고,
 * 0이라고 적지 않는다 — 「안 쟀다」와 「재서 하나도 안 빨갛다」는 다른 말이다.
 */
function totalsOf(boards, layers) {
  const failed = boards.filter((board) => board.status === 'fail').length;
  const countLayer = (layer) => boards
    .filter((board) => (board.failures || []).some((failure) => failure.layer === layer)).length;
  return {
    boards: boards.length,
    pass: boards.length - failed,
    fail: failed,
    static_fail: layers.static ? countLayer('static') : null,
    mount_fail: layers.mount ? countLayer('mount') : null,
    mount_measured: boards.filter(hasMountEvidence).length,
  };
}

/** 이전 파일(없거나 스키마가 다르면 빈 껍데기). */
function baseOf(existing) {
  if (existing && existing.schema_version === SCHEMA_VERSION) return existing;
  return { schema_version: SCHEMA_VERSION, layers: {}, boards: [] };
}

function assemble(base, layers, boards, payload) {
  return {
    schema_version: SCHEMA_VERSION,
    gate: 'verify:paper-cards-all',
    generated_at: payload.generated_at,
    manifest_sha256: payload.manifest_sha256 ?? base.manifest_sha256 ?? null,
    totals: totalsOf(boards, layers),
    layers,
    gate_failures: payload.gate_failures ?? base.gate_failures ?? [],
    static: payload.static ?? base.static ?? null,
    boards,
  };
}

/**
 * 정적 층을 얹는다. 보드 명부의 주인은 정적 층이다 — 색인에서 빠진 보드는 사라지고,
 * 남은 보드의 마운트 판정(`mount` 측정값과 layer==='mount' 실패)은 보존한다.
 * @param {object|null} existing 이전 PAPER-CARDS.json
 * @param {object} report checkPaperCardsStatic()가 만든 정적 층 리포트
 */
function mergeStaticLayer(existing, report) {
  const base = baseOf(existing);
  const priorOf = new Map((base.boards || []).map((board) => [board.board_id, board]));
  const boards = report.boards.map((record) => {
    const prior = priorOf.get(record.board_id) || {};
    return sealBoard({
      board_id: record.board_id,
      card_id: record.card_id,
      name: record.name,
      failures: [...(record.failures || []), ...withoutLayer(prior.failures, 'static')],
      mount: prior.mount,
    });
  });
  const layers = {
    ...base.layers,
    static: {
      gate: 'verify:paper-cards-static',
      generated_at: report.generated_at,
      boards: boards.length,
    },
  };
  return assemble(base, layers, boards, {
    generated_at: report.generated_at,
    manifest_sha256: report.manifest_sha256,
    gate_failures: report.gate_failures,
    static: report.static,
  });
}

/**
 * 마운트 층을 얹는다. 이 실행이 잰 보드만 갈아 끼우고 나머지 보드의 판정은 —
 * 정적이든 이전 마운트 실행이든 — 그대로 둔다. 정적 층이 아직 안 돈 보드는
 * 새 항목으로 들어간다.
 * @param {object|null} existing 이전 PAPER-CARDS.json
 * @param {object} runtime probe-paper-cards-mount.js가 만든 실행 결과
 */
function mergeMountLayer(existing, runtime) {
  const base = baseOf(existing);
  const measuredOf = new Map(runtime.boards.map((board) => [board.board_id, board]));
  const applyMount = (prior) => {
    const record = measuredOf.get(prior.board_id);
    if (!record) return sealBoard({ ...prior, failures: prior.failures || [] });
    return sealBoard({
      board_id: prior.board_id,
      card_id: prior.card_id ?? record.card_id,
      name: prior.name ?? record.name,
      failures: [...withoutLayer(prior.failures, 'mount'), ...(record.failures || [])],
      mount: record.mount,
    });
  };
  const known = new Set((base.boards || []).map((board) => board.board_id));
  const boards = [
    ...(base.boards || []).map(applyMount),
    ...runtime.boards.filter((record) => !known.has(record.board_id)).map((record) => applyMount({
      board_id: record.board_id,
      card_id: record.card_id,
      name: record.name,
      failures: [],
    })),
  ];
  const layers = {
    ...base.layers,
    mount: {
      gate: 'verify:paper-cards-mount',
      generated_at: runtime.generated_at,
      canonical: runtime.selection.canonical === true,
      measured: runtime.boards.length,
      board_ids: runtime.selection.canonical === true
        ? null
        : runtime.boards.map((board) => board.board_id),
      presets: runtime.presets,
      chunks: runtime.chunks.length,
      elapsed_ms: runtime.elapsed_ms,
    },
  };
  return assemble(base, layers, boards, { generated_at: runtime.generated_at });
}

module.exports = { SCHEMA_VERSION, mergeMountLayer, mergeStaticLayer };

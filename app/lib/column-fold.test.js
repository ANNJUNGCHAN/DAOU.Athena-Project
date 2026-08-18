'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { foldColumns, columnPixelWidth, DEFAULT_CANVAS_WIDTH_PX } = require('./column-fold');

const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'wide-table-fold-fixtures.json'), 'utf-8')
);
const CALIBRATION = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'ref', 'width-anchor-pixel-calibration.json'),
    'utf-8'
  )
);

test('foldColumns: 좁은 표는 하나도 안 접힌다', () => {
  const columns = [
    { key: 'stk_cd', label: '종목코드' },
    { key: 'stk_nm', label: '종목명' },
    { key: 'cur_prc', label: '현재가' },
  ];
  const { visible, hidden } = foldColumns(columns);
  assert.equal(visible.length, 3);
  assert.equal(hidden.length, 0);
});

test('foldColumns: ka10095(63컬럼)는 §5.3.1 fold가 실제로 발동한다', () => {
  const tr = FIXTURES.trs.find((t) => t.mapping_id === 'base:ka10095');
  assert.ok(tr, 'ka10095 fixture가 있어야 한다');
  assert.equal(tr.total_columns, 63);

  const { visible, hidden, usedPx } = foldColumns(tr.columns, DEFAULT_CANVAS_WIDTH_PX);
  assert.equal(visible.length + hidden.length, 63);
  assert.ok(hidden.length > 0, '63컬럼 표는 1560px에서 반드시 fold돼야 한다');
  assert.ok(usedPx <= DEFAULT_CANVAS_WIDTH_PX);
  // 식별 컬럼(§5.3.1(a))이 fold 밖으로 밀리면 안 된다.
  assert.ok(visible.some((c) => c.key === 'stk_cd'));
  assert.ok(visible.some((c) => c.key === 'stk_nm'));
  // 고빈도 alias(cur_prc 89 등)는 fold 안쪽에 있어야 한다 — PRIORITY_FIELD_HIDDEN이면
  // backend/scripts/fit_dissonance_check.py가 이미 잡는다(§2.2), 렌더러 쪽도 동일 순서를
  // 그대로 따르므로 여기서 안쪽에 있는지 재확인한다.
  assert.ok(visible.some((c) => c.key === 'cur_prc'));
});

test('foldColumns × backend width-anchor-pixel-calibration.json: 5개 anchor TR 모두 정합', () => {
  // 백엔드는 §2.6 공식으로 "1560px에서 스크롤 없이 보이는 컬럼 수"를 declared 순서
  // 기준으로 이미 추정해뒀다(backend/ref/width-anchor-pixel-calibration.json). 렌더러가
  // column_priority 순서(식별 컬럼 우선, §5.3.1) 위에서 같은 픽셀 가정으로 다시 접었을 때도
  // 같은 결론(스크롤 발생 여부)에 도달하는지 이중 확인한다 — 라벨이 대체로 2~8자로 짧아
  // 데이터 셀 최소폭(90px) 바닥값에 걸리는 이 5개 표본에서는 순서가 바뀌어도 "몇 개까지
  // 보이는가"가 거의 같다는 calibration 파일 §threshold_check.reversal_check의 관측과
  // 일치해야 한다(완전히 같은 수치를 요구하지 않는다 — 순서가 다르므로 근접치만 확인).
  for (const [trId, expected] of Object.entries(CALIBRATION.per_tr)) {
    const mappingId = `base:${trId}`;
    const tr = FIXTURES.trs.find((t) => t.mapping_id === mappingId);
    assert.ok(tr, `${mappingId} fixture가 있어야 한다`);
    const { visible } = foldColumns(tr.columns, CALIBRATION.assumptions.canvas_width_px);
    const delta = Math.abs(visible.length - expected.est_visible_columns_at_1560);
    assert.ok(
      delta <= 2,
      `${trId}: 렌더러 fold=${visible.length}, calibration=${expected.est_visible_columns_at_1560} (오차 ${delta} > 2)`
    );
    assert.ok(visible.length < tr.total_columns, `${trId}: 전체 ${tr.total_columns}컬럼이 모두 보이면 fold 검증이 무의미하다`);
  }
});

test('columnPixelWidth: 짧은 한글 라벨은 데이터 셀 최소폭(90px) 바닥값에 걸린다', () => {
  // §5.3.1 calibration assumptions: numeric_data_cell_min_width_px=90, padding=24.
  // '현재가'(3자 x 14px = 42px) < 90px → 90+24=114px가 나와야 한다.
  assert.equal(columnPixelWidth('현재가'), 114);
});

test('foldColumns: 15개 넓은 테이블 전부 total/visible/hidden이 산술적으로 닫힌다', () => {
  assert.equal(FIXTURES.trs.length, 15);
  for (const tr of FIXTURES.trs) {
    const { visible, hidden } = foldColumns(tr.columns);
    assert.equal(visible.length + hidden.length, tr.total_columns);
  }
});

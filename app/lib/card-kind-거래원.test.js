'use strict';

// DOM 빌더(render거래원)는 document가 필요해 node --test 경로에서는 못 돈다
// (card-primitives.test.js와 같은 결) — 이 스위트는 순수 판정(resolveBrokerRanking/
// resolveBrokerRankingTable/buildBrokerTableRow)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBrokerRanking, resolveBrokerRankingTable, buildBrokerTableRow } = require('./card-kind-거래원');

test('ka10040 매수측 필드 — buy_trde_ori_N/buy_trde_ori_qty_N을 순위행으로 뽑는다', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_1: '미래에셋증권',
    buy_trde_ori_qty_1: '48210',
    buy_trde_ori_cd_1: '05Y', // 코드는 목업에 없는 필드 — 무시돼야 한다
    buy_trde_ori_2: '키움증권',
    buy_trde_ori_qty_2: '31554',
  });
  assert.equal(r.side, 'buy');
  assert.deepEqual(r.rows, [
    { rank: 1, name: '미래에셋증권', qty: '48210' },
    { rank: 2, name: '키움증권', qty: '31554' },
  ]);
});

test('ka10040 매도측 필드 — sel_trde_ori_N 패턴', () => {
  const r = resolveBrokerRanking({
    sel_trde_ori_1: '모건스탠리',
    sel_trde_ori_qty_1: '52077',
  });
  assert.equal(r.side, 'sell');
  assert.deepEqual(r.rows, [{ rank: 1, name: '모건스탠리', qty: '52077' }]);
});

test('ka10002 매수측 필드 — buy_trde_ori_nm_N/buy_trde_qty_N 패턴(다른 네이밍)', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_nm_1: '삼성증권',
    buy_trde_ori_1: '삼성증권',
    buy_trde_qty_1: '18902',
  });
  assert.equal(r.side, 'buy');
  assert.deepEqual(r.rows, [{ rank: 1, name: '삼성증권', qty: '18902' }]);
});

test('ka10002 매도측 필드 — sel_trde_ori_nm_N/sel_trde_qty_N 패턴', () => {
  const r = resolveBrokerRanking({
    sel_trde_ori_nm_1: 'JP모간',
    sel_trde_qty_1: '27368',
  });
  assert.equal(r.side, 'sell');
  assert.deepEqual(r.rows, [{ rank: 1, name: 'JP모간', qty: '27368' }]);
});

test('5위까지 순서대로 뽑는다(Paper는 3위까지만 보였지만 실응답은 5위까지)', () => {
  const map = {};
  for (let n = 1; n <= 5; n += 1) {
    map[`buy_trde_ori_${n}`] = `증권사${n}`;
    map[`buy_trde_ori_qty_${n}`] = String(n * 1000);
  }
  const r = resolveBrokerRanking(map);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[4].rank, 5);
});

test('이름은 있는데 수량이 없으면 그 순위는 생략한다(필드 단위 생략)', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_1: '미래에셋증권',
    buy_trde_ori_qty_1: '48210',
    buy_trde_ori_2: '키움증권', // 수량 없음
  });
  assert.deepEqual(r.rows, [{ rank: 1, name: '미래에셋증권', qty: '48210' }]);
});

test('네 패턴 중 아무것도 안 걸리면 null(all-or-nothing, 범용 렌더러로 폴백)', () => {
  assert.equal(resolveBrokerRanking({}), null);
  assert.equal(resolveBrokerRanking({ unrelated_key: '1' }), null);
  assert.equal(resolveBrokerRanking(null), null);
});

// ---------- ka10038(종목별증권사순위요청) — compound 봉투, 실측 필드명 ----------
// backend/ref/kiwoom-screen-definitions.json:15845-15864(presentation.card=
// "CompoundCard") — envelope.data.table.rows로 온다(facts의 data.fields가 아니다).

test('buildBrokerTableRow — rank/mmcm_nm/acc_netprps_qty 전부 있는 행', () => {
  const row = buildBrokerTableRow({ rank: '1', mmcm_nm: '미래에셋증권', buy_qty: '48210', sell_qty: '100', acc_netprps_qty: '48110' });
  assert.deepEqual(row, { rank: '1', name: '미래에셋증권', qty: '48110' });
});

test('buildBrokerTableRow — 응답이 이미 매긴 순위를 그대로 쓴다(배열 인덱스로 재계산 안 함)', () => {
  const row = buildBrokerTableRow({ rank: '7', mmcm_nm: 'JP모간', acc_netprps_qty: '-500' });
  assert.equal(row.rank, '7');
});

test('buildBrokerTableRow — rank·회원사명·누적순매수 중 하나라도 없으면 null(행 단위 생략)', () => {
  assert.equal(buildBrokerTableRow({ mmcm_nm: 'A', acc_netprps_qty: '1' }), null); // rank 없음
  assert.equal(buildBrokerTableRow({ rank: '1', acc_netprps_qty: '1' }), null); // mmcm_nm 없음
  assert.equal(buildBrokerTableRow({ rank: '1', mmcm_nm: 'A' }), null); // acc_netprps_qty 없음
  assert.equal(buildBrokerTableRow(null), null);
});

test('resolveBrokerRankingTable — 유효한 행만 골라 side:"net"으로 묶는다', () => {
  const r = resolveBrokerRankingTable([
    { rank: '1', mmcm_nm: '미래에셋증권', acc_netprps_qty: '48110' },
    { rank: '2', mmcm_nm: '키움증권' }, // acc_netprps_qty 없음 — 생략
    { rank: '3', mmcm_nm: 'NH투자증권', acc_netprps_qty: '-1200' },
  ]);
  assert.equal(r.side, 'net');
  assert.deepEqual(r.rows, [
    { rank: '1', name: '미래에셋증권', qty: '48110' },
    { rank: '3', name: 'NH투자증권', qty: '-1200' },
  ]);
});

test('resolveBrokerRankingTable — 유효한 행이 하나도 없으면 null(all-or-nothing)', () => {
  assert.equal(resolveBrokerRankingTable([]), null);
  assert.equal(resolveBrokerRankingTable([{ mmcm_nm: 'A' }]), null);
  assert.equal(resolveBrokerRankingTable(undefined), null);
  assert.equal(resolveBrokerRankingTable(null), null);
});

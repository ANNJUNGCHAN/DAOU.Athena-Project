'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectDiscoveryRows,
  selectDiscoveryFacts,
  resolveDiscoveryData,
  selectDiscoveryView,
} = require('./card-kind-종목발굴');

test('selectDiscoveryRows: 종목 랭킹 응답을 순위·종목·가격·등락 모델로 만든다', () => {
  const columns = [
    { key: 'rank', label: '순위' },
    { key: 'stk_cd', label: '종목코드' },
    { key: 'stk_nm', label: '종목명' },
    { key: 'cur_prc', label: '현재가' },
    { key: 'flu_rt', label: '등락률' },
  ];
  const rows = [{ rank: '1', stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '88100', flu_rt: '1.38' }];

  assert.deepEqual(selectDiscoveryRows(columns, rows), [{
    rank: '1',
    name: '삼성전자',
    code: '005930',
    value: '88100',
    unit: '원',
    change: '1.38',
  }]);
});

test('selectDiscoveryRows: ETF·업종처럼 라벨로만 의미가 드러나는 열도 이름과 값을 찾는다', () => {
  const columns = [
    { key: 'inds_nm', label: '업종명' },
    { key: 'now_pric', label: '현재가' },
    { key: 'flu_rt', label: '등락률' },
  ];
  const rows = [{ inds_nm: '반도체', now_pric: '412.55', flu_rt: '-0.42' }];

  assert.deepEqual(selectDiscoveryRows(columns, rows), [{
    rank: 1,
    name: '반도체',
    code: null,
    value: '412.55',
    unit: '',
    change: '-0.42',
  }]);
});

test('selectDiscoveryRows: 이름으로 쓸 수 있는 열이 없으면 전용 랭킹을 만들지 않는다', () => {
  const columns = [{ key: 'cur_prc', label: '현재가' }];
  assert.equal(selectDiscoveryRows(columns, [{ cur_prc: '88100' }]), null);
});

test('selectDiscoveryRows: 키움 가격의 방향 부호를 음수 가격으로 표시하지 않는다', () => {
  const columns = [
    { key: 'stk_nm', label: '종목명' },
    { key: 'cur_prc', label: '현재가' },
  ];
  assert.deepEqual(selectDiscoveryRows(columns, [{ stk_nm: '삼성전자', cur_prc: '-88100' }]), [{
    rank: 1,
    name: '삼성전자',
    code: null,
    value: '88100',
    unit: '원',
    change: null,
  }]);
});

test('selectDiscoveryFacts: 스칼라 발굴 응답은 결과 메타데이터를 빼고 실제 값만 남긴다', () => {
  const fields = [
    { key: 'result_code', label: '결과코드', value: '0' },
    { key: 'nav', label: 'NAV', value: '11234.56' },
    { key: 'flu_rt', label: '등락률', value: '1.20' },
    { key: 'empty', label: '빈 값', value: '' },
  ];

  assert.deepEqual(selectDiscoveryFacts(fields), [
    { label: 'NAV', value: '11234.56' },
    { label: '등락률', value: '1.20' },
  ]);
});

test('selectDiscoveryFacts: detail projection 필드를 임의로 6개에서 자르지 않는다', () => {
  const fields = Array.from({ length: 13 }, (_, index) => ({
    key: `metric_${index + 1}`,
    label: `지표 ${index + 1}`,
    value: String(index + 1),
  }));
  assert.equal(selectDiscoveryFacts(fields).length, 13);
});

test('selectDiscoveryView: ETF 시계열처럼 이름 열 없는 compound는 범용 화면으로 폴백한다', () => {
  const compounds = [
    {
      header: [{ key: 'stk_nm', label: '종목명', value: 'KODEX 200' }],
      table: { columns: [{ key: 'tm', label: '시간' }, { key: 'close_pric', label: '종가' }], rows: [{ tm: '093000', close_pric: '35000' }] },
    },
    {
      header: [{ key: 'stk_nm', label: '종목명', value: 'KODEX 200' }],
      table: { columns: [{ key: 'cntr_tm', label: '체결시간' }, { key: 'cur_prc', label: '현재가' }], rows: [{ cntr_tm: '093001', cur_prc: '35010' }] },
    },
    {
      header: [{ key: 'cur_prc', label: '현재가', value: '35010' }],
      table: { columns: [{ key: 'dt', label: '일자' }, { key: 'cur_prc_n', label: '현재가' }], rows: [{ dt: '20260828', cur_prc_n: '35010' }] },
    },
  ];
  for (const data of compounds) {
    assert.equal(selectDiscoveryView(data), null);
  }
});

test('selectDiscoveryView: 목록형 compound는 header facts와 table 목록을 함께 보존한다', () => {
  const data = {
    header: [{ key: 'tot_cnt', label: '전체 종목 수', value: '2' }],
    table: {
      columns: [
        { key: 'rank', label: '순위' },
        { key: 'stk_nm', label: '종목명' },
        { key: 'cur_prc', label: '현재가' },
      ],
      rows: [{ rank: '1', stk_nm: '삼성전자', cur_prc: '88100' }],
    },
  };
  assert.deepEqual(selectDiscoveryView(data), {
    facts: [{ label: '전체 종목 수', value: '2' }],
    rows: [{ rank: '1', name: '삼성전자', code: null, value: '88100', unit: '원', change: null }],
  });
});

test('selectDiscoveryView: ka30001·ka90002 실형 compound의 header 값을 버리지 않는다', () => {
  const cases = [
    {
      header: [{ key: 'base_pric_tm', label: '기준가 시간', value: '090000' }],
      table: {
        columns: [
          { key: 'rank', label: '순위' },
          { key: 'stk_cd', label: '종목코드' },
          { key: 'stk_nm', label: '종목명' },
          { key: 'cur_prc', label: '현재가' },
        ],
        rows: [{ rank: '1', stk_cd: '57J123', stk_nm: 'ELW 샘플', cur_prc: '-125' }],
      },
    },
    {
      header: [
        { key: 'flu_rt', label: '테마 등락률', value: '1.25' },
        { key: 'dt_prft_rt', label: '기간 수익률', value: '3.40' },
      ],
      table: {
        columns: [
          { key: 'stk_cd', label: '종목코드' },
          { key: 'stk_nm', label: '종목명' },
          { key: 'cur_prc', label: '현재가' },
        ],
        rows: [{ stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '88100' }],
      },
    },
  ];
  assert.deepEqual(cases.map((data) => selectDiscoveryView(data).facts), [
    [{ label: '기준가 시간', value: '090000' }],
    [{ label: '테마 등락률', value: '1.25' }, { label: '기간 수익률', value: '3.40' }],
  ]);
});

test('resolveDiscoveryData: compound의 header/table도 동일한 전용 화면 입력으로 푼다', () => {
  const data = {
    header: [{ key: 'base_dt', label: '기준일', value: '20260829' }],
    table: {
      columns: [{ key: 'stk_nm', label: '종목명' }],
      rows: [{ stk_nm: '삼성전자' }],
    },
  };
  assert.deepEqual(resolveDiscoveryData(data), {
    fields: data.header,
    columns: data.table.columns,
    rows: data.table.rows,
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Restore = require('./session-restore');

const SPEC = {
  symbols: ['005930'],
  period: 'day',
  fromDt: '20230101',
  toDt: '20251231',
  params: { k: { default: 0.62 } },
  costs: { fee_bps: 1.5, tax_bps: 20, slippage_bps: 5 },
};

test('폼 칸은 값이 있는 것만 봉인한다 — 빈 칸을 세면 복원 카운트가 부풀려진다', () => {
  assert.deepEqual(Restore.filledFormFields(SPEC),
    ['symbols', 'period', 'fromDt', 'toDt', 'params', 'costs']);
  assert.deepEqual(
    Restore.filledFormFields({ ...SPEC, symbols: [], toDt: '', params: {} }),
    ['period', 'fromDt', 'costs'],
  );
  assert.deepEqual(Restore.filledFormFields(null), []);
});

test('봉인 — 값이 없는 조각은 null이고 로그는 꼬리만 남는다', () => {
  const sealed = Restore.sealBacktest({
    spec: SPEC,
    yaml: 'version: "1.0"\n',
    codeSource: 'def signal(df):\n    return 0\n',
    codeFile: 'strategy.py',
    versionId: 'v7',
    strategyId: 's1',
    runPath: 'code',
    runId: 'run-1',
    technique: {
      projectId: 'p-1', rootPath: 'techniques/내-기법',
      path: 'techniques/내-기법/strategy.py', name: '내 기법', draft: true,
      userStrategyId: null,
    },
    stdout: `${'x'.repeat(Restore.LOG_TAIL_CHARS)}끝`,
    scrollTop: 412.6,
  });
  assert.deepEqual(sealed.form.fields, Restore.filledFormFields(SPEC));
  assert.equal(sealed.code.versionId, 'v7');
  assert.equal(sealed.code.runPath, 'code');
  assert.equal(sealed.run.runId, 'run-1');
  assert.deepEqual(sealed.technique, {
    projectId: 'p-1', rootPath: 'techniques/내-기법',
    path: 'techniques/내-기법/strategy.py', name: '내 기법', draft: true,
    userStrategyId: null,
  });
  assert.equal(sealed.log.tail.length, Restore.LOG_TAIL_CHARS);
  assert.ok(sealed.log.tail.endsWith('끝'));
  assert.deepEqual(sealed.scroll, { top: 413 });

  const empty = Restore.sealBacktest({ spec: SPEC, yaml: '   ' });
  assert.equal(empty.form, null);
  assert.equal(empty.code, null);
  assert.equal(empty.technique, null);
  assert.equal(empty.run, null);
  assert.equal(empty.log, null);
  assert.equal(empty.scroll, null);
});

test('기법 작업공간 봉인은 같은 상대 폴더 안의 파일만 허용한다', () => {
  assert.deepEqual(Restore.sealTechniqueBinding({
    projectId: ' p-1 ', rootPath: 'techniques\\내-기법\\',
    path: 'techniques\\내-기법\\strategy.py', name: ' 내 기법 ', draft: true,
  }), {
    projectId: 'p-1', rootPath: 'techniques/내-기법',
    path: 'techniques/내-기법/strategy.py', name: '내 기법', draft: true,
    userStrategyId: null,
  });
  assert.deepEqual(Restore.sealTechniqueBinding({
    projectId: 'p-1', rootPath: '', path: 'strategies/a.py', name: 'a',
    userStrategyId: 'u1',
  }), {
    projectId: 'p-1', rootPath: '', path: 'strategies/a.py', name: 'a',
    draft: false, userStrategyId: 'u1',
  });
  assert.equal(Restore.sealTechniqueBinding({
    projectId: 'p-1', rootPath: 'techniques/a', path: '../strategy.py', name: 'a',
  }), null);
  assert.equal(Restore.sealTechniqueBinding({
    projectId: 'p-1', rootPath: 'techniques/a', path: 'techniques/b/strategy.py', name: 'a',
  }), null);
  assert.equal(Restore.sealTechniqueBinding({
    projectId: 'p-1', rootPath: 'C:/techniques/a', path: 'C:/techniques/a/strategy.py', name: 'a',
  }), null);
});

test('전부 돌아오면 안내 문장을 만들지 않는다(Rule 1 — 조용한 복원)', () => {
  const sealed = Restore.sealBacktest({
    spec: SPEC, yaml: 'y', codeSource: 'code', runId: 'run-1', stdout: 'log',
  });
  const report = Restore.restoreReport(sealed, {
    form: sealed.form.fields, code: true, result: true, log: true,
  });
  assert.equal(report.partial, false);
  assert.equal(report.message, '');
  assert.deepEqual(report.form, { restored: 6, sealed: 6 });
  assert.deepEqual(report.items.map((i) => i.key), ['form', 'code', 'result', 'log']);
});

test('봉인되지 않은 항목은 판정에 끼지 않는다 — 없던 것을 못 찾았다고 말하지 않는다', () => {
  const sealed = Restore.sealBacktest({ spec: SPEC, yaml: 'y' });
  const report = Restore.restoreReport(sealed, { form: sealed.form.fields });
  assert.deepEqual(report.items.map((i) => i.key), ['form']);
  assert.equal(report.partial, false);
});

test('결과만 못 찾으면 이름을 대고 나머지는 그대로라고 말한다(Rule 3)', () => {
  const sealed = Restore.sealBacktest({
    spec: SPEC, yaml: 'y', codeSource: 'code', runId: 'run-1', stdout: 'log',
  });
  const report = Restore.restoreReport(sealed, {
    form: sealed.form.fields, code: true, result: false, log: true,
  });
  assert.equal(report.partial, true);
  // Paper 3WO4-1의 문면 그대로 — 못 찾은 자리에만 수량이 붙는다.
  assert.deepEqual(report.missing, ['결과 데이터셋 1장']);
  assert.deepEqual(report.kept, ['폼', '코드', '로그']);
  assert.equal(report.message, '결과 데이터셋 1장을 찾지 못했습니다. 폼·코드·로그는 그대로입니다.');
});

test('폼이 덜 돌아오면 그 항목이 실패고 카운트가 남는다', () => {
  const sealed = Restore.sealBacktest({ spec: SPEC, yaml: 'y', codeSource: 'code' });
  const report = Restore.restoreReport(sealed, { form: ['symbols', 'period'], code: false });
  assert.deepEqual(report.form, { restored: 2, sealed: 6 });
  assert.equal(report.items[0].ok, false);
  assert.deepEqual(report.missing, ['폼', '코드']);
  assert.equal(report.message, '폼·코드를 찾지 못했습니다.');
});

test('봉인하지 않은 칸이 돌아왔다고 보고돼도 세지 않는다', () => {
  const sealed = Restore.sealBacktest({
    spec: { ...SPEC, params: {} }, yaml: 'y',
  });
  const report = Restore.restoreReport(sealed, { form: [...sealed.form.fields, 'params'] });
  assert.deepEqual(report.form, { restored: 5, sealed: 5 });
});

test('조사는 받침으로 갈린다', () => {
  assert.equal(Restore.hasJongseong('전략 폼'), true);
  assert.equal(Restore.hasJongseong('전략 코드'), false);
  assert.equal(Restore.hasJongseong('결과'), false);
  assert.equal(Restore.hasJongseong('실행 로그'), false);
  assert.equal(Restore.hasJongseong(''), false);
});

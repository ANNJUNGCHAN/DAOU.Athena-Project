'use strict';

// backtest-bridge.js 단위 테스트 — 주입식 fetchImpl로 실네트워크 없이 검증한다
// (chart-series.js 테스트 관례와 같은 자리). 핵심은 두 가지: (1) 모든 함수가
// {ok:true,data}|{ok:false,status,error} 봉투를 지키는가, (2) run()의 409가
// detail(needed_pages/est_seconds)을 잃지 않고 올라오는가(backtest-mode-plan.md §9).

const test = require('node:test');
const assert = require('node:assert/strict');
const backtestBridge = require('./backtest-bridge');

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test('fetchPresets: 200 → {ok:true, data}', async () => {
  const res = await backtestBridge.fetchPresets({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(200, { presets: [{ id: 'p1', name: '이평 교차', category: 'trend', yaml: 'x' }] }),
  });
  assert.deepEqual(res, { ok: true, data: { presets: [{ id: 'p1', name: '이평 교차', category: 'trend', yaml: 'x' }] } } );
});

test('fetchPresets: 네트워크 예외 → {ok:false, status:0, error}', async () => {
  const res = await backtestBridge.fetchPresets({
    backendBase: 'http://x',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.match(res.error, /ECONNREFUSED/);
});

test('runBacktest: 202 → {ok:true, data:{run_id}}', async () => {
  let capturedBody = null;
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 202, json: async () => ({ run_id: 'r1' }) };
    },
    yaml: 'strategy: x',
  });
  assert.deepEqual(res, { ok: true, data: { run_id: 'r1' } });
  assert.deepEqual(capturedBody, { yaml: 'strategy: x' });
});

test('runBacktest: 409(캐시 부족) → ok:false지만 detail(needed_pages/est_seconds)을 싣는다', async () => {
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(409, { detail: { needed_pages: 12, est_seconds: 12 } }),
    yaml: 'strategy: x',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.deepEqual(res.detail, { needed_pages: 12, est_seconds: 12 });
});

test('runBacktest: 일반 오류(500, 문자열 detail)는 detail 없이 error 메시지만 싣는다', async () => {
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(500, { detail: '내부 오류' }),
    yaml: 'x',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.equal(res.error, '내부 오류');
  assert.equal(res.detail, undefined);
});

test('planBacktest/backfillBacktest: backendBase/fetchImpl을 제외한 나머지 필드를 몸체로 그대로 보낸다', async () => {
  let seenPlanBody = null;
  let seenBackfillBody = null;
  await backtestBridge.planBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => { seenPlanBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; },
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
  assert.deepEqual(seenPlanBody, {
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });

  await backtestBridge.backfillBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => { seenBackfillBody = JSON.parse(opts.body); return { ok: true, status: 202, json: async () => ({ job_id: 'j1' }) }; },
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
  assert.deepEqual(seenBackfillBody, {
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
});

test('fetchJobStatus/fetchRunResult/fetchRunTrades: id를 경로에 인코딩해서 부른다', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  await backtestBridge.fetchJobStatus({ backendBase: 'http://x', fetchImpl, job_id: 'j 1' });
  await backtestBridge.fetchRunResult({ backendBase: 'http://x', fetchImpl, run_id: 'r1' });
  await backtestBridge.fetchRunTrades({ backendBase: 'http://x', fetchImpl, run_id: 'r1' });
  assert.deepEqual(urls, [
    'http://x/api/v1/backtest/jobs/j%201',
    'http://x/api/v1/backtest/runs/r1',
    'http://x/api/v1/backtest/runs/r1/trades',
  ]);
});

test('cancelJob: DELETE /api/v1/backtest/jobs/{id} — 수집 「중단」의 통로다', async () => {
  const seen = [];
  const res = await backtestBridge.cancelJob({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => {
      seen.push([url, init.method]);
      return { ok: true, status: 200, json: async () => ({ ok: true, cancelled: true }) };
    },
    job_id: 'j 1',
  });
  assert.deepEqual(seen, [['http://x/api/v1/backtest/jobs/j%201', 'DELETE']]);
  assert.deepEqual(res, { ok: true, data: { ok: true, cancelled: true } });
});

test('fetchRuns: GET /api/v1/backtest/runs', async () => {
  let seenUrl = null;
  const res = await backtestBridge.fetchRuns({
    backendBase: 'http://x',
    fetchImpl: async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ runs: [] }) }; },
  });
  assert.equal(seenUrl, 'http://x/api/v1/backtest/runs');
  assert.deepEqual(res, { ok: true, data: { runs: [] } });
});

// ── 프로젝트 파일 API(2026-09-02) ────────────────────────────────────────────

test('프로젝트 목록·생성·열기·등록 해제: 경로와 몸체가 계약 그대로다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await backtestBridge.listProjects({ backendBase: 'http://x', fetchImpl });
  await backtestBridge.createProject({ backendBase: 'http://x', fetchImpl, name: '내 전략' });
  await backtestBridge.openProject({ backendBase: 'http://x', fetchImpl, path: 'D:/quant/my' });
  await backtestBridge.unregisterProject({ backendBase: 'http://x', fetchImpl, project_id: 'p 1' });
  assert.deepEqual(calls, [
    ['GET', 'http://x/api/v1/projects', null],
    ['POST', 'http://x/api/v1/projects', { name: '내 전략' }],
    ['POST', 'http://x/api/v1/projects/open', { path: 'D:/quant/my' }],
    ['DELETE', 'http://x/api/v1/projects/p%201', null],
  ]);
});

test('파일 읽기·지우기: path를 쿼리로, project_id는 경로에 인코딩한다', async () => {
  const urls = [];
  const methods = [];
  const fetchImpl = async (url, opts) => {
    urls.push(url); methods.push(opts.method);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await backtestBridge.fetchProjectTree({ backendBase: 'http://x', fetchImpl, project_id: 'p 1' });
  await backtestBridge.readProjectFile({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', path: 'strategies/골든.py',
  });
  await backtestBridge.deleteProjectFile({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', path: 'a.py',
  });
  assert.deepEqual(methods, ['GET', 'GET', 'DELETE']);
  assert.equal(urls[0], 'http://x/api/v1/projects/p%201/tree');
  assert.equal(urls[1], 'http://x/api/v1/projects/p1/file?path=strategies%2F%EA%B3%A8%EB%93%A0.py');
  assert.equal(urls[2], 'http://x/api/v1/projects/p1/file?path=a.py');
});

test('파일 쓰기·만들기·이름 바꾸기: project_id는 몸체에서 빠진다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, JSON.parse(opts.body)]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await backtestBridge.writeProjectFile({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', path: 'a.py', text: 'x = 1\n',
  });
  await backtestBridge.createProjectFile({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', path: 'b.py', kind: 'file',
  });
  await backtestBridge.renameProjectFile({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', path: 'a.py', to: 'c.py',
  });
  assert.deepEqual(calls, [
    ['PUT', 'http://x/api/v1/projects/p1/file', { path: 'a.py', text: 'x = 1\n' }],
    ['POST', 'http://x/api/v1/projects/p1/file', { path: 'b.py', kind: 'file' }],
    ['POST', 'http://x/api/v1/projects/p1/rename', { path: 'a.py', to: 'c.py' }],
  ]);
});

test('프로젝트 라우트의 오류도 같은 봉투다 — 한국어 detail을 그대로 싣는다', async () => {
  const res = await backtestBridge.writeProjectFile({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 415, json: async () => ({ detail: '파이썬(.py) 파일만 저장할 수 있다' }),
    }),
    project_id: 'p1', path: 'a.txt', text: '',
  });
  assert.deepEqual(res, { ok: false, status: 415, error: '파이썬(.py) 파일만 저장할 수 있다' });
});

// ── 내 전략 등록부·가상환경(2026-09-02) ─────────────────────────────────────

test('내 전략 등록부: 목록·등록·해제의 메서드·경로·몸체가 계약 그대로다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await backtestBridge.fetchUserStrategies({ backendBase: 'http://x', fetchImpl });
  await backtestBridge.registerUserStrategy({
    backendBase: 'http://x', fetchImpl,
    project_id: 'p1', path: 'strategies/golden.py', name: 'golden',
  });
  await backtestBridge.unregisterUserStrategy({
    backendBase: 'http://x', fetchImpl, strategy_id: 'u 1',
  });
  assert.deepEqual(calls, [
    ['GET', 'http://x/api/v1/backtest/user-strategies', null],
    ['POST', 'http://x/api/v1/backtest/user-strategies',
      { project_id: 'p1', path: 'strategies/golden.py', name: 'golden' }],
    ['DELETE', 'http://x/api/v1/backtest/user-strategies/u%201', null],
  ]);
});

test('등록 실패(422)도 같은 봉투다 — 백엔드의 한국어 사유를 그대로 싣는다', async () => {
  const res = await backtestBridge.registerUserStrategy({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 422, json: async () => ({ detail: '파이썬 파일(.py)만 등록할 수 있다' }),
    }),
    project_id: 'p1', path: 'notes.txt', name: 'notes',
  });
  assert.deepEqual(res, { ok: false, status: 422, error: '파이썬 파일(.py)만 등록할 수 있다' });
});

test('가상환경: 조회는 GET, 만들기는 POST + packages 몸체다(project_id는 경로로 빠진다)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 202, json: async () => ({ job_id: 'j1' }) };
  };
  await backtestBridge.fetchProjectEnv({ backendBase: 'http://x', fetchImpl, project_id: 'p 1' });
  const made = await backtestBridge.createProjectEnv({
    backendBase: 'http://x', fetchImpl, project_id: 'p1', packages: ['scipy'],
  });
  assert.deepEqual(calls, [
    ['GET', 'http://x/api/v1/projects/p%201/env', null],
    ['POST', 'http://x/api/v1/projects/p1/env', { packages: ['scipy'] }],
  ]);
  assert.deepEqual(made, { ok: true, data: { job_id: 'j1' } });
});

test('가상환경 409(이미 도는 중)도 봉투를 지킨다 — 사유가 job_id를 품고 올라온다', async () => {
  const res = await backtestBridge.createProjectEnv({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: '이 프로젝트의 환경 구성이 아직 돌고 있다 (job_id=j1)' }),
    }),
    project_id: 'p1', packages: [],
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.error, /job_id=j1/);
});

test('흐름 지도: 폼이든 코드든 같은 라우트에 몸체를 그대로 보낸다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, JSON.parse(opts.body)]);
    return { ok: true, status: 200, json: async () => ({ version: 3, nodes: [] }) };
  };
  const form = await backtestBridge.fetchMap({
    backendBase: 'http://x', fetchImpl, yaml: 'version: "1.0"', run_id: 'r1', version: 3,
  });
  await backtestBridge.fetchMap({
    backendBase: 'http://x', fetchImpl, source: 'def signals(df, p):\n    return df\n',
  });
  assert.deepEqual(calls, [
    ['POST', 'http://x/api/v1/backtest/map', { yaml: 'version: "1.0"', run_id: 'r1', version: 3 }],
    ['POST', 'http://x/api/v1/backtest/map', { source: 'def signals(df, p):\n    return df\n' }],
  ]);
  assert.deepEqual(form, { ok: true, data: { version: 3, nodes: [] } });
});

// ── 출처에서 지도로(2026-09-07, Paper 보드 17) ──────────────────────────────

test('출처→지도 잡 3종: 시작은 202+job_id, 폴링·멈추기는 그 id로 간다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 202, json: async () => ({ job_id: 'sm-1' }) };
  };
  const started = await backtestBridge.startSourceMap({
    backendBase: 'http://x', fetchImpl, url: 'https://youtu.be/8kQz',
  });
  await backtestBridge.fetchSourceMap({ backendBase: 'http://x', fetchImpl, job_id: 'sm 1' });
  await backtestBridge.cancelSourceMap({ backendBase: 'http://x', fetchImpl, job_id: 'sm-1' });
  assert.deepEqual(calls, [
    ['POST', 'http://x/api/v1/backtest/source/map', { url: 'https://youtu.be/8kQz' }],
    // id는 경로에 들어가므로 인코딩된다 — 잡 id가 경로를 벗어나면 다른 잡을 읽는다.
    ['GET', 'http://x/api/v1/backtest/source/map/sm%201', null],
    ['DELETE', 'http://x/api/v1/backtest/source/map/sm-1', null],
  ]);
  assert.deepEqual(started, { ok: true, data: { job_id: 'sm-1' } });
});

test('출처→지도 잡: 읽지 못한 출처의 한국어 이유가 봉투에 그대로 남는다', async () => {
  const res = await backtestBridge.startSourceMap({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 422, json: async () => ({ detail: 'url은 비어 있지 않은 문자열이어야 한다' }),
    }),
    url: '  ',
  });
  assert.deepEqual(res, { ok: false, status: 422, error: 'url은 비어 있지 않은 문자열이어야 한다' });
});

// ── 시각 설계 ↔ 코드 왕복(2026-09-03) ───────────────────────────────────────

test('시각 라우트 6종: 메서드·경로·몸체가 계약 그대로다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await backtestBridge.fetchVisualRegistry({ backendBase: 'http://x', fetchImpl });
  await backtestBridge.validateVisual({ backendBase: 'http://x', fetchImpl, graph: { nodes: [] } });
  await backtestBridge.compileVisual({ backendBase: 'http://x', fetchImpl, graph: { nodes: [] } });
  await backtestBridge.visualQuestion({
    backendBase: 'http://x', fetchImpl, graph: { nodes: [] }, diagnostics: [{ code: 'BTG-PORT-002' }],
  });
  await backtestBridge.visualPatch({
    backendBase: 'http://x', fetchImpl, code: 'BTG-PORT-002', choice_id: 'connect-slow',
  });
  await backtestBridge.visualFromSpec({ backendBase: 'http://x', fetchImpl, yaml: 'version: "1.0"' });
  assert.deepEqual(calls, [
    ['GET', 'http://x/api/v1/backtest/visual/registry', null],
    ['POST', 'http://x/api/v1/backtest/visual/validate', { graph: { nodes: [] } }],
    ['POST', 'http://x/api/v1/backtest/visual/compile', { graph: { nodes: [] } }],
    ['POST', 'http://x/api/v1/backtest/visual/question',
      { graph: { nodes: [] }, diagnostics: [{ code: 'BTG-PORT-002' }] }],
    ['POST', 'http://x/api/v1/backtest/visual/patch', { code: 'BTG-PORT-002', choice_id: 'connect-slow' }],
    ['POST', 'http://x/api/v1/backtest/visual/from-spec', { yaml: 'version: "1.0"' }],
  ]);
});

// 저장 경로를 새로 만들지 않았다는 것 자체가 계약이다 — 사람 승인 receipt까지
// 포함한 몸체가 기존 버전 라우트로 그대로 간다(§"사용자 적용 이후 서버 처리").
test('saveVisualVersion: 기존 버전 라우트로 가고 strategy_id만 경로로 빠진다', async () => {
  let seen = null;
  const res = await backtestBridge.saveVisualVersion({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => {
      seen = [opts.method, url, JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ version_id: 'v4', is_active: false }) };
    },
    strategy_id: 's 1',
    origin: 'visual',
    yaml: 'version: "1.0"',
    source: 'import athena_bt as bt\n',
    graph: { nodes: [] },
    source_map: { entries: [] },
    hashes: { graph_hash: 'g1', artifact_hash: 'a1' },
    compiler_version: 'c1',
    apply_receipt: { patch_id: 'p1', base_version_id: 'v3' },
  });
  assert.deepEqual(seen, [
    'POST', 'http://x/api/v1/backtest/strategies/s%201/versions',
    {
      origin: 'visual',
      yaml: 'version: "1.0"',
      source: 'import athena_bt as bt\n',
      graph: { nodes: [] },
      source_map: { entries: [] },
      hashes: { graph_hash: 'g1', artifact_hash: 'a1' },
      compiler_version: 'c1',
      apply_receipt: { patch_id: 'p1', base_version_id: 'v3' },
    },
  ]);
  assert.deepEqual(res, { ok: true, data: { version_id: 'v4', is_active: false } });
});

test('시각 patch 409(다른 수정이 먼저 저장됨)도 봉투를 지킨다 — detail을 잃지 않는다', async () => {
  const res = await backtestBridge.visualPatch({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(409, {
      detail: { message: '다른 수정이 먼저 저장됐습니다', base_version_id: 'v3', head_version_id: 'v4' },
    }),
    patch_id: 'p1',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.error, '다른 수정이 먼저 저장됐습니다');
  assert.equal(res.detail.head_version_id, 'v4');
});

test('지도→코드 생성: 422(읽을 수 없는 yaml)도 봉투를 지킨다', async () => {
  const ok = await backtestBridge.fetchCodegen({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => {
      assert.equal(url, 'http://x/api/v1/backtest/codegen');
      assert.deepEqual(JSON.parse(opts.body), { yaml: 'version: "1.0"' });
      return { ok: true, status: 200, json: async () => ({ source: 'import athena_bt as bt\n', lines: 1 }) };
    },
    yaml: 'version: "1.0"',
  });
  assert.deepEqual(ok, { ok: true, data: { source: 'import athena_bt as bt\n', lines: 1 } });

  const bad = await backtestBridge.fetchCodegen({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 422, json: async () => ({ detail: 'yaml은 비어 있지 않은 문자열이어야 한다' }),
    }),
    yaml: '  ',
  });
  assert.deepEqual(bad, { ok: false, status: 422, error: 'yaml은 비어 있지 않은 문자열이어야 한다' });
});

// ── US-010 · 버전 되열기 ─────────────────────────────────────────────────────

test('버전 상세: GET .../versions/{version_id} 하나로 bundle까지 펼쳐 받는다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body || null]);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'v 2', version: 2, origin: 'visual', source: 'x', spec_yaml: 'y',
        graph: { nodes: [] }, source_map: { entries: [] }, hashes: { graph_hash: 'gh-2' },
        compiler_version: 'visual-1.0.0', is_active: false,
      }),
    };
  };
  const res = await backtestBridge.fetchVersionDetail({
    backendBase: 'http://x', fetchImpl, strategy_id: 's 1', version_id: 'v 2',
  });
  assert.deepEqual(calls, [
    ['GET', 'http://x/api/v1/backtest/strategies/s%201/versions/v%202', null],
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.data.origin, 'visual');
  assert.equal(res.data.hashes.graph_hash, 'gh-2');
  assert.equal(res.data.is_active, false);
});

test('버전 상세 404(그 전략에 속한 버전이 아니다)도 같은 봉투다', async () => {
  const res = await backtestBridge.fetchVersionDetail({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 404, json: async () => ({ detail: '그 전략에 속한 버전이 아니다' }),
    }),
    strategy_id: 's1', version_id: 'nope',
  });
  assert.deepEqual(res, { ok: false, status: 404, error: '그 전략에 속한 버전이 아니다' });
});

// ── 새 기법 만들기(보드 20·21, 2026-09-03) ──────────────────────────────────

test('기법 노드·검사 2종: 메서드·경로·몸체가 계약 그대로다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([opts.method, url, opts.body ? JSON.parse(opts.body) : null]);
    return { ok: true, status: 200, json: async () => ({ nodes: [], error: null }) };
  };
  const SRC = 'def signals(df, p):\n    return df\n';
  const nodes = await backtestBridge.fetchTechniqueNodes({
    backendBase: 'http://x', fetchImpl, source: SRC,
  });
  await backtestBridge.fetchTechniqueCheck({
    backendBase: 'http://x', fetchImpl, source: SRC, symbol: '005930', period: 'D',
    from: '20240101', to: '20240630',
  });
  assert.deepEqual(calls, [
    ['POST', 'http://x/api/v1/backtest/technique/nodes', { source: SRC }],
    ['POST', 'http://x/api/v1/backtest/technique/check', {
      source: SRC, symbol: '005930', period: 'D', from: '20240101', to: '20240630',
    }],
  ]);
  assert.deepEqual(nodes, { ok: true, data: { nodes: [], error: null } });
});

test('기법 검사 422(계약을 못 지킨 코드)도 같은 봉투다 — 한국어 사유를 그대로 싣는다', async () => {
  const res = await backtestBridge.fetchTechniqueCheck({
    backendBase: 'http://x',
    fetchImpl: async () => ({
      ok: false, status: 422,
      json: async () => ({ detail: 'signals(df, p)를 찾지 못했습니다' }),
    }),
    source: 'x = 1',
  });
  assert.deepEqual(res, { ok: false, status: 422, error: 'signals(df, p)를 찾지 못했습니다' });
});

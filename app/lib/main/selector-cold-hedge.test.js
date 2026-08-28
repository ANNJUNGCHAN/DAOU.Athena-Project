'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClassificationPrompt,
  createPairLimiter,
  createSelectorColdHedge,
  validateProposal,
} = require('./selector-cold-hedge');

const preflight = {
  status: 'needs_inference',
  catalog_version: 'catalog-v1',
  candidates: [
    {
      operation_ref: 'detail:ka10001:current_trading',
      kind: 'detail',
      detail_group: 'current_trading',
      argument_contracts: {
        required: ['stk_cd'],
        properties: { stk_cd: { type: 'string', pattern: '^\\d{6}$' } },
      },
    },
    {
      operation_ref: 'base:ka10002',
      kind: 'query',
      required_arguments: ['stk_cd'],
    },
  ],
};

function valid(ref = 'detail:ka10001:current_trading') {
  return JSON.stringify({
    intent: 'query',
    operation_ref: ref,
    detail_group: ref.startsWith('detail:') ? 'current_trading' : null,
    arguments: { stk_cd: '005930' },
  });
}

function classificationResult(text) {
  return { ok: true, finalResult: { result: text } };
}

test('two classifiers start in parallel; first valid wins, aborts loser, and dispatches once', async () => {
  const run = createSelectorColdHedge({ limiter: createPairLimiter(4) });
  const started = [];
  let loserAborted = false;
  let dispatches = 0;
  let releaseWinner;
  const pending = run({
    question: '삼성전자 현재 거래 정보',
    preflight,
    classify: ({ index, signal }) => {
      started.push(index);
      if (index === 0) {
        return new Promise((resolve) => { releaseWinner = () => resolve(classificationResult(valid())); });
      }
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          loserAborted = true;
          resolve({ ok: false, aborted: true });
        }, { once: true });
      });
    },
    dispatchProposal: async (proposal) => {
      dispatches += 1;
      assert.equal(proposal.operation_ref, 'detail:ka10001:current_trading');
      return { handled: true, ok: true };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), [0, 1]);
  releaseWinner();
  const result = await pending;
  assert.equal(result.handled, true);
  assert.equal(result.source, 'selector-cold');
  assert.equal(result.modelCalls, 2);
  assert.equal(dispatches, 1);
  assert.equal(loserAborted, true);
});

test('malformed JSON and candidate mismatch fall through without backend dispatch', async () => {
  const run = createSelectorColdHedge({ limiter: createPairLimiter(4) });
  let dispatches = 0;
  const outputs = [
    classificationResult('```json\n{}\n```'),
    classificationResult(JSON.stringify({ intent: 'query', operation_ref: 'base:unknown', arguments: {} })),
  ];
  const result = await run({
    question: '모호한 질문',
    preflight,
    classify: ({ index }) => outputs[index],
    dispatchProposal: async () => { dispatches += 1; },
  });
  assert.deepEqual(result, { handled: false, reason: 'classification_failed', modelCalls: 2 });
  assert.equal(dispatches, 0);
});

test('proposal contract rejects missing required args, extra args, and plan tokens', () => {
  assert.throws(() => validateProposal(JSON.stringify({
    intent: 'query', operation_ref: 'detail:ka10001:current_trading', arguments: {},
  }), preflight), /required_argument_missing/);
  assert.throws(() => validateProposal(JSON.stringify({
    intent: 'query', operation_ref: 'detail:ka10001:current_trading',
    arguments: { stk_cd: '005930', surprise: 'x' },
  }), preflight), /argument_contract_mismatch/);
  assert.throws(() => validateProposal(JSON.stringify({
    intent: 'query', operation_ref: 'base:ka10002', arguments: { stk_cd: '005930' }, plan_token: 'forbidden',
  }), preflight), /plan_token_forbidden/);
});

test('backend compact alias/json_schema argument contract is validated', () => {
  const backendPreflight = {
    status: 'needs_inference',
    candidates: [{
      operation_ref: 'base:ka10001',
      kind: 'query',
      name: '주식기본정보요청',
      required_arguments: [{
        alias: 'stk_cd',
        description: '종목코드',
        json_schema: { type: 'string', pattern: '^\\d{6}$' },
      }],
    }],
  };
  const proposal = validateProposal(JSON.stringify({
    intent: 'query', operation_ref: 'base:ka10001', arguments: { stk_cd: '005930' },
  }), backendPreflight);
  assert.deepEqual(proposal.arguments, { stk_cd: '005930' });
  assert.throws(() => validateProposal(JSON.stringify({
    intent: 'query', operation_ref: 'base:ka10001', arguments: { stk_cd: '삼성전자' },
  }), backendPreflight), /argument_contract_mismatch/);
});

test('global limiter admits at most two parallel hedges (four classifiers)', async () => {
  const limiter = createPairLimiter(4);
  const release1 = await limiter.acquire(2);
  const release2 = await limiter.acquire(2);
  assert.equal(limiter.active(), 4);
  let thirdStarted = false;
  const third = limiter.acquire(2).then((release) => {
    thirdStarted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(thirdStarted, false);
  release1();
  const release3 = await third;
  assert.equal(thirdStarted, true);
  assert.equal(limiter.active(), 4);
  release2();
  release3();
  assert.equal(limiter.active(), 0);
});

test('parent cancellation aborts both classifiers and prevents dispatch', async () => {
  const run = createSelectorColdHedge({ limiter: createPairLimiter(4) });
  const controller = new AbortController();
  let aborts = 0;
  let dispatches = 0;
  const pending = run({
    question: '취소할 질문',
    preflight,
    signal: controller.signal,
    classify: ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        aborts += 1;
        resolve({ ok: false, aborted: true });
      }, { once: true });
    }),
    dispatchProposal: async () => { dispatches += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('사용자 취소'));
  await assert.rejects(pending, /사용자 취소/);
  assert.equal(aborts, 2);
  assert.equal(dispatches, 0);
});

test('abort racing with queued slot admission releases the pair before classifiers start', async () => {
  const limiter = createPairLimiter(2);
  const releaseBlocker = await limiter.acquire(2);
  const run = createSelectorColdHedge({ limiter });
  const controller = new AbortController();
  let classifiers = 0;
  let dispatches = 0;
  const pending = run({
    question: '슬롯 대기 중 취소할 질문',
    preflight,
    signal: controller.signal,
    classify: () => {
      classifiers += 1;
      return classificationResult(valid());
    },
    dispatchProposal: async () => { dispatches += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseBlocker();
  controller.abort(new Error('슬롯 승인과 동시에 취소'));
  await assert.rejects(pending, /슬롯 승인과 동시에 취소/);
  assert.equal(classifiers, 0);
  assert.equal(dispatches, 0);
  assert.equal(limiter.active(), 0);
});

test('prompt exposes only bounded candidates and demands strict side-effect-free JSON', () => {
  const prompt = buildClassificationPrompt('삼성전자 알려줘', preflight);
  assert.match(prompt, /Do not call tools/);
  assert.match(prompt, /exactly one JSON object/);
  assert.match(prompt, /detail:ka10001:current_trading/);
  assert.doesNotMatch(prompt, /plan_token/);
});

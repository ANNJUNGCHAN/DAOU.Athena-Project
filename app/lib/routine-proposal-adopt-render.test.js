'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const start = source.indexOf('function adoptSeedText(');
const end = source.indexOf("window.athena.on('athena:routine-proposed'", start);
assert.ok(start >= 0 && end > start);

test('제안 채택은 입력창을 덮지 않고 완결형 루틴 요청을 바로 제출한다', async () => {
  const events = [];
  const scope = {
    document: {
      createElement: (tag) => ({
        tag, className: '', textContent: '', children: [], listeners: {}, disabled: false,
        appendChild(child) { this.children.push(child); return child; },
        addEventListener(kind, handler) { this.listeners[kind] = handler; },
      }),
      dispatchEvent: (event) => { events.push(event); return true; },
    },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    window: {
      dispatchEvent() {},
      athena: { invoke: async () => ({ ok: true }) },
      AthenaNotify: null,
      AthenaAgentCanvas: null,
    },
    controlTurnLib: {},
    proposalTurnLib: {},
    unreadAlertCount: () => 0,
    openAgentCanvas() {},
    _btn: (label, className) => ({
      textContent: label, className, children: [], listeners: {}, disabled: false,
      addEventListener(kind, handler) { this.listeners[kind] = handler; },
    }),
    _mountTurn() {},
    appendSystemLine() {},
    state: 'idle',
    remoteQueryBusy: false,
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);

  await scope.acceptProposal({ control: 'adopt', subject: '외국인 순매수 3일 연속' });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'athena:chat-submit');
  assert.equal(
    events[0].detail.text,
    '"외국인 순매수 3일 연속" 감시 루틴을 확인 주기와 쿨다운까지 알아서 정해 완성된 초안으로 만들고 자동 검사해줘. 승인은 하지 마.',
  );
  assert.equal('AthenaShell' in scope.window, false, 'composer 입력 버스를 사용하지 않는다');
});

test('답변 중 제안 채택은 칩을 잠그지 않아 끝난 뒤 다시 누를 수 있다', async () => {
  const events = [];
  const notices = [];
  const mounted = [];
  const element = (tag) => ({
    tag, className: '', textContent: '', children: [], listeners: {}, disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(kind, handler) { this.listeners[kind] = handler; },
  });
  const scope = {
    document: { createElement: element, dispatchEvent: (event) => { events.push(event); return true; } },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    window: { dispatchEvent() {}, athena: { invoke: async () => ({ ok: true }) }, AthenaNotify: null },
    controlTurnLib: {},
    proposalTurnLib: { DECLINE_STATUS: '보류' },
    unreadAlertCount: () => 0,
    openAgentCanvas() {},
    _btn: (label, className) => Object.assign(element('button'), { textContent: label, className }),
    _mountTurn: (line, card) => { line.appendChild(card); mounted.push(line); },
    appendSystemLine: (text) => notices.push(text),
    state: 'busy',
    remoteQueryBusy: false,
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  scope.renderControlProposalTurn({
    control: 'adopt', subject: '배당주 뉴스', badge: '제안 채택', statusPill: '제안',
    lead: '배당주 뉴스 감시', rationale: '', status: [],
    chips: [{ label: '루틴으로', role: 'accept' }, { label: '보류', role: 'decline' }],
  });
  const buttons = mounted[0].children[0].children.at(-1).children;
  buttons[0].listeners.click();
  assert.deepEqual(notices, ['답변 중']);
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, false);
  assert.equal(events.length, 0);

  scope.state = 'idle';
  scope.remoteQueryBusy = true;
  buttons[0].listeners.click();
  assert.deepEqual(notices, ['답변 중', '답변 중']);
  assert.equal(buttons[0].disabled, false);
  assert.equal(events.length, 0);

  scope.remoteQueryBusy = false;
  buttons[0].listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(buttons.every((button) => button.disabled), true);
});

test('제어 응답을 기다리는 동안 대화를 바꿔도 결과 봉투는 원래 대화 id를 유지한다', async () => {
  const events = [];
  let resolveUpdate;
  const scope = {
    document: { dispatchEvent() {} },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    window: {
      dispatchEvent: (event) => events.push(event),
      athena: {
        invoke: () => new Promise((resolve) => { resolveUpdate = resolve; }),
      },
      AthenaNotify: null,
    },
    controlTurnLib: {
      controlFactLine: () => '현재 값',
      buildControlResultTurn: (model) => ({ ...model, tone: 'ok', statusBadge: '완료', chips: [] }),
    },
    proposalTurnLib: { updateAppliedLead: () => '바뀜' },
    unreadAlertCount: () => 0,
    openAgentCanvas() {},
    _btn() {},
    _mountTurn() {},
    appendSystemLine() {},
    state: 'idle',
    remoteQueryBusy: false,
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);

  const pending = scope.acceptProposal({
    control: 'update', routineId: 'routine-a', badge: '작업 설정', current: {}, proposed: {},
  }, 'conversation-a');
  resolveUpdate({ ok: true });
  await pending;

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'athena:routine-control-result');
  assert.equal(events[0].detail.conversationId, 'conversation-a');
});

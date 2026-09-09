'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createTechniqueCreateDialog,
  projectList,
  techniqueNameError,
} = require('./technique-create-dialog');

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    value: '',
    type: '',
    hidden: false,
    disabled: false,
    selected: false,
    children: [],
    attrs: {},
    _listeners: {},
    parentNode: null,
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      child.parentNode = null;
      return child;
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((handler) => handler(event)));
    },
    focus() { this.focused = true; },
  };
}

function fakeDocument() {
  return { body: fakeNode('body'), createElement: (tag) => fakeNode(tag) };
}

function findByClass(root, className) {
  const out = [];
  const walk = (node) => {
    if (String(node.className || '').split(/\s+/).includes(className)) out.push(node);
    (node.children || []).forEach(walk);
  };
  walk(root);
  return out;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('기법 이름은 실제 폴더로 만들 수 있는 수동 이름만 받는다', () => {
  assert.equal(techniqueNameError('거래량 돌파'), '');
  assert.equal(techniqueNameError('  '), '기법 이름을 입력하세요');
  assert.match(techniqueNameError('../밖'), /쓸 수 없는 문자/);
  assert.match(techniqueNameError('끝.'), /이름 끝/);
});

test('프로젝트 목록은 실제 존재하고 id가 있는 항목만 남긴다', () => {
  assert.deepEqual(projectList({ projects: [
    { id: 'p1', name: '현재' },
    { id: 'gone', exists: false },
    { name: 'id 없음' },
  ] }), [{ id: 'p1', name: '현재' }]);
});

test('셸은 대화상자 스타일과 스크립트를 백테스트 캔버스보다 먼저 읽는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  assert.match(html, /lib\/technique-create-dialog\.css/);
  assert.ok(
    html.indexOf('<script src="lib/technique-create-dialog.js"></script>')
      < html.indexOf('<script src="lib/backtest-canvas.js"></script>'),
    'backtest-canvas가 대화상자 모듈을 읽을 수 있어야 한다',
  );
});

test('취소하면 폴더 생성과 새 대화를 전혀 호출하지 않는다', async () => {
  const doc = fakeDocument();
  let created = 0;
  let registrations = 0;
  let conversations = 0;
  const pending = createTechniqueCreateDialog({
    document: doc,
    listProjects: async () => [{ id: 'p1', name: '프로젝트' }],
    createTechnique: async () => { created += 1; },
    registerUserStrategy: async () => { registrations += 1; return { id: 'us1' }; },
    startTechniqueConversation: async () => { conversations += 1; },
  });
  await flush();
  await findByClass(doc.body, 'technique-create-cancel')[0].dispatchEvent({ type: 'click' });
  assert.equal(await pending, null);
  assert.equal(created, 0);
  assert.equal(registrations, 0);
  assert.equal(conversations, 0);
  assert.equal(doc.body.children.length, 0);
});

test('선택한 프로젝트·상위 폴더·이름으로 만든 뒤 새 대화를 기다리고 결과를 돌려준다', async () => {
  const doc = fakeDocument();
  const calls = [];
  const response = {
    project_id: 'p2',
    technique: {
      name: '거래량 돌파',
      path: 'alpha/거래량 돌파',
      strategy_path: 'alpha/거래량 돌파/strategy.py',
      test_path: 'alpha/거래량 돌파/test_strategy.py',
    },
    env: { status: 'ready', scope: 'project' },
  };
  const pending = createTechniqueCreateDialog({
    document: doc,
    preferredProjectId: 'p2',
    listProjects: async () => [
      { id: 'p1', name: '첫째' },
      { id: 'p2', name: '현재 프로젝트' },
    ],
    pickTechniqueFolder: async (id) => {
      calls.push(['pick', id]);
      return { parent: 'alpha', path: 'C:/project/alpha' };
    },
    createTechnique: async (id, body) => {
      calls.push(['create', id, body]);
      return response;
    },
    registerUserStrategy: async (body) => {
      calls.push(['register', body]);
      return { id: 'us1', name: body.name, project_id: body.project_id, path: body.path };
    },
    startTechniqueConversation: async (id) => {
      calls.push(['conversation', id]);
      return 'conversation-1';
    },
  });
  await flush();
  const select = findByClass(doc.body, 'technique-create-select')[0];
  assert.equal(select.value, 'p2');
  await findByClass(doc.body, 'technique-create-folder-button')[0]
    .dispatchEvent({ type: 'click' });
  const name = findByClass(doc.body, 'technique-create-input')[1];
  name.value = '거래량 돌파';
  await name.dispatchEvent({ type: 'input' });
  await findByClass(doc.body, 'technique-create-submit')[0].dispatchEvent({ type: 'click' });

  assert.deepEqual(await pending, Object.assign({}, response, {
    registration: {
      id: 'us1', name: '거래량 돌파', project_id: 'p2',
      path: 'alpha/거래량 돌파/strategy.py',
    },
    conversation: 'conversation-1',
  }));
  assert.deepEqual(calls, [
    ['pick', 'p2'],
    ['create', 'p2', { parent: 'alpha', name: '거래량 돌파' }],
    ['register', {
      project_id: 'p2', path: 'alpha/거래량 돌파/strategy.py', name: '거래량 돌파',
    }],
    ['conversation', 'p2'],
  ]);
});

test('목록 등록만 실패하면 만든 폴더를 유지하고 등록 단계부터 재시도한다', async () => {
  const doc = fakeDocument();
  let creates = 0;
  let registrations = 0;
  const pending = createTechniqueCreateDialog({
    document: doc,
    listProjects: async () => [{ id: 'p1', name: '프로젝트' }],
    createTechnique: async () => {
      creates += 1;
      return {
        project_id: 'p1',
        technique: {
          name: '기법', path: '기법', strategy_path: '기법/strategy.py',
          test_path: '기법/tests/test_strategy.py',
        },
      };
    },
    registerUserStrategy: async (body) => {
      registrations += 1;
      if (registrations === 1) throw new Error('목록 등록 실패');
      return { id: 'us1', ...body };
    },
    startTechniqueConversation: async () => 'conversation-1',
  });
  await flush();
  findByClass(doc.body, 'technique-create-input')[1].value = '기법';
  const submit = findByClass(doc.body, 'technique-create-submit')[0];
  await submit.dispatchEvent({ type: 'click' });
  assert.equal(creates, 1);
  assert.equal(registrations, 1);
  assert.equal(submit.textContent, '목록 등록 다시 시도');
  assert.match(findByClass(doc.body, 'technique-create-error')[0].textContent, /목록 등록 실패/);

  await submit.dispatchEvent({ type: 'click' });
  assert.equal((await pending).registration.id, 'us1');
  assert.equal(creates, 1);
  assert.equal(registrations, 2);
});

test('새 대화만 실패하면 같은 폴더를 다시 만들지 않고 대화 연결만 재시도한다', async () => {
  const doc = fakeDocument();
  let creates = 0;
  let conversations = 0;
  let createBody = null;
  const pending = createTechniqueCreateDialog({
    document: doc,
    listProjects: async () => [{ id: 'p1', name: '프로젝트' }],
    createTechnique: async (_id, body) => {
      creates += 1;
      createBody = body;
      return {
        project_id: 'p1',
        technique: {
          name: '기법', path: '기법', strategy_path: '기법/strategy.py',
          test_path: '기법/test_strategy.py',
        },
      };
    },
    registerUserStrategy: async (body) => ({ id: 'us1', ...body }),
    startTechniqueConversation: async () => {
      conversations += 1;
      if (conversations === 1) throw new Error('대화 전환 실패');
      return 'conversation-2';
    },
  });
  await flush();
  const name = findByClass(doc.body, 'technique-create-input')[1];
  name.value = '기법';
  const submit = findByClass(doc.body, 'technique-create-submit')[0];
  await submit.dispatchEvent({ type: 'click' });
  assert.equal(creates, 1);
  assert.deepEqual(createBody, { parent: '.', name: '기법' }, '기본 위치는 프로젝트 루트로 보낸다');
  assert.equal(conversations, 1);
  assert.equal(submit.textContent, '대화 다시 연결');
  assert.match(findByClass(doc.body, 'technique-create-error')[0].textContent, /대화 전환 실패/);
  await submit.dispatchEvent({ type: 'click' });
  assert.equal((await pending).conversation, 'conversation-2');
  assert.equal(creates, 1);
  assert.equal(conversations, 2);
});

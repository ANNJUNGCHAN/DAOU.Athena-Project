'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf('{', start);
  assert.ok(open > start, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function loadProductionCardCallback(activeConversationId) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const callbacksStart = source.indexOf('  const turnCallbacks = {');
  const callbacksEnd = source.indexOf('  // 상주 세션', callbacksStart);
  assert.ok(callbacksStart >= 0 && callbacksEnd > callbacksStart, 'main live-turn callbacks must remain executable');

  const calls = { reveal: [], shell: [], saved: [] };
  const bridge = {
    flush() {},
    load: () => ({ canvasCards: [] }),
    saveCards: (payload) => calls.saved.push(payload),
  };
  const shellWin = {
    isDestroyed: () => false,
    webContents: { send: (...args) => calls.shell.push(args) },
  };
  const context = vm.createContext({
    calls,
    crypto,
    Map,
    shellWin,
    ensureSessionRecord: () => bridge,
    historyConversationId: () => activeConversationId,
    revealShell: (options) => calls.reveal.push(options),
    orbWin: null,
  });
  vm.runInContext([
    'const backgroundCanvasCards = new Map();',
    functionSource(source, 'function persistBackgroundCanvasCard('),
    functionSource(source, 'function sendLiveCanvasResult('),
    'function exerciseCard(result, turnConversationId, expand = true, origin = "shell") {',
    '  let expandTriggered = false;',
    '  const canvasTypesSeen = [];',
    '  const canvasCaptionsSeen = [];',
    source.slice(callbacksStart, callbacksEnd),
    '  turnCallbacks.onCanvasResult(result);',
    '  return { expandTriggered, canvasTypesSeen, canvasCaptionsSeen };',
    '}',
  ].join('\n'), context);
  return { calls, exerciseCard: context.exerciseCard };
}

const CARD_RESULT = {
  status: 'success',
  envelope: { canvas_type: 'quote', card_title: '삼성전자 현재가' },
};

test('background live card stays hidden and is persisted for replay', () => {
  const { calls, exerciseCard } = loadProductionCardCallback('conversation-active');

  const outcome = exerciseCard(CARD_RESULT, 'conversation-background');

  assert.equal(outcome.expandTriggered, false);
  assert.equal(calls.reveal.length, 0);
  assert.equal(calls.shell.some(([channel]) => channel === 'athena:add-canvas-live'), false);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].sessionId, 'conversation-background');
  assert.equal(calls.saved[0].cards.length, 1);
  assert.equal(calls.saved[0].cards[0].channel, 'live');
  assert.equal(calls.saved[0].cards[0].envelope.canvas_type, 'quote');
});

test('active live card reveals the shell once and paints the active canvas', () => {
  const { calls, exerciseCard } = loadProductionCardCallback('conversation-active');

  const outcome = exerciseCard(CARD_RESULT, 'conversation-active');

  assert.equal(outcome.expandTriggered, true);
  assert.equal(calls.reveal.length, 1);
  assert.equal(calls.reveal[0].focus, false);
  assert.equal(calls.shell.filter(([channel]) => channel === 'athena:add-canvas-live').length, 1);
  assert.equal(calls.saved.length, 0);
});

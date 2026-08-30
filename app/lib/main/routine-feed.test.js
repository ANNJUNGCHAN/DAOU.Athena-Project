'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoutineFeed } = require('./routine-feed');

class FakeWs {
  constructor(url) {
    FakeWs.instances.push(this);
    this.url = url;
    this.sent = [];
  }
  send(data) { this.sent.push(data); }
  close() { if (this.onclose) this.onclose(); }
}
FakeWs.instances = [];

function makeFeed(over = {}) {
  const events = [];
  const timers = [];
  const feed = new RoutineFeed({
    url: 'ws://127.0.0.1:8010/api/v1/ws/routines',
    readyFeed: 'routines',
    WebSocketImpl: FakeWs,
    onEvent: (e) => events.push(e),
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
    ...over,
  });
  return { feed, events, timers };
}

test('토큰 설정 시 첫 메시지로 auth envelope를 보낸다', () => {
  FakeWs.instances = [];
  const { feed } = makeFeed({ token: 'sekrit' });
  feed.start();
  const ws = FakeWs.instances[0];
  ws.onopen();
  assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'auth', token: 'sekrit' });
  feed.stop();
});

test('토큰 미설정이면 아무것도 보내지 않는다(루프백 모드)', () => {
  FakeWs.instances = [];
  const { feed } = makeFeed();
  feed.start();
  const ws = FakeWs.instances[0];
  ws.onopen();
  assert.equal(ws.sent.length, 0);
  feed.stop();
});

test('이벤트 JSON을 파싱해 전달하고, 깨진 프레임은 버린다', () => {
  FakeWs.instances = [];
  const { feed, events } = makeFeed();
  feed.start();
  const ws = FakeWs.instances[0];
  ws.onopen();
  ws.onmessage({ data: JSON.stringify({ type: 'feed-ready', feed: 'routines' }) });
  ws.onmessage({ data: JSON.stringify({ type: 'routine-fired', symbol: '005930' }) });
  ws.onmessage({ data: '{broken' });
  assert.equal(events.length, 1);
  assert.equal(events[0].symbol, '005930');
  feed.stop();
});

test('재연결 백오프 — 1s→2s→4s, 상한 준수, open 시 리셋', () => {
  FakeWs.instances = [];
  const { feed, timers } = makeFeed({ baseDelayMs: 1000, maxDelayMs: 4000 });
  feed.start();
  FakeWs.instances[0].onclose();
  assert.equal(timers[0].ms, 1000);
  timers[0].fn(); // 재연결 → 실패
  FakeWs.instances[1].onclose();
  assert.equal(timers[1].ms, 2000);
  timers[1].fn();
  FakeWs.instances[2].onclose();
  assert.equal(timers[2].ms, 4000);
  timers[2].fn();
  FakeWs.instances[3].onopen();
  FakeWs.instances[3].onmessage({ data: JSON.stringify({ type: 'feed-ready', feed: 'routines' }) }); // 성공 — 리셋
  FakeWs.instances[3].onclose();
  assert.equal(timers.at(-1).ms, 1000);
  feed.stop();
});

test('stop 이후에는 재연결하지 않는다', () => {
  FakeWs.instances = [];
  const { feed, timers } = makeFeed();
  feed.start();
  feed.stop();
  const before = timers.length;
  // stop이 close를 불렀고 onclose가 재연결을 잡으면 안 된다
  assert.equal(timers.length, before);
});

test('생성자 연결 예외도 disconnected/retrying 상태로 관측되고 재시도한다', () => {
  const statuses = [];
  const timers = [];
  class ThrowingWs { constructor() { throw new Error('connect refused'); } }
  const feed = new RoutineFeed({
    url: 'ws://127.0.0.1:8010/api/v1/ws/routines',
    WebSocketImpl: ThrowingWs,
    onEvent: () => {},
    onStatus: (status) => statuses.push(status),
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
  });
  feed.start();
  assert.deepEqual(statuses.map((status) => status.state), ['connecting', 'disconnected', 'retrying']);
  assert.equal(statuses[2].retryInMs, 1000);
  assert.match(statuses[1].detail, /connect refused/);
  feed.stop();
});

test('raw open은 connected가 아니며 matching feed-ready 뒤에만 연결 완료된다', () => {
  FakeWs.instances = [];
  const statuses = [];
  const { feed, events } = makeFeed({ onStatus: (status) => statuses.push(status) });
  feed.start();
  const ws = FakeWs.instances[0];
  ws.onopen();
  assert.deepEqual(statuses.map((status) => status.state), ['connecting', 'authenticating']);
  ws.onmessage({ data: JSON.stringify({ type: 'routine-fired', symbol: 'before-ready' }) });
  ws.onmessage({ data: JSON.stringify({ type: 'feed-ready', feed: 'canvas' }) });
  assert.equal(events.length, 0);
  assert.equal(statuses.some((status) => status.state === 'connected'), false);
  ws.onmessage({ data: JSON.stringify({ type: 'feed-ready', feed: 'routines' }) });
  assert.equal(statuses.at(-1).state, 'connected');
  assert.equal(events.length, 0, 'feed-ready 제어 프레임은 onEvent로 전달하지 않는다');
  feed.stop();
});

test('feed-ready handshake timeout은 소켓을 닫고 bounded reconnect를 예약한다', () => {
  FakeWs.instances = [];
  const statuses = [];
  const { feed, timers } = makeFeed({
    handshakeTimeoutMs: 250,
    onStatus: (status) => statuses.push(status),
  });
  feed.start();
  FakeWs.instances[0].onopen();
  assert.equal(timers[0].ms, 250);
  timers[0].fn();
  assert.deepEqual(statuses.map((status) => status.state), [
    'connecting', 'authenticating', 'disconnected', 'retrying',
  ]);
  assert.match(statuses[2].detail, /handshake timeout/);
  assert.equal(timers[1].ms, 1000);
  feed.stop();
});

test('각 socket callback은 생성 당시 connection epoch를 보존한다', () => {
  FakeWs.instances = [];
  const events = [];
  const timers = [];
  const feed = new RoutineFeed({
    url: 'ws://x',
    WebSocketImpl: FakeWs,
    onEvent: (event, meta) => events.push({ event, meta }),
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
  });
  feed.start();
  const oldSocket = FakeWs.instances[0];
  oldSocket.onopen();
  oldSocket.onclose();
  timers[0].fn();
  const newSocket = FakeWs.instances[1];
  newSocket.onopen();
  oldSocket.onmessage({ data: JSON.stringify({ from: 'old' }) });
  newSocket.onmessage({ data: JSON.stringify({ from: 'new' }) });
  assert.deepEqual(events.map((item) => item.meta.connectionEpoch), [1, 2]);
  feed.stop();
});

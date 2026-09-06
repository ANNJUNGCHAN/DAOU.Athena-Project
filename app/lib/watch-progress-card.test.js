// 자동 검사 진행 패널(Paper 보드 09 · 43WD-1 › 458M-1) 단위 테스트.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProgress, SANDBOX_NOTICE, MARK_DONE, MARK_RUNNING, MARK_PENDING,
} = require('./watch-progress-card');

const CHECK = {
  ok: true,
  symbol: '005930',
  lookback_days: 30,
  duration_ms: 12400,
  nodes: [
    { fn: 'load', title_ko: '일봉 불러오기' },
    { fn: 'avg', title_ko: '3일 거래량 평균' },
    { fn: 'cmp', title_ko: '배수 비교' },
    { fn: 'alert', title_ko: '알림' },
  ],
};

test('진행 5줄의 마크는 ✓ ◐ ○ 세 종류뿐이다', () => {
  const done = buildProgress(CHECK);
  assert.equal(done.lines.length, 5);
  const running = buildProgress({ pending: true, symbol: '005930', lookback_days: 30 });
  const marks = done.lines.concat(running.lines).map((l) => l.mark);
  for (const mark of marks) {
    assert.ok([MARK_DONE, MARK_RUNNING, MARK_PENDING].includes(mark), `모르는 마크: ${mark}`);
  }
  // 끝난 검사는 앞 넷이 ✓이고 오늘 값 1회만 아직이다.
  assert.deepEqual(done.lines.map((l) => l.mark), ['✓', '✓', '✓', '✓', '○']);
  // 도는 중에는 지금 도는 줄이 ◐다.
  assert.equal(running.lines[1].mark, '◐');
  assert.match(running.lines[2].text, /돌려 보는 중/);
});

test('격리 실행 고지는 상수라 백엔드 응답 없이도 나온다', () => {
  assert.equal(buildProgress({}).notice, '격리 실행 · 계좌·주문 접근 없음 · 30초 제한');
  assert.equal(buildProgress(null).notice, SANDBOX_NOTICE);
  assert.equal(buildProgress(CHECK).notice, SANDBOX_NOTICE);
  // 머리 두 조각도 Paper 원문 그대로다.
  assert.equal(buildProgress({}).headLeft, '자동 검사');
  assert.equal(buildProgress({}).headRight, '코드가 바뀔 때마다');
});

test('입력 확인 줄은 실값이 없으면 그리지 않는다 — 지어내지 않는다', () => {
  const bare = buildProgress({ ok: true });
  assert.equal(bare.lines.length, 3);
  assert.doesNotMatch(bare.lines.map((l) => l.text).join(' '), /입력 확인|함수/);
  // 종목만 있고 기간을 모르면 여전히 안 그린다.
  assert.equal(buildProgress({ ok: true, symbol: '005930' }).lines.length, 3);
  // 노드가 있으면 개수와 이름이 원장 그대로 온다.
  const full = buildProgress(CHECK);
  assert.equal(full.lines[0].text, '입력 확인 — 005930 · 최근 30일 일봉');
  assert.equal(
    full.lines[1].text,
    '함수 4개 만듦 — 일봉 불러오기 · 3일 거래량 평균 · 배수 비교 · 알림',
  );
});

test('걸린 시간은 한국어 단위로 적고 없으면 적지 않는다', () => {
  assert.equal(buildProgress(CHECK).lines[3].text, '검사 2/3 — 지난 30일 돌려 봄 · 12.4초');
  const noTime = buildProgress({ ok: true, symbol: '005930', lookback_days: 30 });
  assert.equal(noTime.lines[2].text, '검사 2/3 — 지난 30일 돌려 봄');
});

test('코드가 못 돌면 검사 1/3부터 아직으로 남는다 — 통과한 척하지 않는다', () => {
  const failed = buildProgress({
    ok: false, symbol: '005930', lookback_days: 30,
    error: { type: 'SyntaxError', message: 'bad' },
  });
  assert.equal(failed.lines[1].mark, MARK_PENDING);
  assert.equal(failed.lines[2].mark, MARK_PENDING);
  assert.equal(failed.lines[3].mark, MARK_PENDING);
});

test('실패에 error가 없어도 검사 1/3은 아직이다 — 완성 일봉 없음·통로 막힘', () => {
  // run_check는 완성된 일봉이 없으면 reason만 채우고 error를 남기지 않는다.
  const noBars = buildProgress({ ok: false, reason: '완성된 일봉 없음', symbol: '005930', lookback_days: 30 });
  assert.equal(noBars.lines[1].mark, MARK_PENDING);
  assert.equal(noBars.lines[2].mark, MARK_PENDING);
  // 검사 통로가 막힌 폴백도 error가 없다.
  const blocked = buildProgress({ ok: false, reason: '검사 통로가 막혀 있음' });
  assert.equal(blocked.lines[0].mark, MARK_PENDING);
  assert.match(blocked.lines[0].text, /검사 1\/3/);
});

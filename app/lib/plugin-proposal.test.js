// plugin-proposal.js 단위 테스트 — 순수 함수라 DOM 스텁이 필요 없다.
//
// 이 파일이 지키는 계약:
//   · 모델 경로와 GUI 경로가 **같은 함수**로 같은 모양의 제안을 만든다
//   · 출처(source)가 필수이고 카드 라벨이 두 값에서 다르다
//   · 백엔드가 기록한 픽스처를 앱 검증기가 그대로 통과시킨다(교차 언어 계약)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ACTIONS, buildProposal, buildBatchProposal, validateProposal, isProposalStale,
  cardCopy, resultTurnCopy, outOfModeCopy, proposalSignature,
} = require('./plugin-proposal');

const INSTALL = { action: 'install', target: 'fetch', features: ['fetch — 지정한 URL의 본문'] };

test('액션은 6종으로 고정한다', () => {
  assert.deepEqual([...ACTIONS], ['install', 'allow_tools', 'revoke_tools', 'set_enabled', 'remove', 'stage_snippet']);
});

// --- A3⑴ 두 입구, 한 빌더 ------------------------------------------------------

test('모델 입력과 GUI 입력이 같은 스키마의 제안을 낸다(출처 값만 다르다)', () => {
  const fromModel = buildProposal(INSTALL, '웹 문서를 읽으려면 필요합니다', 7, 'model');
  const fromGui = buildProposal(INSTALL, '', 7, 'gui');

  assert.deepEqual(Object.keys(fromModel).sort(), Object.keys(fromGui).sort());
  assert.deepEqual(Object.keys(fromModel.actions[0]).sort(), Object.keys(fromGui.actions[0]).sort());
  assert.deepEqual(fromModel.actions, fromGui.actions);
  assert.equal(fromModel.source, 'model');
  assert.equal(fromGui.source, 'gui');
  assert.equal(validateProposal(fromModel).ok, true);
  assert.equal(validateProposal(fromGui).ok, true);
});

test('buildProposal: revision을 안 넘기면 null을 싣는다(키는 항상 있다)', () => {
  const envelope = buildProposal(INSTALL, '이유', undefined, 'gui');
  assert.equal(envelope.revision, null);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, 'revision'), true);
  assert.equal(validateProposal(envelope).ok, true);
});

test('buildProposal: proposal_id는 제안마다 다르다', () => {
  const a = buildProposal(INSTALL, '이유', 1, 'gui');
  const b = buildProposal(INSTALL, '이유', 1, 'gui');
  assert.equal(typeof a.proposal_id, 'string');
  assert.notEqual(a.proposal_id, b.proposal_id);
});

test('buildProposal: stage_snippet의 target은 넘겨도 null로 고정된다', () => {
  const envelope = buildProposal(
    { action: 'stage_snippet', target: 'brain', snippet: '{"mcpServers":{"x":{}}}' },
    '이유', null, 'gui',
  );
  assert.equal(envelope.actions[0].target, null);
  assert.equal(validateProposal(envelope).ok, true);
});

test('buildBatchProposal: 여러 동작을 한 제안에 담는다', () => {
  const envelope = buildBatchProposal(
    [INSTALL, { action: 'set_enabled', target: 'time', enabled: false }],
    '두 가지를 함께 바꿉니다', 3, 'model',
  );
  assert.equal(envelope.actions.length, 2);
  assert.equal(validateProposal(envelope).ok, true);
});

// --- 검증 --------------------------------------------------------------------

test('validateProposal: source가 없거나 값이 틀리면 거부한다(A9)', () => {
  const base = buildProposal(INSTALL, '이유', 1, 'gui');
  const missing = { ...base };
  delete missing.source;
  assert.equal(validateProposal(missing).ok, false);
  assert.equal(validateProposal({ ...base, source: 'canvas' }).ok, false);
});

test('validateProposal: revision 키가 아예 없으면 거부한다', () => {
  const base = buildProposal(INSTALL, '이유', 1, 'gui');
  const missing = { ...base };
  delete missing.revision;
  const result = validateProposal(missing);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('revision')));
});

test('validateProposal: revision null은 허용한다', () => {
  const envelope = buildProposal(INSTALL, '이유', null, 'gui');
  assert.equal(validateProposal(envelope).ok, true);
});

test('validateProposal: stage_snippet에 target이 있으면 거부한다', () => {
  const envelope = buildProposal(INSTALL, '이유', 1, 'gui');
  envelope.actions[0] = { action: 'stage_snippet', target: 'brain', snippet: '{}' };
  assert.equal(validateProposal(envelope).ok, false);
});

test('validateProposal: stage_snippet에 snippet 문자열이 없으면 거부한다', () => {
  const envelope = buildProposal({ action: 'stage_snippet', target: null }, '이유', 1, 'gui');
  assert.equal(validateProposal(envelope).ok, false);
});

test('validateProposal: actions가 비면 거부한다', () => {
  const envelope = buildBatchProposal([], '이유', 1, 'model');
  assert.equal(validateProposal(envelope).ok, false);
});

test('validateProposal: 허용 목록 밖 액션은 거부한다', () => {
  const envelope = buildProposal({ action: 'uninstall', target: 'fetch' }, '이유', 1, 'model');
  assert.equal(validateProposal(envelope).ok, false);
});

test('validateProposal: set_enabled는 enabled 불리언을 요구한다', () => {
  const bad = buildProposal({ action: 'set_enabled', target: 'time' }, '이유', 1, 'gui');
  assert.equal(validateProposal(bad).ok, false);
  const good = buildProposal({ action: 'set_enabled', target: 'time', enabled: true }, '이유', 1, 'gui');
  assert.equal(validateProposal(good).ok, true);
});

test('validateProposal: features는 문자열 배열이어야 한다', () => {
  const envelope = buildProposal({ action: 'allow_tools', target: 'time', features: [1, 2] }, '이유', 1, 'gui');
  assert.equal(validateProposal(envelope).ok, false);
});

// --- 만료 판정 ----------------------------------------------------------------

test('isProposalStale: 어느 한쪽이라도 모르면 만료로 몰지 않는다', () => {
  assert.equal(isProposalStale({ revision: null }, 5), false);
  assert.equal(isProposalStale({ revision: 5 }, null), false);
  assert.equal(isProposalStale({ revision: null }, null), false);
});

test('isProposalStale: 값이 같으면 유효, 다르면 만료다', () => {
  assert.equal(isProposalStale({ revision: 5 }, 5), false);
  assert.equal(isProposalStale({ revision: 4 }, 5), true);
});

// --- 카드 문구 ----------------------------------------------------------------

test('cardCopy: 출처 라벨이 모델과 GUI에서 다르다(A9)', () => {
  const fromModel = cardCopy(buildProposal(INSTALL, '웹 문서를 읽으려면 필요합니다', 1, 'model'));
  const fromGui = cardCopy(buildProposal(INSTALL, '', 1, 'gui'));
  assert.equal(fromModel.sourceLabel, '아테나 제안');
  assert.equal(fromGui.sourceLabel, '내 요청');
  assert.notEqual(fromModel.sourceLabel, fromGui.sourceLabel);
});

test('cardCopy: 근거 줄은 모델이면 모델 문장, GUI면 누른 버튼 고정 문구다', () => {
  assert.equal(cardCopy(buildProposal(INSTALL, '웹 문서를 읽으려면 필요합니다', 1, 'model')).reasonLine, '웹 문서를 읽으려면 필요합니다');
  assert.equal(cardCopy(buildProposal(INSTALL, '', 1, 'gui')).reasonLine, '허브에서 [설치]를 눌렀습니다');
});

test('cardCopy: GUI 근거 줄은 동작마다 다르다', () => {
  const reason = (spec) => cardCopy(buildProposal(spec, '', 1, 'gui')).reasonLine;
  assert.equal(reason({ action: 'allow_tools', target: 'time', features: ['get_current_time'] }), '권한 화면에서 [저장]을 눌렀습니다');
  assert.equal(reason({ action: 'set_enabled', target: 'time', enabled: false }), '관리에서 [끄기]를 눌렀습니다');
  assert.equal(reason({ action: 'set_enabled', target: 'time', enabled: true }), '관리에서 [켜기]를 눌렀습니다');
  assert.equal(reason({ action: 'remove', target: 'time' }), '관리에서 [삭제]를 눌렀습니다');
  assert.equal(reason({ action: 'stage_snippet', target: null, snippet: '{}' }), '[+ 서버 추가]에서 [승인]을 눌렀습니다');
});

test('cardCopy: 카드 제목은 별칭이 아니라 사람이 읽는 이름을 쓴다', () => {
  const title = (spec) => cardCopy(buildProposal(spec, '이유', 1, 'model')).title;
  assert.equal(title(INSTALL), '웹 문서 읽기 설치');
  assert.equal(title({ action: 'allow_tools', target: 'time', features: [] }), '시간·시간대 · 기능 허용');
  assert.equal(title({ action: 'set_enabled', target: 'fetch', enabled: false }), '웹 문서 읽기 끄기');
  assert.equal(title({ action: 'set_enabled', target: 'fetch', enabled: true }), '웹 문서 읽기 켜기');
  assert.equal(title({ action: 'remove', target: 'time' }), '시간·시간대 삭제');
  assert.equal(title({ action: 'stage_snippet', target: null, snippet: '{}' }), '직접 등록');
});

test('cardCopy: 카탈로그에 없는 별칭은 이름을 지어내지 않고 그대로 쓴다', () => {
  assert.equal(cardCopy(buildProposal({ action: 'remove', target: 'my-server' }, '이유', 1, 'model')).title, 'my-server 삭제');
});

test('cardCopy: 본문 줄은 제안에 실린 값만 쓴다', () => {
  const copy = cardCopy(buildProposal({ action: 'allow_tools', target: 'time', features: ['시세 조회', '종목 검색'] }, '이유', 1, 'gui'));
  assert.deepEqual(copy.lines, ['허용 2개', '시세 조회', '종목 검색']);
});

// --- 결과 턴 문구 --------------------------------------------------------------

test('resultTurnCopy: 성공은 3줄이고 기능 수가 실제 값으로 들어간다', () => {
  assert.deepEqual(resultTurnCopy('success', { toolCount: 6 }).lines, ['등록했습니다', '연결을 확인했습니다', '기능 6개를 찾았습니다']);
});

test('resultTurnCopy: 거부는 한 줄이다', () => {
  assert.deepEqual(resultTurnCopy('rejected', {}).lines, ['그대로 뒀습니다']);
  assert.equal(resultTurnCopy('rejected', {}).chip, null);
});

test('resultTurnCopy: 실패는 사유 한 줄과 다시 시도 칩이다', () => {
  const failed = resultTurnCopy('failed', { reason: '실행 파일을 찾지 못했습니다' });
  assert.deepEqual(failed.lines, ['연결 실패 — 실행 파일을 찾지 못했습니다']);
  assert.equal(failed.chip, '다시 시도');
});

test('resultTurnCopy: 재시작은 런타임이 켜졌을 때만 반영됐다고 말한다', () => {
  assert.deepEqual(
    resultTurnCopy('restart', { runtimeEnabled: true }).lines,
    ['플러그인이 바뀌어 대화를 다시 시작했습니다', '방금 승인한 내용은 반영됐습니다'],
  );
  assert.deepEqual(resultTurnCopy('restart', { runtimeEnabled: false }).lines, ['다음 실행부터 반영됩니다']);
});

test('outOfModeCopy: 폐기 사실과 맞는 한 줄만 낸다', () => {
  assert.equal(outOfModeCopy(), '플러그인 모드에서 다시 요청합니다');
});

// --- 서명(중복 알림 방지) --------------------------------------------------------

test('proposalSignature: 같은 동작·대상이면 같은 서명이다', () => {
  const a = buildProposal(INSTALL, '이유 A', 1, 'model');
  const b = buildProposal(INSTALL, '이유 B', 9, 'gui');
  assert.equal(proposalSignature(a), proposalSignature(b));
});

test('proposalSignature: 대상이 다르면 서명이 다르다', () => {
  const a = buildProposal({ action: 'remove', target: 'fetch' }, '이유', 1, 'model');
  const b = buildProposal({ action: 'remove', target: 'time' }, '이유', 1, 'model');
  assert.notEqual(proposalSignature(a), proposalSignature(b));
});

test('proposalSignature: 스니펫은 대상이 없으므로 내용으로 구분한다', () => {
  const one = buildProposal({ action: 'stage_snippet', target: null, snippet: '{"a":1}' }, '이유', 1, 'gui');
  const same = buildProposal({ action: 'stage_snippet', target: null, snippet: '{"a":1}' }, '이유', 1, 'gui');
  const other = buildProposal({ action: 'stage_snippet', target: null, snippet: '{"b":2}' }, '이유', 1, 'gui');
  assert.equal(proposalSignature(one), proposalSignature(same));
  assert.notEqual(proposalSignature(one), proposalSignature(other));
});

// --- 교차 언어 계약 -------------------------------------------------------------

test('계약: 백엔드가 기록한 제안 픽스처를 앱 검증기가 그대로 통과시킨다', () => {
  const dir = path.join(__dirname, '..', '..', 'backend', 'tests', 'fixtures', 'plugin-proposal');
  assert.ok(fs.existsSync(dir), `픽스처 디렉터리가 없다: ${dir} — 백엔드 제안 테스트가 이 파일들을 기록해야 두 언어의 스키마가 같은지 잴 수 있다`);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.ok(files.length > 0, `픽스처 JSON이 0건이다: ${dir} — 기록된 제안이 없으면 계약을 잴 수 없다`);
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const result = validateProposal(fixture.envelope);
    assert.equal(result.ok, true, `${file}: ${result.errors.join(' · ')}`);
  }
});

// plugin-catalog.js 단위 테스트.
//
// 이 카탈로그의 값은 화면 문구가 아니라 **실행 스펙**이다 — command/args가
// 그대로 `athena-mcp register`로 넘어간다. 그래서 여기서 지키는 건 "보기 좋은가"가
// 아니라 "설치를 눌렀을 때 실제로 붙는 형태인가"다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, MARKETPLACES, recommendedFor, findEntry, displayNameFor } = require('./plugin-catalog');

// registry.py의 ALIAS_CHARSET_RE와 같은 규칙. 여기서 어긋나면 등록 시점에
// AliasValidationError로 떨어진다.
const ALIAS_RE = /^[A-Za-z0-9_-]+$/;
// MAX_QUALIFIED_NAME_LEN(64) - QUALIFIED_NAME_SEPARATOR(2) - OBSERVED_MAX_TOOL_NAME_LEN(34)
const MAX_ALIAS_LEN = 28;

test('카탈로그는 등록 가능한 스펙만 담는다', () => {
  assert.ok(CATALOG.length >= 5, '추천 카탈로그는 5종 이상이다');
  const ids = new Set();
  for (const entry of CATALOG) {
    assert.ok(ALIAS_RE.test(entry.id), `${entry.id}: 별칭 문자집합`);
    assert.ok(entry.id.length <= MAX_ALIAS_LEN, `${entry.id}: 별칭 길이`);
    assert.ok(!ids.has(entry.id), `${entry.id}: 중복 별칭`);
    ids.add(entry.id);

    assert.equal(typeof entry.command, 'string');
    assert.ok(entry.command.trim().length > 0, `${entry.id}: command 비어 있음`);
    assert.ok(['npx', 'uvx'].includes(entry.command), `${entry.id}: 실행기는 npx/uvx만`);
    assert.ok(Array.isArray(entry.args) && entry.args.length, `${entry.id}: args 없음`);
    entry.args.forEach((arg) => assert.equal(typeof arg, 'string', `${entry.id}: args는 전부 문자열`));

    // 키를 요구하는 항목은 설치 직후 반드시 실패한다 — 카탈로그에 넣지 않는다.
    assert.equal(entry.env, undefined, `${entry.id}: 환경변수가 필요한 서버는 카탈로그에 넣지 않는다`);

    assert.ok(entry.name && entry.description, `${entry.id}: 이름·설명`);
    assert.ok(entry.provider && entry.purpose, `${entry.id}: 제공·용도 (설치 승인 시트가 쓴다)`);
    assert.ok(Array.isArray(entry.toolNames) && entry.toolNames.length, `${entry.id}: 도구 이름`);
    assert.ok(Array.isArray(entry.requestedFeatures) && entry.requestedFeatures.length, `${entry.id}: 요청 기능`);
  }
});

test('도구의 정규화 이름이 MCP 64자 한계를 넘지 않는다', () => {
  // registry.py QUALIFIED_NAME_SEPARATOR('__') + MAX_QUALIFIED_NAME_LEN(64).
  // 넘으면 게이트웨이가 그 도구를 아예 재노출하지 못한다(probe가 경고한다).
  for (const entry of CATALOG) {
    for (const tool of entry.toolNames) {
      const qualified = `${entry.id}__${tool}`;
      assert.ok(qualified.length <= 64, `${qualified} (${qualified.length}자)`);
    }
  }
});

test('마켓플레이스는 카탈로그 항목이 가리키는 것만 있다', () => {
  const known = new Set(MARKETPLACES.map((m) => m.id));
  assert.ok(known.size >= 1);
  CATALOG.forEach((entry) => {
    assert.ok(known.has(entry.marketplaceId), `${entry.id}: 알 수 없는 마켓플레이스`);
  });
});

test('추천은 이미 등록된 별칭을 뺀다', () => {
  const all = recommendedFor([]);
  assert.equal(all.length, CATALOG.length);

  const rest = recommendedFor(['fetch', 'time']);
  assert.equal(rest.length, CATALOG.length - 2);
  assert.ok(!rest.some((entry) => entry.id === 'fetch'));
  assert.ok(!rest.some((entry) => entry.id === 'time'));
});

test('꺼진 마켓플레이스의 항목은 추천에 나오지 않는다', () => {
  assert.deepEqual(recommendedFor([], []), []);
  assert.equal(recommendedFor([], ['athena-official']).length, CATALOG.length);
  // null은 "필터 없음"이다 — 호스트가 마켓플레이스를 아직 모를 때 추천이 통째로
  // 사라지지 않게 한다.
  assert.equal(recommendedFor([], null).length, CATALOG.length);
});

test('추천 항목은 원본을 복사해 돌려준다', () => {
  const [first] = recommendedFor([]);
  first.args.push('오염');
  first.name = '바뀐 이름';
  const [again] = recommendedFor([]);
  assert.notEqual(again.name, '바뀐 이름');
  assert.ok(!again.args.includes('오염'));
});

test('표시 이름은 카탈로그에 있는 별칭에만 붙는다', () => {
  assert.equal(displayNameFor('fetch'), '웹 문서 읽기');
  assert.equal(displayNameFor('낯선-서버'), null, '모르는 별칭에는 이름을 지어내지 않는다');
  assert.equal(findEntry('없는것'), null);
  assert.equal(findEntry('memory').command, 'npx');
});

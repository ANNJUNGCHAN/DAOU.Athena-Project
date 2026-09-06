'use strict';

// 한글 폴백 폰트의 줄상자 계약 — Daki가 없는 머신에서 Paper의 줄 높이를 지킨다.
//
// Paper는 본문 16px에 line-height 20px(125%)를 지정하는데, 폴백으로 쓰는
// Noto Sans KR의 글리프 상자는 150%em이라 fit-content 보드(슬랙 0)의 마지막
// 행이 2px 삐져나온다(15R0-2 · 15RX-2). 컨테이너를 늘리지 않고 폴백 폰트의
// metric을 125% 이하로 죄는 별칭 @font-face가 그 자리를 막고 있으므로,
// 별칭 선언과 스택 순서를 여기서 잠근다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOKENS = fs.readFileSync(path.join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');
const ALIAS = 'Noto Sans KR Athena';

test('한글 폴백 별칭은 실재하는 local 폰트를 잡고 줄상자를 125% 이하로 죈다', () => {
  const face = TOKENS.match(/@font-face\s*\{[^}]*'Noto Sans KR Athena'[^}]*\}/);
  assert.ok(face, `${ALIAS} @font-face 선언이 없다`);
  const body = face[0];
  // local()로 못 잡으면 스택이 Malgun Gothic으로 떨어져 자폭이 넓어진다(f860bb0).
  assert.match(body, /src:\s*local\('Noto Sans KR'\)/);
  const pct = (prop) => {
    const found = body.match(new RegExp(prop + ':\\s*(\\d+(?:\\.\\d+)?)%'));
    assert.ok(found, `${prop} 선언이 없다`);
    return Number(found[1]);
  };
  const ascent = pct('ascent-override');
  const descent = pct('descent-override');
  assert.equal(pct('line-gap-override'), 0);
  assert.ok(ascent + descent <= 125, `줄상자 ${ascent + descent}% > 125%`);
  // Noto의 ascent:descent = 118.75:31.25(3.8:1)를 유지해야 기준선 이동이 최소다.
  assert.ok(Math.abs(ascent / descent - 3.8) <= 0.4, `ascent:descent 비 ${ascent / descent}`);
  // --font-strong이 굵은 글꼴을 요구하므로 가변 폰트 축 전체를 선언해야 한다.
  assert.match(body, /font-weight:\s*100\s+900/);
});

test('본문·강조·표제 스택은 Daki → 별칭 → Noto → Malgun 순서를 지킨다', () => {
  for (const [token, first] of [
    ['--font-body', 'Daki'],
    ['--font-strong', 'Daki B'],
    ['--font-display', 'Daki Title'],
  ]) {
    const found = TOKENS.match(new RegExp(token + ':\\s*([^;]+);'));
    assert.ok(found, `${token} 선언이 없다`);
    const families = found[1].split(',').map((name) => name.trim().replace(/^'|'$/g, ''));
    const alias = families.indexOf(ALIAS);
    const noto = families.indexOf('Noto Sans KR');
    const malgun = families.indexOf('Malgun Gothic');
    assert.equal(families[0], first, `${token} 첫 자리는 Daki 계열이어야 한다`);
    // 별칭이 Noto 바로 앞: local()이 실패해도 원래 Noto가 살아 f860bb0의 가로 계약이 남는다.
    assert.equal(alias + 1, noto, `${token} 별칭이 Noto 바로 앞이 아니다`);
    assert.ok(noto < malgun, `${token} Noto가 Malgun보다 뒤에 있다`);
  }
});

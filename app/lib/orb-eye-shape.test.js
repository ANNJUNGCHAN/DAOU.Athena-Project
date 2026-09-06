'use strict';

// 오브 눈 종횡비 계약 — verify.js 검증22 firedEyesAreRounder가 재는 그 수치를
// CSS 쪽에서 그대로 잠근다(Electron 없이). 그 판정은 둘을 본다:
//   대기(idle) 눈 세로/가로 > 1.5, 발화(fired) 눈 세로/가로 < 1.3.
//
// 두 번째 테스트가 이 파일의 존재 이유다: idle이 아닌 표정의 눈은 전부 1.5
// 아래라, 대기 눈을 **idle이 아닌 표정에서 재면** 판정이 조용히 뒤집힌다.
// 2026-09-06 검증22 흔들림의 실체가 그것이었다 — verify.js가 측정 순간의
// 표정을 확인하고서야 그 값을 쓰는 이유다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 주석은 걷어내고 읽는다 — orb.css 주석은 규칙 이름(.orb-eye)과 치수를 그대로
// 인용하고 쉼표도 들어 있어, 안 걷어내면 주석이 선택자로 읽힌다.
const orbCss = fs.readFileSync(path.join(__dirname, '..', 'orb.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(text) {
  const out = {};
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return out;
}

function percent(value) {
  return value && value.endsWith('%') ? Number(value.slice(0, -1)) : null;
}

/** 눈은 바이저 안에서 %로 잡히고 바이저는 정사각이 아니다 — 실측 px 종횡비를
 * 재현하려면 바이저의 가로·세로 비를 곱해야 한다(#orbVisor 인셋에서 나온다). */
function visorAspect() {
  const block = declarations(/#orbVisor \{([^}]*)\}/.exec(orbCss)[1]);
  const width = 100 - percent(block.left) - percent(block.right);
  const height = 100 - percent(block.top) - percent(block.bottom);
  return height / width;
}

/** 어느 표정에서 눈이 실제로 몇 대 몇인가 — 기본 .orb-eye 규칙 위에 그 표정의
 * 규칙을 소스 순서대로 덮어 계산한다(브라우저 캐스케이드와 같은 순서). */
function eyeAspect(face) {
  const size = {};
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  while ((rule = rules.exec(orbCss)) !== null) {
    const applies = rule[1].split(',').some((part) => {
      if (!part.includes('.orb-eye')) return false;
      const stateless = !part.includes('[data-face=') && !part.includes('[data-alert=');
      return stateless || part.includes('[data-face="' + face + '"]');
    });
    if (!applies) continue;
    const decls = declarations(rule[2]);
    for (const prop of ['width', 'height']) {
      if (percent(decls[prop]) !== null) size[prop] = percent(decls[prop]);
    }
  }
  assert.ok(size.width && size.height, `${face} 눈 치수를 orb.css에서 읽을 수 있어야 한다`);
  return (size.height / size.width) * visorAspect();
}

test('대기 눈은 길쭉하고 발화 눈은 거의 원이다 — 검증22가 쓰는 임계 그대로', () => {
  const idle = eyeAspect('idle');
  const fired = eyeAspect('fired');
  assert.ok(idle > 1.5, `대기 눈 종횡비 ${idle.toFixed(2)}는 1.5를 넘어야 한다`);
  assert.ok(fired < 1.3, `발화 눈 종횡비 ${fired.toFixed(2)}는 1.3 미만이어야 한다`);
});

test('idle이 아닌 표정의 눈은 대기 기준선이 될 수 없다', () => {
  for (const face of ['sleep', 'drowsy', 'done', 'glad', 'mopey', 'fired', 'surprise']) {
    const aspect = eyeAspect(face);
    assert.ok(
      aspect <= 1.5,
      `${face} 눈 종횡비 ${aspect.toFixed(2)} — 이 표정에서 재면 대기 판정이 뒤집힌다`,
    );
  }
});

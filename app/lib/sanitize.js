// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

const TAG_RE = /<[^>]*>/g;

// html.unescape()의 전체 엔티티 테이블을 재구현하지 않는다. 실측(캡처
// 200/200 아이템 전수조사, RESULT.md)에서 나온 엔티티만 명시적으로 처리하고
// 숫자 참조(&#39; / &#x27;)는 일반식으로 처리한다.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function unescapeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const num = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isNaN(num)) return whole;
      try {
        return String.fromCodePoint(num);
      } catch {
        return whole;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

function stripTags(text) {
  return text.replace(TAG_RE, '');
}

function sanitize(text) {
  if (text === null || text === undefined) return null;
  return unescapeEntities(stripTags(text));
}

// UMD 각주(2026-08-18 렌더러 격리) — node --test(CommonJS)와 <script> 태그
// 전역 로딩(nodeIntegration:false) 양쪽에서 같은 파일이 동작해야 한다.
const __exports = { sanitize, stripTags, unescapeEntities };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.Sanitize = __exports;
}

})();

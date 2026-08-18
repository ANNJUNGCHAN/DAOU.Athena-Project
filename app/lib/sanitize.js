// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
// spike/stream-adapter/adapter.py 의 sanitize 규칙을 JS로 포팅.
// 순서 고정: strip_tags 먼저, unescape_entities 나중.
// (반대로 하면 &lt;b&gt; 같은 이스케이프된 문자열이 언이스케이프 단계에서
//  실제 태그 모양으로 부활한 뒤 스트리퍼에 걸려 사라진다 — adapter.py 주석 그대로.)
//
// 렌더링 계약(spike/stream-adapter/RESULT.md): sanitize()의 반환값은
// innerHTML로 넣지 않는다. 텍스트 노드로만 렌더한다. 이 계약은 이 모듈이
// 아니라 호출부(canvas.js)가 지켜야 한다 — sanitize 자체는 문자열만 돌려준다.

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

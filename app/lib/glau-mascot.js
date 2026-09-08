(function () {
'use strict';
// Native, editable vector adaptation of the approved Glau reference.
// Shared silhouette stays fixed; only eyes and small expression cues vary.
const EXPRESSIONS = ['neutral', 'happy', 'wink', 'joy', 'surprised', 'error', 'cry', 'sad', 'sleepy', 'thinking'];
const PALETTE = { body: '#BF9B81', face: '#FFF3E2', eye: '#27251F', beak: '#ECAA43', wing: '#354D70', olive: '#687048', tear: '#7EA6BD' };

function svg(state = 'idle') {
  const expression = expressionForState(state);
  const p = PALETTE;
  const line = (d, width = 3.5, color = p.eye) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const eye = (x, y = 63, rx = 4.6, ry = 6.2) => `<ellipse class="glau-eye" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${p.eye}"/>`;
  const happy = line('M40 65 Q45 54 50 65 M78 65 Q83 54 88 65');
  const eyes = {
    neutral: eye(45) + eye(83),
    happy,
    wink: eye(45) + line('M78 64 Q83 58 88 64'),
    joy: happy,
    surprised: eye(45, 62, 5.2, 7.5) + eye(83, 62, 5.2, 7.5),
    error: line('M41 58 L49 66 M49 58 L41 66 M79 58 L87 66 M87 58 L79 66'),
    cry: line('M40 62 Q45 57 50 62 M78 62 Q83 57 88 62'),
    sad: eye(45, 65, 4, 5) + eye(83, 65, 4, 5) + line('M40 55 L48 53 M80 53 L88 55', 2.5),
    sleepy: line('M40 63 Q45 68 50 63 M78 63 Q83 68 88 63'),
    thinking: eye(47, 61, 4.2, 5.5) + eye(85, 61, 4.2, 5.5) + line('M78 51 Q84 48 89 51', 2.5),
  };
  let cue = '';
  if (expression === 'cry') cue = `<path class="glau-tear" d="M43 69 Q36 79 43 79 Q50 79 43 69Z" fill="${p.tear}"/>`;
  if (expression === 'joy') cue = line('M7 39 L3 34 M17 30 L15 24 M114 37 L119 31', 3, p.beak);
  if (expression === 'surprised') cue = line('M40 49 Q45 46 50 49 M78 49 Q83 46 88 49', 2.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" class="glau-mascot" data-expression="${expression}" viewBox="0 0 128 128" fill="none" data-layer-name="Glau ${expression}" aria-hidden="true" focusable="false">
  <title>글라우 · ${expression}</title>
  <g class="glau-figure">
    <g class="glau-olive-leaves" fill="${p.olive}">
      <path d="M97 28 C85 22 86 10 94 3 C102 10 104 20 97 28Z"/>
      <path d="M99 30 C100 19 109 14 119 16 C118 26 110 32 99 30Z"/>
    </g>
    <circle class="glau-body" cx="64" cy="70" r="49" fill="${p.body}"/>
    <path class="glau-cream-face" d="M64 48 C53 34 37 35 29 47 C19 63 28 84 44 85 C52 86 59 82 64 79 C69 83 77 86 85 85 C102 84 109 64 100 49 C92 36 77 34 64 48Z" fill="${p.face}"/>
    <g class="glau-gaze"><g class="glau-lid">${eyes[expression] || eyes.neutral}</g></g>
    <path class="glau-beak" d="M58 70 Q64 67 70 70 Q72 71 69 75 L66 79 Q64 82 62 79 L58 74 Q56 71 58 70Z" fill="${p.beak}"/>
    <g class="glau-wings" fill="${p.wing}">
      <ellipse cx="19" cy="88" rx="9" ry="16" transform="rotate(-18 19 88)"/>
      <ellipse cx="109" cy="88" rx="9" ry="16" transform="rotate(18 109 88)"/>
    </g>
    <g class="glau-feet" fill="${p.beak}">
      <ellipse cx="46" cy="118" rx="9" ry="5"/>
      <ellipse cx="82" cy="118" rx="9" ry="5"/>
    </g>
    <g class="glau-expression-cues">${cue}</g>
  </g>
</svg>`;
}


const STATE_EXPRESSIONS = Object.freeze({
  idle: 'neutral', listen: 'neutral', watch: 'neutral', think: 'thinking',
  done: 'happy', wink: 'wink', glad: 'joy', fired: 'surprised', surprise: 'surprised',
  frown: 'error', crying: 'cry', mopey: 'sad', sleep: 'sleepy', drowsy: 'sleepy',
});
function expressionForState(state) {
  return Object.hasOwn(STATE_EXPRESSIONS, state)
    ? STATE_EXPRESSIONS[state] : (EXPRESSIONS.includes(state) ? state : 'neutral');
}
function render(host, state = 'idle') {
  if (!host) return;
  const expression = expressionForState(state);
  if (host.dataset.glauExpression === expression) return;
  host.innerHTML = svg(expression);
  host.dataset.glauExpression = expression;
}
const api = { EXPRESSIONS: Object.freeze(EXPRESSIONS), PALETTE: Object.freeze(PALETTE), expressionForState, svg, render };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.GlauMascot = api; }

})();

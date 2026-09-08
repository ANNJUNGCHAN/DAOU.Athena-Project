// 글자 잘림 계측 — 「값은 들어왔는데 화면에서 아래가 잘린다」를 잡는 층.
//
// 기존 geometry 검사(board-probe.assertSurfaceGeometry)는 hoist된 상자의
// scrollHeight만 본다. 그래서 **글리프 자체가 조상 클립 상자 밖으로 나가** 아래가
// 잘리는 자리는 통과한다(실측: 값이 실린 뒤 줄이 늘어난 셀). 이 모듈은 텍스트
// 노드의 Range 사각형을 조상 클립 사각형과 대조한다.
//
// 스크롤로 닿을 수 있는 잘림은 결함이 아니다(계획 §2는 세로 스크롤을 허용한다) —
// overflowY가 auto/scroll인 조상이 자르는 경우는 `reachable`로 따로 센다.

'use strict';

// 브라우저에서 평가할 소스. 렌더러에 번들되지 않고 프로브가 문자열로 주입한다.
const TEXT_CLIP_PROBE = (instanceId) => `(() => {
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
  const surface = root && root.querySelector('.board-surface');
  if (!surface) return { error: 'board surface not found' };

  const CLIP = new Set(['hidden', 'clip']);
  const SCROLLABLE = new Set(['auto', 'scroll']);
  const shown = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return Number(style.opacity) !== 0;
  };
  const identity = (el) => {
    const data = el.dataset || {};
    return data.node || data.slotId || data.name || el.className || el.tagName;
  };

  const clipped = [];
  const reachable = [];
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || '').trim();
    if (!text) continue;
    const owner = node.parentElement;
    if (!owner || !shown(owner)) continue;
    if (owner.closest('[hidden]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    range.detach && range.detach();
    if (!rects.length) continue;
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const top = Math.min(...rects.map((rect) => rect.top));
    for (let el = owner; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      const clips = CLIP.has(style.overflowY);
      const scrolls = SCROLLABLE.has(style.overflowY);
      if (!clips && !scrolls) continue;
      const box = el.getBoundingClientRect();
      const clipTop = box.top + el.clientTop;
      const clipBottom = clipTop + el.clientHeight;
      const overBottom = Math.round(bottom - clipBottom);
      const overTop = Math.round(clipTop - top);
      const over = Math.max(overBottom, overTop);
      if (over <= 1) {
        if (el === surface) break;
        continue;
      }
      const record = {
        text: text.slice(0, 40),
        node: identity(owner),
        clip_owner: identity(el),
        over_bottom: overBottom,
        over_top: overTop,
        clip_height: el.clientHeight,
        scroll_height: el.scrollHeight,
      };
      // 스크롤 컨테이너가 자르는 것은 스크롤로 닿는다 — 결함 목록과 분리한다.
      if (scrolls && el.scrollHeight > el.clientHeight + 1) reachable.push(record);
      else clipped.push(record);
      break;
    }
  }
  return {
    clipped_total: clipped.length,
    clipped_nodes: clipped.slice(0, 20),
    reachable_total: reachable.length,
    reachable_nodes: reachable.slice(0, 5),
  };
})()`;

// 결측어가 화면에 실제로 몇 번 찍혔는지. 결측어 3종을 구분해 센다(헌장 신념 5).
const MISSING_TEXT_PROBE = (instanceId) => `(() => {
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
  const surface = root && root.querySelector('.board-surface');
  if (!surface) return { error: 'board surface not found' };
  const WORDS = ['미제공', '집계 전', '해당 없음'];
  const counts = { '미제공': 0, '집계 전': 0, '해당 없음': 0 };
  const nodes = [];
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || '').trim();
    if (!WORDS.includes(text)) continue;
    const owner = node.parentElement;
    if (!owner) continue;
    const style = getComputedStyle(owner);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (owner.closest('[hidden]')) continue;
    if (owner.closest('.bs-paired')) continue;
    counts[text] += 1;
    if (nodes.length < 30) {
      nodes.push({
        text,
        node: (owner.dataset && (owner.dataset.node || owner.dataset.slotId)) || owner.className,
      });
    }
  }
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), nodes };
})()`;

module.exports = { TEXT_CLIP_PROBE, MISSING_TEXT_PROBE };

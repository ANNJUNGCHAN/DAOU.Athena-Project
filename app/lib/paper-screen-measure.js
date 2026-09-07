'use strict';

/**
 * 화면 루트의 가시 텍스트와 구조를 잰다. structure의 visibility는 기본적으로
 * visible이며, any일 때만 숨은 DOM도 센다.
 */
function measureRouteDocument(document, route) {
  const root = document.querySelector(route.root);
  if (!root) return { root_found: false, root_visible: false, visible_text: '', structure: [] };
  const visible = (el) => !!el && el.checkVisibility({ checkVisibilityCSS: true });
  if (!visible(root)) return { root_found: true, root_visible: false, visible_text: '', structure: [] };

  const parts = [];
  const walker = document.createTreeWalker(root, 4); // NodeFilter.SHOW_TEXT
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (!text || !visible(node.parentElement)) continue;
    parts.push(text);
  }

  const structure = route.structure.map((check, index) => {
    const matches = Array.from(root.querySelectorAll(check.selector));
    const found = check.visibility === 'any' ? matches : matches.filter(visible);
    return {
      index,
      actual: check.what === 'order' ? found.map((el) => el.textContent.trim()) : found.length,
    };
  });
  return { root_found: true, root_visible: true, visible_text: parts.join('\n'), structure };
}

function measureScript(route) {
  return `(${measureRouteDocument.toString()})(document, ${JSON.stringify(route)})`;
}

module.exports = { measureRouteDocument, measureScript };

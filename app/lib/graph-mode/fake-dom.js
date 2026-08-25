// 테스트용 최소 DOM 스텁. **테스트 전용**이라 shell.html에 실리지 않고 UMD 각주도
// 없다 — `npm test`의 글롭이 `*.test.js`라 이 파일은 테스트로도 실행되지 않는다.
//
// render.test.js와 controller.test.js가 이것을 각자 한 벌씩 복사해 갖고 있었다.
// 같은 자료를 두 곳에서 고치게 되고, 실제로 둘은 인자 이름만 다른 채 이미 갈라져
// 있었다(한쪽에만 hidden·clientWidth가 있었다). 한 벌로 합친다.
//
// jsdom은 들이지 않는다 — history-badge.test.js가 세운 관례이고, 여기서 쓰는
// 인터페이스는 아래가 전부다.
'use strict';

function fakeNode(name) {
  return {
    nodeName: name,
    attrs: {},
    children: [],
    textContent: '',
    hidden: false,
    clientWidth: 800,
    clientHeight: 600,
    get firstChild() {
      return this.children[0] || null;
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    getAttribute(key) {
      return this.attrs[key];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    // '.graph-node' 같은 단일 클래스 셀렉터만 지원한다 — 두 테스트가 쓰는 전부다.
    querySelectorAll(selector) {
      const wanted = selector.replace(/^\./, '');
      const found = [];
      const walk = (node) => {
        const classes = String(node.attrs.class || '').split(/\s+/);
        if (classes.includes(wanted)) found.push(node);
        node.children.forEach(walk);
      };
      this.children.forEach(walk);
      return found;
    },
    querySelector(selector) {
      if (selector === 'svg.graph-canvas') {
        return this.children.find((c) => c.nodeName === 'svg') || null;
      }
      return this.querySelectorAll(selector)[0] || null;
    },
  };
}

// render.js가 `document.createElementNS`로만 노드를 만든다 — 전역에 그것만 세운다.
function installFakeDocument() {
  global.document = { createElementNS: (_ns, name) => fakeNode(name) };
}

function uninstallFakeDocument() {
  delete global.document;
}

module.exports = { fakeNode, installFakeDocument, uninstallFakeDocument };

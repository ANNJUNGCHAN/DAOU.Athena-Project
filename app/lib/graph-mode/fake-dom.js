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
    _listeners: {},
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
    // controller.test.js가 노드 클릭 배선을 검증하는 데만 쓴다 — 버블링은 없다,
    // 이 스텁이 흉내내는 건 이 리포가 실제로 붙이는 리스너 패턴(개별 바인딩)뿐이다.
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      handlers.forEach((handler) => handler(event));
      return true;
    },
    // controller.js의 applyVisibility()가 모드 칩에 .is-active를 토글한다(스텝1) —
    // attrs.class를 read/write해 querySelectorAll의 클래스 파싱과 같은 자료를 공유한다.
    get classList() {
      const node = this;
      const read = () => String(node.attrs.class || '').split(/\s+/).filter(Boolean);
      const write = (list) => { node.attrs.class = list.join(' '); };
      return {
        add(name) {
          const list = read();
          if (!list.includes(name)) write([...list, name]);
        },
        remove(name) {
          write(read().filter((c) => c !== name));
        },
        toggle(name, force) {
          const shouldHave = force === undefined ? !read().includes(name) : Boolean(force);
          if (shouldHave) this.add(name); else this.remove(name);
          return shouldHave;
        },
        contains(name) {
          return read().includes(name);
        },
      };
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

// render.js는 `document.createElementNS`(SVG)로, summary-table.js는
// `document.createElement`(일반 DOM)로 노드를 만든다 — 전역에 그 둘만 세운다.
function installFakeDocument() {
  global.document = {
    createElementNS: (_ns, name) => fakeNode(name),
    createElement: (name) => fakeNode(name),
  };
}

function uninstallFakeDocument() {
  delete global.document;
}

module.exports = { fakeNode, installFakeDocument, uninstallFakeDocument };

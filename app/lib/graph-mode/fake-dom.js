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
    _text: '',
    hidden: false,
    clientWidth: 800,
    clientHeight: 600,
    _listeners: {},
    get firstChild() {
      return this.children[0] || null;
    },
    // 실제 DOM처럼 자식이 있으면 재귀로 이어붙인 문자열, 없으면 리프 텍스트를
    // 낸다(controller.js가 스텝8에서 panel을 appendChild로 조립하기 시작하며
    // 필요해졌다 — 예전엔 textContent를 직접 대입하는 리프 노드만 있었다).
    // 대입은 실제 DOM과 같이 기존 자식을 전부 지운다.
    get textContent() {
      if (this.children.length === 0) return this._text;
      return this.children.map((c) => c.textContent).join('');
    },
    set textContent(value) {
      this._text = value;
      this.children = [];
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    // 실제 DOM에서 className과 class 속성은 같은 자료다 — 이 저장소는 두 표기를
    // 섞어 쓰므로(el()은 setAttribute, controller.js는 className) 스텁에서도
    // 하나로 모아야 querySelector('.x')가 양쪽을 다 찾는다.
    get className() {
      return String(this.attrs.class || '');
    },
    set className(value) {
      this.attrs.class = value;
    },
    getAttribute(key) {
      return this.attrs[key];
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    parentNode: null,
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

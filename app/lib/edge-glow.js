// 경계 hover 광량 — 자유 리사이즈의 발견 가능성 장치 (2026-08-19 결정, 질의응답).
// 마우스가 창 경계 14px 안에 들어오면 그 변의 가장자리가 은은하게 밝아진다 —
// "깊이는 값(광량)으로 만든다"(soul.md §7)와 같은 문법이라 상시 크롬 없이
// 리사이즈 가능함을 알린다. 두 창(chat.html/canvas.html)이 같이 로드한다.
//
// 자기 초기화 모듈이다 — DOM에 오버레이 4개(.edge-glow-n/e/s/w)를 스스로 만들고
// mousemove로 근접을 판정한다. 스타일은 styles/ui-kit.css(.edge-glow-*).
// pointer-events:none이라 어떤 인터랙션도 가로채지 않는다.
// prefers-contrast에서는 access.css가 숨긴다(장식 광량 — 대비 모드에선 커서가 신호).
(() => {
  const THRESHOLD = 14; // px — 이 거리 안이면 해당 변이 밝아진다

  function init() {
    const edges = {};
    for (const side of ['n', 'e', 's', 'w']) {
      const el = document.createElement('div');
      el.className = `edge-glow edge-glow-${side}`;
      document.body.appendChild(el);
      edges[side] = el;
    }

    let raf = null;
    let last = null;

    function apply(pos) {
      raf = null;
      if (!pos) {
        for (const side of Object.keys(edges)) edges[side].classList.remove('is-near');
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      edges.n.classList.toggle('is-near', pos.y <= THRESHOLD);
      edges.s.classList.toggle('is-near', h - pos.y <= THRESHOLD);
      edges.w.classList.toggle('is-near', pos.x <= THRESHOLD);
      edges.e.classList.toggle('is-near', w - pos.x <= THRESHOLD);
    }

    window.addEventListener('mousemove', (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(() => apply(last));
    });
    // 창 밖으로 나가면(리사이즈 드래그 중 포함) 광량을 정리한다 — 잔광이 남으면
    // "지금도 경계 근처"라는 거짓 신호다(정보 정직성).
    window.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) { last = null; if (!raf) raf = requestAnimationFrame(() => apply(null)); }
    });
    window.addEventListener('blur', () => { last = null; apply(null); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

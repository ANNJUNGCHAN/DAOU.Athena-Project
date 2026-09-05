'use strict';

// 한 번만 실행하고 그 promise를 계속 돌려주는 실행 가드.
// 실패하면 기억을 지워 다음 호출이 다시 시도할 수 있게 한다.
// 실패한 promise에 no-op catch를 미리 걸어 두는 것이 핵심이다 — 호출자가
// 하나뿐이면 그 호출자는 반환된 promise만 보고, 가드가 들고 있던 promise의
// 거부는 아무도 관측하지 않아 unhandledRejection으로 샜다. 거부 자체는
// 반환된 promise로 호출자에게 그대로 전달된다.
function createOnce(factory, onReuse) {
  let inflight = null;
  return function once() {
    if (inflight) {
      if (onReuse) onReuse();
      return inflight;
    }
    inflight = factory().catch((err) => {
      inflight = null;
      throw err;
    });
    inflight.catch(() => {});
    return inflight;
  };
}

module.exports = { createOnce };

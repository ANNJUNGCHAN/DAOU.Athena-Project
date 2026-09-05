// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

// UMD 헤드(2026-08-18 렌더러 격리) — ipcRenderer는 window.athena 다리로
// 대체한다(preload.js). ui-kit require는 node --test/<script> 태그 겸용.
const {
  el, button, labeledRow, statusDot, errorNote, clear,
} = (typeof module !== 'undefined' && module.exports) ? require('./ui-kit') : window.AthenaLib.UiKit;

const STATE_META = {
  needed: { label: '인증 필요' },
  ready: { label: '토큰 준비됨' },
  refreshing: { label: '재발급 중' },
  expired: { label: '만료됨' },
};

function stateDot(state) {
  const meta = STATE_META[state] || STATE_META.needed;
  const d = statusDot(state === 'ready', meta.label);
  if (state === 'needed' || state === 'refreshing') d.classList.add('is-warn');
  return d;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function formatHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

function buildHead(root, { kicker, title, sub }) {
  clear(root);
  const wrap = el('div', 'onb-col onb-auth');
  const head = el('div', 'onb-head');
  if (kicker) head.appendChild(el('div', 'onb-kicker', kicker));
  head.appendChild(el('div', 'onb-title', title));
  head.appendChild(el('div', 'onb-sub', sub));
  wrap.appendChild(head);
  root.appendChild(wrap);
  return wrap;
}

// opts:
//   accountId  — 대상 계좌 id
//   embedded   — true면 온보딩(AT-SY-003) 직후 1회 노출되는 문맥. 상태가
//                "준비됨"이 되면 온보딩을 이어간다.
//   onContinue — embedded일 때만 사용. async () => boolean. 다음 화면(정상
//                대화 창)으로 넘어가도 되는지 chat.js에 위임한다.
//   onBack     — embedded일 때만 사용. 저장된 계좌를 지우지 않고 계좌 단계로 돌아간다.
//   initialView — 'switch'면 상태 화면을 거치지 않고 계좌 전환 화면(Paper 1M3-0)으로
//                바로 들어간다. 사이드바 계정 메뉴의 「계좌 전환」이 쓰는 진입로다.
function renderAuthTokenStatus(root, opts) {
  const o = opts || {};
  let accountId = o.accountId;
  const embedded = !!o.embedded;
  const onContinue = o.onContinue;
  const onBack = o.onBack;

  const wrap = buildHead(root, {
    kicker: embedded ? '3 / 3' : null,
    title: '키움 인증이 연결되었습니다',
    sub: 'Athena는 토큰을 저장하지 않습니다. 만료 전에 자동으로 다시 받습니다.',
  });
  const body = el('div', 'onb-body onb-auth-body');
  const foot = el('div', 'onb-auth-foot');
  wrap.appendChild(body);
  wrap.appendChild(foot);

  let destroyed = false;
  let view = 'status'; // 'status' | 'switch'
  let currentState = 'needed';
  let expiresAtMs = null;
  let lastExpiryText = '';
  let accountAlias = '';
  let currentErrSlot = null;
  let currentTimerDigitsEl = null;
  let autoContinueTimer = null;
  let autoContinueFired = false;
  let switchAccounts = [];
  let switchSelectedId = null;
  let revoking = false;

  function mountErrSlot(parent) {
    currentErrSlot = el('div', 'onb-error-slot');
    parent.appendChild(currentErrSlot);
  }
  function showErr(msg) { if (currentErrSlot) { clear(currentErrSlot); currentErrSlot.appendChild(errorNote(msg)); } }
  function clearErr() { if (currentErrSlot) clear(currentErrSlot); }

  // ---------- 상태 화면 ----------
  function paint() {
    clear(body);
    clear(foot);
    currentTimerDigitsEl = null;

    const timerCard = el('div', 'auth-timer-card');
    timerCard.appendChild(el('div', 'auth-timer-label', currentState === 'needed' ? '토큰이 없다' : '재발급까지 남은 시간'));
    const timerRow = el('div', 'auth-timer-row');
    const digits = el('span', 'auth-timer-digits');
    currentTimerDigitsEl = digits;
    const units = el('span', 'auth-timer-units', '시 분 초');
    timerRow.appendChild(digits);
    timerRow.appendChild(units);
    timerCard.appendChild(timerRow);
    const expiryLine = el('div', 'auth-timer-expiry');

    if (currentState === 'needed') {
      // 스펙 원문은 "— — : — — : — —"(4상태 보드, 44px 폰트에서 실측)다. 이
      // 화면의 실제 폰트 크기(72px)로 그대로 옮기면 카드 폭을 넘겨 줄바꿈
      // 되는 버그가 있었다(실측으로 발견) — 같은 "숫자 없음"을 전하는 8자
      // 대시 표기로 폭을 00:00:00과 맞췄다. 결정/발명 — 리포트에 명시.
      digits.textContent = '--:--:--';
      digits.classList.add('is-dim');
    } else if (currentState === 'expired') {
      digits.textContent = '00:00:00';
      digits.classList.add('is-dim');
      // Description 4: "직전 만료 시각은 지우지 않는다" — 마지막으로 알려진
      // 만료 시각을 그대로 남겨둔다(4상태 보드의 대체 서브라벨은 힌트 쪽에 둔다).
      if (lastExpiryText) expiryLine.textContent = `${lastExpiryText} 만료`;
    } else {
      digits.classList.add(currentState === 'refreshing' ? 'is-warn' : 'is-bright');
      digits.textContent = expiresAtMs != null ? formatHMS((expiresAtMs - Date.now()) / 1000) : '00:00:00';
      if (expiresAtMs != null) {
        lastExpiryText = formatDateTime(new Date(expiresAtMs));
        expiryLine.textContent = `${lastExpiryText} 만료`;
      }
    }
    timerCard.appendChild(expiryLine);
    body.appendChild(timerCard);

    const statusRows = el('div', 'auth-status-rows');
    const accRow = labeledRow('계좌', accountAlias ? `${accountAlias} · 등록됨` : '등록됨');
    // Paper 19가 이 행에 붙인 이름이 「uk-lrow (클릭 → 계좌 전환)」이고, 그 보드는
    // 온보딩 3/3 화면이다(Paper 21의 머리도 같은 3/3이다) — 온보딩에서만 진입로를
    // 막던 조건을 걷어낸다.
    accRow.classList.add('is-clickable');
    accRow.title = '계좌 전환';
    accRow.addEventListener('click', openSwitch);
    statusRows.appendChild(accRow);
    statusRows.appendChild(labeledRow('자동 재발급', currentState === 'ready' ? '남은 10분에' : '—'));
    statusRows.appendChild(labeledRow('확인 주기', '60초마다'));
    body.appendChild(statusRows);

    const hint = el('div', 'onb-hint');
    if (currentState === 'ready') hint.textContent = '남은 시간이 10분 아래로 내려가면 자동으로 다시 받습니다. 직접 누를 필요는 없습니다.';
    else if (currentState === 'expired') hint.textContent = '다음 확인에서 인증 필요로 되돌아갑니다.';
    body.appendChild(hint);

    mountErrSlot(body);

    const statusLeft = el('div', 'auth-status-left');
    statusLeft.appendChild(stateDot(currentState));
    statusLeft.appendChild(el('span', 'auth-status-label', (STATE_META[currentState] || STATE_META.needed).label));
    foot.appendChild(statusLeft);

    const btnGroup = el('div', 'auth-btn-group');
    if (embedded) btnGroup.appendChild(button('text', '이전', { onClick: goBack }));
    if (currentState === 'ready' || currentState === 'refreshing') {
      btnGroup.appendChild(button('text', revoking ? '해제 중…' : '연결 해제', {
        disabled: currentState === 'refreshing' || revoking,
        onClick: doRevoke,
      }));
    }
    let label = '발급';
    let kind = 'primary';
    let disabled = false;
    if (currentState === 'ready') { label = '지금 재발급'; kind = 'ghost'; }
    else if (currentState === 'refreshing') { label = '발급 중'; kind = 'ghost'; disabled = true; }
    else if (currentState === 'expired') { label = '발급'; kind = 'ghost'; }
    btnGroup.appendChild(button(kind, label, { disabled, onClick: doAction }));

    if (embedded) {
      const ready = currentState === 'ready';
      btnGroup.appendChild(button('ghost', '계속', {
        icon: 'right',
        disabled: !ready,
        title: ready ? '' : '토큰이 준비되면 계속할 수 있습니다',
        onClick: proceed,
      }));
      if (ready) scheduleAutoContinue();
    }
    foot.appendChild(btnGroup);
  }

  async function doAction() {
    // scheduleAutoContinue()가 건 2.4초 타이머가 그대로 살아있으면, 사용자가
    // "지금 재발급"을 눌러 currentState가 바뀐 뒤에도 옛 ready 스냅샷을 기준으로
    // proceed()가 발동해 온보딩을 강제 통과시킨다(경합 실측) — 먼저 지운다.
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    clearErr();
    currentState = 'refreshing';
    paint();
    try {
      const res = await window.athena.invoke('athena:auth-token-refresh', { id: accountId });
      if (!res || !res.ok) showErr('발급/재발급에 실패했습니다.');
    } catch (err) {
      showErr('발급/재발급 요청 중 오류가 발생했습니다.');
    }
    await refreshStatus();
  }

  async function doRevoke() {
    // doAction()과 같은 경합 — "연결 해제" 클릭도 옛 예약된 자동진행을 지운다.
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    clearErr();
    revoking = true;
    paint();
    // 로컬 토큰은 upstream 결과와 무관하게 항상 지워진다(accounts.js의
    // tokenRevoke 주석 — auth.py의 finally-clear 결정을 그대로 따름). ok:false는
    // "연결은 해제됐지만 upstream 폐기 확인 자체는 실패했다"는 뜻이다. 메시지는
    // refreshStatus() **뒤에** 띄운다 — refreshStatus()도 내부에서 paint()를
    // 부르므로, 먼저 showErr()를 부르면 그 직후 paint()가 errBox를 새로 갈아
    // 끼우면서 메시지가 바로 지워진다(doAction()에 있는 것과 같은 순서 함정 —
    // 여기서는 새로 만드는 함수라 순서를 바꿔 피한다).
    let failMsg = null;
    try {
      const res = await window.athena.invoke('athena:auth-token-revoke', { id: accountId });
      if (!res || !res.ok) failMsg = '연결은 해제했지만 upstream 폐기 확인에는 실패했습니다.';
    } catch (err) {
      failMsg = '연결 해제 요청 중 오류가 발생했습니다.';
    }
    revoking = false;
    await refreshStatus();
    if (failMsg) showErr(failMsg);
  }

  function applyState(state, expiresInSec) {
    if (destroyed) return;
    currentState = state || 'needed';
    if (expiresInSec != null) expiresAtMs = Date.now() + Math.max(0, expiresInSec) * 1000;
    paint();
  }

  async function refreshStatus() {
    try {
      const [statusRes, accountsRes] = await Promise.all([
        window.athena.invoke('athena:auth-token-status', { id: accountId }),
        window.athena.invoke('athena:account-list'),
      ]);
      if (destroyed) return;
      const acc = accountsRes && accountsRes.accounts ? accountsRes.accounts.find((a) => a.id === accountId) : null;
      accountAlias = acc ? acc.alias : '';
      if (view === 'status') applyState(statusRes && statusRes.state, statusRes && statusRes.expiresInSec);
    } catch (err) {
      if (destroyed) return;
      if (view === 'status') { paint(); showErr('인증 상태를 불러오지 못했습니다.'); }
    }
  }

  // 디자인에는 이 화면 뒤에 "계속" 컨트롤이 없다(온보딩 마지막 확인 화면으로만
  // 그려져 있다) — 등록 직후 자동으로 정상 대화 화면으로 이어지도록 짧게 대기한다.
  // 이 지연·수동 "계속" 버튼 둘 다 발명이다 — 최종 리포트에 명시한다.
  function scheduleAutoContinue() {
    if (!embedded || autoContinueTimer || autoContinueFired) return;
    autoContinueTimer = setTimeout(() => { autoContinueTimer = null; proceed(); }, 2400);
  }

  async function proceed() {
    if (!embedded || autoContinueFired || destroyed) return;
    // 추가 방어 — 타이머가 걸린 뒤 상태가 ready를 벗어났다면(doAction/doRevoke가
    // 지우지 못한 경합이 남아있더라도) 여기서 다시 한번 막는다.
    if (currentState !== 'ready') return;
    autoContinueFired = true;
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    const result = onContinue ? await onContinue() : true;
    if (destroyed) return;
    const ok = result && typeof result === 'object' ? result.ok === true : result === true;
    if (!ok) {
      autoContinueFired = false;
      if (!(result && typeof result === 'object' && result.stale)) {
        showErr((result && typeof result === 'object' && result.error)
          || '다음 화면으로 진행하지 못했습니다. 다시 시도해주세요.');
      }
    }
  }

  function goBack() {
    if (!embedded || destroyed) return;
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    autoContinueFired = true;
    if (onBack) onBack();
  }

  // ---------- 계좌 전환 하위 뷰 (AT-CV-OAUTH-계좌-전환) ----------
  // 트리거는 위 "계좌" 상태 행 클릭이다 — Paper 19가 그 행 이름에 적어 둔 그대로다.
  async function openSwitch() {
    if (view === 'switch') return;
    // doAction/doRevoke와 같은 경합 — 목록을 고르는 동안 예약된 자동 진행이 터지면
    // 온보딩이 사용자를 이 화면 밖으로 끌어낸다.
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    view = 'switch';
    switchSelectedId = null;
    clear(body);
    clear(foot);
    body.appendChild(el('div', 'onb-hint', '계좌 목록을 불러오는 중…'));
    try {
      const data = await window.athena.invoke('athena:account-list');
      switchAccounts = (data && data.accounts) || [];
    } catch (err) {
      switchAccounts = [];
    }
    if (view === 'switch') paintSwitch();
  }

  function paintSwitch() {
    clear(body);
    clear(foot);

    body.appendChild(el('div', 'switch-count', `등록된 계좌 ${switchAccounts.length}`));

    const list = el('div', 'switch-list');
    for (const acc of switchAccounts) {
      const isActive = acc.id === accountId;
      const isSelected = switchSelectedId === acc.id;
      const r = el('div', `switch-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`);
      r.appendChild(el('span', `switch-dot${isActive ? ' is-filled' : ''}`));
      const nameCol = el('div', 'switch-namecol');
      nameCol.appendChild(el('div', 'switch-name', acc.alias));
      // 마스킹된 실제 계좌번호는 IPC 계약(account-list)에 필드가 없다 — 없는
      // 값을 지어내지 않고 고정 문구("키움증권")만 보여준다(백엔드 갭, 명시).
      nameCol.appendChild(el('div', 'switch-sub', '키움증권'));
      r.appendChild(nameCol);
      // 계약에 모의/실계좌 구분 필드가 없다 — 스펙 자체가 "현재는 모의투자만
      // 지원"이라고 명시하므로 고정값 "모의"를 쓴다(지어낸 데이터 아님).
      r.appendChild(el('span', 'switch-badge', '모의'));
      r.appendChild(el('span', 'switch-state', isActive ? '사용 중' : '선택'));
      if (!isActive) {
        r.classList.add('is-clickable');
        r.addEventListener('click', () => { switchSelectedId = acc.id; paintSwitch(); });
      }
      list.appendChild(r);
    }
    body.appendChild(list);

    const warn = el('div', 'switch-warning');
    warn.appendChild(el('span', 'switch-warning-bar'));
    warn.appendChild(el('span', 'switch-warning-text', '전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다.'));
    body.appendChild(warn);

    const flow = el('div', 'switch-flow');
    const steps = ['지금 토큰 폐기', '자격증명 교체', '새 토큰 발급', '실시간 재등록'];
    steps.forEach((step, i) => {
      flow.appendChild(el('span', 'switch-flow-step', step));
      if (i < steps.length - 1) flow.appendChild(el('span', 'switch-flow-arrow', '──▶'));
    });
    body.appendChild(flow);

    mountErrSlot(body);

    foot.appendChild(el('span', 'onb-hint', '한 번에 한 계좌만 사용할 수 있습니다'));
    const btns = el('div', 'switch-footer-btns');
    btns.appendChild(button('text', '취소', { onClick: closeSwitch }));
    btns.appendChild(button('primary', '전환하고 다시 인증', { disabled: !switchSelectedId, onClick: confirmSwitch }));
    foot.appendChild(btns);
  }

  function closeSwitch() {
    view = 'status';
    paint();
  }

  async function confirmSwitch() {
    clearErr();
    const targetId = switchSelectedId;
    if (!targetId) return;
    try {
      const res = await window.athena.invoke('athena:account-set-active', { id: targetId });
      if (res && res.ok) {
        accountId = targetId;
        view = 'status';
        currentState = 'refreshing';
        expiresAtMs = null;
        paint();
        await refreshStatus();
      } else {
        showErr('전환에 실패했습니다 — 이전 계좌를 유지합니다.');
      }
    } catch (err) {
      showErr('전환 요청 중 오류가 발생했습니다 — 이전 계좌를 유지합니다.');
    }
  }

  // ---------- 생애주기 ----------
  const tickInterval = setInterval(() => {
    if (destroyed || view !== 'status') return;
    if (currentState !== 'ready' && currentState !== 'refreshing') return;
    if (!currentTimerDigitsEl || expiresAtMs == null) return;
    // 등폭 숫자만 갱신 — prefers-reduced-motion과 무관하게 계속 돈다
    // (AT-CV-OAUTH-토큰-4상태.md "모션 축소 모드에서도 계속 갱신한다").
    currentTimerDigitsEl.textContent = formatHMS((expiresAtMs - Date.now()) / 1000);
  }, 1000);

  function onChanged(payload) {
    if (!payload || payload.id !== accountId) return;
    if (view === 'status') applyState(payload.state, payload.expiresInSec);
  }
  const unsubscribeAuthTokenChanged = window.athena.on('athena:auth-token-changed', onChanged);

  paint();
  // 「계좌 전환」으로 들어온 경우 목록부터 보여준다. view를 동기로 'switch'에
  // 두므로 뒤이은 refreshStatus()가 상태 화면으로 덮어쓰지 않는다(그 함수는
  // view === 'status'일 때만 그린다).
  if (o.initialView === 'switch') void openSwitch();
  refreshStatus();

  return function cleanup() {
    destroyed = true;
    clearInterval(tickInterval);
    if (autoContinueTimer) clearTimeout(autoContinueTimer);
    unsubscribeAuthTokenChanged();
  };
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { renderAuthTokenStatus };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AuthScreen = __exports;
}

})();

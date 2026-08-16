// 인증(토큰 상태) 화면 — AT-CV-OAUTH 3건을 하나의 실제 화면으로 통합 구현한다:
//   - AT-CV-OAUTH-인증토큰-상태.md   : 실제 레이아웃(마스트헤드 + 타이머 카드 +
//     상태 행 3개 + 하단 액션 바) — "준비됨" 상태 1종만 보여주는 스크린샷.
//   - AT-CV-OAUTH-토큰-4상태.md      : 위와 같은 화면이 상태(인증 필요/준비됨/
//     재발급 중/만료됨)에 따라 "숫자와 색만" 바뀐다는 명세 — 창 높이는 불변.
//   - AT-CV-OAUTH-계좌-전환.md       : 계좌 행을 누르면 여는 하위 뷰(같은 화면
//     안의 내부 상태 전환이지 새 창이 아니다).
// 셋 다 대화 창이 확장된 같은 화면이다(plan/paper-specs/00-통합-계획.md §1.5).
//
// IPC 계약 갭(house rule — 계약은 고정, 임의로 채널을 만들지 않는다):
// 스펙의 [연결 해제] 버튼에 대응하는 채널이 계약에 없다(athena:auth-token-status/
// -refresh와 athena:auth-token-changed 이벤트만 있다 — revoke/disconnect 없음).
// 버튼은 스펙대로 그리되 항상 비활성 + title로 갭을 알린다. 최종 리포트에도
// 별도로 남긴다 — 새 채널(예: athena:auth-token-revoke) 추가가 필요하다.

const { ipcRenderer } = require('electron');
const {
  el, button, labeledRow, statusDot, errorNote, clear,
} = require('./ui-kit');

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
//   embedded   — true면 온보딩(AT-SY-003) 직후 1회 노출되는 문맥. 계좌 전환
//                진입로를 막고, 상태가 "준비됨"이 되면 온보딩을 이어간다.
//   onContinue — embedded일 때만 사용. async () => boolean. 다음 화면(정상
//                대화 창)으로 넘어가도 되는지 chat.js에 위임한다.
function renderAuthTokenStatus(root, opts) {
  const o = opts || {};
  let accountId = o.accountId;
  const embedded = !!o.embedded;
  const onContinue = o.onContinue;

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
    if (!embedded) {
      accRow.classList.add('is-clickable');
      accRow.title = '계좌 전환';
      accRow.addEventListener('click', openSwitch);
    }
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
    if (currentState === 'ready' || currentState === 'refreshing') {
      btnGroup.appendChild(button('text', '연결 해제', {
        disabled: true,
        title: 'IPC 계약에 연결 해제 채널이 없어 비활성화했습니다 — 구현 갭(리포트 참고).',
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
    clearErr();
    currentState = 'refreshing';
    paint();
    try {
      const res = await ipcRenderer.invoke('athena:auth-token-refresh', { id: accountId });
      if (!res || !res.ok) showErr('발급/재발급에 실패했습니다.');
    } catch (err) {
      showErr('발급/재발급 요청 중 오류가 발생했습니다.');
    }
    await refreshStatus();
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
        ipcRenderer.invoke('athena:auth-token-status', { id: accountId }),
        ipcRenderer.invoke('athena:account-list'),
      ]);
      const acc = accountsRes && accountsRes.accounts ? accountsRes.accounts.find((a) => a.id === accountId) : null;
      accountAlias = acc ? acc.alias : '';
      if (view === 'status') applyState(statusRes && statusRes.state, statusRes && statusRes.expiresInSec);
    } catch (err) {
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
    autoContinueFired = true;
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
    const ok = onContinue ? await onContinue() : true;
    if (!ok && !destroyed) {
      autoContinueFired = false;
      showErr('다음 화면으로 진행하지 못했습니다. 다시 시도해주세요.');
    }
  }

  // ---------- 계좌 전환 하위 뷰 (AT-CV-OAUTH-계좌-전환) ----------
  // 트리거: 스펙은 "토큰 상태 화면에서 계좌 선택"이라고만 말한다 — 정확히 어느
  // 요소를 누르는지는 명시가 없어 위 "계좌" 상태 행 클릭으로 결정했다(발명).
  async function openSwitch() {
    if (embedded || view === 'switch') return;
    view = 'switch';
    switchSelectedId = null;
    clear(body);
    clear(foot);
    body.appendChild(el('div', 'onb-hint', '계좌 목록을 불러오는 중…'));
    try {
      const data = await ipcRenderer.invoke('athena:account-list');
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
      const res = await ipcRenderer.invoke('athena:account-set-active', { id: targetId });
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

  function onChanged(e, payload) {
    if (!payload || payload.id !== accountId) return;
    if (view === 'status') applyState(payload.state, payload.expiresInSec);
  }
  ipcRenderer.on('athena:auth-token-changed', onChanged);

  paint();
  refreshStatus();

  return function cleanup() {
    destroyed = true;
    clearInterval(tickInterval);
    if (autoContinueTimer) clearTimeout(autoContinueTimer);
    ipcRenderer.removeListener('athena:auth-token-changed', onChanged);
  };
}

module.exports = { renderAuthTokenStatus };

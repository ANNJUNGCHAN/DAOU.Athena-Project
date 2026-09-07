// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

// UMD 헤드(2026-08-18 렌더러 격리) — ipcRenderer는 window.athena 다리로
// 대체한다(preload.js). ui-kit require는 node --test/<script> 태그 겸용.
const {
  el, row, statusDot, badge, button, progressDots, errorNote, clear,
} = (typeof module !== 'undefined' && module.exports) ? require('./ui-kit') : window.AthenaLib.UiKit;

// CLI 로그인이 연 브라우저가 끝내 결과를 통보하지 않을 때의 안전장치 — 디자인에
// 없는 상태다(AT-SY-002 Open question 6). 이 타임아웃과 오류 문구는 발명이다.
const CLI_LOGIN_TIMEOUT_MS = 90000;
// cli-accounts.js 의 PROVIDER_ORDER/PROVIDER_NAMES 와 같은 집합이어야 한다
// ('athena:cli-list' 실패 시에만 쓰는 자리표시자이기 때문).
const CLI_FALLBACK_NAME = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };
const CLI_FALLBACK_ORDER = ['claude', 'grok', 'codex'];
const CLI_CONNECT_HINT = '연결을 누르면 해당 CLI의 로그인 명령이 새 터미널 창에서 실행됩니다. 로그인은 그 창에서 완료하세요. 계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다.';

function cliConnectFailHint(name, message) {
  const raw = String(message || '').trim();
  if (/설치되어 있지 않다/.test(raw)) {
    return `${name} CLI 실행 파일을 찾지 못했습니다. 설치 후 재시도하거나, 연결된 다른 CLI로 계속할 수 있습니다.`;
  }
  return raw || `${name} 로그인을 시작하지 못했습니다.`;
}

function buildShell(root, { kicker, title, sub }) {
  clear(root);
  const wrap = el('div', 'onb-col');
  const head = el('div', 'onb-head');
  if (kicker) head.appendChild(el('div', 'onb-kicker', kicker));
  head.appendChild(el('div', 'onb-title', title));
  head.appendChild(el('div', 'onb-sub', sub));
  const body = el('div', 'onb-body');
  const foot = el('div', 'onb-foot');
  wrap.appendChild(head);
  wrap.appendChild(body);
  wrap.appendChild(foot);
  root.appendChild(wrap);
  return { wrap, head, body, foot };
}

// 온보딩은 #shell 밖의 sibling overlay다. 반투명 패널만 올리면 실제 대화·캔버스가
// 뒤에서 계속 보이고 포커스도 받을 수 있으므로, 진행 중에는 셸 전체를 렌더·입력·
// 접근성 트리에서 함께 차단한다. revealChrome()이 hidden 속성을 다시 풀 수 있어
// 표시 차단은 전용 class가 소유하고, hidden은 채팅 영역에 한 번 더 적용한다.
function setAppBlockedForOnboarding(shell, app, blocked) {
  if (!shell || !app) return;
  if (blocked) {
    shell.classList.add('is-onboarding-hidden');
    shell.setAttribute('aria-hidden', 'true');
    shell.inert = true;
    app.hidden = true;
    return;
  }
  shell.classList.remove('is-onboarding-hidden');
  shell.removeAttribute('aria-hidden');
  shell.inert = false;
  shell.hidden = false;
  app.hidden = false;
}

function createOnboardingRevisionGuard() {
  let revision = 0;
  return {
    next: () => { revision += 1; return revision; },
    isCurrent: (candidate) => candidate === revision,
    invalidate: () => { revision += 1; },
  };
}

function resolveOnboardingStartStep(state) {
  if (!state || state.needed !== true) return null;
  return state.step === 3 ? 3 : 2;
}

function normalizeOnboardingAdvanceResult(result) {
  return {
    ok: !!(result && result.ok === true),
    done: !!(result && result.done === true),
  };
}

function completeOnboardingIfCurrent(result, revisionGuard, viewRevision, finish) {
  if (!revisionGuard || !revisionGuard.isCurrent(viewRevision)) return { ok: false, stale: true };
  if (result && result.ok === true && result.done === true) {
    if (typeof finish === 'function') finish();
    return { ok: true };
  }
  if (result && result.ok === true) {
    return { ok: false, error: '온보딩 완료 상태를 확인하지 못했습니다. 계좌 연결 상태를 다시 확인해주세요.' };
  }
  return { ok: false, error: '온보딩 완료 상태를 저장하지 못했습니다. 다시 시도해주세요.' };
}

// 온보딩 중에는 receipt를 화면에 그릴 수 없다. 조용히 버리면 main의 3초 waiter가
// timeout되므로 즉시 fail ACK한다. 원 요청은 reject되어 호출자가 온보딩 완료 뒤
// 다시 요청할 수 있고, receipt 본문은 큐에 보관하지 않아 오래된 내용·비밀이 후속
// 대화에 나타나지 않는다. 외부로 내보내는 사유는 호출자가 준 안정된 공개 코드
// 하나뿐이다 — 같은 오버레이를 쓰는 계좌 전환 화면은 자기 사유를 넘긴다.
function ackRestReceiptBlockedByOnboarding(onboard, send, receiptId, reason, receiptRevision) {
  if (!onboard || onboard.hidden || typeof send !== 'function') return false;
  send('athena:rest-receipt-painted', {
    receipt_id: receiptId,
    ...(receiptRevision ? { receipt_revision: receiptRevision } : {}),
    verified_visible: false,
    error: reason || 'onboarding_active',
  });
  return true;
}

// ---------- 2 / 3 — CLI 연결 (AT-SY-002) ----------
// onContinue: async () => boolean — [계속] 클릭 시 호출. false를 돌려주면 이
// 화면에 머무르며 오류를 보여준다(다음 단계 이동은 호출자=chat.js가 결정한다).
function renderCliStep(root, { onContinue }) {
  const { body, foot } = buildShell(root, {
    kicker: '2 / 3',
    title: '사용할 CLI를 연결합니다',
    sub: 'Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다.',
  });

  const list = el('div', 'onb-cli-list');
  // 스펙 원문은 "연결을 누르면 **브라우저에서** 해당 서비스에 로그인합니다"다.
  // 그 문장은 브라우저 리다이렉트 방식을 전제하는데, 그 방식은 스펙 자신이
  // 각주에서 "미정 — 협의 필요"로 남긴 것이고 우리는 다른 쪽(CLI 자체 로그인
  // 명령 위임)을 택했다. 실제로 열리는 건 브라우저가 아니라 터미널 창이다
  // (lib/main/cli-accounts.js의 login()). 화면이 브라우저를 약속하고 콘솔을
  // 띄우면 그건 사용자에게 거짓말이므로, 스펙 문장을 그대로 두지 않고 실제
  // 동작에 맞춘다 — 원문은 이 주석에 남긴다.
  const hint = el('div', 'onb-hint', CLI_CONNECT_HINT);
  const errSlot = el('div', 'onb-error-slot');
  body.appendChild(list);
  body.appendChild(hint);
  body.appendChild(errSlot);

  const dots = progressDots(3, 2);
  const spacer = el('div', 'onb-spacer');
  // 건너뛰기 없음(EV-0 Desc 5) — CLI가 하나도 연결되지 않으면 [계속]을 비활성화한다.
  // 디자인 보드는 이 0개 상태를 그리지 않는다 — 여기서 명시적으로 결정했다.
  const continueBtn = button('primary', '계속', { icon: 'right', disabled: true });
  foot.appendChild(dots);
  foot.appendChild(spacer);
  foot.appendChild(continueBtn);

  const pending = new Map(); // providerId -> timeoutId (브라우저 로그인 대기 중)
  // 마지막 연결 시도가 실패한 CLI(Paper 보드 33). 실패한 행은 [연결] 자리에
  // 「연결 실패 · 재시도」를 두고, 행 자체가 재시도가 된다.
  const failedConnect = new Set();
  const failHints = new Map();
  let destroyed = false;
  let lastProviders = [];

  function hasAccounts(p) { return (p.accounts || []).length > 0; }

  function renderAll() {
    clear(list);
    const anyAccount = lastProviders.some(hasAccounts);
    continueBtn.disabled = !anyAccount;
    continueBtn.title = anyAccount ? '' : 'CLI를 하나 이상 연결해야 계속할 수 있습니다 — 건너뛰기는 없습니다.';
    const failedId = [...failedConnect][0];
    hint.textContent = (failedId && failHints.get(failedId)) || CLI_CONNECT_HINT;
    for (const p of lastProviders) list.appendChild(renderProvider(p));
  }

  function renderProvider(p) {
    const accounts = p.accounts || [];
    const isPending = pending.has(p.id);
    if (accounts.length > 1) return renderCard(p, accounts, isPending);
    if (accounts.length === 1) return renderSingleConnected(p, accounts[0], isPending);
    return renderSingleUnconnected(p, isPending);
  }

  function waitingLabel() { return el('span', 'onb-cli-waiting', '로그인 대기 중…'); }

  function renderCard(p, accounts, isPending) {
    const card = el('div', 'onb-cli-card');
    const head = row('onb-cli-card-head', [statusDot(true), el('div', 'onb-cli-name', p.name)]);
    head.appendChild(el('div', 'onb-cli-spacer'));
    head.appendChild(isPending ? waitingLabel() : button('text', '계정 추가', { onClick: () => doConnect(p) }));
    card.appendChild(head);
    for (const acc of accounts) {
      const isActive = !!acc.active;
      const r = row(`onb-cli-account-row${isActive ? ' is-active' : ''}`, [
        el('span', 'onb-cli-email', acc.label),
        badge(isActive, isActive ? '활성' : '비활성'),
      ]);
      if (!isActive) {
        r.classList.add('is-clickable');
        r.addEventListener('click', () => setActive(acc.id));
      }
      card.appendChild(r);
    }
    return card;
  }

  function renderSingleConnected(p, acc, isPending) {
    const nameCol = el('div', 'onb-cli-namecol');
    nameCol.appendChild(el('div', 'onb-cli-name', p.name));
    nameCol.appendChild(el('div', 'onb-cli-email-sm', acc.label));
    const r = row('onb-cli-row', [statusDot(true), nameCol]);
    r.appendChild(el('div', 'onb-cli-spacer'));
    if (isPending) {
      r.appendChild(waitingLabel());
    } else {
      r.appendChild(badge(!!acc.active, acc.active ? '활성' : '비활성'));
      // 계정 1개 상태에서도 추가 연결 진입로를 연다(2026-08-27 검토 결정) —
      // 다계정 카드(renderCard)의 '계정 추가'와 같은 동작. 행 클릭(setActive)과
      // 겹치지 않게 전파를 끊는다.
      r.appendChild(button('text', '계정 추가', {
        onClick: (ev) => { ev.stopPropagation(); doConnect(p); },
      }));
    }
    if (!acc.active) {
      r.classList.add('is-clickable');
      r.addEventListener('click', () => setActive(acc.id));
    }
    return r;
  }

  function renderSingleUnconnected(p, isPending) {
    const r = row('onb-cli-row', [statusDot(false), el('div', 'onb-cli-name', p.name)]);
    r.appendChild(el('div', 'onb-cli-spacer'));
    if (isPending) {
      r.appendChild(waitingLabel());
    } else if (failedConnect.has(p.id)) {
      // Paper 보드 33은 이 자리를 버튼이 아니라 대기 라벨과 같은 텍스트로 그린다.
      // 그래서 재시도는 행 클릭이 받는다 — 비활성 계정 행(setActive)과 같은 관례.
      r.appendChild(el('span', 'onb-cli-waiting is-failed', '연결 실패 · 재시도'));
      r.classList.add('is-clickable');
      r.addEventListener('click', () => doConnect(p));
    } else {
      r.appendChild(button('ghost', '연결', { icon: 'up-right', onClick: () => doConnect(p) }));
    }
    return r;
  }

  async function doConnect(p) {
    clear(errSlot);
    failedConnect.delete(p.id);
    failHints.delete(p.id);
    try {
      const res = await window.athena.invoke('athena:cli-login', { providerId: p.id });
      if (!res || !res.ok) {
        failedConnect.add(p.id);
        failHints.set(p.id, cliConnectFailHint(p.name, res && res.message));
        renderAll();
        return;
      }
      if (res.launched) {
        const t = setTimeout(() => {
          if (destroyed) return;
          pending.delete(p.id);
          errSlot.appendChild(errorNote(`${p.name} 로그인이 완료되지 않았습니다 — 다시 시도해주세요.`));
          renderAll();
        }, CLI_LOGIN_TIMEOUT_MS);
        pending.set(p.id, t);
        renderAll();
      }
    } catch (err) {
      failedConnect.add(p.id);
      failHints.set(p.id, cliConnectFailHint(p.name, err && err.message));
      renderAll();
    }
  }

  async function setActive(accountId) {
    clear(errSlot);
    try {
      const res = await window.athena.invoke('athena:cli-set-active', { accountId });
      if (!res || !res.ok) { errSlot.appendChild(errorNote('활성 계정 전환에 실패했습니다.')); return; }
      await load();
    } catch (err) {
      errSlot.appendChild(errorNote('활성 계정 전환 중 오류가 발생했습니다.'));
    }
  }

  async function load() {
    clear(errSlot);
    try {
      const data = await window.athena.invoke('athena:cli-list');
      lastProviders = (data && data.providers) || [];
    } catch (err) {
      lastProviders = CLI_FALLBACK_ORDER.map((id) => ({ id, name: CLI_FALLBACK_NAME[id], connected: false, accounts: [] }));
      errSlot.appendChild(errorNote('CLI 목록을 불러오지 못했습니다.'));
    }
    renderAll();
  }

  function onChanged(data) {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    failedConnect.clear();
    failHints.clear();
    lastProviders = (data && data.providers) || [];
    renderAll();
  }
  const unsubscribeCliChanged = window.athena.on('athena:cli-changed', onChanged);

  continueBtn.addEventListener('click', async () => {
    continueBtn.disabled = true;
    clear(errSlot);
    const ok = await onContinue();
    if (!ok && !destroyed) {
      continueBtn.disabled = !lastProviders.some(hasAccounts);
      errSlot.appendChild(errorNote('다음 단계로 진행하지 못했습니다. 다시 시도해주세요.'));
    }
  });

  load();

  return function cleanup() {
    destroyed = true;
    unsubscribeCliChanged();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  };
}

// ---------- 3 / 3 — 계좌 연결 (AT-SY-003) ----------
// onRegistered: (accountId) => void — 등록·검증 성공 시 1회 호출. 다음 화면(인증
// 토큰 상태)으로의 전환은 호출자(chat.js)가 담당한다.
function renderAccountStep(root, {
  onRegistered, onBack, connectedAccountId, onUseRegistered,
}) {
  const { body, foot } = buildShell(root, {
    kicker: '3 / 3',
    title: '증권 계좌를 연결합니다',
    sub: '키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장되고 화면에 다시 나타나지 않습니다.',
  });

  const form = el('div', 'onb-form');
  body.appendChild(form);

  let destroyed = false;
  if (connectedAccountId) {
    const connected = el('div', 'onb-savebox onb-connected-account');
    const connectedInner = el('div', 'onb-savebox-inner');
    const connectedTitle = el('div', 'onb-savebox-title', '이미 연결된 계좌');
    const connectedBody = el('div', 'onb-savebox-body', '등록된 계좌 정보를 확인하고 있습니다.');
    const useRegistered = button('ghost', '인증 확인으로 돌아가기', {
      onClick: () => {
        if (!destroyed && onUseRegistered) onUseRegistered(connectedAccountId);
      },
    });
    connectedInner.appendChild(connectedTitle);
    connectedInner.appendChild(connectedBody);
    connected.appendChild(connectedInner);
    connected.appendChild(useRegistered);
    form.appendChild(connected);
    window.athena.invoke('athena:account-list').then((data) => {
      if (destroyed) return;
      const accounts = data && Array.isArray(data.accounts) ? data.accounts : [];
      const account = accounts.find((item) => item && item.id === connectedAccountId);
      connectedBody.textContent = account && account.alias
        ? `${account.alias} · 자격증명 저장됨`
        : '등록된 계좌 · 자격증명 저장됨';
    }, () => {
      if (!destroyed) connectedBody.textContent = '등록된 계좌 · 자격증명 저장됨';
    });
  }

  // 별칭 — 자유 텍스트로 다룬다. "선택" 라벨은 정적 보조 텍스트로 해석했다
  // (스펙 Open question: 피커일 가능성도 있으나 근거 부족 — 발명/결정 사항).
  const aliasGroup = el('div', 'onb-field');
  aliasGroup.appendChild(el('div', 'onb-field-label', '별칭'));
  const aliasRow = el('div', 'onb-input-row');
  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.className = 'onb-input';
  aliasInput.placeholder = '모의-1';
  aliasInput.autocomplete = 'off';
  aliasRow.appendChild(aliasInput);
  aliasRow.appendChild(el('span', 'onb-input-right', '선택'));
  aliasGroup.appendChild(aliasRow);
  aliasGroup.appendChild(el('div', 'onb-field-helper', '이 컴퓨터에서만 쓰는 이름이다. 증권사 계좌번호가 아니다.'));
  form.appendChild(aliasGroup);

  // 비밀값 필드 공통 빌더 — house rule 2: 값은 절대 JS 변수에 남기지 않는다.
  // secretMask(charCount)는 "저장됨" 문구(등록 이후 상태)라 이 화면(등록 전
  // "붙여넣음" 상태)의 스펙 문구와 다르다 — 여기서는 값-없는 카운터 텍스트를
  // 로컬로 직접 만든다(같은 계약: 길이만 다룬다).
  function secretField(labelText, helperText) {
    const group = el('div', 'onb-field');
    group.appendChild(el('div', 'onb-field-label', labelText));
    const r = el('div', 'onb-input-row');
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'onb-input onb-input-mono';
    input.autocomplete = 'new-password';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.spellcheck = false;
    // "붙여넣기만 지원한다" — 직접 타이핑(IME 조합 포함)은 막고 붙여넣기/삭제만
    // 허용한다. beforeinput의 inputType으로 판별한다(keydown 키코드 추정보다 견고).
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' || e.inputType === 'insertCompositionText') e.preventDefault();
    });
    const counter = el('span', 'onb-input-right', '');
    input.addEventListener('input', () => {
      const n = input.value.length; // 길이만 읽는다 — 값 자체는 어디에도 담지 않는다
      counter.textContent = n > 0 ? `붙여넣음 · ${n}자` : '';
      updateSubmitEnabled();
    });
    r.appendChild(input);
    r.appendChild(counter);
    group.appendChild(r);
    group.appendChild(el('div', 'onb-field-helper', helperText));
    form.appendChild(group);
    return input;
  }

  const appKeyInput = secretField('APP KEY', '붙여넣기만 지원한다. 입력한 값은 저장 후 다시 표시되지 않는다.');
  const secretKeyInput = secretField('SECRET KEY', '값이 아니라 문자 수만 보여준다 — 오타는 잡되 값은 노출하지 않는다.');

  const saveBox = el('div', 'onb-savebox');
  const saveBoxInner = el('div', 'onb-savebox-inner');
  saveBoxInner.appendChild(el('div', 'onb-savebox-title', '저장 위치'));
  saveBoxInner.appendChild(el('div', 'onb-savebox-body', 'Windows 자격증명 저장소(DPAPI)에 암호화되어 저장됩니다. 앱 화면·로그·스크린샷 어디에도 값이 다시 나타나지 않습니다.'));
  saveBoxInner.appendChild(el('div', 'onb-savebox-body', '여기서 등록한 계좌가 활성 계좌가 됩니다. 계좌는 나중에 더 추가할 수 있고, 활성은 항상 하나입니다.'));
  saveBox.appendChild(saveBoxInner);
  form.appendChild(saveBox);

  form.appendChild(el('div', 'onb-field-helper', '검증에 성공한 키만 저장됩니다. 실패하면 다음으로 넘어가지 않습니다.'));

  const errSlot = el('div', 'onb-error-slot');
  form.appendChild(errSlot);

  const dots = progressDots(3, 3);
  const spacer = el('div', 'onb-spacer');
  const backBtn = button('text', '이전', { onClick: () => { if (!destroyed && onBack) onBack(); } });
  const submitBtn = button('primary', '검증 후 시작', { icon: 'right', disabled: true });
  foot.appendChild(dots);
  foot.appendChild(spacer);
  foot.appendChild(backBtn);
  foot.appendChild(submitBtn);

  function updateSubmitEnabled() {
    submitBtn.disabled = !(appKeyInput.value.length > 0 && secretKeyInput.value.length > 0);
  }

  const ERROR_TEXT = {
    auth: '인증에 실패했습니다. APP KEY / SECRET KEY를 확인해주세요.',
    network: '네트워크 오류로 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
    ratelimit: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    invalid: '입력값을 다시 확인해주세요.',
  };

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    clear(errSlot);
    try {
      // 값은 여기서만, invoke() 인자 리터럴 안에서 딱 한 번 읽는다 — 변수에 담지 않는다.
      const res = await window.athena.invoke('athena:account-register', {
        alias: aliasInput.value.trim() || undefined,
        appKey: appKeyInput.value,
        secretKey: secretKeyInput.value,
      });
      appKeyInput.value = '';
      secretKeyInput.value = '';
      if (destroyed) return;
      if (res && res.ok) {
        onRegistered(res.id);
      } else {
        errSlot.appendChild(errorNote((res && ERROR_TEXT[res.error]) || '등록에 실패했습니다.'));
        updateSubmitEnabled();
      }
    } catch (err) {
      appKeyInput.value = '';
      secretKeyInput.value = '';
      if (destroyed) return;
      errSlot.appendChild(errorNote('등록 요청 중 오류가 발생했습니다.'));
      updateSubmitEnabled();
    }
  });

  return function cleanup() {
    destroyed = true;
    appKeyInput.value = '';
    secretKeyInput.value = '';
  };
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = {
  renderCliStep,
  cliConnectFailHint,
  renderAccountStep,
  setAppBlockedForOnboarding,
  createOnboardingRevisionGuard,
  resolveOnboardingStartStep,
  normalizeOnboardingAdvanceResult,
  completeOnboardingIfCurrent,
  ackRestReceiptBlockedByOnboarding,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.Onboarding = __exports;
}

})();

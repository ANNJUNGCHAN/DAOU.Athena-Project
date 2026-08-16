// 온보딩 2/3(CLI 연결)·3/3(계좌 연결) 화면. AT-SY-002 / AT-SY-003.
//
// 이 화면들은 새 창이 아니다 — 대화 창이 chatMaxH로 확장된 상태의 콘텐츠다
// (plan/paper-specs/00-통합-계획.md §1.1). 스펙의 800px "Onboarding Window"는
// 실제 창(1560px 폭 스케일)의 콘텐츠 컬럼으로만 다룬다 — 창을 흉내 낸 카드를
// 한 번 더 그리지 않는다(chat.html의 #onboard가 이미 .app과 같은 유리 패널이다).
//
// 렌더링 계약은 lib/markdown.js·lib/ui-kit.js와 동일: innerHTML에 문자열을 넣지
// 않는다. 전부 el()/textContent.
//
// 비밀값 계약(house rule 2 · AT-ST-007): APP KEY/SECRET KEY 값은 입력 요소에서
// ipcRenderer.invoke() 호출 인자로 "직접" 읽어 넘긴다 — 어떤 JS 변수에도 값
// 자체를 담아두지 않는다(길이만 읽어 카운터를 표시한다). 저장 성공/실패와
// 무관하게 클릭 직후 입력 필드도 곧바로 비운다.

const { ipcRenderer } = require('electron');
const {
  el, row, statusDot, badge, button, progressDots, errorNote, clear,
} = require('./ui-kit');

// CLI 로그인이 연 브라우저가 끝내 결과를 통보하지 않을 때의 안전장치 — 디자인에
// 없는 상태다(AT-SY-002 Open question 6). 이 타임아웃과 오류 문구는 발명이다.
const CLI_LOGIN_TIMEOUT_MS = 90000;
const CLI_FALLBACK_NAME = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', grok: 'Grok' };
const CLI_FALLBACK_ORDER = ['claude', 'gemini', 'codex', 'grok'];

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
  const hint = el('div', 'onb-hint', '연결을 누르면 해당 CLI의 로그인 명령이 새 터미널 창에서 실행됩니다. 로그인은 그 창에서 완료하세요. 계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다.');
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
  let destroyed = false;
  let lastProviders = [];

  function hasAccounts(p) { return (p.accounts || []).length > 0; }

  function renderAll() {
    clear(list);
    const anyAccount = lastProviders.some(hasAccounts);
    continueBtn.disabled = !anyAccount;
    continueBtn.title = anyAccount ? '' : 'CLI를 하나 이상 연결해야 계속할 수 있습니다 — 건너뛰기는 없습니다.';
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
    r.appendChild(isPending ? waitingLabel() : badge(!!acc.active, acc.active ? '활성' : '비활성'));
    if (!acc.active) {
      r.classList.add('is-clickable');
      r.addEventListener('click', () => setActive(acc.id));
    }
    return r;
  }

  function renderSingleUnconnected(p, isPending) {
    const r = row('onb-cli-row', [statusDot(false), el('div', 'onb-cli-name', p.name)]);
    r.appendChild(el('div', 'onb-cli-spacer'));
    r.appendChild(isPending ? waitingLabel() : button('ghost', '연결', { icon: 'up-right', onClick: () => doConnect(p) }));
    return r;
  }

  async function doConnect(p) {
    clear(errSlot);
    try {
      const res = await ipcRenderer.invoke('athena:cli-login', { providerId: p.id });
      if (!res || !res.ok) {
        errSlot.appendChild(errorNote(`${p.name} 로그인을 시작하지 못했습니다.${res && res.message ? ' ' + res.message : ''}`));
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
      errSlot.appendChild(errorNote(`${p.name} 로그인 요청 중 오류가 발생했습니다.`));
    }
  }

  async function setActive(accountId) {
    clear(errSlot);
    try {
      const res = await ipcRenderer.invoke('athena:cli-set-active', { accountId });
      if (!res || !res.ok) { errSlot.appendChild(errorNote('활성 계정 전환에 실패했습니다.')); return; }
      await load();
    } catch (err) {
      errSlot.appendChild(errorNote('활성 계정 전환 중 오류가 발생했습니다.'));
    }
  }

  async function load() {
    clear(errSlot);
    try {
      const data = await ipcRenderer.invoke('athena:cli-list');
      lastProviders = (data && data.providers) || [];
    } catch (err) {
      lastProviders = CLI_FALLBACK_ORDER.map((id) => ({ id, name: CLI_FALLBACK_NAME[id], connected: false, accounts: [] }));
      errSlot.appendChild(errorNote('CLI 목록을 불러오지 못했습니다.'));
    }
    renderAll();
  }

  function onChanged(e, data) {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    lastProviders = (data && data.providers) || [];
    renderAll();
  }
  ipcRenderer.on('athena:cli-changed', onChanged);

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
    ipcRenderer.removeListener('athena:cli-changed', onChanged);
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  };
}

// ---------- 3 / 3 — 계좌 연결 (AT-SY-003) ----------
// onRegistered: (accountId) => void — 등록·검증 성공 시 1회 호출. 다음 화면(인증
// 토큰 상태)으로의 전환은 호출자(chat.js)가 담당한다.
function renderAccountStep(root, { onRegistered }) {
  const { body, foot } = buildShell(root, {
    kicker: '3 / 3',
    title: '증권 계좌를 연결합니다',
    sub: '키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장되고 화면에 다시 나타나지 않습니다.',
  });

  const form = el('div', 'onb-form');
  body.appendChild(form);

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
  const submitBtn = button('primary', '검증 후 시작', { icon: 'right', disabled: true });
  foot.appendChild(dots);
  foot.appendChild(spacer);
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
      const res = await ipcRenderer.invoke('athena:account-register', {
        alias: aliasInput.value.trim() || undefined,
        appKey: appKeyInput.value,
        secretKey: secretKeyInput.value,
      });
      appKeyInput.value = '';
      secretKeyInput.value = '';
      if (res && res.ok) {
        onRegistered(res.id);
      } else {
        errSlot.appendChild(errorNote((res && ERROR_TEXT[res.error]) || '등록에 실패했습니다.'));
        updateSubmitEnabled();
      }
    } catch (err) {
      appKeyInput.value = '';
      secretKeyInput.value = '';
      errSlot.appendChild(errorNote('등록 요청 중 오류가 발생했습니다.'));
      updateSubmitEnabled();
    }
  });

  return function cleanup() {};
}

module.exports = { renderCliStep, renderAccountStep };

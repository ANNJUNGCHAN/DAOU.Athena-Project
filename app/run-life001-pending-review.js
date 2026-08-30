'use strict';

// LIFE-001 / Paper 27 온보딩 셸 + Paper 28 refreshing 상태 수동 검수 전용 런처.
// 매 실행 새 임시 프로필에서 production chat.js -> showAuthConfirm() ->
// auth-screen.js 경로를 그대로 통과한다. 계좌 등록과 토큰 상태만 메모리 fixture로
// 바꿔 실제 자격증명 저장이나 Kiwoom 네트워크 호출이 일어날 수 없게 한다.
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const {
  createFreshVerifyProfile,
  startVerifyProfileCleanupWatchdog,
} = require('./lib/main/verify-profile');

const CAPTURE_PATH = path.join(__dirname, 'captures', 'life001-auth-refreshing.png');
const REPORT_PATH = path.join(__dirname, 'captures', 'life001-auth-refreshing.json');
const FIXTURE_ACCOUNT_ID = 'life001-auth-refreshing-fixture-account';

const profile = createFreshVerifyProfile({ scenario: 'cli-complete' });
app.setPath('userData', profile.directory);
startVerifyProfileCleanupWatchdog(profile.directory, {
  tempRoot: profile.tempRoot,
  expectedRunId: profile.runId,
});

// main.js가 같은 모듈 객체를 받기 전에 두 외부효과 경계만 대체한다.
const accounts = require('./lib/main/accounts');
accounts.register = async () => ({ ok: true, id: FIXTURE_ACCOUNT_ID });
accounts.tokenStatus = () => ({ state: 'refreshing', expiresInSec: 3599, issuedAt: null });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForShell() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const shell = BrowserWindow.getAllWindows().find((win) => (
      !win.isDestroyed() && win.webContents.getURL().includes('shell.html')
    ));
    if (shell) return shell;
    await wait(100);
  }
  throw new Error('LIFE-001 shell window did not appear');
}

async function waitForRenderer(shell, predicateSource, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await shell.webContents.executeJavaScript(`Boolean(${predicateSource})`);
    if (matched) return;
    await wait(100);
  }
  throw new Error(`renderer condition timed out: ${predicateSource}`);
}

async function enterPendingState(shell) {
  await waitForRenderer(shell, `
    !document.querySelector('#onboard')?.hidden
      && document.querySelector('.onb-title')?.textContent === '증권 계좌를 연결합니다'
  `);

  await shell.webContents.executeJavaScript(`(() => {
    const fields = [...document.querySelectorAll('#onboard input')];
    const alias = fields.find((input) => input.type === 'text');
    const secrets = fields.filter((input) => input.type === 'password');
    if (!alias || secrets.length !== 2) throw new Error('account fields missing');
    alias.value = '검증용 모의계좌';
    secrets.forEach((input) => {
      input.value = 'fixture-only-not-a-credential';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = [...document.querySelectorAll('#onboard button')]
      .find((button) => button.textContent.trim().includes('검증 후 시작'));
    if (!submit || submit.disabled) throw new Error('account submit unavailable');
    submit.click();
  })()`);

  await waitForRenderer(shell, `
    document.querySelector('#onboard .onb-auth')
      && document.querySelector('#onboard .auth-status-label')?.textContent === '재발급 중'
  `);
}

async function inspectPendingState(shell) {
  return shell.webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll('#onboard button')].map((button) => ({
      label: button.textContent.trim(),
      disabled: button.disabled,
      className: button.className,
    }));
    const byLabel = (label) => buttons.find((button) => button.label === label);
    const rootText = document.querySelector('#onboard')?.innerText || '';
    const timerStyle = getComputedStyle(document.querySelector('#onboard .auth-timer-card'));
    const issueStyle = getComputedStyle([...document.querySelectorAll('#onboard button')]
      .find((button) => button.textContent.trim() === '발급 중'));
    const continueStyle = getComputedStyle([...document.querySelectorAll('#onboard button')]
      .find((button) => button.textContent.trim() === '계속'));
    const result = {
      surfaceVisible: Boolean(document.querySelector('#onboard .onb-auth')),
      stateLabel: document.querySelector('#onboard .auth-status-label')?.textContent || '',
      issueAction: byLabel('발급 중') || null,
      revokeAction: byLabel('연결 해제') || null,
      continueAction: byLabel('계속') || null,
      backAction: byLabel('이전') || null,
      secretInputCount: document.querySelectorAll('#onboard input[type="password"]').length,
      fixtureTextVisible: rootText.includes('fixture-only-not-a-credential'),
      appBlocked: document.querySelector('#shell')?.getAttribute('aria-hidden') === 'true'
        && document.querySelector('#shell')?.inert === true
        && document.querySelector('#app')?.hidden === true,
      cascade: {
        timerBackground: timerStyle.backgroundColor,
        timerBackgroundImage: timerStyle.backgroundImage,
        timerBackdropFilter: timerStyle.backdropFilter,
        timerBorderStyle: timerStyle.borderStyle,
        timerBorderWidth: timerStyle.borderWidth,
        issueBackground: issueStyle.backgroundColor,
        continueBackground: continueStyle.backgroundColor,
      },
    };
    result.ok = result.surfaceVisible
      && result.stateLabel === '재발급 중'
      && result.issueAction?.disabled === true
      && result.revokeAction?.disabled === true
      && result.continueAction?.disabled === true
      && result.backAction?.disabled === false
      && result.secretInputCount === 0
      && result.fixtureTextVisible === false
      && result.appBlocked === true
      && result.cascade.timerBackground === 'rgba(0, 0, 0, 0)'
      && result.cascade.timerBackgroundImage === 'none'
      && result.cascade.timerBackdropFilter === 'none'
      && result.cascade.timerBorderStyle === 'solid'
      && Number.parseFloat(result.cascade.timerBorderWidth) > 0
      && Number.parseFloat(result.cascade.timerBorderWidth) <= 1
      && result.cascade.issueBackground === 'rgba(0, 0, 0, 0)'
      && result.cascade.continueBackground === 'rgba(0, 0, 0, 0)';
    return result;
  })()`);
}

app.whenReady().then(async () => {
  try {
    const shell = await waitForShell();
    await enterPendingState(shell);
    const dom = await inspectPendingState(shell);
    if (!dom.ok) throw new Error(`auth refreshing DOM assertions failed: ${JSON.stringify(dom)}`);

    shell.maximize();
    shell.show();
    shell.focus();
    await wait(500);

    fs.mkdirSync(path.dirname(CAPTURE_PATH), { recursive: true });
    const png = await shell.webContents.capturePage();
    fs.writeFileSync(CAPTURE_PATH, png.toPNG());

    const report = {
      ok: true,
      scenario: 'LIFE-001 / Paper 27 onboarding shell + Paper 28 refreshing',
      fixtureOnly: true,
      externalCredentialWrite: false,
      kiwoomNetworkCall: false,
      process: { pid: process.pid },
      window: {
        id: shell.id,
        title: shell.getTitle(),
        bounds: shell.getBounds(),
        visible: shell.isVisible(),
        maximized: shell.isMaximized(),
      },
      dom,
      capturePath: CAPTURE_PATH,
      profile: { runId: profile.runId, cleanup: 'watchdog' },
    };
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report));
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  }
});

require('./main');

// 오브 대화 모드(board-33/34) 결선 확인 프로브 — "오브랑 대화 자체가 안된다"는
// 사용자 신고를 (1) 부팅 시 초기 상태 (2) 셸 숨김→오브 대화 모드 전이
// (3) 오브 입력에서 질의 제출→응답 (4) "대화창으로 가기"→셸 복귀+이력 백필,
// 네 단계로 나눠 실제 사람 클릭 경로로 태운다(phase4-traversal.js 패턴 —
// main.js를 라이브러리로 불러와 createWindows() 직접 호출).
// 백엔드(127.0.0.1:8010)가 이미 떠 있어야 한다. ATHENA_NO_AUTOSTART를 안
// 켠다 — Kiwoom 종목명 인덱스가 있어야 "삼성전자"가 REST 직결 fast-path로
// 풀린다(probe-chart-fastpath.js 관례와 동일하게 12초 대기).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-chat-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };

function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-chat] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function orbState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    const panel = document.getElementById('orbPanel');
    const inputStack = document.getElementById('orbInputStack');
    const chatBody = document.getElementById('orbChatBody');
    const input = document.getElementById('orbInput');
    return {
      orbMode: root ? root.dataset.orbMode : null,
      state: root ? root.dataset.state : null,
      panelHidden: panel ? panel.hidden : null,
      inputStackHidden: inputStack ? inputStack.hidden : null,
      chatBodyHidden: chatBody ? chatBody.hidden : null,
      inputVisible: !!(input && !input.hidden && input.offsetParent !== null),
    };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin 못 찾음');
  // createWindows()를 직접 부르는 프로브는 실제 BOOT→shell handoff를 생략한다.
  // hide/show 전이를 한 번 발생시켜 프로덕션 handoff가 보내는 것과 같은
  // athena:shell-visibility 초기 동기화를 만든다.
  shellWin.hide();
  await wait(100);
  shellWin.show();
  shellWin.focus();

  // Kiwoom 종목명 인덱스 채워질 때까지 대기(probe-chart-fastpath.js 관례)
  await wait(12000);

  // ---------- (1) 부팅 직후 초기 상태 ----------
  let s1 = null;
  const initialDeadline = Date.now() + 3000;
  while (Date.now() < initialDeadline) {
    s1 = await orbState(orbWin);
    if (s1.orbMode === 'alert') break;
    await wait(100);
  }
  record('01-boot-초기상태(셸 표시중이라 alert 모드여야 함)', s1.orbMode === 'alert', s1);

  // ---------- (2) 셸 숨김(닫기 버튼 경로) → 오브 대화 모드 전이 ----------
  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(500);
  const shellHiddenNow = !shellWin.isVisible();
  record('02a-winClose 클릭 후 셸 숨김', shellHiddenNow, { visible: shellWin.isVisible() });

  const s2 = await orbState(orbWin);
  record('02b-셸 숨김 후 오브 orbMode=chat 전이', s2.orbMode === 'chat', s2);

  // 오브 펼치기 — 입력창은 펼친 패널 안에 있다
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(400);
  const s3 = await orbState(orbWin);
  record('02c-오브 펼침 후 입력창 노출', s3.state === 'expanded' && s3.inputVisible, s3);

  await orbWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-chat-02-expanded.png'), img.toPNG());
  });

  // ---------- (3) 오브 입력에서 질의 제출(REST 직결 fast-path, 모델 비용 없음) ----------
  const QUERY = '삼성전자 현재가 알려줘';
  const submitStart = Date.now();
  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = ${JSON.stringify(QUERY)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  // 답변 턴이 나타날 때까지 폴링(최대 15초)
  let turnResult = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    turnResult = await orbWin.webContents.executeJavaScript(`(() => {
      const turns = document.getElementById('orbChatTurns');
      const answers = turns ? turns.querySelectorAll('.orb-turn-a') : [];
      return {
        turnCount: turns ? turns.children.length : 0,
        lastAnswerText: answers.length ? answers[answers.length - 1].textContent : null,
        kiumiCards: Array.from(document.querySelectorAll('.orb-kiumi-card')).map((card) => ({
          boardId: card.dataset.boardId || null,
          grammar: card.dataset.kiumiGrammar || null,
          height: Math.round(card.getBoundingClientRect().height),
          clientHeight: card.clientHeight,
          scrollHeight: card.scrollHeight,
        })),
      };
    })()`);
    if (turnResult.lastAnswerText && turnResult.kiumiCards.length > 0) break;
    await wait(300);
  }
  const submitElapsedMs = Date.now() - submitStart;
  record('03-질의 제출→답변 턴 렌더', !!(turnResult && turnResult.lastAnswerText), { ...turnResult, elapsedMs: submitElapsedMs });
  const directCard = turnResult && turnResult.kiumiCards && turnResult.kiumiCards[0];
  record('03b-REST 직결 카드가 키우미 360×420 표면으로 전달됨',
    !!directCard && directCard.boardId && directCard.height === 420
      && directCard.scrollHeight <= directCard.clientHeight,
    directCard || null);

  await orbWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-chat-03-answered.png'), img.toPNG());
  });

  // ---------- (4) "대화창으로 가기" → 셸 복귀 + 이력 백필 ----------
  await orbWin.webContents.executeJavaScript("document.getElementById('orbChatGo').click()");
  await wait(600);
  const shellVisibleAfterGo = shellWin.isVisible();
  record('04a-대화창으로 가기 → 셸 표시', shellVisibleAfterGo, { visible: shellVisibleAfterGo });

  const backfill = await shellWin.webContents.executeJavaScript(`(() => {
    const body = document.body.innerHTML;
    return { hasSamsung: body.includes('삼성전자'), bodyLen: body.length };
  })()`).catch((e) => ({ error: String(e) }));
  record('04b-셸 DOM에 오브 턴 백필', !!(backfill && backfill.hasSamsung), backfill);

  await shellWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-chat-04-shell-backfilled.png'), img.toPNG());
  });

  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-chat-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-chat] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-chat] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-chat-fatal.log'), String((err && err.stack) || err));
  app.exit(1);
});

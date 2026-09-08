// 미니 주문 티켓 실질의 프로브(2026-08-27, Step 10c/board-33⑤·CP2 승인) —
// 오브 대화 모드에 실제 질의를 태워 athena:orb-canvas-result로 도착한
// facts(card_title="주문 티켓") 엔벌로프가 orb.js renderOrbTicket()을 거쳐
// #orbTicket으로 실제로 그려지는지, 값이 엔벌로프 1:1인지("없는 필드 행
// 미생성" 포함), 실행 버튼이 기존 athena:order-execute IPC를 셸(chat.js)과
// 같은 페이로드 계약({trId, body, idempotencyKey})으로 실제로 쏘는지, 취소가
// 새 채널 없이 티켓을 닫기만 하는지 화면 캡처·IPC 가로채기로 확인한다.
//
// 2026-08-27 CP2 확장 승인(결함4/5, 사용자 질의응답) 보강 — 셸 동등성의
// 나머지 절반: ① 게이트 차단 계좌(athena:account-list gateBlocker 사유로
// 실행 버튼이 잠기고 사유가 보이는지), ② 실행 실패 응답(조용히 닫히지
// 않고 실패가 표시되며 티켓이 유지되는지 — 옛 12번 스텝의 "실패인데 조용히
// 닫힘" 통과 기준을 뒤집는다), ③ IN_DOUBT(409) 응답(재전송 금지 경고와 함께
// 티켓이 유지되고 실행 버튼이 종결 잠김되는지)까지 화면 상태로 확인한다.
// account-list 응답도 athena:order-execute처럼 시나리오마다 갈아 끼운다
// (실제 계좌 상태를 건드리지 않는다).
//
// 실제 주문 API는 절대 타지 않는다 — main.js가 등록한 진짜
// athena:order-execute/athena:account-list 핸들러를 probe 시작 직후 스텁으로
// 갈아 끼워 인자만 가로채고 시나리오별 응답을 돌려준다
// (probe-orb-table-fold-card.js와 같은 원칙으로, 가짜 claude 실행 파일을
// csc.exe로 즉석 컴파일해 LLM도 부르지 않는다).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { captureRoot } = require('./lib/probe-captures');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = captureRoot(__dirname);

const PROFILE = path.join(__dirname, '.probe-orb-order-ticket-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

process.env.ATHENA_CANVAS_SOURCE = 'fixture'; // WS 사이드채널(범위 밖) 끈다

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('csc.exe(.NET Framework)를 못 찾았다 — 가짜 claude 실행 파일을 컴파일할 수 없다');
  return found;
}

// render_canvas 성공 1건(facts, card_title="주문 티켓")만 stdout에 쏟는
// 최소 실행 파일. 필드 5개 중 symbol_name은 종목 행 조립에만 쓰고 별도
// 라벨 행을 만들지 않는다(orb.js orbTicketFieldValue 계약).
function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-orderticket-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const src = `
using System;

class Program {
  static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    char q = (char)34;

    string fields =
      "[" +
      "{" + q + "key" + q + ":" + q + "symbol" + q + "," + q + "label" + q + ":" + q + "종목" + q + "," + q + "value" + q + ":" + q + "005930" + q + "}," +
      "{" + q + "key" + q + ":" + q + "symbol_name" + q + "," + q + "label" + q + ":null," + q + "value" + q + ":" + q + "삼성전자" + q + "}," +
      "{" + q + "key" + q + ":" + q + "side" + q + "," + q + "label" + q + ":" + q + "구분" + q + "," + q + "value" + q + ":" + q + "buy" + q + "}," +
      "{" + q + "key" + q + ":" + q + "qty" + q + "," + q + "label" + q + ":" + q + "수량" + q + "," + q + "value" + q + ":10}," +
      "{" + q + "key" + q + ":" + q + "estimated_amount" + q + "," + q + "label" + q + ":" + q + "예상 체결금액" + q + "," + q + "value" + q + ":881000}" +
      "]";

    string envelope =
      "{" + q + "card_title" + q + ":" + q + "주문 티켓" + q + "," +
      q + "caption" + q + ":" + q + "모의-주력" + q + "," +
      q + "canvas_type" + q + ":" + q + "facts" + q + "," +
      q + "fell_back" + q + ":false," +
      q + "data" + q + ":{" + q + "fields" + q + ":" + fields + "}" +
      "}";

    string esc = envelope.Replace(q.ToString(), "\\\\" + q);

    Console.WriteLine("{" + q + "type" + q + ":" + q + "assistant" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_use" + q + "," + q + "id" + q + ":" + q + "tu1" + q + "," + q + "name" + q + ":" + q + "mcp__athena__athena__render_canvas" + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "user" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_result" + q + "," + q + "tool_use_id" + q + ":" + q + "tu1" + q + "," + q + "content" + q + ":" + q + esc + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "result" + q + "," + q + "is_error" + q + ":false," + q + "result" + q + ":" + q + "티켓을 만들었습니다. 실행 전에는 아무 일도 일어나지 않습니다." + q + "," + q + "session_id" + q + ":" + q + "FAKE-SESSION-ORDER-TICKET" + q + "}");
    Environment.Exit(0);
  }
}`;
  fs.writeFileSync(csPath, src, 'utf-8');
  execFileSync(findCsc(), ['/nologo', `/out:${exePath}`, csPath], { stdio: 'pipe' });
  return exePath;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-order-ticket] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function capturePngWithTimeout(win, fileName, timeoutMs = 5000) {
  const image = await Promise.race([
    win.webContents.capturePage(),
    wait(timeoutMs).then(() => null),
  ]);
  if (!image) {
    console.warn(`[probe-orb-order-ticket] 캡처 시간 제한 초과 — ${fileName}`);
    return false;
  }
  fs.writeFileSync(path.join(OUT_DIR, fileName), image.toPNG());
  return true;
}

// evalJs가 null 아닌 값을 낼 때까지 기다린다(결함4/5 보강 — 게이트 조회·실행
// 결과가 비동기라 정적 wait()만으로는 스텝마다 타이밍을 손으로 맞춰야 했다).
async function pollFor(win, evalJs, deadlineMs, stepMs = 200) {
  const deadline = Date.now() + deadlineMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await win.webContents.executeJavaScript(evalJs);
    if (result) return result;
    await wait(stepMs);
  }
  return result;
}

const QUERY_TEXT = '삼성전자 10주 시장가로 사줘';
async function submitOrbQuery(win) {
  await win.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = ${JSON.stringify(QUERY_TEXT)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
}

// 티켓이 실제로 뜬 뒤(#orbTicket 안 hidden) 게이트 조회가 끝날 때까지 잰다 —
// 조회 중에는 실행 버튼이 잠기고 게이트 고지는 아직 안 뜬다(refreshTicketGate의
// 자리표시자 구간, orb.js). 둘 중 하나가 정해지면(활성 or 차단 사유 표시)
// 그 시점 스냅샷을 돌려준다.
function gateSettledExpr() {
  return `(() => {
    const t = document.getElementById('orbTicket');
    if (t.hidden) return null;
    const exec = document.getElementById('orbTicketExec');
    const gate = document.getElementById('orbTicketGate');
    if (exec.disabled && gate.hidden) return null; // 아직 계좌 조회 중
    return { execDisabled: exec.disabled, gateHidden: gate.hidden, gateText: gate.textContent };
  })()`;
}

function ticketStatusExpr() {
  return `(() => {
    const st = document.getElementById('orbTicketStatus');
    if (st.hidden) return null;
    return {
      ticketHidden: document.getElementById('orbTicket').hidden,
      statusText: st.textContent,
      statusIsFailed: st.classList.contains('is-failed'),
      statusIsDoubt: st.classList.contains('is-doubt'),
      execDisabled: document.getElementById('orbTicketExec').disabled,
    };
  })()`;
}

async function main() {
  const exePath = compileFakeClaude();
  process.env.ATHENA_CLAUDE_BIN = exePath;

  const mainMod = require('./main.js');

  // 실제 주문 API/계좌 상태를 절대 타지 않는다 — 진짜 핸들러를 스텁으로
  // 갈아 끼우고 인자만 가로챈다. 응답은 시나리오마다 바깥 변수를 바꿔 끼우는
  // 방식으로 갈아 끼운다(핸들러 재등록 없이) — main.js가 이미 두 핸들러를
  // 모듈 로드 시점에 등록해 뒀으므로 여기서 한 번만 걷어내고 다시 심는다.
  let capturedInvoke = null;
  let orderExecuteResponse = { ok: false, status: 0, error: 'probe-stub — 실제 주문 API 미호출' };
  ipcMain.removeHandler('athena:order-execute');
  ipcMain.handle('athena:order-execute', async (_e, args) => {
    capturedInvoke = args;
    return orderExecuteResponse;
  });

  // 게이트 조회 스텁(결함4 보강) — 기본은 활성 계좌(주문 API 켜짐, 게이트
  // 통과)로 둬서 기존 렌더·페이로드 계약 검증(01~13)이 그대로 실행 버튼을
  // 쓸 수 있게 한다. 차단 시나리오는 이 값을 바꿔 끼운다.
  let accountListResponse = { accounts: [{ id: 'probe-acc', alias: '모의-주력', active: true, orderApi: true }] };
  ipcMain.removeHandler('athena:account-list');
  ipcMain.handle('athena:account-list', async () => accountListResponse);

  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin 못 찾음');
  shellWin.show();
  shellWin.focus();
  await wait(1000);

  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(500);
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(400);

  await submitOrbQuery(orbWin);

  const deadline = Date.now() + 20000;
  let ticketState = null;
  while (Date.now() < deadline) {
    ticketState = await orbWin.webContents.executeJavaScript(`(() => {
      const t = document.getElementById('orbTicket');
      if (!t || t.hidden) return null;
      function rowText(rowId, valId) {
        const row = document.getElementById(rowId);
        return row.hidden ? null : document.getElementById(valId).textContent;
      }
      return {
        account: document.getElementById('orbTicketAccount').textContent,
        symbol: rowText('orbTicketRowSymbol', 'orbTicketSymbol'),
        side: rowText('orbTicketRowSide', 'orbTicketSide'),
        sideIsBuyClass: document.getElementById('orbTicketSide').classList.contains('is-buy'),
        qty: rowText('orbTicketRowQty', 'orbTicketQty'),
        amount: rowText('orbTicketRowAmount', 'orbTicketAmount'),
        execDisabled: document.getElementById('orbTicketExec').disabled,
      };
    })()`);
    if (ticketState) break;
    await wait(300);
  }

  record('01-티켓이 실제로 렌더됐다(#orbTicket이 안 hidden)', !!ticketState, ticketState);
  record('02-계좌 캡션이 엔벌로프 caption 그대로', !!ticketState && ticketState.account === '모의-주력', ticketState);
  record('03-종목 행 = symbol_name + symbol(값 1:1)', !!ticketState && ticketState.symbol === '삼성전자 005930', ticketState);
  record('04-구분 행 = 매수 · 시장가 + is-buy 톤', !!ticketState && ticketState.side === '매수 · 시장가' && ticketState.sideIsBuyClass === true, ticketState);
  record('05-수량 행 = 10주(계산 없이 그대로)', !!ticketState && ticketState.qty === '10주', ticketState);
  record('06-예상 체결금액 = 881,000원(오브가 가격×수량을 계산하지 않는다)', !!ticketState && ticketState.amount === '881,000원', ticketState);

  // 게이트가 열려 있으면(계좌 활성 + 주문 API on) 조회가 끝나는 순간
  // 실행 버튼이 풀린다 — 필수값 충족만으로는 더 이상 충분하지 않다(결함4).
  const gateOpenState = await pollFor(orbWin, gateSettledExpr(), 5000);
  record('07-게이트 통과(계좌 활성) + 필수값 충족으로 실행 버튼이 풀린다', !!gateOpenState && gateOpenState.execDisabled === false && gateOpenState.gateHidden === true, gateOpenState);

  await wait(300);
  await capturePngWithTimeout(orbWin, 'probe-orb-order-ticket-rendered.png');

  // 실행 클릭 — athena:order-execute가 셸과 같은 페이로드 계약으로 발화하는지.
  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketExec').click()");
  const execDeadline = Date.now() + 5000;
  while (Date.now() < execDeadline && capturedInvoke === null) await wait(100);

  record('08-실행 클릭 시 athena:order-execute가 실제로 발화했다', capturedInvoke !== null, capturedInvoke);
  record('09-trId가 매수 TR(kt10000)이다', !!capturedInvoke && capturedInvoke.trId === 'kt10000', capturedInvoke);
  record('10-body.stk_cd/ord_qty/trde_tp가 셸(chat.js)과 같은 계약', !!capturedInvoke && capturedInvoke.body
    && capturedInvoke.body.stk_cd === '005930' && capturedInvoke.body.ord_qty === '10' && capturedInvoke.body.trde_tp === '3', capturedInvoke);
  record('11-idempotencyKey가 채워져 있다(멱등키 없이 안 쏜다)', !!capturedInvoke && typeof capturedInvoke.idempotencyKey === 'string' && capturedInvoke.idempotencyKey.length > 0, capturedInvoke);

  // 결함5 보강 — 응답이 실패(status:0, probe 기본 스텁)면 조용히 닫히면 안
  // 된다. 옛 12번 스텝("실행 후 티켓이 닫힌다")의 정반대를 이제 통과 기준으로
  // 삼는다: 티켓 유지 + 실패 표시 + 재시도를 위해 실행 버튼이 다시 풀린다.
  const failState = await pollFor(orbWin, ticketStatusExpr(), 5000);
  record('12-실패 응답은 티켓을 유지하고 실패를 표시한다(조용히 닫히지 않는다)',
    !!failState && failState.ticketHidden === false && failState.statusIsFailed === true && failState.statusText.includes('실패'),
    failState);
  record('13-실패 후 실행 버튼이 재시도를 위해 다시 풀린다(gate 열림 유지)', !!failState && failState.execDisabled === false, failState);

  // 취소 경로 — 실패로 열려 있던 티켓을 취소해 새 IPC 없이 닫기만 하는지, 게이트/
  // 결과 표시도 같이 지워지는지 본다.
  capturedInvoke = null;
  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketCancel').click()");
  await wait(300);
  const afterCancel = await orbWin.webContents.executeJavaScript(`(() => ({
    ticketHidden: document.getElementById('orbTicket').hidden,
    gateHidden: document.getElementById('orbTicketGate').hidden,
    statusHidden: document.getElementById('orbTicketStatus').hidden,
  }))()`);
  record('14-취소는 티켓만 닫고 order-execute를 부르지 않는다(게이트·결과 표시도 지운다)',
    !!afterCancel && afterCancel.ticketHidden === true && afterCancel.gateHidden === true && afterCancel.statusHidden === true && capturedInvoke === null,
    { afterCancel, capturedInvoke });

  // ── 시나리오 ①(결함4) — 게이트 차단 계좌: 실행 버튼 잠김 + 사유 표시 ──
  accountListResponse = { accounts: [{ id: 'probe-acc', alias: '모의-주력', active: true, orderApi: false }] };
  capturedInvoke = null;
  await wait(500); // chatBusy가 확실히 풀린 뒤 다음 질의를 넣는다
  await submitOrbQuery(orbWin);
  const blockedState = await pollFor(orbWin, gateSettledExpr(), 8000);
  record('15-주문 API 비활성 계좌면 실행 버튼이 잠긴다', !!blockedState && blockedState.execDisabled === true, blockedState);
  record('16-차단 사유 문구가 뜬다("지금은 실행할 수 없음" + gateBlocker 사유)',
    !!blockedState && blockedState.gateHidden === false && blockedState.gateText.includes('지금은 실행할 수 없음') && blockedState.gateText.includes('주문 API가 OFF'),
    blockedState);

  // 잠긴 버튼은 클릭해도 IPC를 못 쏜다(disabled 네이티브 동작 — 새 방어 장치를
  // 더 두지 않아도 이미 막힌다는 확인).
  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketExec').click()");
  await wait(300);
  record('17-잠긴 실행 버튼을 눌러도 athena:order-execute가 안 뜬다', capturedInvoke === null, { capturedInvoke });

  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketCancel').click()");
  await wait(300);

  // ── 시나리오 ③(결함5) — IN_DOUBT(409): 재전송 금지 경고 + 티켓 유지 + 종결 잠김 ──
  accountListResponse = { accounts: [{ id: 'probe-acc', alias: '모의-주력', active: true, orderApi: true }] };
  orderExecuteResponse = { ok: false, status: 409, error: 'IN_DOUBT' };
  capturedInvoke = null;
  await wait(500);
  await submitOrbQuery(orbWin);
  const doubtGateState = await pollFor(orbWin, gateSettledExpr(), 8000);
  record('18-in_doubt 시나리오 진입 전 게이트가 다시 열린다', !!doubtGateState && doubtGateState.execDisabled === false, doubtGateState);

  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketExec').click()");
  const doubtInvokeDeadline = Date.now() + 5000;
  while (Date.now() < doubtInvokeDeadline && capturedInvoke === null) await wait(100);
  record('19-IN_DOUBT 실행도 athena:order-execute를 실제로 쏜다', capturedInvoke !== null, capturedInvoke);

  const doubtState = await pollFor(orbWin, ticketStatusExpr(), 5000);
  record('20-409(IN_DOUBT)는 티켓을 유지하고 재전송 금지 경고를 보여준다',
    !!doubtState && doubtState.ticketHidden === false && doubtState.statusIsDoubt === true
      && doubtState.statusText.includes('IN_DOUBT') && doubtState.statusText.includes('재전송하지 않습니다'),
    doubtState);
  record('21-IN_DOUBT는 종결 상태라 실행 버튼이 다시 잠긴다(재시도 불가)', !!doubtState && doubtState.execDisabled === true, doubtState);

  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-order-ticket-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-order-ticket] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-order-ticket] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-order-ticket-fatal.log'), String((err && err.stack) || err));
  app.exit(1);
});

// 미니 주문 티켓 실질의 프로브(2026-08-27, Step 10c/board-33⑤·CP2 승인) —
// 오브 대화 모드에 실제 질의를 태워 athena:orb-canvas-result로 도착한
// facts(card_title="주문 티켓") 엔벌로프가 orb.js renderOrbTicket()을 거쳐
// #orbTicket으로 실제로 그려지는지, 값이 엔벌로프 1:1인지("없는 필드 행
// 미생성" 포함), 실행 버튼이 기존 athena:order-execute IPC를 셸(chat.js)과
// 같은 페이로드 계약({trId, body, idempotencyKey})으로 실제로 쏘는지, 취소가
// 새 채널 없이 티켓을 닫기만 하는지 화면 캡처·IPC 가로채기로 확인한다.
//
// 실제 주문 API는 절대 타지 않는다 — main.js가 등록한 진짜
// athena:order-execute 핸들러를 probe 시작 직후 스텁으로 갈아 끼워 인자만
// 가로채고 즉시 실패 응답을 돌려준다(probe-orb-table-fold-card.js와 같은
// 원칙으로, 가짜 claude 실행 파일을 csc.exe로 즉석 컴파일해 LLM도 부르지
// 않는다).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-order-ticket-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
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

async function main() {
  const exePath = compileFakeClaude();
  process.env.ATHENA_CLAUDE_BIN = exePath;

  const mainMod = require('./main.js');

  // 실제 주문 API를 절대 타지 않는다 — 진짜 핸들러를 스텁으로 갈아 끼우고
  // 인자만 가로챈다. main.js가 이미 ipcMain.handle('athena:order-execute', …)을
  // 모듈 로드 시점에 등록해 뒀으므로 여기서 걷어내고 다시 심는다.
  let capturedInvoke = null;
  ipcMain.removeHandler('athena:order-execute');
  ipcMain.handle('athena:order-execute', async (_e, args) => {
    capturedInvoke = args;
    return { ok: false, status: 0, error: 'probe-stub — 실제 주문 API 미호출' };
  });

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

  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = ${JSON.stringify('삼성전자 10주 시장가로 사줘')};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

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
  record('07-실행 버튼이 필수값 충족으로 활성 상태', !!ticketState && ticketState.execDisabled === false, ticketState);

  await wait(300);
  await orbWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-order-ticket-rendered.png'), img.toPNG());
  });

  // 실행 클릭 — athena:order-execute가 셸과 같은 페이로드 계약으로 발화하는지.
  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketExec').click()");
  const execDeadline = Date.now() + 5000;
  while (Date.now() < execDeadline && capturedInvoke === null) await wait(100);

  record('08-실행 클릭 시 athena:order-execute가 실제로 발화했다', capturedInvoke !== null, capturedInvoke);
  record('09-trId가 매수 TR(kt10000)이다', !!capturedInvoke && capturedInvoke.trId === 'kt10000', capturedInvoke);
  record('10-body.stk_cd/ord_qty/trde_tp가 셸(chat.js)과 같은 계약', !!capturedInvoke && capturedInvoke.body
    && capturedInvoke.body.stk_cd === '005930' && capturedInvoke.body.ord_qty === '10' && capturedInvoke.body.trde_tp === '3', capturedInvoke);
  record('11-idempotencyKey가 채워져 있다(멱등키 없이 안 쏜다)', !!capturedInvoke && typeof capturedInvoke.idempotencyKey === 'string' && capturedInvoke.idempotencyKey.length > 0, capturedInvoke);

  const closedState = await orbWin.webContents.executeJavaScript(
    "document.getElementById('orbTicket').hidden",
  );
  record('12-실행 후 티켓이 닫힌다(영수증 카드를 새로 만들지 않는다)', closedState === true, { closedState });

  // 취소 경로 — 두 번째 티켓을 새로 띄워 취소가 새 IPC 없이 닫기만 하는지 본다.
  capturedInvoke = null;
  await orbWin.webContents.executeJavaScript(`(() => {
    const t = document.getElementById('orbTicket');
    t.hidden = false;
    document.getElementById('orbTicketRowSymbol').hidden = false;
  })()`);
  await orbWin.webContents.executeJavaScript("document.getElementById('orbTicketCancel').click()");
  await wait(300);
  const afterCancel = await orbWin.webContents.executeJavaScript(
    "document.getElementById('orbTicket').hidden",
  );
  record('13-취소는 티켓만 닫고 order-execute를 부르지 않는다', afterCancel === true && capturedInvoke === null, { afterCancel, capturedInvoke });

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

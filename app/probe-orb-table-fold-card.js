// 표 축약 카드 실질의 프로브(2026-08-27, Step 9b/board-33③) — 오브 대화 모드에
// 실제 질의를 태워 athena:orb-canvas-result로 도착한 table 엔벌로프가
// orb.js buildOrbTableCard()를 거쳐 .orb-fold-card로 실제로 그려지는지,
// column-fold.js가 360px에서 정말로 컬럼을 접는지, 접힘 고지 문구가 보드
// 원문 형식(Paper 4XV-0 실측 "열 N개 · 행 N개를 접었습니다 — 전체는
// 캔버스에서")과 일치하는지 화면 캡처로 확인한다.
//
// ATHENA_CLAUDE_BIN을 즉석 컴파일한 가짜 claude 실행 파일로 오버라이드해
// 실제 claude를 부르지 않는다(probe-orb-canvas-origin-retry.js와 같은 원칙 —
// csc.exe로 컴파일한 최소 실행 파일, .cmd/.bat는 Node 22 shell:false spawn을
// EINVAL로 막아 후보에서 제외). 5개 컬럼(계정·당기·전기·증감·증감률) × 5행
// 짜리 재무상태표 모양 엔벌로프를 흘려서 360px 카드 폭에서 실제로 folding이
// 발동하게 한다(계정/당기/전기 3열만 114px 바닥값 누적으로 들어가고, 증감·
// 증감률 2열은 밀린다 — column-fold.test.js가 같은 산수를 고정한다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-table-fold-card-profile');
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

// render_canvas 성공 1건(5컬럼×5행 재무상태표 모양 table 엔벌로프)만 stdout에
// 쏟는 최소 실행 파일. Console.OutputEncoding을 UTF-8로 고정한다 — 기본
// 콘솔 코드페이지로는 한글 라벨이 깨져 나간다(실측).
function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-tablecard-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const src = `
using System;

class Program {
  static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    char q = (char)34;

    string cols =
      "[" +
      "{" + q + "key" + q + ":" + q + "acct" + q + "," + q + "label" + q + ":" + q + "계정" + q + "}," +
      "{" + q + "key" + q + ":" + q + "cur" + q + "," + q + "label" + q + ":" + q + "당기" + q + "}," +
      "{" + q + "key" + q + ":" + q + "prev" + q + "," + q + "label" + q + ":" + q + "전기" + q + "}," +
      "{" + q + "key" + q + ":" + q + "chg" + q + "," + q + "label" + q + ":" + q + "증감" + q + "}," +
      "{" + q + "key" + q + ":" + q + "chgpct" + q + "," + q + "label" + q + ":" + q + "증감률" + q + "}" +
      "]";

    string row1 = "{" + q + "acct" + q + ":" + q + "자산총계" + q + "," + q + "cur" + q + ":" + q + "566,942,110" + q + "," + q + "prev" + q + ":" + q + "514,531,948" + q + "," + q + "chg" + q + ":" + q + "52,410,162" + q + "," + q + "chgpct" + q + ":" + q + "10.2%" + q + "}";
    string row2 = "{" + q + "acct" + q + ":" + q + "유동자산" + q + "," + q + "cur" + q + ":" + q + "247,684,612" + q + "," + q + "prev" + q + ":" + q + "227,062,266" + q + "," + q + "chg" + q + ":" + q + "20,622,346" + q + "," + q + "chgpct" + q + ":" + q + "9.1%" + q + "}";
    string row3 = "{" + q + "acct" + q + ":" + q + "현금및현금성자산" + q + "," + q + "cur" + q + ":" + q + "57,856,378" + q + "," + q + "prev" + q + ":" + q + "53,705,579" + q + "," + q + "chg" + q + ":" + q + "4,150,799" + q + "," + q + "chgpct" + q + ":" + q + "7.7%" + q + "}";
    string row4 = "{" + q + "acct" + q + ":" + q + "부채총계" + q + "," + q + "cur" + q + ":" + q + "92,000,000" + q + "," + q + "prev" + q + ":" + q + "88,000,000" + q + "," + q + "chg" + q + ":" + q + "4,000,000" + q + "," + q + "chgpct" + q + ":" + q + "4.5%" + q + "}";
    string row5 = "{" + q + "acct" + q + ":" + q + "자본총계" + q + "," + q + "cur" + q + ":" + q + "474,942,110" + q + "," + q + "prev" + q + ":" + q + "426,531,948" + q + "," + q + "chg" + q + ":" + q + "48,410,162" + q + "," + q + "chgpct" + q + ":" + q + "11.4%" + q + "}";
    string rows = "[" + row1 + "," + row2 + "," + row3 + "," + row4 + "," + row5 + "]";

    string envelope =
      "{" + q + "card_title" + q + ":" + q + "재무상태표(테스트)" + q + "," +
      q + "caption" + q + ":" + q + "TEST-FIXTURE" + q + "," +
      q + "canvas_type" + q + ":" + q + "table" + q + "," +
      q + "fell_back" + q + ":false," +
      q + "data" + q + ":{" + q + "columns" + q + ":" + cols + "," + q + "rows" + q + ":" + rows + "}" +
      "}";

    string esc = envelope.Replace(q.ToString(), "\\\\" + q);

    Console.WriteLine("{" + q + "type" + q + ":" + q + "assistant" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_use" + q + "," + q + "id" + q + ":" + q + "tu1" + q + "," + q + "name" + q + ":" + q + "mcp__athena__athena__render_canvas" + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "user" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_result" + q + "," + q + "tool_use_id" + q + ":" + q + "tu1" + q + "," + q + "content" + q + ":" + q + esc + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "result" + q + "," + q + "is_error" + q + ":false," + q + "result" + q + ":" + q + "자산총계 566조, 유동자산 247조입니다. 전기 대비 둘 다 늘었습니다." + q + "," + q + "session_id" + q + ":" + q + "FAKE-SESSION-TABLE" + q + "}");
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
  console.log(`[probe-orb-table-fold-card] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function main() {
  const exePath = compileFakeClaude();
  process.env.ATHENA_CLAUDE_BIN = exePath;

  const mainMod = require('./main.js');
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
    input.value = ${JSON.stringify('삼성전자 재무 좀 봐줘')};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  const deadline = Date.now() + 20000;
  let cardState = null;
  while (Date.now() < deadline) {
    cardState = await orbWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('#orbChatTurns .orb-fold-card');
      if (!card) return null;
      const rows = Array.from(card.querySelectorAll('.orb-fold-row')).map((row) =>
        Array.from(row.children).map((c) => c.textContent));
      const note = card.querySelector('.orb-fold-note');
      return {
        title: card.querySelector('.orb-fold-card-title') && card.querySelector('.orb-fold-card-title').textContent,
        subtitle: card.querySelector('.orb-fold-card-subtitle') && card.querySelector('.orb-fold-card-subtitle').textContent,
        rowCount: rows.length,
        headerCells: rows[0],
        firstDataRow: rows[1],
        noteText: note ? note.textContent : null,
      };
    })()`);
    if (cardState) break;
    await wait(300);
  }

  record('01-표 축약 카드가 실제로 그려졌다', !!cardState, cardState);
  record('02-카드 제목/부제가 엔벌로프 card_title/caption 그대로', !!cardState && cardState.title === '재무상태표(테스트)' && cardState.subtitle === 'TEST-FIXTURE', cardState);
  // 헤더 1행 + 데이터 3행(ORB_TABLE_MAX_ROWS) = 4행. 5컬럼 중 360px에서 3컬럼만
  // 보인다(계정·당기·전기) — column-fold.test.js의 같은 산수.
  record('03-헤더+데이터 3행(=4행)만 렌더 — 나머지 2행은 접힘', !!cardState && cardState.rowCount === 4, cardState);
  record('04-헤더 컬럼 3개(계정/당기/전기)만 보이고 증감·증감률은 접힌다', !!cardState && JSON.stringify(cardState.headerCells) === JSON.stringify(['계정', '당기', '전기']), cardState);
  record('05-첫 데이터 행 값도 3컬럼(자산총계/566,942,110/514,531,948)', !!cardState && JSON.stringify(cardState.firstDataRow) === JSON.stringify(['자산총계', '566,942,110', '514,531,948']), cardState);
  record('06-접힘 고지가 보드 원문 형식과 일치(열 2개 · 행 2개)', !!cardState && cardState.noteText === '열 2개 · 행 2개를 접었습니다 — 전체는 캔버스에서', cardState);

  await wait(500);
  await orbWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-table-fold-card.png'), img.toPNG());
  });

  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-table-fold-card-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-table-fold-card] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-table-fold-card] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-table-fold-card-fatal.log'), String((err && err.stack) || err));
  app.exit(1);
});

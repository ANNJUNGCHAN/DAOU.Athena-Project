// 오브용 미니 차트 실질의 프로브(2026-08-27, Step 9c/board-33④) — 오브 대화
// 모드에 실제 질의를 태워 athena:orb-canvas-result로 도착한 chart 엔벌로프가
// orb.js buildOrbChartCard()를 거쳐 .orb-fold-card(+ SVG 라인)로 실제로
// 그려지는지, 가격/등락률/시작·끝 날짜가 Paper 4ZM-0 실측 구성 상한대로
// 나오는지(지표·드로잉·매물대 없음) 화면 캡처로 확인한다.
//
// probe-orb-table-fold-card.js와 같은 원칙 — ATHENA_CLAUDE_BIN을 즉석
// 컴파일한 가짜 claude 실행 파일로 오버라이드해 실제 claude를 부르지 않는다.
// 6개 일봉 캔들(68,900→88,100, 우상향)을 흘려서 종가 라인 6점과 상승(양수)
// 등락 톤(--color-up)이 실제로 나오는지까지 확인한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-mini-chart-card-profile');
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

// render_canvas 성공 1건(6개 일봉 캔들짜리 chart 엔벌로프)만 stdout에 쏟는
// 최소 실행 파일. Console.OutputEncoding을 UTF-8로 고정한다 — 기본 콘솔
// 코드페이지로는 한글 라벨이 깨져 나간다(probe-orb-table-fold-card.js 실측).
function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-chartcard-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const src = `
using System;

class Program {
  static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    char q = (char)34;

    string c1 = "{" + q + "time" + q + ":" + q + "2026-05-26" + q + "," + q + "open" + q + ":68000," + q + "high" + q + ":69500," + q + "low" + q + ":67800," + q + "close" + q + ":68900," + q + "volume" + q + ":1000}";
    string c2 = "{" + q + "time" + q + ":" + q + "2026-06-10" + q + "," + q + "open" + q + ":68900," + q + "high" + q + ":74500," + q + "low" + q + ":68500," + q + "close" + q + ":74000," + q + "volume" + q + ":1200}";
    string c3 = "{" + q + "time" + q + ":" + q + "2026-06-25" + q + "," + q + "open" + q + ":74000," + q + "high" + q + ":80000," + q + "low" + q + ":73800," + q + "close" + q + ":79500," + q + "volume" + q + ":1300}";
    string c4 = "{" + q + "time" + q + ":" + q + "2026-07-05" + q + "," + q + "open" + q + ":79500," + q + "high" + q + ":83500," + q + "low" + q + ":79000," + q + "close" + q + ":83000," + q + "volume" + q + ":1400}";
    string c5 = "{" + q + "time" + q + ":" + q + "2026-07-12" + q + "," + q + "open" + q + ":83000," + q + "high" + q + ":85500," + q + "low" + q + ":82500," + q + "close" + q + ":85000," + q + "volume" + q + ":1500}";
    string c6 = "{" + q + "time" + q + ":" + q + "2026-07-19" + q + "," + q + "open" + q + ":85000," + q + "high" + q + ":88500," + q + "low" + q + ":84800," + q + "close" + q + ":88100," + q + "volume" + q + ":1600}";
    string candles = "[" + c1 + "," + c2 + "," + c3 + "," + c4 + "," + c5 + "," + c6 + "]";

    string chart = "{" + q + "period" + q + ":" + q + "day" + q + "," + q + "target" + q + ":" + q + "stock" + q + "," + q + "trId" + q + ":" + q + "ka10081" + q + "," + q + "candles" + q + ":" + candles + "}";

    string envelope =
      "{" + q + "card_title" + q + ":" + q + "삼성전자 005930(테스트)" + q + "," +
      q + "canvas_type" + q + ":" + q + "chart" + q + "," +
      q + "fell_back" + q + ":false," +
      q + "data" + q + ":{" + q + "symbol" + q + ":" + q + "005930" + q + "," + q + "chart" + q + ":" + chart + "}" +
      "}";

    string esc = envelope.Replace(q.ToString(), "\\\\" + q);

    Console.WriteLine("{" + q + "type" + q + ":" + q + "assistant" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_use" + q + "," + q + "id" + q + ":" + q + "tu1" + q + "," + q + "name" + q + ":" + q + "mcp__athena__athena__render_canvas" + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "user" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_result" + q + "," + q + "tool_use_id" + q + ":" + q + "tu1" + q + "," + q + "content" + q + ":" + q + esc + q + "}]}}");
    Console.WriteLine("{" + q + "type" + q + ":" + q + "result" + q + "," + q + "is_error" + q + ":false," + q + "result" + q + ":" + q + "3개월 저점 68,900에서 88,100까지 올라왔습니다." + q + "," + q + "session_id" + q + ":" + q + "FAKE-SESSION-CHART" + q + "}");
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
  console.log(`[probe-orb-mini-chart-card] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
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
    input.value = ${JSON.stringify('삼성전자 3개월 흐름 보여줘')};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  const deadline = Date.now() + 20000;
  let cardState = null;
  while (Date.now() < deadline) {
    cardState = await orbWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('#orbChatTurns .orb-fold-card');
      if (!card) return null;
      const svg = card.querySelector('.orb-chart-svg');
      const path = svg ? svg.querySelector('path') : null;
      const d = path ? path.getAttribute('d') : null;
      const dates = Array.from(card.querySelectorAll('.orb-chart-dates span')).map((s) => s.textContent);
      const changeEl = card.querySelector('.orb-chart-change');
      return {
        title: card.querySelector('.orb-fold-card-title') && card.querySelector('.orb-fold-card-title').textContent,
        subtitle: card.querySelector('.orb-fold-card-subtitle') && card.querySelector('.orb-fold-card-subtitle').textContent,
        price: card.querySelector('.orb-chart-price') && card.querySelector('.orb-chart-price').textContent,
        changeText: changeEl ? changeEl.textContent : null,
        changeClass: changeEl ? changeEl.className : null,
        svgWidth: svg ? svg.getAttribute('width') : null,
        svgHeight: svg ? svg.getAttribute('height') : null,
        pathPointCount: d ? (d.match(/[ML]/g) || []).length : 0,
        pathStroke: path ? path.getAttribute('stroke') : null,
        dates,
        noteText: card.querySelector('.orb-fold-note') && card.querySelector('.orb-fold-note').textContent,
      };
    })()`);
    if (cardState) break;
    await wait(300);
  }

  record('01-미니 차트 카드가 실제로 그려졌다', !!cardState, cardState);
  record('02-카드 제목/부제 — card_title 그대로 + 일봉 라벨', !!cardState && cardState.title === '삼성전자 005930(테스트)' && cardState.subtitle === '일봉', cardState);
  record('03-가격은 마지막 종가(88,100)', !!cardState && cardState.price === '88,100', cardState);
  record('04-등락 배지는 +3,100 (+3.65%) · 상승 톤(is-up)', !!cardState && cardState.changeText === '+3,100 (+3.65%)' && /is-up/.test(cardState.changeClass || ''), cardState);
  record('05-SVG 판 크기는 보드 실측(336×116)', !!cardState && cardState.svgWidth === '336' && cardState.svgHeight === '116', cardState);
  record('06-종가 라인 1개가 캔들 6개만큼 점을 찍는다(M+L×5)', !!cardState && cardState.pathPointCount === 6, cardState);
  record('07-라인 색은 상승 토큰(var(--color-up))', !!cardState && cardState.pathStroke === 'var(--color-up)', cardState);
  record('08-시작/끝 날짜 2개', !!cardState && JSON.stringify(cardState.dates) === JSON.stringify(['2026-05-26', '2026-07-19']), cardState);
  record('09-능력 고지가 보드 원문과 일치', !!cardState && cardState.noteText === '지표 · 드로잉 · 매물대는 캔버스에서', cardState);

  await wait(500);
  await orbWin.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-mini-chart-card.png'), img.toPNG());
  });

  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-mini-chart-card-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-mini-chart-card] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-mini-chart-card] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-mini-chart-card-fatal.log'), String((err && err.stack) || err));
  app.exit(1);
});

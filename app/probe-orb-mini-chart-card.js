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
//
// 2026-09-01 정정 — 일봉·분봉 두 봉투를 **한 턴에** 흘린다. 이전 판은 첫 턴
// 뒤에 ATHENA_CLAUDE_BIN을 분봉용 실행 파일로 바꾸고 둘째 턴을 태웠는데,
// 상주 프로바이더 세션(lib/main/claude-chat-session.js:117 `this._claudeBin`)이
// 세션 생성 시점의 경로를 붙들고 있어 둘째 턴도 **첫 실행 파일**을 다시 돌렸다.
// 그래서 10~15단계가 첫 턴 카드를 보고 계속 실패했다(앱이 아니라 프로브의
// 결함 — 진단 결과 둘째 턴에도 '첫 턴 차트'가 그대로 그려졌다). 한 턴 안에
// 두 봉투를 보내면 실행 파일을 갈아끼울 필요 자체가 없다.
//
// NDJSON은 Node에서 만들어 base64로 넘기고 C#은 디코드해 그대로 뱉기만 한다 —
// q-연결로 JSON을 짓던 옛 방식은 봉투가 둘 이상이면 이스케이프가 감당이 안 된다
// (probe-orb-mini-cards.js와 같은 방식).

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

// 일봉 6개 + 분봉 2개, 두 봉투를 한 턴에 내는 가짜 claude.
// 분봉 candle.time은 문자열이 아니라 백엔드 canvas_transform.py _aits_time()이
// 만드는 Unix epoch 초 정수다(2026-08-27 결함 3 회귀 케이스).
const DAY_ENVELOPE = {
  card_title: '삼성전자 005930(테스트)',
  canvas_type: 'chart',
  fell_back: false,
  data: {
    symbol: '005930',
    chart: {
      period: 'day',
      target: 'stock',
      trId: 'ka10081',
      candles: [
        { time: '2026-05-26', open: 68000, high: 69500, low: 67800, close: 68900, volume: 1000 },
        { time: '2026-06-10', open: 68900, high: 74500, low: 68500, close: 74000, volume: 1200 },
        { time: '2026-06-25', open: 74000, high: 80000, low: 73800, close: 79500, volume: 1300 },
        { time: '2026-07-05', open: 79500, high: 83500, low: 79000, close: 83000, volume: 1400 },
        { time: '2026-07-12', open: 83000, high: 85500, low: 82500, close: 85000, volume: 1500 },
        { time: '2026-07-19', open: 85000, high: 88500, low: 84800, close: 88100, volume: 1600 },
      ],
    },
  },
};

// 2026-08-27 09:31/09:35 KST → epoch 초.
const MIN_ENVELOPE = {
  card_title: '삼성전자 005930(분봉테스트)',
  canvas_type: 'chart',
  fell_back: false,
  data: {
    symbol: '005930',
    chart: {
      period: 'min',
      target: 'stock',
      trId: 'ka10080',
      candles: [
        { time: 1787790660, open: 68800, high: 69000, low: 68700, close: 68900, volume: 500 },
        { time: 1787790900, open: 68900, high: 69300, low: 68850, close: 69200, volume: 600 },
      ],
    },
  },
};

function buildNdjson() {
  const lines = [];
  [DAY_ENVELOPE, MIN_ENVELOPE].forEach((envelope, i) => {
    const id = `tu${i + 1}`;
    lines.push(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name: 'mcp__athena__athena__render_canvas' }] },
    }));
    lines.push(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(envelope) }] },
    }));
  });
  lines.push(JSON.stringify({
    type: 'result',
    is_error: false,
    result: '3개월 저점 68,900에서 88,100까지 올라왔습니다. 최근 1분봉은 68,900에서 69,200으로 올랐습니다.',
    session_id: 'FAKE-SESSION-CHART',
  }));
  return `${lines.join('\n')}\n`;
}

function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-chartcard-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const payload = Buffer.from(buildNdjson(), 'utf-8').toString('base64');
  const src = `
using System;
using System.Text;

class Program {
  static void Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    string payload = "${payload}";
    Console.Write(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
    Console.Out.Flush();
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
      const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-fold-card'));
      const card = cards.find((c) => {
        const t = c.querySelector('.orb-fold-card-title');
        return t && t.textContent === '삼성전자 005930(테스트)';
      });
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

  // ---------- 결함 3 회귀 — 분봉(숫자 epoch) 케이스 ----------
  // candle.time이 'YYYY-MM-DD' 문자열이 아니라 숫자 epoch(canvas_transform.py
  // _aits_time()이 분·틱봉에 만드는 형태)일 때도 orbChartDateLabel()이 KST
  // 날짜·시각으로 바꿔 찍는지 — 수정 전엔 facts-card.js formatDatetime이
  // 8자리 문자열만 인식해 "1787790660"이 그대로 찍혔다. 같은 턴에 이미 도착한
  // 둘째 봉투를 제목으로 골라 본다(위 머리말 — 실행 파일 교체는 상주 세션에서
  // 통하지 않는다).
  const minDeadline = Date.now() + 20000;
  let minCardState = null;
  while (Date.now() < minDeadline) {
    minCardState = await orbWin.webContents.executeJavaScript(`(() => {
      const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-fold-card'));
      const card = cards.find((c) => {
        const t = c.querySelector('.orb-fold-card-title');
        return t && t.textContent === '삼성전자 005930(분봉테스트)';
      });
      if (!card) return null;
      const svg = card.querySelector('.orb-chart-svg');
      const path = svg ? svg.querySelector('path') : null;
      const d = path ? path.getAttribute('d') : null;
      const dates = Array.from(card.querySelectorAll('.orb-chart-dates span')).map((s) => s.textContent);
      const changeEl = card.querySelector('.orb-chart-change');
      return {
        subtitle: card.querySelector('.orb-fold-card-subtitle') && card.querySelector('.orb-fold-card-subtitle').textContent,
        price: card.querySelector('.orb-chart-price') && card.querySelector('.orb-chart-price').textContent,
        changeText: changeEl ? changeEl.textContent : null,
        changeClass: changeEl ? changeEl.className : null,
        pathPointCount: d ? (d.match(/[ML]/g) || []).length : 0,
        dates,
      };
    })()`);
    if (minCardState) break;
    await wait(300);
  }

  record('10-분봉(숫자 epoch) 카드가 실제로 그려졌다', !!minCardState, minCardState);
  record('11-부제는 분봉 라벨', !!minCardState && minCardState.subtitle === '분봉', minCardState);
  record('12-가격은 마지막 종가(69,200)', !!minCardState && minCardState.price === '69,200', minCardState);
  record('13-등락 배지는 +300 (+0.44%) · 상승 톤(is-up)', !!minCardState && minCardState.changeText === '+300 (+0.44%)' && /is-up/.test(minCardState.changeClass || ''), minCardState);
  record('14-종가 라인 점 2개(캔들 2개)', !!minCardState && minCardState.pathPointCount === 2, minCardState);
  record('15-시작/끝 날짜가 epoch 그대로가 아니라 KST 날짜·시각으로 표시된다(1787790660→2026-08-27 09:31)',
    !!minCardState && JSON.stringify(minCardState.dates) === JSON.stringify(['2026-08-27 09:31', '2026-08-27 09:35']),
    minCardState);

  await wait(500);
  // 캡처 실패가 판정을 삼키지 않게 한다 — probe-orb-mini-cards.js와 같은 이유다.
  // (실측 2026-09-01: 단언 15/15 통과 후 UnknownVizError로 프로세스가 안 죽었다.)
  try {
    const img = await orbWin.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-mini-chart-card.png'), img.toPNG());
  } catch (err) {
    report.capture_error = String((err && err.message) || err);
    console.warn(`[probe-orb-mini-chart-card] 캡처 실패(판정과 무관): ${report.capture_error}`);
  }

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

// 미니 카드 7종 실질의 프로브 (2026-09-01 전수검사 · Paper 키우미 보드 09).
//
// 보드 09가 캔버스 9종 → 미니 10종을 확정했다. 그중 표·차트·주문 티켓 셋은
// 이미 probe-orb-table-fold-card.js / probe-orb-mini-chart-card.js /
// probe-orb-order-ticket.js가 각각 고정하고 있고, 이 프로브는 이번에 새로
// 배선한 **나머지 일곱**(facts 일반 · compound · event · action · status ·
// reader · stream)이 실제 오브 대화 화면에 그려지는지를 본다.
//
// 한 턴에 render_canvas 성공 7건을 흘린다 — 일곱을 따로 돌리면 창을 일곱 번
// 띄우느라 느리기만 하고, 정작 "여러 봉투가 한 답변에 같이 도착할 때 카드가
// 다 붙는가"는 확인하지 못한다(그게 실사용 모양이다).
//
// probe-orb-table-fold-card.js와 같은 원칙 — ATHENA_CLAUDE_BIN을 즉석 컴파일한
// 가짜 claude 실행 파일로 오버라이드해 실제 claude를 부르지 않는다. 다만 이
// 프로브는 봉투가 일곱이라 q-연결로 JSON을 짓는 기존 방식이 감당이 안 된다:
// NDJSON을 **Node에서 만들어 base64로 넘기고** C#은 디코드해 그대로 뱉기만
// 한다(이스케이프 경로가 하나도 없어 한글·따옴표 사고가 원천적으로 없다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-mini-cards-profile');
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

// ── 봉투 7종 ── 상한을 실제로 넘기는 크기로 만든다(접힘 고지가 나와야 계약이
// 확인된다). 값은 전부 고정 픽스처다 — 라이브 API를 부르지 않는다.
const ENVELOPES = [
  {
    card_title: '종목정보(테스트)',
    caption: '삼성전자 005930',
    canvas_type: 'facts',
    fell_back: false,
    data: {
      fields: [
        { key: 'cur_prc', label: '종가', value: 88100 },
        { key: 'flu_rt', label: '등락률', value: '1.03' },
        { key: 'acc_trde_qty', label: '거래량', value: 11689068 },
        { key: 'mac', label: '시가총액', value: '525.8조' },
        { key: 'dt', label: '기준일', value: '20260719' },
        { key: 'per', label: 'PER', value: '11.2' },
        { key: 'pbr', label: 'PBR', value: '1.4' },
        { key: 'eps', label: 'EPS', value: '7,860' },
        { key: 'bps', label: 'BPS', value: '62,900' },
        { key: 'empty1', label: '없는 값', value: null },
        { key: 'empty2', label: '빈 값', value: '' },
      ],
    },
  },
  {
    card_title: '계좌(테스트)',
    caption: '모의-주력',
    canvas_type: 'compound',
    fell_back: false,
    data: {
      header: [
        { key: 'tot_evlt_amt', label: '총평가', value: '18,420,500' },
        { key: 'evlt_pl', label: '평가손익', value: '612300' },
        { key: 'prft_rt', label: '수익률', value: '3.44%' },
        { key: 'dpst', label: '예수금', value: '2,100,000' },
        { key: 'ord_psbl', label: '주문가능', value: '2,100,000' },
      ],
      table: {
        columns: [
          { key: 'stk_nm', label: '종목' },
          { key: 'evlt_amt', label: '평가금액' },
        ],
        rows: [
          { stk_nm: '삼성전자', evlt_amt: '10,572,000' },
          { stk_nm: 'SK하이닉스', evlt_amt: '7,848,500' },
          { stk_nm: 'NAVER', evlt_amt: '1,204,000' },
          { stk_nm: '카카오', evlt_amt: '842,000' },
          { stk_nm: 'LG에너지솔루션', evlt_amt: '640,000' },
          { stk_nm: '현대차', evlt_amt: '520,000' },
        ],
      },
    },
  },
  {
    card_title: '실시간 이벤트(테스트)',
    caption: '체결 · 005930',
    canvas_type: 'event',
    fell_back: false,
    data: {
      state: 'connected',
      records: [
        { time: '15:29:58', price: '88,100', qty: '1,200' },
        { time: '15:29:57', price: '88,000', qty: '340' },
        { time: '15:29:55', price: '88,000', qty: '90' },
        { time: '15:29:52', price: '87,900', qty: '410' },
        { time: '15:29:50', price: '87,900', qty: '75' },
      ],
    },
  },
  {
    card_title: '주문 확인(테스트)',
    caption: '모의-주력',
    canvas_type: 'action',
    fell_back: false,
    data: {
      state: 'done',
      receipt: { ord_no: '0000117', dmst_stex_tp: 'KRX', secret_token: '노출되면 안 된다' },
    },
  },
  {
    caption: '연결 상태(테스트)',
    canvas_type: 'status',
    fell_back: false,
    data: { configured: true, ready: true, expires_at: '2026-07-20 06:00' },
  },
  {
    caption: 'DART · 07-18',
    canvas_type: 'reader',
    fell_back: false,
    data: {
      title: '주요사항보고서(테스트)',
      body_markdown: '# 자기주식 취득 신탁계약 체결 결정\n\n회사는 이사회 결의로 자기주식 취득 신탁계약 체결을 결정했습니다. 계약금액은 3,000억원이며 계약기간은 체결일로부터 6개월입니다.\n\n두 번째 문단은 오브에 오지 않는다.',
    },
  },
  {
    caption: '스트림 · 뉴스(테스트)',
    canvas_type: 'stream',
    fell_back: false,
    data: {
      records: [
        { title: '삼성전자, 자기주식 3,000억 취득 신탁 결정', ts: '2026-07-19T15:12:00', ts_precision: 'second', source: 'DART' },
        { title: '반도체 수출 3개월 연속 증가', ts: '2026-07-19T14:40:00', ts_precision: 'second', url: 'https://www.example.com/news/1' },
        { title: '세 번째는 접힌다', ts: '2026-07-19T14:00:00', ts_precision: 'second', source: 'X' },
        { title: '네 번째도 접힌다', ts: '2026-07-19T13:00:00', ts_precision: 'second', source: 'Y' },
      ],
    },
  },
];

const ANSWER_TEXT = '일곱 봉투를 카드로 보여드립니다.';

/** claude CLI가 뱉는 NDJSON 그대로. render_canvas tool_use/tool_result 쌍을
 * 봉투 수만큼 낸 뒤 result 한 줄로 턴을 닫는다. */
function buildNdjson() {
  const lines = [];
  ENVELOPES.forEach((envelope, i) => {
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
    type: 'result', is_error: false, result: ANSWER_TEXT, session_id: 'FAKE-SESSION-MINI-CARDS',
  }));
  return `${lines.join('\n')}\n`;
}

function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-minicards-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const payload = Buffer.from(buildNdjson(), 'utf-8').toString('base64');
  // base64 한 덩어리만 들고 있는다 — C# 소스에 따옴표도 한글도 안 들어가므로
  // 이스케이프가 어긋날 자리가 없다(기존 프로브들의 q-연결이 풀려던 문제).
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
let failures = 0;
function record(name, ok, data) {
  if (!ok) failures += 1;
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-mini-cards] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
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

  // 셸을 내려야 오브가 대화 모드가 된다(board-34 게이트).
  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(500);
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(400);

  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = ${JSON.stringify('계좌랑 공시랑 다 보여줘')};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  const deadline = Date.now() + 25000;
  let dom = null;
  while (Date.now() < deadline) {
    dom = await orbWin.webContents.executeJavaScript(`(() => {
      const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-fold-card'));
      if (cards.length < 7) return null;
      const read = (card) => ({
        title: (card.querySelector('.orb-fold-card-title') || {}).textContent || null,
        subtitle: (card.querySelector('.orb-fold-card-subtitle') || {}).textContent || null,
        badge: (card.querySelector('.orb-state-text') || {}).textContent || null,
        badgeClass: (card.querySelector('.orb-state-badge') || {}).className || null,
        rows: Array.from(card.querySelectorAll('.orb-fold-row')).map((row) => row.textContent),
        rowCount: card.querySelectorAll('.orb-fold-row').length,
        bandLabels: Array.from(card.querySelectorAll('.orb-band-label')).map((n) => n.textContent),
        bandValues: Array.from(card.querySelectorAll('.orb-band-value')).map((n) => n.textContent),
        valueTones: Array.from(card.querySelectorAll('.orb-fold-cell-value')).map((n) => n.className),
        readerBody: (card.querySelector('.orb-reader-body') || {}).textContent || null,
        streamTitles: Array.from(card.querySelectorAll('.orb-stream-title')).map((n) => n.textContent),
        streamMetas: Array.from(card.querySelectorAll('.orb-stream-meta')).map((n) => n.textContent),
        note: (card.querySelector('.orb-fold-note') || {}).textContent || null,
        html: card.innerHTML,
      });
      return {
        count: cards.length,
        cards: cards.map(read),
        answerText: (document.querySelector('#orbChatTurns .orb-turn-answer') || {}).textContent || null,
      };
    })()`);
    if (dom) break;
    await wait(400);
  }

  if (!dom) {
    record('00-미니 카드 7종이 한 답변에 모두 붙었다', false, { reason: '25초 안에 카드 7장이 안 나왔다' });
  } else {
    record('00-미니 카드 7종이 한 답변에 모두 붙었다', dom.count === 7, { count: dom.count });

    const [facts, compound, event, action, status, reader, stream] = dom.cards;

    // ── 03 사실 ──
    record('01-사실: card_title은 제목, caption은 부제',
      facts.title === '종목정보(테스트)' && facts.subtitle === '삼성전자 005930', facts);
    record('02-사실: 값 있는 필드만 5행 — 없는 값 2개는 행이 아니다',
      facts.rowCount === 5, { rowCount: facts.rowCount, rows: facts.rows });
    record('03-사실: 접힘 고지는 값 있는 나머지 4개만 센다',
      facts.note === '항목 4개를 접었습니다 — 전체는 캔버스에서', { note: facts.note });
    record('04-사실: 가격·거래량은 천단위, 일시는 하이픈, 등락은 상승 톤',
      /88,100/.test(facts.rows[0] || '')
      && /11,689,068/.test(facts.rows[2] || '')
      && /2026-07-19/.test(facts.rows[4] || '')
      && facts.valueTones.some((c) => /is-up/.test(c)), facts);

    // ── 04 복합 ──
    record('05-복합: 스칼라 밴드 3개까지',
      compound.bandLabels.length === 3
      && JSON.stringify(compound.bandLabels) === JSON.stringify(['총평가', '평가손익', '수익률']), compound);
    record('06-복합: 표는 헤더 1 + 2행',
      compound.rowCount === 3, { rowCount: compound.rowCount, rows: compound.rows });
    record('07-복합: 스칼라와 행을 따로 세어 고지한다',
      compound.note === '스칼라 2개 · 행 4개를 접었습니다 — 전체는 캔버스에서', { note: compound.note });

    // ── 07 이벤트 ──
    record('08-이벤트: 수신 상태 배지가 상태를 글자로도 말한다',
      event.badge === '수신 상태 · connected' && /is-ok/.test(event.badgeClass || ''), event);
    record('09-이벤트: 최근 2건만, 한 건은 값 3쌍까지',
      event.rowCount === 2 && /time 15:29:58 · price 88,100 · qty 1,200/.test(event.rows[0] || ''), event);
    record('10-이벤트: 남은 건수를 전체와 함께 밝힌다',
      event.note === '최근 2건 · 5건 중 — 전체는 캔버스에서', { note: event.note });

    // ── 06 주문 확인 ──
    record('11-주문 확인: 주문 단계 배지 + 허용 목록 2행',
      action.badge === '주문 단계 · done' && action.rowCount === 2, action);
    record('12-주문 확인: 허용 목록 밖 영수증 필드는 그리지 않는다',
      !/secret_token|노출되면/.test(action.html || ''), { html: (action.html || '').slice(0, 200) });
    record('13-주문 확인: 실행 버튼이 없다 — 미니 티켓만 실행을 가진다',
      !/<button/i.test(action.html || ''), { hasButton: /<button/i.test(action.html || '') });

    // ── 08 인증 상태 ──
    record('14-인증 상태: 캔버스와 같은 세 행 고정',
      status.rowCount === 3
      && /설정됨예/.test((status.rows[0] || '').replace(/\s+/g, ''))
      && /만료 시각/.test(status.rows[2] || ''), status);
    record('15-인증 상태: 토큰 비노출 고지',
      status.note === '토큰과 자격 증명 값은 표시하지 않음', { note: status.note });

    // ── 09 본문 ──
    record('16-본문: data.title이 제목이 된다',
      reader.title === '주요사항보고서(테스트)', reader);
    record('17-본문: 첫 문단만, 줄머리 # 를 벗기고 한 줄로',
      reader.readerBody === '자기주식 취득 신탁계약 체결 결정', { body: reader.readerBody });
    record('18-본문: 잘라낸 분량을 글자 수로 밝힌다',
      /^첫 문단만 · 전문 \d+자는 캔버스에서$/.test(reader.note || ''), { note: reader.note });

    // ── 10 스트림 ──
    record('19-스트림: 2건까지, 제목 줄 + 시각·출처 줄',
      stream.streamTitles.length === 2
      && stream.streamMetas[0] === '07.19 15:12 · DART'
      && stream.streamMetas[1] === '07.19 14:40 · example.com', stream);
    record('20-스트림: 남은 건수 고지',
      stream.note === '최근 2건 · 4건 중 — 전체는 캔버스에서', { note: stream.note });

    // ── 공통 규칙 ──
    record('21-보드 09 규칙 5: 어느 카드에도 innerHTML 주입 흔적이 없다(스크립트 0)',
      dom.cards.every((c) => !/<script/i.test(c.html || '')), {});
  }

  await orbWin.webContents.executeJavaScript(
    "document.getElementById('orbPanel').scrollTop = 0",
  );
  await wait(200);
  const img = await orbWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-mini-cards.png'), img.toPNG());

  report.ok = failures === 0;
  fs.writeFileSync(
    path.join(OUT_DIR, 'PROBE-ORB-MINI-CARDS.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
  console.log(`[probe-orb-mini-cards] ${failures === 0 ? 'ALL OK' : `${failures} FAILED`}`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-mini-cards] 예외:', err);
  app.exit(1);
});

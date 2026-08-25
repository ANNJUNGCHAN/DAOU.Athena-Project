const fs = require('fs');
const path = require('path');

// 픽스처는 전부 app/data/ 안에 산다. 옛 판은 스트림·테이블만 저장소 밖
// spike/captures를 가리켰는데, 그 디렉터리가 사라지면서(2026-08-25 정리 커밋)
// athena:load-fixture가 ENOENT로 죽었다 — 테스트 경로가 아니라 실행 경로다
// (main.js athena__render_canvas의 source:'fixture'가 닿는다). 앱이 읽는 자료는
// 앱 안에 둔다.
const APP_DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readJson(file) {
  const p = path.join(APP_DATA_DIR, file);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ① 스트림 캔버스 — S2B-naver-news-date.json
function loadStreamItems() {
  const raw = readJson('S2B-naver-news-date.json');
  const payload = JSON.parse(raw.content[0].text);
  return payload.items; // [{title, originallink, link, description, pubDate}]
}

// ④ 공통 테이블 캔버스 — S2B-jjlabsio-financial-statement.json
function loadFinancialStatement() {
  const raw = readJson('S2B-jjlabsio-financial-statement.json');
  const payload = JSON.parse(raw.result.content[0].text);
  return { meta: raw.args, list: payload.list }; // list: [{sj_nm, account_nm, thstrm_amount, frmtrm_amount, bfefrmtrm_amount, ...}]
}

// ② 리더 캔버스 — DART 마크다운.
function loadReaderMarkdown() {
  return fs.readFileSync(path.join(APP_DATA_DIR, 'reader-mock.md'), 'utf-8');
}

// ⑤ 차트 카드(CC-101) — app/data/chart-mock-ohlcv.json.
function loadChartOhlcv() {
  const p = path.join(APP_DATA_DIR, 'chart-mock-ohlcv.json');
  const payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return payload; // {_meta, bars}
}

// athena:load-fixture 핸들러가 쓰는 단일 진입점 — kind별로 분기한다.
function loadFixture(kind) {
  if (kind === 'stream') return { items: loadStreamItems() };
  if (kind === 'reader') return { markdown: loadReaderMarkdown() };
  if (kind === 'table') return loadFinancialStatement();
  if (kind === 'chart') return loadChartOhlcv();
  throw new Error(`알 수 없는 fixture kind: ${kind}`);
}

module.exports = { loadStreamItems, loadFinancialStatement, loadReaderMarkdown, loadChartOhlcv, loadFixture };

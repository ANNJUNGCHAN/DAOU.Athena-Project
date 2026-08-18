// 목업 데이터 로더 — main 프로세스 전용(2026-08-18 렌더러 격리 이관).
// 원래 app/lib/mockdata.js였다. canvas.js가 fs로 spike/captures를 직접 읽는
// 것은 nodeIntegration:false 아래서는 불가능해졌다 — main으로 옮기고
// athena:load-fixture IPC로 파싱된 데이터만 넘긴다(CLAUDE.md §6 렌더러 Node
// API 직접 접근 0건). spike/captures/*.json은 그대로 읽기만 한다(편집 금지).
const fs = require('fs');
const path = require('path');

const CAPTURES_DIR = path.join(__dirname, '..', '..', '..', 'spike', 'captures');
const APP_DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readJson(file) {
  const p = path.join(CAPTURES_DIR, file);
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

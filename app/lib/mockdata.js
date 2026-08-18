// 목업 데이터 로더. spike/captures/ 의 실제 캡처를 읽는다(스파이크 파일은
// 수정하지 않는다 — 읽기만). W2 지시: 실제 캡처를 목업으로 쓸 것.
const fs = require('fs');
const path = require('path');

const CAPTURES_DIR = path.join(__dirname, '..', '..', 'spike', 'captures');
const APP_DATA_DIR = path.join(__dirname, '..', 'data');

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

// ② 리더 캔버스 — DART 마크다운. 원본 캡처(spike/captures/DARTSURVEY-chrisryugj-
// download_document-SAME-AS-jjlabsio-SMALL-markdown.json)는 content0_text_head가
// 2000자에서 끊긴 미리보기 필드뿐이라 완전한 원문이 없다(캡처 당시 저장 안 됨).
// 그 필드에서 실제 마크다운 부분만 추출해 app/data/reader-mock.md 로 저장해뒀다
// (추출 스크립트는 1회성이라 남기지 않음, 이 파일이 산출물).
function loadReaderMarkdown() {
  return fs.readFileSync(path.join(APP_DATA_DIR, 'reader-mock.md'), 'utf-8');
}

// ⑤ 차트 카드(CC-101) — app/data/chart-mock-ohlcv.json. spike 캡처가 아니라
// 이 작업에서 새로 만든 절차적 목업이다(파일 _meta.note에 "정직한 목업" 명시,
// 실데이터 연결은 G004). bars: [{time,open,high,low,close,volume}, ...] 일봉 240개.
function loadChartOhlcv() {
  const p = path.join(APP_DATA_DIR, 'chart-mock-ohlcv.json');
  const payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return payload; // {_meta, bars}
}

module.exports = { loadStreamItems, loadFinancialStatement, loadReaderMarkdown, loadChartOhlcv };

// QA 드라이버 3종의 공용부
//
// run-cases.js · run-cases-ui.js · run-cases-appmode.js가 케이스 로더·audit 로그
// 스냅샷/델타·날짜 스탬프를 거의 동일하게 각자 정의하고 있었다. 순수 fs/path 계산이라
// Electron API 의존이 없다 — 값(데이터셋 경로, audit 디렉터리)은 호출부가 넘긴다.
//
// 동작은 원본 3벌과 100% 동일해야 한다. 이 파일은 npm test가 안 덮는 QA 도구의
// 일부이므로 바꿀 때는 세 드라이버를 실제로 돌려 확인하라.

const fs = require('fs');
const path = require('path');

// 검증 데이터셋(JSONL, 한 줄에 케이스 하나)을 케이스 id -> 케이스 객체 Map으로 읽는다.
function loadCases(datasetPath) {
  const out = new Map();
  for (const line of fs.readFileSync(datasetPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const c = JSON.parse(t);
    out.set(c.id, c);
  }
  return out;
}

// audit 로그는 append-only JSONL이다. 실행 전 각 파일의 행 수를 스냅샷해 두면
// auditDelta()로 그 실행이 실제로 낸 행만 뽑을 수 있다 — 그 케이스가 어떤 upstream
// 툴을 불렀는지가 여기서만 확인된다.
function auditSnapshot(auditDir) {
  const snap = {};
  if (!fs.existsSync(auditDir)) return snap;
  for (const f of fs.readdirSync(auditDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(auditDir, f), 'utf8').split('\n').filter(Boolean);
    snap[f] = lines.length;
  }
  return snap;
}

function auditDelta(auditDir, before) {
  const rows = [];
  if (!fs.existsSync(auditDir)) return rows;
  for (const f of fs.readdirSync(auditDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(auditDir, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(before[f] || 0)) {
      try { rows.push(JSON.parse(l)); } catch { rows.push({ raw: l }); }
    }
  }
  return rows;
}

// YYYY-MM-DD 날짜 스탬프. run-cases.js는 `stamp`, run-cases-ui.js/run-cases-appmode.js는
// `stampDir`라는 이름으로 각자 갖고 있었다 — 몸체가 동일해 이름만 통일했다.
function stampDir(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { loadCases, auditSnapshot, auditDelta, stampDir };

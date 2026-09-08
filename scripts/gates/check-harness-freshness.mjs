/**
 * 하네스 신선도 게이트 — 검증 하네스가 참조하는 DOM id·IPC 채널이 현행 앱에
 * 실재하는지 소스를 정적으로 대조한다. Electron 부팅 없이 도는 정적 오라클이다.
 *
 * 왜 필요한가: 설계가 바뀌면(예: #graphPill 제거, #dot=키우미, #sidebarModes→
 * #sidebarModeNav) 하네스가 사라진 요소를 계속 참조하면서 "항상 실패" 또는
 * "공허 통과"로 조용히 거짓말한다 — 2026-08-27~28 두 병합에서 이 부류가 반복
 * 실측됐다(settings-cards 행 걸림·bootStatePure 상시 false·버블 단언 구계약).
 * 이 게이트는 그 부류를 설계 변경 당일 잡는다.
 *
 * 검사 대상: app/verify.js · app/verify-settings.js · app/verify-settings-cards.js
 *   1) getElementById('X') / querySelector('#X') 리터럴 → shell.html에 id="X" 실재
 *   2) 'athena:...' 채널 리터럴 → preload.js 허용 Set(INVOKE/SEND/ON) ∪ main.js
 *      (ipcMain.handle/on 등록·webContents.send 발신) 어딘가에 실재
 *
 * 의도적 부정 프로브는 제외한다:
 *   - 채널: 같은 줄에 `ipc-channels:allow-dead` 마커 (verify.js의 죽은 채널 거절 검사)
 *   - DOM id: 같은 줄에서 `=== null` 부재 단언 (예: pillGone)
 *   - 하네스 자기 창 id: __harness- 접두(하네스가 스스로 만드는 노드)
 *
 * 성공 표지: harness freshness verification passed
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "app");
const failures = [];

function read(rel) {
  const p = join(APP, rel);
  if (!existsSync(p)) {
    failures.push(`${rel}: 파일이 없다`);
    return null;
  }
  return readFileSync(p, "utf8");
}

const shellHtml = read("shell.html");
const orbHtml = read("orb.html");
const preload = read("preload.js");
const mainJs = read("main.js");
const HARNESSES = ["verify.js", "verify-settings.js", "verify-settings-cards.js"];

function domEventLiteralSpans(line) {
  const spans = [];
  const patterns = [
    /\b(?:document|window)\s*\.\s*(?:addEventListener|removeEventListener)\s*\(\s*(['"`])(athena:[a-z0-9-]+)\1/g,
    /\b(?:new\s+)?CustomEvent\s*\(\s*(['"`])(athena:[a-z0-9-]+)\1/g,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index + match[0].lastIndexOf(match[2]);
      spans.push([start, start + match[2].length]);
    }
  }
  return spans;
}

if (!shellHtml || !preload || !mainJs) {
  console.error("[harness-freshness] 대조 원본 소스가 없다:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

// ---------- 대조 원본: 실재하는 DOM id ----------
const knownIds = new Set();
for (const html of [shellHtml, orbHtml || ""]) {
  for (const m of html.matchAll(/id="([^"]+)"/g)) knownIds.add(m[1]);
}
// 하네스 검사 대상 렌더러 JS가 동적으로 만드는 id도 실재로 친다 —
// createElement 후 .id = 'x' / setAttribute('id', 'x') 두 패턴.
for (const rel of ["chat.js", "canvas.js", "shell.js", "orb.js", "verify.js",
  "lib/sidebar.js", "lib/sidebar-mode-nav.js", "lib/agent-canvas.js", "lib/settings-cards.js",
  "lib/auth-screen.js", "lib/ui-kit.js"]) {
  const src = read(rel);
  if (!src) continue;
  for (const m of src.matchAll(/\.id\s*=\s*['"`]([A-Za-z][\w-]*)['"`]/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]\s*\)/g)) knownIds.add(m[1]);
}

// ---------- 대조 원본: 실재하는 IPC 채널 ----------
const knownChannels = new Set();
for (const src of [preload, mainJs]) {
  for (const m of src.matchAll(/['"`](athena:[a-z0-9-]+)['"`]/g)) knownChannels.add(m[1]);
}

// ---------- 하네스 스캔 ----------
for (const rel of HARNESSES) {
  const src = read(rel);
  if (!src) continue;
  const lines = src.split("\n");
  lines.forEach((rawLine, i) => {
    const loc = `${rel}:${i + 1}`;
    // 주석 속 언급(역사 서술)은 하네스 동작이 아니다 — 코드 부분만 스캔한다.
    // ':' 뒤 '//'는 URL(http://)일 수 있어 check-window-model과 같은 가드를 쓴다.
    const line = rawLine.replace(/(^|[^:])\/\/.*$/, "$1");
    // 의도적 부재 단언 줄은 통째로 건너뛴다.
    const negativeProbe = /===\s*null/.test(line);
    for (const m of line.matchAll(/getElementById\(\s*'([\w-]+)'\s*\)/g)) {
      if (negativeProbe) continue;
      if (m[1].startsWith("__harness-")) continue;
      if (!knownIds.has(m[1])) failures.push(`${loc}: 사라진 DOM id '#${m[1]}' 참조 — ${line.trim().slice(0, 90)}`);
    }
    for (const m of line.matchAll(/querySelector(?:All)?\(\s*'#([\w-]+)[^']*'\s*\)/g)) {
      if (negativeProbe) continue;
      if (!knownIds.has(m[1])) failures.push(`${loc}: 사라진 DOM id '#${m[1]}' 참조 — ${line.trim().slice(0, 90)}`);
    }
    if (!/ipc-channels:allow-dead/.test(rawLine) && !(i > 0 && /ipc-channels:allow-dead/.test(lines[i - 1]))) {
      const domEventSpans = domEventLiteralSpans(line);
      for (const m of line.matchAll(/['"`](athena:[a-z0-9-]+)['"`]/g)) {
        const channelStart = m.index + 1;
        if (domEventSpans.some(([start, end]) => channelStart >= start && channelStart < end)) continue;
        if (!knownChannels.has(m[1])) failures.push(`${loc}: 미등록 IPC 채널 '${m[1]}' 참조 — ${line.trim().slice(0, 90)}`);
      }
    }
  });
}

if (failures.length) {
  console.error(`[harness-freshness] 실패 ${failures.length}건:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`하네스 3종 · DOM id ${knownIds.size}개·채널 ${knownChannels.size}개 대조 통과`);
console.log("harness freshness verification passed");

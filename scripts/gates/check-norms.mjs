/**
 * leaf-1.1.1 게이트 — Codex형 규범 개정이 세 문서에 **일관되게** 반영됐는지 검사한다.
 *
 * 왜 필요한가: Codex형 셸은 좌측 이력 사이드바를 둔다. 현행 규범은
 * "상시 노출되는 사이드바/탭바/툴바"를 **즉시 탈락**으로 못박고 있어(CLAUDE.md §2 ·
 * GLOSSARY.md 탈락 조건 · ui/soul.md §8) 개정 없이 구현하면 규범 위반이다.
 * 세 문서가 따로 놀면 다음 세션이 어느 쪽을 믿을지 알 수 없다 — 그래서 셋을 함께 본다.
 *
 * 음성 대조군(negative control): "창 3개 이상" 탈락 조건은 Codex형에서도
 * **살아 있어야 한다**(셸 창 + 오브 창 = 2). 개정하면서 이 조항까지 지워버리면
 * 이 검사가 실패한다. 즉 이 스크립트는 "무언가 지웠다"가 아니라 "맞는 것만 지웠다"를 잰다.
 *
 * 실행: node scripts/gates/check-norms.mjs
 * 성공 표지: norms verification passed
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** 개정 표지 — 세 문서가 같은 날짜·같은 근거를 달아야 한다. */
const AMENDMENT_MARK = "Codex형 개정 2026-08-24";

/** 개정된 탈락 조건의 정준 문구. 세 문서가 글자 그대로 공유한다. */
const AMENDED_CLAUSE = "접을 수 없는 사이드바";

/** 개정 후에도 반드시 살아 있어야 하는 조항(음성 대조군). */
const CONTROL_CLAUSE = /창(이|은)?\s*(3개|셋)\s*이상/;

const CHECKS = [
  {
    file: "CLAUDE.md",
    required: [
      { label: "개정 표지", test: (s) => s.includes(AMENDMENT_MARK) },
      { label: "개정된 탈락 조건", test: (s) => s.includes(AMENDED_CLAUSE) },
      { label: "셸 창 명명", test: (s) => s.includes("셸 창") },
      { label: "알림 오브 창 명명", test: (s) => s.includes("알림 오브 창") },
      {
        label: "좌측 이력 사이드바 예외 명시",
        test: (s) => s.includes("이력 사이드바"),
      },
    ],
    control: { label: "창 3개 이상 탈락 조건 존치", test: (s) => CONTROL_CLAUSE.test(s) },
  },
  {
    file: "GLOSSARY.md",
    required: [
      { label: "개정 표지", test: (s) => s.includes(AMENDMENT_MARK) },
      { label: "개정된 탈락 조건", test: (s) => s.includes(AMENDED_CLAUSE) },
      { label: "셸 창 정의", test: (s) => s.includes("셸 창") },
      { label: "알림 오브 창 정의", test: (s) => s.includes("알림 오브 창") },
    ],
    control: { label: "창 3개 이상 탈락 조건 존치", test: (s) => CONTROL_CLAUSE.test(s) },
  },
  {
    file: join("ui", "soul.md"),
    required: [
      { label: "개정 표지", test: (s) => s.includes(AMENDMENT_MARK) },
      { label: "개정된 탈락 조건", test: (s) => s.includes(AMENDED_CLAUSE) },
      { label: "셸 창 명명", test: (s) => s.includes("셸 창") },
    ],
    control: { label: "창 3개 이상 탈락 조건 존치", test: (s) => CONTROL_CLAUSE.test(s) },
  },
];

/** 타협 불가 규범은 개정 대상이 아니다 — 함께 지워지지 않았는지 확인한다. */
const UNTOUCHABLE = [
  { file: "CLAUDE.md", phrase: "액센트 색 없음" },
  { file: "CLAUDE.md", phrase: "AI 냄새" },
  { file: "CLAUDE.md", phrase: "prefers-reduced-transparency" },
  { file: join("ui", "soul.md"), phrase: "AI 냄새" },
];

const failures = [];

for (const spec of CHECKS) {
  let text;
  try {
    text = readFileSync(join(ROOT, spec.file), "utf8");
  } catch (err) {
    failures.push(`${spec.file}: 읽을 수 없다 (${err.code ?? err.message})`);
    continue;
  }
  for (const req of spec.required) {
    if (!req.test(text)) failures.push(`${spec.file}: ${req.label} 누락`);
  }
  if (!spec.control.test(text)) {
    failures.push(`${spec.file}: ${spec.control.label} — 대조군 실패, 지우면 안 되는 조항이 사라졌다`);
  }
}

/**
 * 개정문이 가리키는 문서가 실제로 존재하는지 본다.
 *
 * 이 검사는 실제 결함에서 나왔다: 개정 직후 CLAUDE.md가 아직 만들지 않은
 * `plan/codex-실행계획.md`를 가리키고 있었다. 수동 검토로 잡았고, 같은 실수가
 * 반복되지 않도록 여기에 고정한다. 규범이 없는 문서를 가리키면 다음 세션이 길을 잃는다.
 */
const LINKED_DOCS = [
  { from: "CLAUDE.md", target: join("plan", "codex-실행계획.md") },
  { from: "CLAUDE.md", target: join("ui", "round-1R", "two-windows.md") },
];

for (const link of LINKED_DOCS) {
  let text;
  try {
    text = readFileSync(join(ROOT, link.from), "utf8");
  } catch {
    continue;
  }
  // 개정문이 그 문서를 언급할 때에만 존재를 요구한다.
  const mentioned = text.includes(link.target.split(/[\\/]/).pop());
  if (!mentioned) continue;
  try {
    readFileSync(join(ROOT, link.target));
  } catch {
    failures.push(`${link.from}: 가리키는 문서가 없다 — ${link.target}`);
  }
}

for (const item of UNTOUCHABLE) {
  let text;
  try {
    text = readFileSync(join(ROOT, item.file), "utf8");
  } catch {
    continue; // 위에서 이미 보고됐다
  }
  if (!text.includes(item.phrase)) {
    failures.push(`${item.file}: 타협 불가 규범 "${item.phrase}"가 사라졌다`);
  }
}

if (failures.length > 0) {
  console.error("규범 개정 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("norms verification passed");

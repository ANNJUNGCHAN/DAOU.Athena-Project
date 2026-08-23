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
 * GLOSSARY §1이 **정준 정의 절**이다 — 새 정의가 문서 어딘가에 있는 것으로는 부족하다.
 *
 * 이 검사도 실제 결함에서 나왔다: 1차 개정 때 셸 창·알림 오브 창 정의를 §5(판정·프로세스)에
 * 얹고 §1(창·표면 ★)은 손대지 않았다. 그래서 §1만 읽으면 옛 2창 모델이 여전히 유일한
 * 정의로 보였다. 원 계획서가 "깨지는 것"으로 명시 지목한 지점이 바로 §1인데도 그랬다.
 * 단어 존재 검사는 이걸 통과시킨다 — 절을 잘라서 그 안을 봐야 한다.
 *
 * 정의 중복도 막는다. 용어집에 같은 용어가 두 곳에 정의돼 있으면 어느 쪽이 표준인지
 * 알 수 없고, 한쪽만 갱신되는 드리프트가 시작된다.
 */
{
  let text;
  try {
    text = readFileSync(join(ROOT, "GLOSSARY.md"), "utf8");
  } catch {
    text = null;
  }
  if (text) {
    const m = /^##\s*1\.\s*창[^\n]*$([\s\S]*?)(?=^##\s)/m.exec(text);
    if (!m) {
      failures.push("GLOSSARY.md: §1(창·표면) 절을 찾지 못했다");
    } else {
      const section1 = m[1];
      for (const term of ["셸 창", "알림 오브 창"]) {
        if (!section1.includes(term)) {
          failures.push(
            `GLOSSARY.md §1: "${term}" 정의가 없다 — §1이 정준 정의 절이다. ` +
              `다른 절에만 적으면 §1만 읽는 사람에게는 옛 정의가 유일해 보인다`
          );
        }
      }
      // 정의 중복 금지: 표 행(`| **용어** |`) 형태가 §1 밖에도 있으면 드리프트 시작점이다.
      for (const term of ["셸 창", "알림 오브 창"]) {
        const rowRe = new RegExp(`^\\|\\s*\\*\\*${term}\\*\\*\\s*\\|`, "gm");
        const all = [...text.matchAll(rowRe)].length;
        const inS1 = [...section1.matchAll(rowRe)].length;
        if (all > inS1) {
          failures.push(
            `GLOSSARY.md: "${term}" 정의 행이 §1 밖에도 ${all - inS1}건 있다 — 중복 정의는 드리프트를 부른다`
          );
        }
      }
    }
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

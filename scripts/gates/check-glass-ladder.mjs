/**
 * leaf-1.1.2 게이트 — 유리 5단과 글자 5단이 tokens.css·prefs.js에서 일관되고,
 * 순서 계약이 **모든 단계에서** 지켜지는지 tokens.css를 직접 파싱해 잰다.
 *
 * 순서 계약(2축):
 *   ① 단계 안: window < card < canvas < window-max
 *   ② 단계 간: 같은 역할끼리 clear < sheer < default < solid < opaque 단조 증가
 *
 * ②가 없으면 "5단이지만 sheer가 default보다 불투명" 같은 무의미한 사다리가 통과한다.
 * verify.js 검증16은 렌더 값을 재는데, 이 게이트는 **소스를 재서** 렌더 없이 회귀를 잡는다.
 *
 * 기본값 일치도 함께 본다: prefs.js의 fontSize 기본값은 tokens.css `:root`가 뜻하는
 * 단계(md)와 같아야 한다. 어긋나면 렌더 도중 글자 크기가 튄다(2026-08-24 실측 버그).
 *
 * 실행: node scripts/gates/check-glass-ladder.mjs
 * 성공 표지: glass ladder verification passed
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOKENS = join(ROOT, "app", "styles", "tokens.css");
const PREFS = join(ROOT, "app", "lib", "main", "prefs.js");

/** 사다리 안의 역할 순서. 이 순서대로 값이 커져야 한다. */
const ROLES = ["--glass-window", "--glass-card", "--glass-canvas", "--glass-window-max"];

/** 단계 순서. `default`는 `:root`에 산다(별도 data-glass 블록이 없다). */
const LEVELS = ["clear", "sheer", "default", "solid", "opaque"];

const failures = [];
const css = readFileSync(TOKENS, "utf8");

/** 주어진 CSS 블록 본문에서 역할 4개의 숫자를 뽑는다. */
function readRoles(body, where) {
  const out = {};
  for (const role of ROLES) {
    const m = new RegExp(`${role}\\s*:\\s*([0-9.]+)`).exec(body);
    if (!m) {
      failures.push(`${where}: ${role} 없음`);
      continue;
    }
    out[role] = Number.parseFloat(m[1]);
  }
  return out;
}

/** `:root { ... }` 첫 블록을 기본(default) 단계로 읽는다. */
function rootBlock() {
  const m = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!m) {
    failures.push("tokens.css: :root 블록을 찾지 못했다");
    return null;
  }
  return m[1];
}

/** `:root[data-glass="<level>"] { ... }` 블록을 읽는다. */
function glassBlock(level) {
  const re = new RegExp(
    `\\[data-glass\\s*=\\s*["']${level}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`
  );
  const m = re.exec(css);
  if (!m) {
    failures.push(`tokens.css: data-glass="${level}" 블록 없음`);
    return null;
  }
  return m[1];
}

// ── 각 단계의 값을 모은다 ────────────────────────────────────────────────
const table = {};
for (const level of LEVELS) {
  const body = level === "default" ? rootBlock() : glassBlock(level);
  if (body == null) continue;
  table[level] = readRoles(body, `tokens.css[${level}]`);
}

// ── 계약 ① 단계 안 순서 ─────────────────────────────────────────────────
for (const [level, roles] of Object.entries(table)) {
  const vals = ROLES.map((r) => roles[r]);
  if (vals.some((v) => typeof v !== "number" || Number.isNaN(v))) continue;
  for (let i = 1; i < vals.length; i += 1) {
    if (!(vals[i - 1] < vals[i])) {
      failures.push(
        `단계 안 순서 위반 [${level}]: ${ROLES[i - 1]}=${vals[i - 1]} < ${ROLES[i]}=${vals[i]} 이어야 한다`
      );
    }
  }
}

// ── 계약 ② 단계 간 단조 증가 ────────────────────────────────────────────
for (const role of ROLES) {
  const seq = LEVELS.map((l) => table[l]?.[role]);
  if (seq.some((v) => typeof v !== "number" || Number.isNaN(v))) continue;
  for (let i = 1; i < seq.length; i += 1) {
    if (!(seq[i - 1] < seq[i])) {
      failures.push(
        `단계 간 순서 위반 [${role}]: ${LEVELS[i - 1]}=${seq[i - 1]} < ${LEVELS[i]}=${seq[i]} 이어야 한다`
      );
    }
  }
}

// ── prefs.js 목록과 기본값 ──────────────────────────────────────────────
const prefs = readFileSync(PREFS, "utf8");

const glassLevels = /GLASS_LEVELS\s*=\s*\[([^\]]*)\]/.exec(prefs);
if (!glassLevels) {
  failures.push("prefs.js: GLASS_LEVELS 배열을 찾지 못했다");
} else {
  const declared = [...glassLevels[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (declared.join(",") !== LEVELS.join(",")) {
    failures.push(
      `prefs.js: GLASS_LEVELS가 [${declared.join(", ")}] — [${LEVELS.join(", ")}] 이어야 한다`
    );
  }
}

const fontSizes = /FONT_SIZES\s*=\s*\[([^\]]*)\]/.exec(prefs);
if (!fontSizes) {
  failures.push("prefs.js: FONT_SIZES 배열을 찾지 못했다");
} else {
  const declared = [...fontSizes[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  const want = ["xs", "sm", "md", "lg", "xl"];
  if (declared.join(",") !== want.join(",")) {
    failures.push(`prefs.js: FONT_SIZES가 [${declared.join(", ")}] — [${want.join(", ")}] 이어야 한다`);
  }
}

/**
 * 기본값은 `:root`가 뜻하는 단계와 같아야 한다.
 * tokens.css `:root`에 data-font-size 속성이 없을 때 적용되는 스케일이 곧 md이므로
 * prefs.js의 기본값도 md여야 한다. 'xs'였던 것이 2026-08-24 실측 버그다.
 */
const fontDefault = /fontSize\s*:\s*["']([^"']+)["']/.exec(prefs);
if (!fontDefault) {
  failures.push("prefs.js: fontSize 기본값을 찾지 못했다");
} else if (fontDefault[1] !== "md") {
  failures.push(
    `prefs.js: fontSize 기본값이 '${fontDefault[1]}' — tokens.css :root가 md 스케일이므로 'md'여야 한다 (렌더 도중 글자 크기가 튄다)`
  );
}

const glassDefault = /glassLevel\s*:\s*["']([^"']+)["']/.exec(prefs);
if (glassDefault && glassDefault[1] !== "default") {
  failures.push(`prefs.js: glassLevel 기본값이 '${glassDefault[1]}' — 'default'여야 한다`);
}

/**
 * 단계가 실제로 **사용자에게 닿는가**.
 *
 * settings-cards.js의 GLASS_CHIPS가 설정 화면의 칩을 그린다. 그 파일 주석은
 * "값은 lib/main/prefs.js GLASS_LEVELS와 1:1"이라고 주장하므로, 그 주장을 잰다.
 * 토큰과 배열만 늘리고 칩을 안 늘리면 sheer·solid는 **도달 불가능한 죽은 단계**가 되고
 * 주석은 거짓이 된다 — 게이트가 초록인데 기능이 없는 전형적인 조용한 미완이다.
 */
const SETTINGS_CARDS = join(ROOT, "app", "lib", "settings-cards.js");
let cards;
try {
  cards = readFileSync(SETTINGS_CARDS, "utf8");
} catch {
  failures.push("settings-cards.js: 읽을 수 없다");
}
if (cards) {
  const chips = /GLASS_CHIPS\s*=\s*\[([\s\S]*?)\]/.exec(cards);
  if (!chips) {
    failures.push("settings-cards.js: GLASS_CHIPS 배열을 찾지 못했다");
  } else {
    const values = [...chips[1].matchAll(/value\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    if (values.join(",") !== LEVELS.join(",")) {
      failures.push(
        `settings-cards.js: GLASS_CHIPS가 [${values.join(", ")}] — prefs.js GLASS_LEVELS와 1:1이어야 한다 ` +
          `(빠진 단계는 사용자가 고를 수 없다: ${LEVELS.filter((l) => !values.includes(l)).join(", ") || "없음"})`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("유리·글자 사다리 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `단계 ${LEVELS.length} · 역할 ${ROLES.length} · 순서 계약 2축 통과 ` +
    `(window ${LEVELS.map((l) => table[l]["--glass-window"]).join(" < ")})`
);
console.log("glass ladder verification passed");

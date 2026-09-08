/**
 * 유리 표면은 기존 '가장 불투명' 값으로 고정한다.
 * 초기 CSS 값, 표면 간 순서, 설정 제거와 글자 크기 계약을 검사한다.
 * 실행: node scripts/gates/check-glass-ladder.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const css = read("app", "styles", "tokens.css");
const prefs = read("app", "lib", "main", "prefs.js");
const cards = read("app", "lib", "settings-cards.js");
const failures = [];
const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
const roles = {
  "--glass-window": 0.96,
  "--glass-card": 0.97,
  "--glass-canvas": 0.98,
  "--glass-window-max": 0.99,
};

let previous = 0;
for (const [role, expected] of Object.entries(roles)) {
  const actual = Number(new RegExp(`${role}\\s*:\\s*([0-9.]+)`).exec(root || "")?.[1]);
  if (actual !== expected) failures.push(`${role}: ${actual} — ${expected} 이어야 한다`);
  if (!(actual > previous)) failures.push(`${role}: 표면 간 불투명도 순서 위반`);
  previous = actual;
}
if (/\[data-glass\s*=/.test(css)) failures.push("tokens.css: 선택 가능한 투명도 단계가 남아 있다");
if (/glassLevel|GLASS_LEVELS/.test(prefs)) failures.push("prefs.js: 투명도 설정이 남아 있다");
if (/GLASS_CHIPS|glassLevel|유리 투명도/.test(cards)) failures.push("settings-cards.js: 투명도 옵션이 남아 있다");

const fontSizes = /FONT_SIZES\s*=\s*\[([^\]]*)\]/.exec(prefs);
const declared = [...(fontSizes?.[1] || "").matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
if (declared.join(",") !== "xs,sm,md,lg,xl") failures.push("prefs.js: 글자 크기 5단계 불일치");
if (/fontSize\s*:\s*["']([^"']+)["']/.exec(prefs)?.[1] !== "md") {
  failures.push("prefs.js: 기본 글자 크기는 CSS 기본값과 같은 md여야 한다");
}

if (failures.length) {
  console.error("유리·글자 검사 실패:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("고정 불투명도 · 표면 순서 · 투명도 옵션 제거 · 글자 크기 계약 통과");
console.log("glass ladder verification passed");

// 굴절층·데이터층 분리 스파이크 계측. `npm run verify:glass`
// (= electron verify-glass-separation.js)로 실행한다.
//
// 목적(plan.md 다음 수 7 · soul.md §7 완화책 "프로토타입 실측 먼저"):
// 확장/수축 rAF 프레임을 세 변형으로 실측해 분리 채택을 수치로 판정한다.
//   A (현행)        sheen blur 반경을 매 프레임 30→0px 변조 · 카드 유리 유지
//   B (정적 프로스트) sheen 반경 30px 고정 + 서리 농도(opacity)만 변조 · 카드 유리 유지
//   C (카드 굽기)    sheen 현행 + 애니메이션 동안 카드 backdrop-filter를 끈다
//
// 실측 배경(2026-08-18 verify): 확장은 빈 그리드에서 일어나고(max 50.3ms) 수축은
// 카드 3장이 찬 상태(max 16.8ms)였다 — 카드 굽기(C)는 수축에만, sheen 변형(B)은
// 둘 다에 영향 가설. 판정은 이 스크립트의 숫자가 한다.
//
// 정직성: 이 데스크톱은 공유 환경이라 실행마다 흔들린다(CLAUDE.md §9 "초록 나올
// 때까지 재실행하는 건 검증이 아니다"). 그래서 변형을 ABC ABC … 로 **끼워 넣어**
// 시간대 부하 편차가 특정 변형에 몰리지 않게 하고, 회차 원본을 전부 남긴다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// 검증 전용 프로필 — verify.js와 같은 이유(시작 상태를 이 머신에 맡기지 않는다).
const VERIFY_PROFILE = path.join(__dirname, '.verify-glass-profile');
fs.rmSync(VERIFY_PROFILE, { recursive: true, force: true });
fs.mkdirSync(VERIFY_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(VERIFY_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', VERIFY_PROFILE);

const OUT_DIR = path.join(__dirname, '..', 'spike', 'glass-separation');
fs.mkdirSync(OUT_DIR, { recursive: true });

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function stats(timestamps) {
  const deltas = [];
  for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
  return {
    frameCount: timestamps.length,
    p50: pct(50), p95: pct(95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    min: sorted.length ? sorted[0] : null,
  };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const VARIANTS = {
  A: { label: '현행 — 반경 변조 · 카드 유리', config: { sheen: 'modulate', cards: 'live' } },
  B: { label: '정적 프로스트 — 반경 고정 + 농도 변조', config: { sheen: 'bake', cards: 'live' } },
  C: { label: '카드 굽기 — sheen 현행 + 카드 backdrop-filter off', config: { sheen: 'modulate', cards: 'baked' } },
};
const PAIRS_PER_VARIANT = 6; // 변형당 확장+수축 6회 — ABC 인터리브

app.whenReady().then(async () => {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { canvasWin } = mainMod.getWins();
  await wait(2500); // 부팅 시퀀스가 끝날 때까지 — 부하 겹침 방지

  const runs = []; // { variant, cycle, expand: stats, collapse: stats }
  for (let cycle = 0; cycle < PAIRS_PER_VARIANT; cycle++) {
    for (const key of Object.keys(VARIANTS)) {
      canvasWin.webContents.send('athena:glass-separation', VARIANTS[key].config);
      await wait(120);
      const expandResult = await mainMod.expandCanvasWindow();
      await wait(120);
      // 실사용과 같은 상태로 수축을 잰다 — 확장(빈 그리드) 후 카드 3장을 채운다.
      canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
      canvasWin.webContents.send('athena:add-canvas', { type: 'reader' });
      canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
      await wait(300);
      const collapseResult = await mainMod.collapseCanvasWindow();
      await wait(250);
      runs.push({
        variant: key, cycle,
        expand: stats(expandResult.timestamps),
        collapse: stats(collapseResult.timestamps),
      });
      console.log(`[glass] ${key} #${cycle} expand max=${runs.at(-1).expand.max?.toFixed(1)} p95=${runs.at(-1).expand.p95?.toFixed(1)} | collapse max=${runs.at(-1).collapse.max?.toFixed(1)}`);
    }
  }

  // 기본값 복원 — 계측이 렌더러 상태를 바꾼 채 남기지 않는다
  canvasWin.webContents.send('athena:glass-separation', VARIANTS.A.config);

  const summary = {};
  for (const key of Object.keys(VARIANTS)) {
    const mine = runs.filter((r) => r.variant === key);
    summary[key] = {
      label: VARIANTS[key].label,
      cycles: mine.length,
      expand: {
        medianMax: median(mine.map((r) => r.expand.max)),
        medianP95: median(mine.map((r) => r.expand.p95)),
        worstMax: Math.max(...mine.map((r) => r.expand.max)),
      },
      collapse: {
        medianMax: median(mine.map((r) => r.collapse.max)),
        medianP95: median(mine.map((r) => r.collapse.p95)),
        worstMax: Math.max(...mine.map((r) => r.collapse.max)),
      },
    };
  }

  const report = {
    measuredAt: new Date().toISOString(),
    environment: '공유 데스크톱 — 실행마다 부하 편차 있음(다른 프로세스와 화면 공유)',
    interleaving: 'ABC × ' + PAIRS_PER_VARIANT + ' (시간대 편차 분산)',
    variants: summary,
    runs,
  };
  const outPath = path.join(OUT_DIR, `RESULT-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('[glass] 요약:', JSON.stringify(summary, null, 2));
  console.log('[glass] 결과 저장:', outPath);
  app.quit();
});

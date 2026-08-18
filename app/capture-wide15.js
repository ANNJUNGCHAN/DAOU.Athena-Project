// 넓은 테이블 15 TR 접힌 렌더링 캡처. `npm run capture:wide15` (= electron
// capture-wide15.js)로 실행한다. G001.5 사람 판정 게이트의 증거물.
//
// app/verify.js 검증12(컬럼 우선순위 fold — main 병합 시 검증10에서 재번호)의
// 경로를 그대로 재사용한다 —
// canvasWin에 app/data/wide-table-fold-fixtures.json의 실데이터를
// 'athena:add-canvas-live'로 직접 주입 → canvas.js의 renderMcpTable() →
// app/lib/column-fold.js가 실제 렌더 DOM에서 fold를 발동시킨다 → capturePage().
// main.js를 거치지 않으므로 fixture/live 소스 분기와 무관한 순수 렌더러 검증이다.
// canvas.js(렌더러 코드)는 건드리지 않는다 — 이 스크립트는 캡처 전용이다.

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const OUT_DIR = path.join(__dirname, 'captures', 'wide-15');
const BLIND_DIR = path.join(OUT_DIR, 'blind');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(BLIND_DIR, { recursive: true });

// verify.js와 동일하게 검증 전용 프로필로 갈아끼운다 — 이 머신의 온보딩/계좌
// 등록 상태에 결과가 좌우되지 않게 한다(app/verify.js:28-55의 실측 함정).
const CAPTURE_PROFILE = path.join(__dirname, '.capture-wide15-profile');
fs.rmSync(CAPTURE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(CAPTURE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(CAPTURE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', CAPTURE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function shot(win, filePath) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(filePath, img.toPNG());
}

app.whenReady().then(async () => {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { chatWin, canvasWin } = mainMod.getWins();
  await mainMod.expandCanvasWindow();
  await wait(300);

  const wideFixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'wide-table-fold-fixtures.json'), 'utf-8')
  );
  const foldSummary = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '.omc', 'state', 'fold-summary.json'), 'utf-8')
  );
  const foldByMappingId = new Map(foldSummary.results.map((r) => [r.mapping_id, r]));

  const captureEntries = [];

  for (let i = 0; i < wideFixtures.trs.length; i++) {
    const tr = wideFixtures.trs[i];
    const idx = String(i + 1).padStart(2, '0');
    const fileName = `${idx}-${tr.tr_id}.png`;
    const filePath = path.join(OUT_DIR, fileName);

    const mockRow = {};
    for (const col of tr.columns) mockRow[col.key] = `v:${col.key}`;

    canvasWin.webContents.send('athena:add-canvas-live', {
      status: 'success',
      envelope: {
        canvas_type: 'table',
        fell_back: false,
        caption: tr.name_ko,
        data: { columns: tr.columns, rows: [mockRow, mockRow] },
      },
    });
    await wait(300);

    const foldProbe = await canvasWin.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector('#grid .card.mcp-table');
        if (!card) return null;
        return {
          headerCellCount: card.querySelectorAll('thead th').length,
          rowCellCounts: Array.from(card.querySelectorAll('tbody tr')).map((tr) => tr.children.length),
          foldDataset: (() => {
            const t = card.querySelector('table.fin-table');
            return t ? { total: t.dataset.totalColumns, visible: t.dataset.visibleColumns, hidden: t.dataset.hiddenColumns } : null;
          })(),
        };
      })()
    `);

    await shot(canvasWin, filePath);

    const expected = foldByMappingId.get(tr.mapping_id) || null;
    const visibleColumns = foldProbe && foldProbe.headerCellCount;
    const hiddenColumns = foldProbe !== null ? tr.total_columns - visibleColumns : null;
    const headerMatchesEveryRow = foldProbe !== null
      && foldProbe.rowCellCounts.every((n) => n === foldProbe.headerCellCount);

    captureEntries.push({
      index: i + 1,
      file: fileName,
      mappingId: tr.mapping_id,
      trId: tr.tr_id,
      totalColumns: tr.total_columns,
      cardRendered: foldProbe !== null,
      visibleColumns,
      hiddenColumns,
      foldedBelowTotal: foldProbe !== null && visibleColumns < tr.total_columns,
      headerMatchesEveryRow,
      foldDataset: foldProbe && foldProbe.foldDataset,
      matchesFoldSummary: !!expected
        && expected.total_columns === tr.total_columns
        && expected.visible_columns === visibleColumns
        && expected.hidden_columns === hiddenColumns,
      foldSummaryExpected: expected
        ? { total_columns: expected.total_columns, visible_columns: expected.visible_columns, hidden_columns: expected.hidden_columns }
        : null,
    });
  }

  const allMatch = captureEntries.every((e) => e.matchesFoldSummary);
  const report = {
    generatedAt: new Date().toISOString(),
    method: "app/capture-wide15.js — verify.js 검증12(컬럼 우선순위 fold) 경로를 15 TR 전부로 확장. canvasWin에 athena:add-canvas-live를 직접 주입 → renderMcpTable → webContents.capturePage().",
    canvasWidthPx: wideFixtures.canvas_width_px,
    trCount: wideFixtures.trs.length,
    allMatchFoldSummary: allMatch,
    entries: captureEntries,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'capture-report.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );

  // ---------- blind 채점용 익명 매핑 ----------
  // mapping_id 사전순으로 정렬한 뒤, 각 mapping_id의 sha256 해시값 오름차순으로
  // W01~W15를 배정한다 — 결정적이고 재현 가능한 순열이다(같은 입력이면 항상
  // 같은 W번호 배정). 매핑표는 채점 후 공개용으로 blind/mapping.json에 남긴다.
  const sortedByMappingId = [...captureEntries].sort((a, b) => a.mappingId.localeCompare(b.mappingId));
  const withHash = sortedByMappingId.map((e) => ({
    ...e,
    hash: crypto.createHash('sha256').update(e.mappingId).digest('hex'),
  }));
  withHash.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  const blindMapping = [];
  withHash.forEach((entry, i) => {
    const wLabel = `W${String(i + 1).padStart(2, '0')}`;
    const srcPath = path.join(OUT_DIR, entry.file);
    const destPath = path.join(BLIND_DIR, `${wLabel}.png`);
    fs.copyFileSync(srcPath, destPath);
    blindMapping.push({
      blindLabel: wLabel,
      mappingId: entry.mappingId,
      trId: entry.trId,
      sourceFile: entry.file,
      hash: entry.hash,
    });
  });

  fs.writeFileSync(
    path.join(BLIND_DIR, 'mapping.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      method: 'mapping_id 사전순 정렬 → sha256(mapping_id) 오름차순으로 W01~W15 배정 (결정적 순열).',
      mapping: blindMapping,
    }, null, 2),
    'utf-8'
  );

  console.log('[capture-wide15] 15장 캡처 완료. allMatchFoldSummary =', allMatch);
  console.log('[capture-wide15] 출력:', OUT_DIR);

  await wait(200);
  app.quit();
});

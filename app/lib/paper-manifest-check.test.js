'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ledgerDir = path.join(__dirname, '..', '..', 'backend', 'ref', 'paper-ledger');
const checkerPath = path.join(__dirname, '..', 'scripts', 'paper-manifest-check.mjs');

let mod;
const load = async () => {
  if (!mod) mod = await import(require('node:url').pathToFileURL(checkerPath).href);
  return mod;
};

const clone = () => JSON.parse(fs.readFileSync(path.join(ledgerDir, 'manifest.json'), 'utf8'));

test('paper ledger manifest satisfies all six invariants', async () => {
  const { checkPaperManifest, TOTAL_BOARDS } = await load();
  const { failures, counts } = checkPaperManifest();
  assert.deepEqual(failures, []);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  assert.equal(total, TOTAL_BOARDS);
  assert.equal(counts.card_template, 96);
});

test('every role in the manifest comes from the closed vocabulary', async () => {
  const { ROLES } = await load();
  for (const board of clone().boards) assert.ok(ROLES.includes(board.role), board.id);
});

test('I1 catches a board count that drifts away from 444', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  manifest.boards.pop();
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f.startsWith('I1 boards[].length')));
});

test('I2 catches a page whose declared count no longer matches its boards', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  manifest.pages.find((page) => page.id === '1-0').boards += 1;
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f.startsWith('I2 페이지 1-0')));
});

test('I3 catches card_template drifting from card-surface-templates/index.json', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  const template = manifest.boards.find((board) => board.role === 'card_template');
  template.role = 'card_spec';
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f === `I3 ${template.id}: index.json에 있는데 card_template이 아니다`));
});

test('I4 refuses a retired board that carries no reason', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  const retired = manifest.boards.find((board) => board.role === 'retired');
  assert.ok(retired, '폐기 보드가 매니페스트에 있어야 한다');
  delete retired.why;
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f === `I4 ${retired.id}: retired인데 why가 없다`));
});

test('I5 catches a manifest row whose ledger file does not exist', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  manifest.boards[0].id = 'ZZZZ-9';
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f.startsWith('I5 ZZZZ-9')));
});

test('an unknown role is rejected instead of silently passing', async () => {
  const { checkPaperManifest } = await load();
  const manifest = clone();
  manifest.boards[0].role = 'todo';
  const { failures } = checkPaperManifest({ manifest });
  assert.ok(failures.some((f) => f.includes('폐쇄집합 밖이다')));
});

test('the 8-1 graph boards stay on page 8-1 and remain implementation targets', async () => {
  const manifest = clone();
  for (const id of ['3Z8U-1', '3ZAA-1', '3ZC2-1']) {
    const board = manifest.boards.find((entry) => entry.id === id);
    assert.equal(board.page, '8-1');
    assert.equal(board.role, 'screen');
  }
});

// ---------- I6 · I5 역방향: 합성 원장으로 실패 경로를 재현한다 ----------

const sha = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// boards: [{ id, tree, sha, unregistered? }] — 한 페이지(P-1)짜리 최소 원장을 임시 폴더에 짓는다.
const makeLedger = (t, boards) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pageDir = path.join(dir, 'P-1');
  fs.mkdirSync(pageDir, { recursive: true });
  const manifest = { schema_version: 1, pages: [{ id: 'P-1', name: 'p', boards: 0 }], boards: [] };
  for (const board of boards) {
    fs.writeFileSync(path.join(pageDir, `${board.id}.tree.txt`), board.tree);
    fs.writeFileSync(path.join(pageDir, `${board.id}.json`), JSON.stringify({ tree_summary_sha256: board.sha }));
    if (!board.unregistered) manifest.boards.push({ id: board.id, page: 'P-1', role: 'screen' });
  }
  manifest.pages[0].boards = manifest.boards.length;
  return { ledgerDir: dir, manifest, cardTemplateIds: new Set() };
};

test('I6 accepts both newline conventions the extractor actually used', async (t) => {
  const { checkPaperManifest } = await load();
  const options = makeLedger(t, [
    { id: 'AA-0', tree: 'a\nb\n', sha: sha('a\nb\n') },
    { id: 'BB-0', tree: 'a\nb\n', sha: sha('a\nb') },
  ]);
  const { failures } = checkPaperManifest(options);
  assert.deepEqual(failures.filter((f) => f.startsWith('I6')), []);
});

test('I6 catches a tree summary whose hash no longer reproduces from the file', async (t) => {
  const { checkPaperManifest } = await load();
  const options = makeLedger(t, [{ id: 'AA-0', tree: 'a\nb\n', sha: sha('다른 내용') }]);
  const { failures } = checkPaperManifest(options);
  assert.ok(failures.some((f) => f.startsWith('I6 AA-0') && f.includes('재현되지 않는다')));
});

test('I6 refuses a tree summary stored with CRLF line endings', async (t) => {
  const { checkPaperManifest } = await load();
  const options = makeLedger(t, [{ id: 'AA-0', tree: 'a\r\nb\r\n', sha: sha('a\nb\n') }]);
  const { failures } = checkPaperManifest(options);
  assert.ok(failures.some((f) => f.startsWith('I6 AA-0') && f.includes('CRLF로 저장됐다')));
});

test('I5 catches a ledger file that no manifest row claims', async (t) => {
  const { checkPaperManifest } = await load();
  const options = makeLedger(t, [
    { id: 'AA-0', tree: 'a\n', sha: sha('a\n') },
    { id: 'ZZ-9', tree: 'z\n', sha: sha('z\n'), unregistered: true },
  ]);
  const { failures } = checkPaperManifest(options);
  assert.ok(failures.some((f) => f === 'I5 P-1/ZZ-9.json: 원장에 있는데 매니페스트에 없다'));
});

test('the CLI reports failures on stderr semantics and exits nonzero', async () => {
  const { formatCliReport } = await load();
  const failed = formatCliReport({ failures: ['I6 AA-0: 깨졌다'], counts: {} });
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.lines, ['[paper-manifest] 매니페스트 불변식 위반:', '  - I6 AA-0: 깨졌다']);
  const passed = formatCliReport({ failures: [], counts: { screen: 104 } });
  assert.equal(passed.exitCode, 0);
  assert.match(passed.lines[0], /^paper manifest verification passed — .*screen=104/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ledgerDir = path.join(__dirname, '..', '..', 'backend', 'ref', 'paper-ledger');
const checkerPath = path.join(__dirname, '..', 'scripts', 'paper-manifest-check.mjs');

let mod;
const load = async () => {
  if (!mod) mod = await import(require('node:url').pathToFileURL(checkerPath).href);
  return mod;
};

const clone = () => JSON.parse(fs.readFileSync(path.join(ledgerDir, 'manifest.json'), 'utf8'));

test('paper ledger manifest satisfies all five invariants', async () => {
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

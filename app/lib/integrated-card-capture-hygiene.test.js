'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  KNOWN_STALE_BOARD_CAPTURE_NAMES,
  assertBoardCaptureArtifacts,
  assertExactBoardCaptureNames,
  assertExactBoardCaptureSet,
  captureOutputDirectory,
  expectedBoardCaptureNames,
  ensureCaptureOutputDirectory,
  pruneUnexpectedBoardCaptures,
  resolveBoardSelection,
} = require('./integrated-card-capture-hygiene');
const { assertReadability } = require('./board-glyph-geometry');

const DEFAULT_BOARDS = Object.freeze([
  '2SKU-1', '2R3M-1', '13BC-2', '2QFO-2', '13K0-2', '135M-2',
]);
const PRESETS = Object.freeze([
  { width: 1920, height: 1080 },
  { width: 960, height: 1080 },
  { width: 640, height: 540 },
  { width: 480, height: 420 },
]);
const EXPECTED_24 = Object.freeze([
  'board-2SKU-1-1920x1080.png', 'board-2SKU-1-960x1080.png',
  'board-2SKU-1-640x540.png', 'board-2SKU-1-480x420.png',
  'board-2R3M-1-1920x1080.png', 'board-2R3M-1-960x1080.png',
  'board-2R3M-1-640x540.png', 'board-2R3M-1-480x420.png',
  'board-13BC-2-1920x1080.png', 'board-13BC-2-960x1080.png',
  'board-13BC-2-640x540.png', 'board-13BC-2-480x420.png',
  'board-2QFO-2-1920x1080.png', 'board-2QFO-2-960x1080.png',
  'board-2QFO-2-640x540.png', 'board-2QFO-2-480x420.png',
  'board-13K0-2-1920x1080.png', 'board-13K0-2-960x1080.png',
  'board-13K0-2-640x540.png', 'board-13K0-2-480x420.png',
  'board-135M-2-1920x1080.png', 'board-135M-2-960x1080.png',
  'board-135M-2-640x540.png', 'board-135M-2-480x420.png',
]);
const EXPECTED_STALE_12 = Object.freeze([
  'board-15P5-2-1920x1080.png', 'board-15P5-2-960x1080.png',
  'board-15P5-2-640x540.png', 'board-15P5-2-480x420.png',
  'board-2QX1-1-1920x1080.png', 'board-2QX1-1-960x1080.png',
  'board-2QX1-1-640x540.png', 'board-2QX1-1-480x420.png',
  'board-3DZ1-0-1920x1080.png', 'board-3DZ1-0-960x1080.png',
  'board-3DZ1-0-640x540.png', 'board-3DZ1-0-480x420.png',
]);

function tempCaptureDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-captures-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('board selection distinguishes the no-override canonical run from explicit overrides', () => {
  assert.deepEqual(resolveBoardSelection(undefined, DEFAULT_BOARDS), {
    boardIds: [...DEFAULT_BOARDS], canonical: true,
  });
  assert.deepEqual(resolveBoardSelection('', DEFAULT_BOARDS), {
    boardIds: [...DEFAULT_BOARDS], canonical: false,
  });
  assert.deepEqual(resolveBoardSelection(' 2QFO-2, 13K0-2 ', DEFAULT_BOARDS), {
    boardIds: ['2QFO-2', '13K0-2'], canonical: false,
  });
  assert.throws(() => resolveBoardSelection('   ', DEFAULT_BOARDS), /empty board set/);
  assert.throws(() => resolveBoardSelection('2QFO-2,2QFO-2', DEFAULT_BOARDS), /duplicates/);
});

test('alternate runs are isolated under the canonical capture directory', () => {
  const canonical = path.resolve('app', 'captures', 'integrated-cards');
  assert.equal(captureOutputDirectory(canonical, true), canonical);
  assert.equal(captureOutputDirectory(canonical, false), path.join(canonical, 'diagnostic'));
});

test('canonical output preparation creates a missing exact directory chain safely', (t) => {
  const parent = tempCaptureDir(t);
  const canonical = path.join(parent, 'captures', 'integrated-cards');
  assert.equal(fs.existsSync(canonical), false);
  assert.equal(ensureCaptureOutputDirectory(canonical, true), canonical);
  for (const directory of [path.dirname(canonical), canonical]) {
    const stat = fs.lstatSync(directory);
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(fs.realpathSync.native(directory), directory);
  }
});

test('canonical output preparation rejects a redirected missing-root ancestor', (t) => {
  const parent = tempCaptureDir(t);
  const redirected = tempCaptureDir(t);
  const captures = path.join(parent, 'captures');
  const canonical = path.join(captures, 'integrated-cards');
  fs.symlinkSync(redirected, captures, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => ensureCaptureOutputDirectory(canonical, true),
    /canonical capture output must be a real directory/);
  assert.equal(fs.existsSync(path.join(redirected, 'integrated-cards')), false);
});

test('diagnostic output preparation creates one real direct-child directory idempotently', (t) => {
  const canonical = tempCaptureDir(t);
  const diagnostic = path.join(canonical, 'diagnostic');
  assert.equal(ensureCaptureOutputDirectory(canonical, false), diagnostic);
  assert.equal(fs.lstatSync(diagnostic).isDirectory(), true);
  assert.equal(fs.lstatSync(diagnostic).isSymbolicLink(), false);
  assert.equal(ensureCaptureOutputDirectory(canonical, false), diagnostic);
});

test('diagnostic output preparation rejects a non-directory before replacing or writing it', (t) => {
  const canonical = tempCaptureDir(t);
  const diagnostic = path.join(canonical, 'diagnostic');
  fs.writeFileSync(diagnostic, 'keep');
  assert.throws(() => ensureCaptureOutputDirectory(canonical, false),
    /diagnostic capture output must be a real directory/);
  assert.equal(fs.readFileSync(diagnostic, 'utf8'), 'keep');
});

test('diagnostic output preparation rejects a symlink or junction redirect', (t) => {
  const canonical = tempCaptureDir(t);
  const redirected = tempCaptureDir(t);
  const diagnostic = path.join(canonical, 'diagnostic');
  fs.symlinkSync(redirected, diagnostic, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => ensureCaptureOutputDirectory(canonical, false),
    /diagnostic capture output must be a real directory/);
  assert.equal(fs.readdirSync(redirected).length, 0);
});

test('an alternate board selection cannot bypass an injected readability finding', () => {
  const selection = resolveBoardSelection('2QFO-2', DEFAULT_BOARDS);
  assert.equal(selection.canonical, false);
  assert.throws(() => assertReadability(selection.boardIds[0], { name: 'M' }, {
    atomic_wrap_nodes: [{ node: 'price' }], atomic_wrap_total: 1,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  }, { enforce: true }), /readability atomic_wrap_nodes/);
});

test('the frozen boards and viewport presets derive the exact canonical 24 PNG names', () => {
  assert.deepEqual(expectedBoardCaptureNames(DEFAULT_BOARDS, PRESETS), EXPECTED_24);
  assert.deepEqual(KNOWN_STALE_BOARD_CAPTURE_NAMES, EXPECTED_STALE_12);
  assert.deepEqual(assertExactBoardCaptureNames(EXPECTED_24, EXPECTED_24), [...EXPECTED_24].sort());
  assert.throws(() => assertExactBoardCaptureNames(EXPECTED_24.slice(1), EXPECTED_24),
    /board capture references mismatch/);
});

test('canonical cleanup dry-run identifies only explicitly allowlisted stale board PNGs', (t) => {
  const directory = tempCaptureDir(t);
  const expected = EXPECTED_24.slice(0, 1);
  const stale = [
    'board-15P5-2-1920x1080.png',
    'board-2QX1-1-960x1080.png',
    'board-3DZ1-0-480x420.png',
  ];
  for (const name of [...expected, ...stale, 'CC-01-summary.png']) {
    fs.writeFileSync(path.join(directory, name), name);
  }
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'board-OLD-1-480x420.png'), 'nested');

  const removed = pruneUnexpectedBoardCaptures({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: expected,
    allowedStaleNames: stale,
    dryRun: true,
  });

  assert.deepEqual(removed, stale.sort());
  for (const name of stale) assert.equal(fs.existsSync(path.join(directory, name)), true);
  assert.equal(fs.existsSync(path.join(directory, 'nested', 'board-OLD-1-480x420.png')), true);
});

test('canonical cleanup deletes only allowlisted direct PNGs and remains idempotent', (t) => {
  const directory = tempCaptureDir(t);
  const expected = EXPECTED_24.slice(0, 2);
  const stale = 'board-15P5-2-640x540.png';
  for (const name of [...expected, stale, 'VERIFY-INTEGRATED-CARDS.json']) {
    fs.writeFileSync(path.join(directory, name), name);
  }

  assert.throws(() => assertExactBoardCaptureSet({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: expected,
  }), /board capture set mismatch.*15P5/);
  assert.deepEqual(pruneUnexpectedBoardCaptures({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: expected,
    allowedStaleNames: [stale],
  }), [stale]);
  assert.equal(fs.existsSync(path.join(directory, stale)), false);
  assert.deepEqual(pruneUnexpectedBoardCaptures({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: expected,
    allowedStaleNames: [stale],
  }), [], 'a second cleanup is idempotent');
  assert.deepEqual(assertExactBoardCaptureSet({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: expected,
  }), expected);
});

test('unknown or nonregular board PNG entries fail before any allowlisted stale file is deleted', (t) => {
  const unknownCases = [
    { name: 'board-UNKNOWN-1-640x540.png', directory: false },
    { name: 'board-REPARSE-1-640x540.png', directory: true },
  ];
  for (const item of unknownCases) {
    const directory = tempCaptureDir(t);
    const stale = 'board-15P5-2-640x540.png';
    fs.writeFileSync(path.join(directory, stale), stale);
    if (item.directory) fs.mkdirSync(path.join(directory, item.name));
    else fs.writeFileSync(path.join(directory, item.name), item.name);

    for (const dryRun of [true, false]) {
      assert.throws(() => pruneUnexpectedBoardCaptures({
        captureDir: directory,
        canonicalCaptureDir: directory,
        expectedNames: [],
        allowedStaleNames: [stale],
        dryRun,
      }), /unrecognized board capture entry/);
      assert.equal(fs.existsSync(path.join(directory, stale)), true);
      assert.equal(fs.existsSync(path.join(directory, item.name)), true);
    }
  }
});

test('canonical cleanup refuses any directory other than the exact canonical capture root', (t) => {
  const canonical = tempCaptureDir(t);
  const other = tempCaptureDir(t);
  const stale = 'board-15P5-2-640x540.png';
  fs.writeFileSync(path.join(other, stale), stale);

  assert.throws(() => pruneUnexpectedBoardCaptures({
    captureDir: other,
    canonicalCaptureDir: canonical,
    expectedNames: [],
    allowedStaleNames: [stale],
  }), /exact canonical capture directory/);
  assert.equal(fs.existsSync(path.join(other, stale)), true);
});

test('canonical cleanup refuses a symlink or reparse-point capture root', (t) => {
  const parent = tempCaptureDir(t);
  const target = path.join(parent, 'target');
  const linked = path.join(parent, 'linked');
  fs.mkdirSync(target);
  fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(() => pruneUnexpectedBoardCaptures({
    captureDir: linked,
    canonicalCaptureDir: linked,
    expectedNames: [],
    allowedStaleNames: [],
  }), /must not be a symlink or reparse point/);
});

test('post-run artifact verification binds each report reference to file hash and PNG dimensions', (t) => {
  const directory = tempCaptureDir(t);
  const file = 'board-2SKU-1-1x1.png';
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  fs.writeFileSync(path.join(directory, file), png);
  const record = {
    file,
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
    dimensions: { width: 1, height: 1 },
  };

  assert.deepEqual(assertBoardCaptureArtifacts({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: [file],
    records: [record],
  }), { files: 1, hashes: 1, dimensions: 1 });
  assert.throws(() => assertBoardCaptureArtifacts({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: [file],
    records: [{ ...record, sha256: '0'.repeat(64) }],
  }), /capture hash mismatch/);
  assert.throws(() => assertBoardCaptureArtifacts({
    captureDir: directory,
    canonicalCaptureDir: directory,
    expectedNames: [file],
    records: [{ ...record, dimensions: { width: 2, height: 1 } }],
  }), /capture dimensions mismatch/);
});

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const GENERATED_BOARD_CAPTURE = /^board-[a-z0-9]+(?:-[a-z0-9]+)*-[1-9]\d*x[1-9]\d*\.png$/i;
const BOARD_CAPTURE = /^board-.*\.png$/i;
const KNOWN_STALE_BOARD_CAPTURE_NAMES = Object.freeze([
  'board-15P5-2-1920x1080.png', 'board-15P5-2-960x1080.png',
  'board-15P5-2-640x540.png', 'board-15P5-2-480x420.png',
  'board-2QX1-1-1920x1080.png', 'board-2QX1-1-960x1080.png',
  'board-2QX1-1-640x540.png', 'board-2QX1-1-480x420.png',
  'board-3DZ1-0-1920x1080.png', 'board-3DZ1-0-960x1080.png',
  'board-3DZ1-0-640x540.png', 'board-3DZ1-0-480x420.png',
]);

function resolveBoardSelection(rawOverride, defaultBoardIds) {
  const canonical = rawOverride === undefined;
  if (rawOverride !== undefined && typeof rawOverride !== 'string') {
    throw new TypeError('ATHENA_VERIFY_BOARD_IDS must be a string');
  }
  const source = canonical || rawOverride === '' ? defaultBoardIds.join(',') : rawOverride;
  const boardIds = source.split(',').map((boardId) => boardId.trim()).filter(Boolean);
  if (!boardIds.length) {
    throw new Error('ATHENA_VERIFY_BOARD_IDS resolved to an empty board set');
  }
  if (new Set(boardIds).size !== boardIds.length) {
    throw new Error(`ATHENA_VERIFY_BOARD_IDS contains duplicates: ${boardIds.join(',')}`);
  }
  return { boardIds, canonical };
}

function captureOutputDirectory(canonicalCaptureDir, canonical) {
  const root = path.resolve(canonicalCaptureDir);
  if (canonical) return root;
  const diagnostic = path.resolve(root, 'diagnostic');
  if (path.dirname(diagnostic) !== root) {
    throw new Error('diagnostic capture directory escaped the canonical capture directory');
  }
  return diagnostic;
}

function checkedRealDirectory(directory, label) {
  const configured = path.resolve(directory);
  let stat;
  try {
    stat = fs.lstatSync(configured);
  } catch (error) {
    throw new Error(`${label} must be an existing real directory: ${configured}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${configured}`);
  }
  const real = fs.realpathSync.native(configured);
  if (comparablePath(real) !== comparablePath(configured)) {
    throw new Error(`${label} must not be a symlink or reparse point: ${configured}`);
  }
  return real;
}

function ensureRealDirectoryTree(directory, label) {
  const configured = path.resolve(directory);
  const missing = [];
  let cursor = configured;
  for (;;) {
    try {
      checkedRealDirectory(cursor, label);
      break;
    } catch (error) {
      let stat;
      try {
        stat = fs.lstatSync(cursor);
      } catch (lstatError) {
        if (lstatError.code !== 'ENOENT') throw error;
      }
      if (stat) throw error;
      missing.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
  for (const target of missing.reverse()) {
    checkedRealDirectory(path.dirname(target), label);
    fs.mkdirSync(target);
    checkedRealDirectory(target, label);
  }
  return checkedRealDirectory(configured, label);
}

function ensureCaptureOutputDirectory(canonicalCaptureDir, canonical) {
  const root = ensureRealDirectoryTree(canonicalCaptureDir, 'canonical capture output');
  if (canonical) return root;
  const diagnostic = captureOutputDirectory(root, false);
  if (!fs.existsSync(diagnostic)) fs.mkdirSync(diagnostic);
  let output;
  try {
    output = checkedRealDirectory(diagnostic, 'diagnostic capture output');
  } catch (error) {
    throw new Error(`diagnostic capture output must be a real directory: ${diagnostic}`);
  }
  if (comparablePath(path.dirname(output)) !== comparablePath(root)
    || comparablePath(output) !== comparablePath(diagnostic)) {
    throw new Error(`diagnostic capture output must be the canonical root's direct child: ${output}`);
  }
  return output;
}

function expectedBoardCaptureNames(boardIds, presets) {
  const names = [];
  for (const boardId of boardIds) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(boardId)) {
      throw new Error(`invalid board capture id: ${boardId}`);
    }
    for (const preset of presets) {
      if (!Number.isInteger(preset.width) || preset.width <= 0
        || !Number.isInteger(preset.height) || preset.height <= 0) {
        throw new Error(`invalid board capture preset: ${JSON.stringify(preset)}`);
      }
      names.push(`board-${boardId}-${preset.width}x${preset.height}.png`);
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error('expected board capture names contain duplicates');
  }
  return names;
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function exactCaptureRoot(captureDir, canonicalCaptureDir) {
  const configuredCaptureRoot = path.resolve(captureDir);
  const configuredCanonicalRoot = path.resolve(canonicalCaptureDir);
  if (comparablePath(configuredCaptureRoot) !== comparablePath(configuredCanonicalRoot)) {
    throw new Error('capture cleanup requires the exact canonical capture directory');
  }
  const captureRoot = fs.realpathSync.native(configuredCaptureRoot);
  const canonicalRoot = fs.realpathSync.native(configuredCanonicalRoot);
  if (comparablePath(captureRoot) !== comparablePath(canonicalRoot)
    || comparablePath(canonicalRoot) !== comparablePath(configuredCanonicalRoot)) {
    throw new Error('canonical capture directory must not be a symlink or reparse point');
  }
  return captureRoot;
}

function directEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true });
}

function assertExactBoardCaptureNames(actualNames, expectedNames, label = 'board capture references') {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((name) => !actualSet.has(name));
    const unexpected = actual.filter((name) => !expectedSet.has(name));
    throw new Error(
      `${label} mismatch: missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`,
    );
  }
  return actual;
}

function pruneUnexpectedBoardCaptures({
  captureDir, canonicalCaptureDir, expectedNames, allowedStaleNames, dryRun = false,
}) {
  const root = exactCaptureRoot(captureDir, canonicalCaptureDir);
  const expected = new Set(expectedNames);
  const allowedStale = new Set(allowedStaleNames);
  if ([...allowedStale].some((name) => !GENERATED_BOARD_CAPTURE.test(name))) {
    throw new Error('stale board capture allowlist contains an invalid generated filename');
  }
  if ([...allowedStale].some((name) => expected.has(name))) {
    throw new Error('stale board capture allowlist overlaps the expected capture set');
  }
  const boardEntries = directEntries(root).filter((entry) => BOARD_CAPTURE.test(entry.name));
  const unrecognized = boardEntries.filter((entry) => (
    !entry.isFile() || (!expected.has(entry.name) && !allowedStale.has(entry.name))
  ));
  if (unrecognized.length) {
    throw new Error(
      `unrecognized board capture entry: ${unrecognized.map((entry) => entry.name).sort().join(',')}`,
    );
  }
  const stale = boardEntries
    .filter((entry) => entry.isFile() && allowedStale.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!dryRun) {
    for (const name of stale) {
      const target = path.resolve(root, name);
      if (comparablePath(path.dirname(target)) !== comparablePath(root)) {
        throw new Error(`board capture escaped the exact capture directory: ${name}`);
      }
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`board capture is not a regular file: ${name}`);
      }
      fs.unlinkSync(target);
    }
  }
  return stale;
}

function assertExactBoardCaptureSet({ captureDir, canonicalCaptureDir, expectedNames }) {
  const root = exactCaptureRoot(captureDir, canonicalCaptureDir);
  const boardEntries = directEntries(root).filter((entry) => BOARD_CAPTURE.test(entry.name));
  const nonregular = boardEntries.filter((entry) => !entry.isFile());
  if (nonregular.length) {
    throw new Error(
      `board capture set contains nonregular entries: ${nonregular.map((entry) => entry.name).sort()}`,
    );
  }
  const actual = boardEntries.map((entry) => entry.name).sort();
  return assertExactBoardCaptureNames(actual, expectedNames, 'board capture set');
}

function pngDimensions(buffer, name) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)
    || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`capture is not a PNG with an IHDR header: ${name}`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertBoardCaptureArtifacts({
  captureDir, canonicalCaptureDir, expectedNames, records,
}) {
  const root = exactCaptureRoot(captureDir, canonicalCaptureDir);
  if (!Array.isArray(records)) throw new Error('board capture records are missing');
  assertExactBoardCaptureNames(
    records.map((record) => record && record.file), expectedNames,
  );
  assertExactBoardCaptureSet({ captureDir: root, canonicalCaptureDir, expectedNames });
  for (const record of records) {
    const target = path.resolve(root, record.file);
    if (comparablePath(path.dirname(target)) !== comparablePath(root)) {
      throw new Error(`board capture escaped the exact capture directory: ${record.file}`);
    }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`board capture is not a regular file: ${record.file}`);
    }
    const png = fs.readFileSync(target);
    const actualHash = crypto.createHash('sha256').update(png).digest('hex');
    if (record.sha256 !== actualHash) {
      throw new Error(`capture hash mismatch: ${record.file}`);
    }
    const dimensions = pngDimensions(png, record.file);
    if (!record.dimensions || record.dimensions.width !== dimensions.width
      || record.dimensions.height !== dimensions.height) {
      throw new Error(`capture dimensions mismatch: ${record.file}`);
    }
  }
  return { files: records.length, hashes: records.length, dimensions: records.length };
}

module.exports = {
  KNOWN_STALE_BOARD_CAPTURE_NAMES,
  assertBoardCaptureArtifacts,
  assertExactBoardCaptureNames,
  assertExactBoardCaptureSet,
  captureOutputDirectory,
  ensureCaptureOutputDirectory,
  expectedBoardCaptureNames,
  pruneUnexpectedBoardCaptures,
  resolveBoardSelection,
};

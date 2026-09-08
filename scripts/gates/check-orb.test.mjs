import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const gate = fileURLToPath(new URL('./check-orb.mjs', import.meta.url));
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const files = ['orb.html', 'orb.css', 'orb.js', 'main.js', 'preload.js',
  'lib/main/orb-window.js', 'lib/glau-mascot.js', 'styles/glau-mascot.css'];

function runFixture(change) {
  const dir = mkdtempSync(join(tmpdir(), 'athena-glau-gate-'));
  try {
    for (const file of files) {
      const target = join(dir, 'app', file);
      mkdirSync(resolve(target, '..'), { recursive: true });
      copyFileSync(join(root, 'app', file), target);
    }
    if (change) {
      const target = join(dir, 'app', change.file);
      const original = readFileSync(target, 'utf8');
      const updated = original.replace(change.before, change.after);
      assert.notEqual(updated, original, 'mutation must alter production source');
      writeFileSync(target, updated);
    }
    return spawnSync(process.execPath, [gate], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('current Glau orb passes the complete contract gate', () => {
  const result = runFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /orb contract verification passed/);
});

for (const [name, change, message] of [
  ['neutralized alert expression', { file: 'lib/glau-mascot.js', before: "fired: 'surprised'", after: "fired: 'neutral'" }, /fired/],
  ['wrong approved palette', { file: 'lib/glau-mascot.js', before: "body: '#BF9B81'", after: "body: '#0000FF'" }, /palette/],
  ['missing gaze movement', { file: 'styles/glau-mascot.css', before: '--orb-gx', after: '--disabled-gx' }, /gaze/],
  ['missing runtime state renderer', { file: 'orb.js', before: 'glauMascot.render(glauHost, next);', after: '' }, /render/],
  ['one eye missing', { file: 'lib/glau-mascot.js', before: 'neutral: eye(45) + eye(83)', after: 'neutral: eye(45)' }, /eyes/],
  ['collapsed body geometry', { file: 'lib/glau-mascot.js', before: 'cy="70" r="49"', after: 'cy="70" r="4"' }, /geometry/],
]) {
  test(`gate rejects ${name}`, () => {
    const result = runFixture(change);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  });
}

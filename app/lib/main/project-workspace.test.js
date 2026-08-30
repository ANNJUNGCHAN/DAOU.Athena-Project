'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ProjectWorkspaceError,
  WORKSPACE_SECURITY_CONTRACT,
  createProjectWorkspace,
  validateProjectRoot,
  validateRelativePath,
} = require('./project-workspace');

async function withTempWorkspace(run) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-project-workspace-'));
  const root = path.join(container, 'project');
  fs.mkdirSync(root);
  try { return await run({ container, root }); }
  finally { fs.rmSync(container, { recursive: true, force: true }); }
}

async function expectCode(code, action) {
  await assert.rejects(action, (error) => error instanceof ProjectWorkspaceError && error.code === code);
}

function fileSystemProxy(overrides = {}) {
  return Object.assign(Object.create(fs), overrides);
}

function replaceRoot(root) {
  const displaced = `${root}-displaced-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.renameSync(root, displaced);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'report.txt'), 'replacement');
}

test('프로젝트 루트를 canonical absolute directory로 고정하고 cwd getter가 재검증한다', () => withTempWorkspace(async ({ root }) => {
  const selected = path.join(root, '.');
  const identity = await validateProjectRoot(selected);
  const workspace = await createProjectWorkspace(selected);
  assert.equal(path.isAbsolute(identity.canonicalPath), true);
  const execution = await workspace.getValidatedRoot();
  assert.equal(execution.cwd, fs.realpathSync.native(root));
  assert.equal(execution.verificationBoundary, 'pre-spawn-only');
  assert.equal(execution.atomicWithSpawn, false);
  assert.equal(execution.childMustRevalidateIdentity, true);
  assert.match(execution.rootIdentity.device, /^\d+$/);
  assert.match(execution.rootIdentity.fileId, /^\d+$/);
  assert.deepEqual(WORKSPACE_SECURITY_CONTRACT, {
    rootToSpawnAtomic: false,
    fileReadUsesExclusiveWindowsLock: false,
    fileReadVerification: 'open-handle-pre-post-identity-size-time-and-final-path',
    ooxmlLoading: 'fail-closed',
  });
}));

test('존재하지 않거나 파일이거나 UNC/device namespace인 루트는 거절한다', () => withTempWorkspace(async ({ root }) => {
  const file = path.join(root, 'file.txt');
  fs.writeFileSync(file, 'x');
  await expectCode('path_unavailable', () => validateProjectRoot(path.join(root, 'missing')));
  await expectCode('not_directory', () => validateProjectRoot(file));
  for (const candidate of ['\\\\server\\share', '\\\\?\\C:\\project', '\\\\.\\C:\\project', 'relative/project']) {
    await expectCode('invalid_root', () => validateProjectRoot(candidate));
  }
}));

test('상대 경로 문법은 traversal, 절대 경로, 대체 separator, ADS와 Windows device명을 차단한다', () => {
  assert.deepEqual(validateRelativePath('reports/summary.md'), ['reports', 'summary.md']);
  for (const candidate of [
    '../secret.txt', 'reports/../secret.txt', '/etc/passwd', 'C:/outside.txt',
    'reports\\summary.md', '//server/share.txt', 'report.txt:stream', 'CON.txt',
    'folder./file.txt', 'folder /file.txt', './file.txt', 'folder//file.txt',
  ]) {
    assert.throws(() => validateRelativePath(candidate));
  }
});

test('숨김 파일과 credential/token/secret 이름은 목록과 load에서 보호한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'report.md'), '# ok');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret');
  fs.writeFileSync(path.join(root, 'api-token.json'), '{}');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), 'secret');
  const workspace = await createProjectWorkspace(root);
  assert.deepEqual((await workspace.listArtifacts()).items.map((item) => item.path), ['report.md']);
  await expectCode('protected_artifact', () => workspace.loadArtifact('.env'));
  await expectCode('protected_artifact', () => workspace.loadArtifact('api-token.json'));
}));

test('안전한 목록은 공개 상대 경로와 제한된 메타데이터만 반환한다', () => withTempWorkspace(async ({ root }) => {
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', 'summary.md'), '# 결과');
  fs.writeFileSync(path.join(root, 'reports', 'ignored.exe'), 'not listed');
  const result = await (await createProjectWorkspace(root)).listArtifacts();
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items.map((item) => ({ path: item.path, kind: item.kind })), [
    { path: 'reports', kind: 'directory' },
    { path: 'reports/summary.md', kind: 'file' },
  ]);
  assert.equal(result.items[1].loadable, true);
  assert.equal(result.items[1].mimeType, 'text/markdown');
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(Object.hasOwn(result.items[1], 'absolutePath'), false);
}));

test('목록 재귀 깊이와 전체 entry 수를 제한한다', () => withTempWorkspace(async ({ root }) => {
  fs.mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'one.txt'), '1');
  fs.writeFileSync(path.join(root, 'a', 'b', 'two.txt'), '2');
  fs.writeFileSync(path.join(root, 'a', 'b', 'c', 'three.txt'), '3');
  const workspace = await createProjectWorkspace(root);
  const shallow = await workspace.listArtifacts({ maxDepth: 2 });
  assert.deepEqual(shallow.items.map((item) => item.path), ['a', 'a/b', 'a/one.txt']);
  const capped = await workspace.listArtifacts({ maxEntries: 2 });
  assert.equal(capped.items.length, 2);
  assert.equal(capped.truncated, true);
  await expectCode('invalid_max_depth', () => workspace.listArtifacts({ maxDepth: 99 }));
  await expectCode('invalid_max_entries', () => workspace.listArtifacts({ maxEntries: 99_999 }));
}));

test('UTF-8 text load는 공개 shape만 반환하고 크기 및 encoding을 검증한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'result.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
  fs.writeFileSync(path.join(root, 'large.txt'), '12345');
  const workspace = await createProjectWorkspace(root);
  const loaded = await workspace.loadArtifact('result.json');
  assert.deepEqual({ path: loaded.path, name: loaded.name, type: loaded.type, encoding: loaded.encoding, content: loaded.content }, {
    path: 'result.json', name: 'result.json', type: 'text', encoding: 'utf-8', content: '{"ok":true}\n',
  });
  assert.equal(JSON.stringify(loaded).includes(root), false);
  await expectCode('invalid_text_encoding', () => workspace.loadArtifact('invalid.txt'));
  await expectCode('artifact_too_large', () => workspace.loadArtifact('large.txt', { maxBytes: 4 }));
}));

test('binary는 기본 차단하며 명시적 허용과 별도 크기 제한에서만 base64로 반환한다', () => withTempWorkspace(async ({ root }) => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(path.join(root, 'chart.png'), bytes);
  const workspace = await createProjectWorkspace(root);
  const listed = (await workspace.listArtifacts()).items.find((item) => item.path === 'chart.png');
  assert.equal(listed.type, 'binary');
  assert.equal(listed.loadable, false);
  await expectCode('binary_not_allowed', () => workspace.loadArtifact('chart.png'));
  const loaded = await workspace.loadArtifact('chart.png', { allowBinary: true });
  assert.equal(loaded.encoding, 'base64');
  assert.equal(loaded.content, bytes.toString('base64'));
  await expectCode('artifact_too_large', () => workspace.loadArtifact('chart.png', { allowBinary: true, maxBytes: 3 }));
}));

test('지원하지 않는 파일과 directory load를 거절한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'program.exe'), 'x');
  fs.mkdirSync(path.join(root, 'reports'));
  const workspace = await createProjectWorkspace(root);
  await expectCode('unsupported_artifact', () => workspace.loadArtifact('program.exe'));
  await expectCode('not_file', () => workspace.loadArtifact('reports'));
}));

test('루트가 교체되면 기존 workspace의 cwd/list/load를 모두 중단한다', () => withTempWorkspace(async ({ root }) => {
  const workspace = await createProjectWorkspace(root);
  fs.renameSync(root, `${root}-old`);
  fs.mkdirSync(root);
  await expectCode('root_changed', () => workspace.getValidatedRoot());
  await expectCode('root_changed', () => workspace.listArtifacts());
  await expectCode('root_changed', () => workspace.loadArtifact('file.txt'));
}));

test('심볼릭 링크나 정션 루트와 하위 링크는 따라가지 않는다', () => withTempWorkspace(async ({ container, root }) => {
  const outside = path.join(container, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'report.txt'), 'outside');
  const rootLink = path.join(container, 'root-link');
  const childLink = path.join(root, 'linked');
  fs.symlinkSync(root, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(outside, childLink, process.platform === 'win32' ? 'junction' : 'dir');
  await expectCode('reparse_point', () => createProjectWorkspace(rootLink));
  const workspace = await createProjectWorkspace(root);
  assert.equal((await workspace.listArtifacts()).items.some((item) => item.path.startsWith('linked')), false);
  await expectCode('reparse_point', () => workspace.loadArtifact('linked/report.txt'));
}));

test('NTFS hardlink는 nlink 경계에서 목록과 load 모두 차단한다', () => withTempWorkspace(async ({ container, root }) => {
  const outside = path.join(container, 'outside.txt');
  const linked = path.join(root, 'linked.txt');
  fs.writeFileSync(outside, 'outside');
  fs.linkSync(outside, linked);
  const workspace = await createProjectWorkspace(root);
  const listed = await workspace.listArtifacts();
  assert.equal(listed.items.some((item) => item.path === 'linked.txt'), false);
  assert.deepEqual(listed.exclusionReasons, [{ code: 'linked_or_reparse', count: 1 }]);
  await expectCode('multiple_links', () => workspace.loadArtifact('linked.txt'));
}));

test('주입 reparse inspector는 generic reparse와 volume-mount 판정을 항상 거절한다', () => withTempWorkspace(async ({ root }) => {
  fs.mkdirSync(path.join(root, 'generic-reparse'));
  fs.writeFileSync(path.join(root, 'generic-reparse', 'report.txt'), 'outside-like');
  const workspace = await createProjectWorkspace(root, {
    reparseInspector: ({ absolutePath }) => path.basename(absolutePath) === 'generic-reparse',
  });
  const listed = await workspace.listArtifacts();
  assert.equal(listed.items.some((item) => item.path.startsWith('generic-reparse')), false);
  assert.deepEqual(listed.exclusionReasons, [{ code: 'linked_or_reparse', count: 1 }]);
  await expectCode('reparse_point', () => workspace.loadArtifact('generic-reparse/report.txt'));
}));

test('0 또는 unavailable handle identity는 안전한 대체 ID 없이 fail-closed 한다', () => withTempWorkspace(async ({ root }) => {
  const zeroIdentityFs = fileSystemProxy({
    fstatSync(descriptor, options) {
      const stat = fs.fstatSync(descriptor, options);
      return new Proxy(stat, { get(target, key) { return key === 'dev' ? 0n : Reflect.get(target, key); } });
    },
  });
  await expectCode('identity_unavailable', () => createProjectWorkspace(root, { fileSystem: zeroIdentityFs }));
}));

test('기본 native reparse 검사가 unavailable이면 caller callback과 무관하게 fail-closed 한다', () => withTempWorkspace(async ({ root }) => {
  await expectCode('reparse_inspection_unavailable', () => createProjectWorkspace(root, {
    nativeReparseProbe() { throw new Error('native unavailable'); },
    reparseInspector() { return false; },
  }));
}));

test('동시 list/load는 같은 경로·identity의 in-flight probe를 공유하고 native probe 동시성을 제한한다', () => withTempWorkspace(async ({ root }) => {
  for (let index = 0; index < 20; index += 1) {
    fs.writeFileSync(path.join(root, `artifact-${String(index).padStart(2, '0')}.txt`), 'ok');
  }
  const probeCounts = new Map();
  let active = 0;
  let maxActive = 0;
  const workspace = await createProjectWorkspace(root, {
    async nativeReparseProbe({ canonicalPath }) {
      probeCounts.set(canonicalPath, (probeCounts.get(canonicalPath) || 0) + 1);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return false;
    },
  });
  await Promise.all([
    ...Array.from({ length: 20 }, () => workspace.listArtifacts({ maxEntries: 20, maxScannedEntries: 20 })),
    ...Array.from({ length: 20 }, (_, index) => workspace.loadArtifact(`artifact-${String(index).padStart(2, '0')}.txt`)),
    ...Array.from({ length: 20 }, () => workspace.loadArtifact('artifact-00.txt')),
  ]);
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= 4, `native probe concurrency was ${maxActive}`);
  assert.equal(Math.max(...probeCounts.values()), 1);
  assert.equal(probeCounts.size, 21);
}));

test('여러 workspace instance의 native probe도 process-wide 동시성 4를 공유한다', () => withTempWorkspace(async ({ root }) => {
  let active = 0;
  let maxActive = 0;
  let probeCount = 0;
  const nativeReparseProbe = async () => {
    probeCount += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return false;
  };
  const workspaces = await Promise.all(Array.from({ length: 20 }, () => createProjectWorkspace(root, {
    nativeReparseProbe,
  })));
  assert.equal(workspaces.length, 20);
  assert.equal(probeCount, 20);
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= 4, `process-wide native probe concurrency was ${maxActive}`);
}));

test('reparse cache는 path별 현재 fingerprint만 유지하고 stale identity를 재검사한다', () => withTempWorkspace(async ({ root }) => {
  const report = path.join(root, 'report.txt');
  fs.writeFileSync(report, 'first');
  let reportProbeCount = 0;
  const workspace = await createProjectWorkspace(root, {
    nativeReparseProbe({ canonicalPath }) {
      if (path.resolve(canonicalPath) === path.resolve(report)) reportProbeCount += 1;
      return false;
    },
  });
  await workspace.loadArtifact('report.txt');
  fs.rmSync(report);
  fs.writeFileSync(report, 'second');
  const loaded = await workspace.loadArtifact('report.txt');
  assert.equal(loaded.content, 'second');
  assert.equal(reportProbeCount, 2);
}));

test('조작된 SystemRoot 환경값은 OS kernel SystemRoot 경계와 불일치하여 fail-closed 한다', () => withTempWorkspace(async ({ container, root }) => {
  if (process.platform !== 'win32') {
    const source = fs.readFileSync(path.join(__dirname, 'project-workspace.js'), 'utf8');
    assert.match(source, /GLOBALROOT\\\\SystemRoot/);
    return;
  }
  const attackerRoot = path.join(container, 'attacker', 'Windows');
  fs.mkdirSync(path.join(attackerRoot, 'System32'), { recursive: true });
  fs.writeFileSync(path.join(attackerRoot, 'System32', 'fsutil.exe'), 'not executable');
  const previous = process.env.SystemRoot;
  process.env.SystemRoot = attackerRoot;
  try {
    await expectCode('reparse_inspection_unavailable', () => createProjectWorkspace(root));
  } finally {
    if (previous === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previous;
  }
}));

for (const tamperStage of [
  'load:after-current-root',
  'load:target:component-0:after-lstat',
  'load:target:component-0:after-open',
  'load:after-read',
]) {
  test(`root TOCTOU를 ${tamperStage} 단계에서 감지하고 결과를 폐기한다`, () => withTempWorkspace(async ({ root }) => {
    fs.writeFileSync(path.join(root, 'report.txt'), 'original');
    let armed = false;
    let identitySwapped = false;
    const descriptors = new Map();
    const proxy = fileSystemProxy({
      openSync(target, flags) {
        const descriptor = fs.openSync(target, flags);
        descriptors.set(descriptor, target);
        return descriptor;
      },
      fstatSync(descriptor, options) {
        const stat = fs.fstatSync(descriptor, options);
        const target = descriptors.get(descriptor);
        if (!identitySwapped || !target || path.resolve(target) !== path.resolve(root)) return stat;
        return new Proxy(stat, {
          get(value, key) { return key === 'ino' ? Reflect.get(value, key) + 1n : Reflect.get(value, key); },
        });
      },
      closeSync(descriptor) {
        descriptors.delete(descriptor);
        fs.closeSync(descriptor);
      },
    });
    const workspace = await createProjectWorkspace(root, {
      fileSystem: proxy,
      checkpoint(stage) {
        if (armed && !identitySwapped && stage === tamperStage) identitySwapped = true;
      },
    });
    armed = true;
    await expectCode('root_changed', () => workspace.loadArtifact('report.txt'));
    assert.equal(identitySwapped, true);
  }));
}

test('getValidatedRoot은 반환 직전 root 교체를 재검증하며 spawn 원자성을 주장하지 않는다', () => withTempWorkspace(async ({ root }) => {
  let armed = false;
  let swapped = false;
  const workspace = await createProjectWorkspace(root, {
    checkpoint(stage) {
      if (armed && !swapped && stage === 'execution-context:before-return') {
        swapped = true;
        replaceRoot(root);
      }
    },
  });
  armed = true;
  await expectCode('root_changed', () => workspace.getValidatedRoot());
  assert.equal(swapped, true);
}));

test('text content sniff는 NUL과 비텍스트 control byte를 확장자와 무관하게 거절한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'zero.txt'), Buffer.from([0x61, 0x00, 0x62]));
  fs.writeFileSync(path.join(root, 'control.json'), Buffer.from([0x7b, 0x01, 0x7d]));
  const workspace = await createProjectWorkspace(root);
  await expectCode('non_text_content', () => workspace.loadArtifact('zero.txt'));
  await expectCode('non_text_content', () => workspace.loadArtifact('control.json'));
}));

test('binary content sniff는 PNG/JPEG/PDF magic 불일치와 active SVG를 거절한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'fake.png'), '%PDF-1.7\n');
  fs.writeFileSync(path.join(root, 'fake.pdf'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(path.join(root, 'fake.jpg'), 'not-jpeg');
  fs.writeFileSync(path.join(root, 'active.svg'), '<svg><script>alert(1)</script></svg>');
  const workspace = await createProjectWorkspace(root);
  for (const file of ['fake.png', 'fake.pdf', 'fake.jpg']) {
    await expectCode('binary_signature_mismatch', () => workspace.loadArtifact(file, { allowBinary: true }));
  }
  await expectCode('unsupported_artifact', () => workspace.loadArtifact('active.svg', { allowBinary: true }));
}));

test('실제 central directory와 EOCD가 있는 OOXML ZIP도 parser가 없으므로 fail-closed 한다', () => withTempWorkspace(async ({ root }) => {
  const actualDocxZip = Buffer.from('UEsDBBQAAAAIALuJHl0rhCYSDAAAAAQAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLKp0LcDAAAA//8DAFBLAwQUAAAACAC7iR5dK4QmEgwAAAAEAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1ssqnQtwMAAAD//wMAUEsBAhQAFAAAAAgAu4keXSuEJhIMAAAABAAAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACAC7iR5dK4QmEgwAAAAEAAAAEQAAAAAAAAAAAAAAAAA9AAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAAeAAAAAAA', 'base64');
  fs.writeFileSync(path.join(root, 'valid-structure.docx'), actualDocxZip);
  fs.writeFileSync(path.join(root, 'prefix-only.docx'), Buffer.from('PK\x03\x04[Content_Types].xml word/document.xml'));
  const workspace = await createProjectWorkspace(root);
  await expectCode('unsupported_artifact', () => workspace.loadArtifact('valid-structure.docx', { allowBinary: true }));
  await expectCode('unsupported_artifact', () => workspace.loadArtifact('prefix-only.docx', { allowBinary: true }));
}));

test('streaming 열거는 unsupported/protected 항목도 scanned budget에 포함하고 즉시 중단한다', () => withTempWorkspace(async ({ root }) => {
  for (let index = 0; index < 20; index += 1) fs.writeFileSync(path.join(root, `ignored-${index}.exe`), 'x');
  const result = await (await createProjectWorkspace(root)).listArtifacts({ maxScannedEntries: 3 });
  assert.equal(result.scannedCount, 3);
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.skippedReasons, [{ code: 'scan_limit', count: 1 }]);
  assert.equal(result.excludedCount, 3);
  assert.deepEqual(result.exclusionReasons, [{ code: 'unsupported_type', count: 3 }]);
  const source = fs.readFileSync(path.join(__dirname, 'project-workspace.js'), 'utf8');
  assert.equal(source.includes('readdirSync'), false);
}));

test('100개 항목의 Windows reparse 검사는 동기 자식 프로세스 없이 이벤트 루프를 양보한다', () => withTempWorkspace(async ({ root }) => {
  for (let index = 0; index < 100; index += 1) {
    fs.writeFileSync(path.join(root, `artifact-${String(index).padStart(3, '0')}.txt`), 'ok');
  }
  let timerTicks = 0;
  const timer = setInterval(() => { timerTicks += 1; }, 1);
  const startedAt = process.hrtime.bigint();
  let result;
  try {
    const options = process.platform === 'win32' ? {} : {
      async nativeReparseProbe() {
        await new Promise((resolve) => setImmediate(resolve));
        return false;
      },
    };
    result = await (await createProjectWorkspace(root, options))
      .listArtifacts({ maxEntries: 100, maxScannedEntries: 100 });
  } finally {
    clearInterval(timer);
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  assert.equal(result.items.length, 100);
  assert.equal(result.incomplete, false);
  assert.ok(timerTicks > 0, `event loop did not advance during ${elapsedMs.toFixed(1)}ms scan`);
  const source = fs.readFileSync(path.join(__dirname, 'project-workspace.js'), 'utf8');
  assert.equal(source.includes(['spawn', 'Sync'].join('')), false);
  assert.match(source, /execFile\(canonicalWindowsSystemTool\(fileSystem\)/);
}));

test('maxEntries와 maxScannedEntries가 정확히 전체 개수이면 incomplete가 아니다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');
  const exactResults = await (await createProjectWorkspace(root)).listArtifacts({ maxEntries: 2, maxScannedEntries: 10 });
  assert.equal(exactResults.items.length, 2);
  assert.equal(exactResults.incomplete, false);
  assert.deepEqual(exactResults.skippedReasons, []);

  const secondRoot = path.join(path.dirname(root), 'scan-exact');
  fs.mkdirSync(secondRoot);
  fs.writeFileSync(path.join(secondRoot, 'a.exe'), 'a');
  fs.writeFileSync(path.join(secondRoot, 'b.exe'), 'b');
  const exactScan = await (await createProjectWorkspace(secondRoot)).listArtifacts({ maxScannedEntries: 2 });
  assert.equal(exactScan.scannedCount, 2);
  assert.equal(exactScan.incomplete, false);
  assert.deepEqual(exactScan.skippedReasons, []);
  assert.deepEqual(exactScan.exclusionReasons, [{ code: 'unsupported_type', count: 2 }]);
}));

test('반환 직전 root checkpoint 실패는 live descriptor 0도 닫고 원래 오류를 보존한다', () => withTempWorkspace(async ({ root }) => {
  const reportPath = path.join(root, 'report.txt');
  fs.writeFileSync(reportPath, 'report');
  let zeroRealDescriptor;
  let zeroClosed = false;
  let armed = false;
  const proxy = fileSystemProxy({
    openSync(target, flags) {
      const descriptor = fs.openSync(target, flags);
      if (armed && path.resolve(target) === path.resolve(reportPath)) {
        zeroRealDescriptor = descriptor;
        return 0;
      }
      return descriptor;
    },
    fstatSync(descriptor, options) {
      return fs.fstatSync(descriptor === 0 ? zeroRealDescriptor : descriptor, options);
    },
    readSync(descriptor, ...args) {
      return fs.readSync(descriptor === 0 ? zeroRealDescriptor : descriptor, ...args);
    },
    closeSync(descriptor) {
      if (descriptor === 0) {
        fs.closeSync(zeroRealDescriptor);
        zeroClosed = true;
        return;
      }
      fs.closeSync(descriptor);
    },
  });
  const workspace = await createProjectWorkspace(root, {
    fileSystem: proxy,
    checkpoint(stage) {
      if (armed && stage === 'load:target:component-0:after-open-root-check') {
        throw new ProjectWorkspaceError('root_changed', 'tampered');
      }
    },
  });
  armed = true;
  await expectCode('root_changed', () => workspace.loadArtifact('report.txt'));
  assert.equal(zeroClosed, true);
}));

test('같은 inode의 읽기 중 mutation은 artifact_changed이며 AAABBB 혼합 결과를 반환하지 않는다', () => withTempWorkspace(async ({ root }) => {
  const reportPath = path.join(root, 'report.txt');
  fs.writeFileSync(reportPath, 'AAAAAA');
  const descriptors = new Map();
  const chunks = [];
  let mutated = false;
  const proxy = fileSystemProxy({
    openSync(target, flags) {
      const descriptor = fs.openSync(target, flags);
      descriptors.set(descriptor, target);
      return descriptor;
    },
    closeSync(descriptor) {
      descriptors.delete(descriptor);
      fs.closeSync(descriptor);
    },
    readSync(descriptor, buffer, offset, length, position) {
      const target = descriptors.get(descriptor);
      const boundedLength = target && path.resolve(target) === path.resolve(reportPath) ? Math.min(length, 3) : length;
      const bytesRead = fs.readSync(descriptor, buffer, offset, boundedLength, position);
      if (target && path.resolve(target) === path.resolve(reportPath) && bytesRead) {
        chunks.push(buffer.subarray(offset, offset + bytesRead).toString('utf8'));
      }
      return bytesRead;
    },
  });
  const workspace = await createProjectWorkspace(root, {
    fileSystem: proxy,
    checkpoint(stage) {
      if (!mutated && stage === 'load:after-read' && chunks.length === 1) {
        mutated = true;
        fs.writeFileSync(reportPath, 'BBBBBB');
      }
    },
  });
  await expectCode('artifact_changed', () => workspace.loadArtifact('report.txt'));
  assert.equal(mutated, true);
  assert.equal(chunks.join(''), 'AAABBB');
}));

test('root opendir/read 오류는 안전한 명시 오류로 실패한다', () => withTempWorkspace(async ({ root }) => {
  const openFailureFs = fileSystemProxy({ opendirSync() { throw new Error('denied'); } });
  await expectCode('root_enumeration_failed', async () => (await createProjectWorkspace(root, { fileSystem: openFailureFs })).listArtifacts());

  const readFailureFs = fileSystemProxy({
    opendirSync(target) {
      const directory = fs.opendirSync(target);
      return { readSync() { throw new Error('read failed'); }, closeSync() { directory.closeSync(); } };
    },
  });
  await expectCode('root_enumeration_failed', async () => (await createProjectWorkspace(root, { fileSystem: readFailureFs })).listArtifacts());
}));

test('하위 I/O 누락은 incomplete/skipped reason으로 드러나며 policy exclusion과 구분된다', () => withTempWorkspace(async ({ root }) => {
  fs.mkdirSync(path.join(root, 'blocked'));
  fs.writeFileSync(path.join(root, 'ignored.exe'), 'x');
  const proxy = fileSystemProxy({
    opendirSync(target) {
      if (path.basename(target) === 'blocked') throw new Error('denied');
      return fs.opendirSync(target);
    },
  });
  const result = await (await createProjectWorkspace(root, { fileSystem: proxy })).listArtifacts();
  assert.equal(result.incomplete, true);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.skippedReasons, [{ code: 'directory_unreadable', count: 1 }]);
  assert.equal(result.excludedCount, 1);
  assert.deepEqual(result.exclusionReasons, [{ code: 'unsupported_type', count: 1 }]);
}));

test('close failure는 단독 오류로 보고하고 prior 오류가 있으면 원본과 cleanup evidence를 보존한다', () => withTempWorkspace(async ({ root }) => {
  fs.writeFileSync(path.join(root, 'report.txt'), 'ok');
  fs.writeFileSync(path.join(root, 'bad.txt'), Buffer.from([0x61, 0x00]));
  const descriptors = new Map();
  let armed = false;
  const proxy = fileSystemProxy({
    openSync(target, flags) {
      const descriptor = fs.openSync(target, flags);
      descriptors.set(descriptor, target);
      return descriptor;
    },
    closeSync(descriptor) {
      const target = descriptors.get(descriptor);
      descriptors.delete(descriptor);
      fs.closeSync(descriptor);
      if (armed && target && ['report.txt', 'bad.txt'].includes(path.basename(target))) throw new Error('close failed');
    },
  });
  const workspace = await createProjectWorkspace(root, { fileSystem: proxy });
  armed = true;
  await expectCode('handle_close_failed', () => workspace.loadArtifact('report.txt'));
  await assert.rejects(() => workspace.loadArtifact('bad.txt'), (error) => {
    assert.equal(error.code, 'non_text_content');
    assert.deepEqual(error.cleanupError, { code: 'handle_close_failed' });
    return true;
  });
}));

test('directory close failure는 단독 오류 및 prior read 오류 cleanup evidence를 구분한다', () => withTempWorkspace(async ({ root }) => {
  function wrappedFs(readFails) {
    return fileSystemProxy({
      opendirSync(target) {
        const directory = fs.opendirSync(target);
        return {
          readSync() { if (readFails) throw new Error('read failed'); return directory.readSync(); },
          closeSync() { directory.closeSync(); throw new Error('close failed'); },
        };
      },
    });
  }
  await expectCode('directory_close_failed', async () => (await createProjectWorkspace(root, { fileSystem: wrappedFs(false) })).listArtifacts());
  await assert.rejects(async () => (await createProjectWorkspace(root, { fileSystem: wrappedFs(true) })).listArtifacts(), (error) => {
    assert.equal(error.code, 'root_enumeration_failed');
    assert.deepEqual(error.cleanupError, { code: 'directory_close_failed' });
    return true;
  });
}));

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { TextDecoder } = require('node:util');

const DEFAULT_MAX_DEPTH = 5;
const MAX_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_MAX_ENTRIES = 2_000;
const DEFAULT_MAX_SCANNED_ENTRIES = 1_000;
const MAX_MAX_SCANNED_ENTRIES = 5_000;
const DEFAULT_MAX_TEXT_BYTES = 1_000_000;
const MAX_MAX_TEXT_BYTES = 5_000_000;
const DEFAULT_MAX_BINARY_BYTES = 2_000_000;
const MAX_MAX_BINARY_BYTES = 10_000_000;
const MAX_RELATIVE_PATH_BYTES = 1_024;
const MAX_CONCURRENT_NATIVE_REPARSE_PROBES = 4;
const MAX_REPARSE_CACHE_ENTRIES = 1_024;
const WINDOWS_KERNEL_SYSTEM_ROOT = '\\\\?\\GLOBALROOT\\SystemRoot';

const TEXT_TYPES = new Map([
  ['.c', 'text/x-c'], ['.cc', 'text/x-c++'], ['.cpp', 'text/x-c++'],
  ['.css', 'text/css'], ['.csv', 'text/csv'], ['.go', 'text/x-go'],
  ['.h', 'text/x-c'], ['.hpp', 'text/x-c++'], ['.html', 'text/html'],
  ['.ini', 'text/plain'], ['.java', 'text/x-java-source'], ['.js', 'text/javascript'],
  ['.json', 'application/json'], ['.jsonl', 'application/x-ndjson'], ['.jsx', 'text/jsx'],
  ['.kt', 'text/x-kotlin'], ['.log', 'text/plain'], ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'], ['.mjs', 'text/javascript'], ['.ps1', 'text/plain'],
  ['.py', 'text/x-python'], ['.rb', 'text/x-ruby'], ['.rs', 'text/x-rust'],
  ['.sh', 'text/x-shellscript'], ['.sql', 'application/sql'], ['.toml', 'application/toml'],
  ['.ts', 'text/typescript'], ['.tsx', 'text/tsx'], ['.tsv', 'text/tab-separated-values'],
  ['.txt', 'text/plain'], ['.xml', 'application/xml'], ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
]);

const BINARY_TYPES = new Map([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'], ['.ico', 'image/x-icon'], ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'], ['.pdf', 'application/pdf'], ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const WORKSPACE_SECURITY_CONTRACT = Object.freeze({
  rootToSpawnAtomic: false,
  fileReadUsesExclusiveWindowsLock: false,
  fileReadVerification: 'open-handle-pre-post-identity-size-time-and-final-path',
  ooxmlLoading: 'fail-closed',
});

const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SENSITIVE_NAME = /(?:^|[-_.])(secret|secrets|credential|credentials|token|tokens|password|passwd|private[-_.]?key|api[-_.]?key|auth)(?:[-_.]|$)/i;

class ProjectWorkspaceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ProjectWorkspaceError';
    this.code = code;
    if (options.cleanupError) this.cleanupError = Object.freeze({ code: options.cleanupError });
  }
}

function fail(code, message) {
  throw new ProjectWorkspaceError(code, message);
}

function asWorkspaceError(error, code, message) {
  return error instanceof ProjectWorkspaceError ? error : new ProjectWorkspaceError(code, message);
}

function addCleanupEvidence(error, code) {
  if (!error.cleanupError) error.cleanupError = Object.freeze({ code });
  return error;
}

function isNamespaceOrUnc(value) {
  return /^(?:\\\\[?.]\\|\\\\|\/\/)/.test(value);
}

function validateLimit(value, fallback, maximum, code) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail(code, '프로젝트 파일 제한값이 허용 범위를 벗어났습니다.');
  }
  return resolved;
}

function isSensitiveSegment(segment) {
  const lower = segment.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.')
    || lower === 'id_rsa' || lower === 'id_dsa' || lower === 'id_ecdsa' || lower === 'id_ed25519'
    || SENSITIVE_NAME.test(segment);
}

function validateRelativePath(relativePath, { allowEmpty = false } = {}) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    fail('invalid_relative_path', '프로젝트 내부 상대 경로가 올바르지 않습니다.');
  }
  if (Buffer.byteLength(relativePath, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    fail('invalid_relative_path', '프로젝트 내부 상대 경로가 너무 깁니다.');
  }
  if (relativePath === '' && allowEmpty) return [];
  if (!relativePath || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
      || path.posix.isAbsolute(relativePath) || isNamespaceOrUnc(relativePath)
      || /^[a-z]:/i.test(relativePath) || relativePath.includes('\\')) {
    fail('invalid_relative_path', '슬래시로 구분한 프로젝트 내부 상대 경로만 사용할 수 있습니다.');
  }
  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.includes(':')
        || /[\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment)
        || RESERVED_WINDOWS_NAME.test(segment) || segment.length > 255) {
      fail('invalid_relative_path', '프로젝트 내부 상대 경로가 안전하지 않습니다.');
    }
    if (segment.startsWith('.') || isSensitiveSegment(segment)) {
      fail('protected_artifact', '보호된 프로젝트 파일은 열 수 없습니다.');
    }
  }
  return segments;
}

function publicRelativePath(segments) { return segments.join('/'); }

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function bigintValue(value) {
  try { return BigInt(value); } catch { return 0n; }
}

function requireSingleLink(stat, code) {
  if (bigintValue(stat && stat.nlink) !== 1n) {
    fail(code, '하드링크 또는 다중 링크 파일은 프로젝트에서 사용할 수 없습니다.');
  }
}

function identityFromHandleStat(stat, code) {
  const device = bigintValue(stat && stat.dev);
  const fileId = bigintValue(stat && stat.ino);
  if (device <= 0n || fileId <= 0n) fail(code, '안전한 파일 식별자를 확인할 수 없습니다.');
  return Object.freeze({ device: device.toString(), fileId: fileId.toString() });
}

function fileSnapshot(stat, code = 'identity_unavailable') {
  return Object.freeze({
    identity: identityFromHandleStat(stat, code),
    size: bigintValue(stat && stat.size).toString(),
    mtimeNs: bigintValue(stat && stat.mtimeNs).toString(),
    ctimeNs: bigintValue(stat && stat.ctimeNs).toString(),
  });
}

function sameFileSnapshot(left, right) {
  return Boolean(left && right && sameIdentity(left.identity, right.identity)
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs);
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.device === right.device && left.fileId === right.fileId);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function canonicalWindowsSystemTool(fileSystem = fs) {
  let trustedRoot;
  try { trustedRoot = fileSystem.realpathSync.native(WINDOWS_KERNEL_SYSTEM_ROOT); }
  catch { fail('reparse_inspection_unavailable', 'Windows 시스템 디렉터리를 운영체제 경계에서 확인할 수 없습니다.'); }
  for (const environmentName of ['SystemRoot', 'windir']) {
    const environmentPath = process.env[environmentName];
    if (!environmentPath) continue;
    let canonicalEnvironmentPath;
    try { canonicalEnvironmentPath = fileSystem.realpathSync.native(environmentPath); }
    catch { fail('reparse_inspection_unavailable', 'Windows 시스템 디렉터리 환경값을 확인할 수 없습니다.'); }
    if (!samePath(canonicalEnvironmentPath, trustedRoot)) {
      fail('reparse_inspection_unavailable', 'Windows 시스템 디렉터리 환경값이 운영체제 경계와 일치하지 않습니다.');
    }
  }
  const system32 = path.join(trustedRoot, 'System32');
  const executable = path.join(system32, 'fsutil.exe');
  for (const component of [trustedRoot, system32, executable]) {
    try {
      const linkStat = fileSystem.lstatSync(component, { bigint: true });
      const canonicalComponent = fileSystem.realpathSync.native(component);
      if (linkStat.isSymbolicLink() || !samePath(component, canonicalComponent)) {
        fail('reparse_inspection_unavailable', 'Windows 시스템 도구 경로에 재파스 구성요소가 있습니다.');
      }
    } catch (error) {
      if (error instanceof ProjectWorkspaceError) throw error;
      fail('reparse_inspection_unavailable', 'Windows 시스템 도구 경로를 확인할 수 없습니다.');
    }
  }
  const canonicalExecutable = fileSystem.realpathSync.native(executable);
  if (!isContained(system32, canonicalExecutable) || path.basename(canonicalExecutable).toLowerCase() !== 'fsutil.exe') {
    fail('reparse_inspection_unavailable', 'Windows 시스템 도구 경로가 안전한 범위를 벗어났습니다.');
  }
  return canonicalExecutable;
}

function defaultNativeReparseProbe({ absolutePath, fileSystem = fs }) {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve, reject) => {
    execFile(canonicalWindowsSystemTool(fileSystem), ['reparsepoint', 'query', absolutePath], {
      windowsHide: true,
      timeout: 2_000,
      maxBuffer: 4_096,
      encoding: 'buffer',
    }, (error, stdout, stderr) => {
      if (!error) { resolve(true); return; }
      const output = Buffer.concat([
        Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
        Buffer.isBuffer(stderr) ? stderr : Buffer.alloc(0),
      ]);
      if (error.code === 1 && output.includes(Buffer.from('4390', 'ascii'))) { resolve(false); return; }
      reject(new ProjectWorkspaceError('reparse_inspection_unavailable',
        'Windows 재파스 지점 검사 결과를 확인할 수 없습니다.'));
    });
  });
}

function createAsyncSemaphore(limit) {
  let active = 0;
  const waiting = [];
  function advance() {
    if (active >= limit || waiting.length === 0) return;
    const { task, resolve, reject } = waiting.shift();
    active += 1;
    Promise.resolve().then(task).then(resolve, reject).finally(() => {
      active -= 1;
      advance();
    });
  }
  return function run(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      advance();
    });
  };
}

const runNativeReparseProbeGlobally = createAsyncSemaphore(MAX_CONCURRENT_NATIVE_REPARSE_PROBES);

function closeDescriptor(fileSystem, descriptor, priorError, code) {
  if (descriptor === undefined) return priorError;
  try {
    fileSystem.closeSync(descriptor);
    return priorError;
  } catch {
    if (priorError) return addCleanupEvidence(priorError, code);
    return new ProjectWorkspaceError(code, '프로젝트 파일 핸들을 안전하게 닫지 못했습니다.');
  }
}

function closeDirectory(directory, priorError) {
  if (!directory) return priorError;
  try {
    directory.closeSync();
    return priorError;
  } catch {
    if (priorError) return addCleanupEvidence(priorError, 'directory_close_failed');
    return new ProjectWorkspaceError('directory_close_failed', '프로젝트 폴더 열거 핸들을 안전하게 닫지 못했습니다.');
  }
}

function createInspector(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const checkpoint = typeof options.checkpoint === 'function' ? options.checkpoint : () => {};
  const callerReparseInspector = typeof options.reparseInspector === 'function'
    ? options.reparseInspector : null;
  const nativeReparseProbe = typeof options.nativeReparseProbe === 'function'
    ? options.nativeReparseProbe : defaultNativeReparseProbe;
  const reparseCache = new Map();
  function runCheckpoint(stage) { checkpoint(stage); }

  function reparseFingerprint(linkStat) {
    return [bigintValue(linkStat.ino), bigintValue(linkStat.ctimeNs), bigintValue(linkStat.nlink)].join('|');
  }

  function reparsePathKey(canonicalPath) {
    const resolved = path.resolve(canonicalPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  function rememberReparseProbe(pathKey, fingerprint, task) {
    const cached = reparseCache.get(pathKey);
    if (cached && cached.fingerprint === fingerprint) {
      reparseCache.delete(pathKey);
      reparseCache.set(pathKey, cached);
      return cached.promise;
    }
    const entry = { fingerprint, settled: false };
    entry.promise = runNativeReparseProbeGlobally(task).finally(() => { entry.settled = true; });
    reparseCache.delete(pathKey);
    reparseCache.set(pathKey, entry);
    while (reparseCache.size > MAX_REPARSE_CACHE_ENTRIES) {
      const oldest = reparseCache.entries().next().value;
      if (!oldest) break;
      const [oldestKey] = oldest;
      reparseCache.delete(oldestKey);
    }
    return entry.promise;
  }

  async function inspectReparse(absolutePath, canonicalPath, linkStat) {
    if (linkStat.isSymbolicLink() || !samePath(absolutePath, canonicalPath)) {
      fail('reparse_point', '심볼릭 링크, 정션 또는 재파스 지점은 사용할 수 없습니다.');
    }
    const probeInput = Object.freeze({ absolutePath, canonicalPath, linkStat, fileSystem });
    let nativeVerdict;
    try {
      nativeVerdict = await rememberReparseProbe(reparsePathKey(canonicalPath), reparseFingerprint(linkStat),
        () => nativeReparseProbe(probeInput));
    } catch (error) {
      if (error instanceof ProjectWorkspaceError) throw error;
      fail('reparse_inspection_unavailable', '재파스 지점 안전성을 확인할 수 없습니다.');
    }
    if (typeof nativeVerdict !== 'boolean') {
      fail('reparse_inspection_unavailable', '재파스 지점 검사가 명확한 판정을 반환하지 않았습니다.');
    }
    let callerVerdict = false;
    if (callerReparseInspector) {
      try { callerVerdict = await callerReparseInspector(Object.freeze({ absolutePath, canonicalPath, linkStat })); }
      catch { fail('reparse_inspection_failed', '재파스 지점 안전성을 확인할 수 없습니다.'); }
      if (typeof callerVerdict !== 'boolean') {
        fail('reparse_inspection_failed', '재파스 지점 검증기가 명확한 판정을 반환하지 않았습니다.');
      }
    }
    if (nativeVerdict || callerVerdict) {
      fail('reparse_point', '심볼릭 링크, 정션 또는 재파스 지점은 사용할 수 없습니다.');
    }
  }

  async function inspectPath(absolutePath, expectedKind, stage) {
    let descriptor;
    let primaryError;
    let result;
    try {
      runCheckpoint(`${stage}:before-lstat`);
      const linkStat = fileSystem.lstatSync(absolutePath, { bigint: true });
      requireSingleLink(linkStat, 'multiple_links');
      if (bigintValue(linkStat.ino) <= 0n) fail('identity_unavailable', '안전한 파일 식별자를 확인할 수 없습니다.');
      const canonicalPath = fileSystem.realpathSync.native(absolutePath);
      await inspectReparse(absolutePath, canonicalPath, linkStat);
      runCheckpoint(`${stage}:after-lstat`);
      descriptor = fileSystem.openSync(absolutePath, 'r');
      const handleStat = fileSystem.fstatSync(descriptor, { bigint: true });
      requireSingleLink(handleStat, 'multiple_links');
      const identity = identityFromHandleStat(handleStat, 'identity_unavailable');
      if (bigintValue(linkStat.ino).toString() !== identity.fileId) {
        fail('path_changed', '프로젝트 경로가 확인 중 변경되었습니다. 다시 시도해 주세요.');
      }
      if (expectedKind === 'directory' && !handleStat.isDirectory()) fail('not_directory', '프로젝트 폴더가 필요합니다.');
      if (expectedKind === 'file' && !handleStat.isFile()) fail('not_file', '프로젝트 파일이 필요합니다.');
      runCheckpoint(`${stage}:after-open`);
      const finalLinkStat = fileSystem.lstatSync(absolutePath, { bigint: true });
      requireSingleLink(finalLinkStat, 'multiple_links');
      const finalCanonical = fileSystem.realpathSync.native(absolutePath);
      await inspectReparse(absolutePath, finalCanonical, finalLinkStat);
      if (bigintValue(finalLinkStat.ino).toString() !== identity.fileId || !samePath(canonicalPath, finalCanonical)) {
        fail('path_changed', '프로젝트 경로가 확인 중 변경되었습니다. 다시 시도해 주세요.');
      }
      result = { descriptor, canonicalPath: finalCanonical, identity, stat: handleStat };
      descriptor = undefined;
    } catch (error) {
      primaryError = asWorkspaceError(error, 'path_unavailable', '프로젝트 경로를 확인할 수 없습니다.');
    }
    primaryError = closeDescriptor(fileSystem, descriptor, primaryError, 'handle_close_failed');
    if (primaryError) throw primaryError;
    return result;
  }

  return Object.freeze({ fileSystem, runCheckpoint, inspectPath, callerReparseInspector });
}

async function validateProjectRoot(rootPath, options = {}) {
  if (typeof rootPath !== 'string' || !rootPath || rootPath.includes('\0')) fail('invalid_root', '프로젝트 폴더가 올바르지 않습니다.');
  if (isNamespaceOrUnc(rootPath) || !path.isAbsolute(rootPath)) {
    fail('invalid_root', '로컬 절대 경로인 프로젝트 폴더만 사용할 수 있습니다.');
  }
  const inspector = options.inspector || createInspector(options);
  let inspected;
  try { inspected = await inspector.inspectPath(path.resolve(rootPath), 'directory', 'root'); }
  catch (error) { throw asWorkspaceError(error, 'root_unavailable', '프로젝트 폴더를 열 수 없습니다.'); }
  const closeError = closeDescriptor(inspector.fileSystem, inspected.descriptor, null, 'root_handle_close_failed');
  if (closeError) throw closeError;
  return Object.freeze({ canonicalPath: inspected.canonicalPath, identity: inspected.identity });
}

function artifactType(name) {
  const extension = path.extname(name).toLowerCase();
  if (TEXT_TYPES.has(extension)) return { extension, category: 'text', mimeType: TEXT_TYPES.get(extension) };
  if (BINARY_TYPES.has(extension)) return { extension, category: 'binary', mimeType: BINARY_TYPES.get(extension) };
  return null;
}

function hasPrefix(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function validateTextContent(buffer) {
  for (const byte of buffer) {
    if (byte === 0 || byte === 0x7f || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) {
      fail('non_text_content', '텍스트 확장자와 일치하지 않는 제어 바이트가 포함되어 있습니다.');
    }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { fail('invalid_text_encoding', 'UTF-8 텍스트 파일만 불러올 수 있습니다.'); }
}

function validateBinaryContent(buffer, extension) {
  let valid = false;
  if (extension === '.png') valid = hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (extension === '.jpg' || extension === '.jpeg') valid = hasPrefix(buffer, [0xff, 0xd8, 0xff]);
  else if (extension === '.pdf') valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  else if (extension === '.gif') valid = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  else if (extension === '.bmp') valid = buffer.subarray(0, 2).toString('ascii') === 'BM';
  else if (extension === '.ico') valid = hasPrefix(buffer, [0x00, 0x00, 0x01, 0x00]);
  else if (extension === '.webp') valid = buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!valid) fail('binary_signature_mismatch', '파일 내용이 확장자의 안전한 형식과 일치하지 않습니다.');
}

async function createProjectWorkspace(rootPath, options = {}) {
  const inspector = createInspector(options);
  const selectedRoot = await validateProjectRoot(rootPath, { inspector });

  async function inspectCurrentRoot(stage) {
    inspector.runCheckpoint(`${stage}:before-root-check`);
    let current;
    try { current = await inspector.inspectPath(selectedRoot.canonicalPath, 'directory', `${stage}:root`); }
    catch (error) {
      const changed = new ProjectWorkspaceError('root_changed', '프로젝트 폴더가 선택 이후 변경되었습니다. 다시 선택해 주세요.');
      if (error && error.cleanupError) changed.cleanupError = error.cleanupError;
      throw changed;
    }
    let primaryError;
    if (!samePath(current.canonicalPath, selectedRoot.canonicalPath) || !sameIdentity(current.identity, selectedRoot.identity)) {
      primaryError = new ProjectWorkspaceError('root_changed', '프로젝트 폴더가 선택 이후 변경되었습니다. 다시 선택해 주세요.');
    }
    primaryError = closeDescriptor(inspector.fileSystem, current.descriptor, primaryError, 'root_handle_close_failed');
    if (primaryError) throw primaryError;
    return selectedRoot.canonicalPath;
  }

  async function stableCheckpoint(stage) {
    inspector.runCheckpoint(stage);
    return inspectCurrentRoot(`${stage}:verify`);
  }

  async function getValidatedRoot() {
    await inspectCurrentRoot('execution-context:initial');
    await stableCheckpoint('execution-context:before-return');
    return Object.freeze({
      cwd: selectedRoot.canonicalPath,
      rootIdentity: Object.freeze({ ...selectedRoot.identity }),
      verificationBoundary: 'pre-spawn-only',
      atomicWithSpawn: false,
      childMustRevalidateIdentity: true,
    });
  }

  async function inspectRelative(relativePath, expectedKind, stage, { allowEmpty = false } = {}) {
    const segments = validateRelativePath(relativePath, { allowEmpty });
    let cursor = selectedRoot.canonicalPath;
    if (segments.length === 0) {
      const root = await inspector.inspectPath(cursor, expectedKind, stage);
      if (!sameIdentity(root.identity, selectedRoot.identity)) {
        throw closeDescriptor(inspector.fileSystem, root.descriptor,
          new ProjectWorkspaceError('root_changed', '프로젝트 폴더가 변경되었습니다.'), 'root_handle_close_failed');
      }
      return { ...root, segments: [] };
    }
    for (let index = 0; index < segments.length; index += 1) {
      await stableCheckpoint(`${stage}:component-${index}:before`);
      cursor = path.join(cursor, segments[index]);
      const kind = index === segments.length - 1 ? expectedKind : 'directory';
      let inspected;
      try { inspected = await inspector.inspectPath(cursor, kind, `${stage}:component-${index}`); }
      catch (error) { throw asWorkspaceError(error, 'artifact_not_found', '프로젝트 파일을 찾을 수 없습니다.'); }
      if (!isContained(selectedRoot.canonicalPath, inspected.canonicalPath)) {
        throw closeDescriptor(inspector.fileSystem, inspected.descriptor,
          new ProjectWorkspaceError('artifact_escape', '프로젝트 폴더 밖의 파일은 열 수 없습니다.'), 'handle_close_failed');
      }
      const canonicalRelative = path.relative(selectedRoot.canonicalPath, inspected.canonicalPath).split(path.sep).join('/');
      const canonicalSegments = validateRelativePath(canonicalRelative);
      if (index < segments.length - 1) {
        const closeError = closeDescriptor(inspector.fileSystem, inspected.descriptor, null, 'handle_close_failed');
        if (closeError) throw closeError;
      } else {
        try { await stableCheckpoint(`${stage}:component-${index}:after-open-root-check`); }
        catch (error) {
          throw closeDescriptor(inspector.fileSystem, inspected.descriptor,
            asWorkspaceError(error, 'root_changed', '프로젝트 폴더가 변경되었습니다.'), 'handle_close_failed');
        }
        return { ...inspected, segments: canonicalSegments };
      }
    }
    fail('artifact_not_found', '프로젝트 파일을 찾을 수 없습니다.');
  }

  async function listArtifacts({ relativeDir = '', maxDepth, maxEntries, maxScannedEntries } = {}) {
    const depthLimit = validateLimit(maxDepth, DEFAULT_MAX_DEPTH, MAX_MAX_DEPTH, 'invalid_max_depth');
    const entryLimit = validateLimit(maxEntries, DEFAULT_MAX_ENTRIES, MAX_MAX_ENTRIES, 'invalid_max_entries');
    const scanLimit = validateLimit(maxScannedEntries, DEFAULT_MAX_SCANNED_ENTRIES,
      MAX_MAX_SCANNED_ENTRIES, 'invalid_max_scanned_entries');
    await inspectCurrentRoot('list:initial');
    await stableCheckpoint('list:after-current-root');
    const start = await inspectRelative(relativeDir, 'directory', 'list:start', { allowEmpty: true });
    const startCloseError = closeDescriptor(inspector.fileSystem, start.descriptor, null, 'handle_close_failed');
    if (startCloseError) throw startCloseError;

    const items = [];
    const reasonCounts = new Map();
    const exclusionCounts = new Map();
    let scannedCount = 0;
    let skippedCount = 0;
    let excludedCount = 0;
    let incomplete = false;
    let stop = false;
    function countReason(map, code) { map.set(code, (map.get(code) || 0) + 1); }
    function skip(code) { skippedCount += 1; incomplete = true; countReason(reasonCounts, code); }
    function exclude(code) { excludedCount += 1; countReason(exclusionCounts, code); }
    function stopFor(code) { incomplete = true; stop = true; countReason(reasonCounts, code); }
    function addItem(item) {
      if (items.length >= entryLimit) { stopFor('result_limit'); return false; }
      items.push(Object.freeze(item));
      return true;
    }

    const pending = [{ absolutePath: start.canonicalPath, segments: start.segments, depth: 1, root: true }];
    while (pending.length && !stop) {
      const directoryInfo = pending.shift();
      await stableCheckpoint('list:before-opendir');
      let directory;
      let primaryError;
      try {
        directory = inspector.fileSystem.opendirSync(directoryInfo.absolutePath);
        await stableCheckpoint('list:after-opendir');
        while (!stop) {
          let entry;
          if (scannedCount === scanLimit) {
            try { entry = directory.readSync(); }
            catch (error) {
              if (directoryInfo.root) primaryError = asWorkspaceError(error, 'root_enumeration_failed', '프로젝트 폴더 목록을 읽을 수 없습니다.');
              else primaryError = asWorkspaceError(error, 'directory_unreadable', '프로젝트 하위 폴더 목록을 읽을 수 없습니다.');
              break;
            }
            if (entry) stopFor('scan_limit');
            break;
          }
          try { entry = directory.readSync(); }
          catch (error) {
            if (directoryInfo.root) primaryError = asWorkspaceError(error, 'root_enumeration_failed', '프로젝트 폴더 목록을 읽을 수 없습니다.');
            else primaryError = asWorkspaceError(error, 'directory_unreadable', '프로젝트 하위 폴더 목록을 읽을 수 없습니다.');
            break;
          }
          if (!entry) break;
          scannedCount += 1;
          let childSegments;
          try {
            childSegments = [...directoryInfo.segments, entry.name];
            validateRelativePath(publicRelativePath(childSegments));
          } catch (error) {
            exclude(error instanceof ProjectWorkspaceError && error.code === 'protected_artifact'
              ? 'protected_by_policy' : 'unsafe_name');
            continue;
          }
          const absoluteChild = path.join(directoryInfo.absolutePath, entry.name);
          let inspected;
          try { inspected = await inspector.inspectPath(absoluteChild, entry.isDirectory() ? 'directory' : 'file', 'list:entry'); }
          catch (error) {
            if (error instanceof ProjectWorkspaceError && ['multiple_links', 'reparse_point'].includes(error.code)) exclude('linked_or_reparse');
            else skip('entry_unreadable');
            continue;
          }
          let entryError;
          const canonicalRelative = path.relative(selectedRoot.canonicalPath, inspected.canonicalPath).split(path.sep).join('/');
          if (!isContained(selectedRoot.canonicalPath, inspected.canonicalPath)) exclude('outside_root');
          else if (inspected.stat.isDirectory()) {
            const added = addItem({ path: canonicalRelative, name: entry.name, kind: 'directory' });
            if (added && directoryInfo.depth < depthLimit) {
              pending.push({ absolutePath: inspected.canonicalPath,
                segments: validateRelativePath(canonicalRelative), depth: directoryInfo.depth + 1, root: false });
            } else if (added) exclude('depth_limit');
          } else if (inspected.stat.isFile()) {
            const type = artifactType(entry.name);
            if (!type) exclude('unsupported_type');
            else addItem({
              path: canonicalRelative,
              name: entry.name,
              kind: 'file',
              type: type.category,
              mimeType: type.mimeType,
              size: Number(inspected.stat.size),
              modifiedAt: new Date(Number(inspected.stat.mtimeMs)).toISOString(),
              loadable: type.category === 'text' && inspected.stat.size <= BigInt(DEFAULT_MAX_TEXT_BYTES),
            });
          } else exclude('unsupported_node');
          entryError = closeDescriptor(inspector.fileSystem, inspected.descriptor, entryError, 'handle_close_failed');
          if (entryError) { primaryError = entryError; break; }
        }
      } catch (error) {
        primaryError = asWorkspaceError(error,
          directoryInfo.root ? 'root_enumeration_failed' : 'directory_unreadable',
          '프로젝트 폴더 목록을 읽을 수 없습니다.');
      }
      primaryError = closeDirectory(directory, primaryError);
      if (primaryError) {
        if (directoryInfo.root || primaryError.code === 'directory_close_failed' || primaryError.code === 'handle_close_failed') throw primaryError;
        if (primaryError.cleanupError) countReason(reasonCounts, primaryError.cleanupError.code);
        skip('directory_unreadable');
      }
    }
    await stableCheckpoint('list:before-return');
    items.sort((left, right) => left.path.localeCompare(right.path));
    const toReasons = (map) => Object.freeze([...map.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => Object.freeze({ code, count })));
    return Object.freeze({
      items: Object.freeze(items), incomplete, truncated: incomplete, scannedCount, skippedCount, excludedCount,
      skippedReasons: toReasons(reasonCounts), exclusionReasons: toReasons(exclusionCounts),
      limits: Object.freeze({ maxDepth: depthLimit, maxEntries: entryLimit, maxScannedEntries: scanLimit }),
    });
  }

  async function loadArtifact(relativePath, { allowBinary = false, maxBytes } = {}) {
    await inspectCurrentRoot('load:initial');
    await stableCheckpoint('load:after-current-root');
    const opened = await inspectRelative(relativePath, 'file', 'load:target');
    let primaryError;
    let result;
    try {
      const name = opened.segments[opened.segments.length - 1];
      const type = artifactType(name);
      if (!type) fail('unsupported_artifact', '지원하지 않는 프로젝트 파일 형식입니다.');
      if (type.category === 'binary' && !allowBinary) fail('binary_not_allowed', '바이너리 파일은 명시적으로 허용해야 불러올 수 있습니다.');
      const maximum = type.category === 'text' ? MAX_MAX_TEXT_BYTES : MAX_MAX_BINARY_BYTES;
      const fallback = type.category === 'text' ? DEFAULT_MAX_TEXT_BYTES : DEFAULT_MAX_BINARY_BYTES;
      const byteLimit = validateLimit(maxBytes, fallback, maximum, 'invalid_max_bytes');
      if (opened.stat.size > BigInt(byteLimit)) fail('artifact_too_large', '프로젝트 파일이 불러오기 제한보다 큽니다.');
      const initialSnapshot = fileSnapshot(opened.stat);
      const preReadStat = inspector.fileSystem.fstatSync(opened.descriptor, { bigint: true });
      requireSingleLink(preReadStat, 'multiple_links');
      const preReadSnapshot = fileSnapshot(preReadStat);
      if (!sameFileSnapshot(initialSnapshot, preReadSnapshot)) {
        fail('artifact_changed', '프로젝트 파일이 읽기 전에 변경되었습니다. 다시 시도해 주세요.');
      }
      const buffer = Buffer.allocUnsafe(byteLimit + 1);
      let offset = 0;
      while (offset < buffer.length) {
        await stableCheckpoint('load:before-read');
        const bytesRead = inspector.fileSystem.readSync(opened.descriptor, buffer, offset, buffer.length - offset, null);
        await stableCheckpoint('load:after-read');
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > byteLimit) fail('artifact_too_large', '프로젝트 파일이 불러오기 제한보다 큽니다.');
      const postReadStat = inspector.fileSystem.fstatSync(opened.descriptor, { bigint: true });
      requireSingleLink(postReadStat, 'multiple_links');
      const postReadSnapshot = fileSnapshot(postReadStat);
      if (!sameFileSnapshot(preReadSnapshot, postReadSnapshot)
          || BigInt(offset) !== bigintValue(postReadStat.size)) {
        fail('artifact_changed', '프로젝트 파일이 읽는 동안 변경되었습니다. 다시 시도해 주세요.');
      }
      const contentBuffer = buffer.subarray(0, offset);
      let content;
      let encoding;
      if (type.category === 'text') { content = validateTextContent(contentBuffer); encoding = 'utf-8'; }
      else { validateBinaryContent(contentBuffer, type.extension); content = contentBuffer.toString('base64'); encoding = 'base64'; }
      const finalPath = await inspector.inspectPath(opened.canonicalPath, 'file', 'load:final-path');
      let finalPathError;
      if (!sameIdentity(finalPath.identity, opened.identity)
          || !sameFileSnapshot(postReadSnapshot, fileSnapshot(finalPath.stat))
          || !isContained(selectedRoot.canonicalPath, finalPath.canonicalPath)) {
        finalPathError = new ProjectWorkspaceError('artifact_changed', '프로젝트 파일이 읽는 동안 변경되었습니다. 다시 시도해 주세요.');
      }
      finalPathError = closeDescriptor(inspector.fileSystem, finalPath.descriptor, finalPathError, 'handle_close_failed');
      if (finalPathError) throw finalPathError;
      await stableCheckpoint('load:before-result');
      result = Object.freeze({
        path: publicRelativePath(opened.segments), name, kind: 'file', type: type.category,
        mimeType: type.mimeType, size: offset, modifiedAt: new Date(Number(opened.stat.mtimeMs)).toISOString(),
        encoding, content,
      });
    } catch (error) {
      primaryError = asWorkspaceError(error, 'artifact_unreadable', '프로젝트 파일을 읽을 수 없습니다.');
    }
    primaryError = closeDescriptor(inspector.fileSystem, opened.descriptor, primaryError, 'handle_close_failed');
    if (primaryError) throw primaryError;
    await stableCheckpoint('load:after-close');
    return result;
  }

  return Object.freeze({ getValidatedRoot, listArtifacts, loadArtifact });
}

module.exports = {
  ProjectWorkspaceError, validateProjectRoot, validateRelativePath, createProjectWorkspace,
  WORKSPACE_SECURITY_CONTRACT,
  DEFAULT_MAX_DEPTH, MAX_MAX_DEPTH, DEFAULT_MAX_ENTRIES, MAX_MAX_ENTRIES,
  DEFAULT_MAX_SCANNED_ENTRIES, MAX_MAX_SCANNED_ENTRIES,
  DEFAULT_MAX_TEXT_BYTES, MAX_MAX_TEXT_BYTES, DEFAULT_MAX_BINARY_BYTES, MAX_MAX_BINARY_BYTES,
};

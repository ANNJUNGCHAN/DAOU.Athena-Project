'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EPOCH_FILE_NAME = 'mcp-security-epoch.json';
const EPOCH_ENV = Object.freeze({
  path: 'ATHENA_MCP_SECURITY_EPOCH_PATH',
  token: 'ATHENA_MCP_GATEWAY_CAPABILITY_TOKEN',
  generation: 'ATHENA_MCP_SECURITY_GENERATION',
  revision: 'ATHENA_MCP_GATEWAY_EPOCH_REVISION',
});

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function writeJsonAtomic(filePath, value, fsImpl = fs) {
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(tempPath, 'wx', 0o600);
    fsImpl.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;
    fsImpl.renameSync(tempPath, filePath);
    try {
      const directoryDescriptor = fsImpl.openSync(directory, 'r');
      try { fsImpl.fsyncSync(directoryDescriptor); } finally { fsImpl.closeSync(directoryDescriptor); }
    } catch (_) {
      // Windows does not consistently permit opening directories for fsync. The
      // file itself is already durable and rename remains atomic on one volume.
    }
  } catch (error) {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
    try { fsImpl.unlinkSync(tempPath); } catch (_) { /* best effort */ }
    throw error;
  }
}

function createMcpSecurityEpochStore({ stateDir, fsImpl = fs, randomBytes = crypto.randomBytes } = {}) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir)) {
    throw new TypeError('stateDir must be an absolute path');
  }
  const epochPath = path.join(stateDir, EPOCH_FILE_NAME);
  let revision = 0;

  function publishDocument(securityGeneration, token) {
    revision += 1;
    const document = Object.freeze({
      version: 1,
      revision,
      securityGeneration: requirePositiveInteger(securityGeneration, 'securityGeneration'),
      tokenHash: tokenHash(token),
    });
    writeJsonAtomic(epochPath, document, fsImpl);
    return document;
  }

  function invalidate(securityGeneration) {
    const replacement = randomBytes(32).toString('base64url');
    const document = publishDocument(securityGeneration, replacement);
    return Object.freeze({
      securityGeneration: document.securityGeneration,
      epochRevision: document.revision,
      epochPath,
    });
  }

  function publishGeneration(securityGeneration) {
    let token = randomBytes(32).toString('base64url');
    const document = publishDocument(securityGeneration, token);
    const stamp = Object.freeze({
      securityGeneration: document.securityGeneration,
      epochRevision: document.revision,
      epochPath,
    });

    return Object.freeze({
      stamp,
      buildCapabilityEnv() {
        if (token === null) throw new Error('capability context has been disposed');
        return {
          [EPOCH_ENV.path]: epochPath,
          [EPOCH_ENV.token]: token,
          [EPOCH_ENV.generation]: String(document.securityGeneration),
          [EPOCH_ENV.revision]: String(document.revision),
        };
      },
      dispose() {
        token = null;
      },
    });
  }

  return Object.freeze({
    epochPath,
    invalidate,
    publishGeneration,
    snapshot() {
      return Object.freeze({ epochPath, revision });
    },
  });
}

module.exports = {
  EPOCH_ENV,
  EPOCH_FILE_NAME,
  createMcpSecurityEpochStore,
  tokenHash,
  writeJsonAtomic,
};

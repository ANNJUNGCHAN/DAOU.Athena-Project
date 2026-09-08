'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const SECRET_SENTINEL = '__ATHENA_SAFESTORAGE__';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeRevision(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeTools(tools) {
  return [...new Set((tools || []).map((tool) => String(tool)))].sort();
}

function sanitizeRegistryServers(servers) {
  return (servers || []).map((server) => {
    const env = server && server.env && typeof server.env === 'object' ? server.env : {};
    const envKeys = Object.keys(env).sort();
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    return {
      alias: String(server.alias),
      commandName: path.basename(String(server.command)),
      argumentCount: args.length,
      argumentsHash: canonicalHash(args),
      envKeys,
      secretEnvKeys: envKeys.filter((key) => env[key] === SECRET_SENTINEL),
    };
  }).sort((a, b) => a.alias.localeCompare(b.alias));
}

function sanitizeClaudeServers(servers) {
  const athena = servers && typeof servers === 'object' ? servers.athena : null;
  if (!athena || typeof athena !== 'object') return {};
  const env = athena.env && typeof athena.env === 'object' ? athena.env : {};
  const expectedArgs = ['-m', 'athena_mcp', 'serve'];
  if (athena.command !== PYTHON_EXE
    || !Array.isArray(athena.args)
    || canonicalJson(athena.args) !== canonicalJson(expectedArgs)
    || env.PYTHONPATH !== BACKEND_DIR) {
    throw new TypeError('Athena gateway config does not match the app-owned contract');
  }
  return {
    athena: {
      command: PYTHON_EXE,
      args: expectedArgs,
      env: { PYTHONPATH: BACKEND_DIR },
    },
  };
}

class McpRuntimeSnapshot {
  constructor(input = {}) {
    const registry = input.registry || {};
    const consent = input.consent || {};
    const claudeServers = sanitizeClaudeServers(input.claudeServers);
    const registryServers = sanitizeRegistryServers(registry.servers);
    const allowedTools = normalizeTools(input.allowedTools);
    const disallowedTools = normalizeTools(input.disallowedTools);
    const hashInput = {
      registryRevision: normalizeRevision(registry.revision ?? input.registryRevision ?? 0, 'registryRevision'),
      registryHash: String(registry.fingerprint ?? input.registryHash ?? ''),
      consentRevision: normalizeRevision(consent.revision ?? input.consentRevision ?? 0, 'consentRevision'),
      consentHash: String(consent.fingerprint ?? input.consentHash ?? ''),
      secretRevision: normalizeRevision(input.secretRevision ?? 0, 'secretRevision'),
      gatewayEpochRevision: normalizeRevision(input.gatewayEpochRevision ?? 0, 'gatewayEpochRevision'),
      claudeServers,
      registryServers,
      allowedTools,
      disallowedTools,
    };
    Object.assign(this, hashInput, {
      securityGeneration: normalizeRevision(input.securityGeneration ?? 0, 'securityGeneration'),
      codexConfigRevision: normalizeRevision(input.codexConfigRevision ?? 0, 'codexConfigRevision'),
      configHash: canonicalHash(hashInput),
    });
    deepFreeze(this);
  }
}

function createMcpRuntimeSnapshot(input) {
  return new McpRuntimeSnapshot(input);
}

function atomicWriteFileSync(targetPath, data) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, targetPath);
    try {
      const dirFd = fs.openSync(path.dirname(targetPath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Directory fsync is not supported by every Windows filesystem.
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort cleanup */ }
  }
}

function tomlInlineTable(obj) {
  const parts = Object.entries(obj).map(([key, value]) => `${key} = ${JSON.stringify(String(value))}`);
  return `{ ${parts.join(', ')} }`;
}

function writeGrokProjectMcpConfig(dir) {
  const grokDir = path.join(dir, '.grok');
  fs.mkdirSync(grokDir, { recursive: true });
  const grokConfigPath = path.join(grokDir, 'config.toml');
  const body = [
    '[mcp_servers.athena]',
    `command = ${JSON.stringify(PYTHON_EXE)}`,
    `args = ${JSON.stringify(['-m', 'athena_mcp', 'serve'])}`,
    `env = ${tomlInlineTable({
      PYTHONPATH: BACKEND_DIR,
      ATHENA_MCP_TOOL_NAME_STYLE: 'grok',
    })}`,
    'enabled = true',
    '',
  ].join('\n');
  atomicWriteFileSync(grokConfigPath, body);
  return grokConfigPath;
}

function ensureMcpConfig(userDataDir) {
  const dir = path.join(userDataDir, 'mcp-config');
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, '.mcp.json');
  const config = {
    mcpServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
    },
  };
  atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
  const grokConfigPath = writeGrokProjectMcpConfig(dir);
  const grokProfilePath = path.join(dir, 'athena-grok-agent.md');
  atomicWriteFileSync(grokProfilePath, [
    '---',
    'name: athena-chat',
    'description: Athena conversation and approved MCP tools',
    'tools: search_tool, use_tool',
    '---',
    '',
  ].join('\n'));
  return { dir, configFile: '.mcp.json', configPath, grokConfigPath, grokProfilePath };
}

module.exports = {
  ensureMcpConfig,
  createMcpRuntimeSnapshot,
  McpRuntimeSnapshot,
  canonicalHash,
  BACKEND_DIR,
  PYTHON_EXE,
  SECRET_SENTINEL,
};

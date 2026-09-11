'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const mcpEnv = require('./mcp-env');
const { resolveCodexExecutable } = require('./codex-bin');
const { resolveCodexRuntimeHome } = require('./codex-runtime-home');
const { terminateTree } = require('./proc-utils');

const DISABLED_FEATURES = Object.freeze([
  'apply_patch_freeform',
  'apps',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode_host',
  'collaboration_modes',
  'computer_use',
  'goals',
  'image_generation',
  'in_app_browser',
  'memories',
  'multi_agent',
  'multi_agent_v2',
  'plugins',
  'request_permissions_tool',
  'shell_tool',
  'skill_search',
  'tool_suggest',
  'view_image',
  'workspace_dependencies',
]);

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return [...value];
}

function normalizeAllowedTools(value) {
  const entries = typeof value === 'string'
    ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : stringArray(value, 'allowedTools');
  const gatewayAll = entries.includes('mcp__athena');
  const exact = [...new Set(entries.filter((tool) => tool.startsWith('mcp__athena__')))].sort();
  if (!gatewayAll && exact.length === 0) {
    throw new TypeError('allowedTools must authorize the Athena MCP gateway');
  }
  return { gatewayAll, exact, localTools: exact.map(localToolName) };
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function tomlTable(value) {
  return `{ ${Object.entries(value).map(([key, entry]) => `${tomlString(key)} = ${tomlString(entry)}`).join(', ')} }`;
}

function localToolName(tool) {
  const prefix = 'mcp__athena__';
  if (!tool.startsWith(prefix) || tool.length === prefix.length) {
    throw new TypeError(`allowedTools contains a non-Athena MCP tool: ${tool}`);
  }
  return tool.slice(prefix.length);
}

function buildCodexAppServerArgs({ gateway, allowedTools }) {
  if (!gateway || typeof gateway !== 'object' || Array.isArray(gateway)) {
    throw new TypeError('gateway must be an object');
  }
  const command = nonEmptyString(gateway.command, 'gateway.command');
  const args = stringArray(gateway.args, 'gateway.args');
  const env = gateway.env == null ? {} : gateway.env;
  if (!env || typeof env !== 'object' || Array.isArray(env)
    || Object.values(env).some((value) => typeof value !== 'string')) {
    throw new TypeError('gateway.env must be an object of strings');
  }
  const toolPolicy = normalizeAllowedTools(allowedTools);
  const athena = [
    `command = ${tomlString(command)}`,
    `args = ${tomlArray(args)}`,
    `env = ${tomlTable(env)}`,
    ...(toolPolicy.gatewayAll ? [] : [`enabled_tools = ${tomlArray(toolPolicy.localTools)}`]),
    'required = true',
  ].join(', ');
  const result = ['app-server', '--strict-config', '--listen', 'stdio://'];
  for (const feature of DISABLED_FEATURES) result.push('--disable', feature);
  result.push('-c', 'web_search="disabled"');
  // Replaces the complete MCP map for this process. A private-home config cannot
  // silently add another server to Athena conversations.
  result.push('-c', `mcp_servers={ athena = { ${athena} } }`);
  return result;
}

function createPrivateAuthRequiredError(runtimeHome) {
  return Object.assign(
    new Error('Athena 계정 설정에서 Codex 로그인을 완료해 주세요.'),
    {
      code: 'CODEX_PRIVATE_AUTH_REQUIRED',
      actionNeeded: true,
      retryable: false,
      runtimeHome,
    },
  );
}

function normalizeInventoryTool(name) {
  const value = String(name || '');
  if (value.startsWith('mcp__athena__')) return value.slice('mcp__athena__'.length);
  return value;
}

function inventoryToolNames(tools) {
  if (Array.isArray(tools)) return tools.map((tool) => tool?.name ?? tool);
  if (tools && typeof tools === 'object') return Object.keys(tools);
  return [];
}

function createMcpAudit(allowedTools, gateway = null) {
  const toolPolicy = normalizeAllowedTools(allowedTools);
  const requiredTools = Object.freeze(
    [...toolPolicy.localTools],
  );
  const requiredMcpServer = Object.freeze({ name: 'athena', requiredTools });
  return Object.freeze({
    requiredMcpServer,
    validate({ configAudit, servers } = {}) {
      const configured = configAudit?.config?.mcp_servers ?? configAudit?.config?.mcpServers;
      if (!configured || typeof configured !== 'object' || Array.isArray(configured)
        || Object.keys(configured).length !== 1 || !configured.athena) {
        const error = new Error('Codex effective config is not restricted to the Athena MCP gateway');
        error.code = 'CODEX_MCP_CONFIG_MISMATCH';
        throw error;
      }
      if (gateway) {
        const effective = configured.athena;
        const effectiveArgs = effective.args ?? [];
        const effectiveEnv = effective.env ?? {};
        const effectiveTools = effective.enabled_tools ?? effective.enabledTools;
        if (effective.command !== gateway.command
          || JSON.stringify(effectiveArgs) !== JSON.stringify(gateway.args)
          || JSON.stringify(effectiveEnv) !== JSON.stringify(gateway.env ?? {})
          || effective.required !== true
          || (toolPolicy.gatewayAll
            ? effectiveTools !== undefined && effectiveTools !== null
            : JSON.stringify([...(effectiveTools ?? [])].sort()) !== JSON.stringify(requiredTools))) {
          const error = new Error('Codex effective Athena MCP gateway command does not match the app-owned config');
          error.code = 'CODEX_MCP_CONFIG_MISMATCH';
          throw error;
        }
      }
      const config = configAudit.config;
      const features = config.features ?? {};
      if (config.web_search !== 'disabled' && config.webSearch !== 'disabled') {
        const error = new Error('Codex effective web search policy is not disabled');
        error.code = 'CODEX_BUILTIN_POLICY_MISMATCH';
        throw error;
      }
      for (const feature of DISABLED_FEATURES) {
        if (features[feature] === false) continue;
        const error = new Error(`Codex effective builtin feature is not disabled: ${feature}`);
        error.code = 'CODEX_BUILTIN_POLICY_MISMATCH';
        throw error;
      }
      if (!Array.isArray(servers) || servers.length !== 1 || servers[0]?.name !== 'athena') {
        const error = new Error('Codex effective MCP server inventory is not Athena-only');
        error.code = 'CODEX_MCP_INVENTORY_MISMATCH';
        throw error;
      }
      const actualTools = inventoryToolNames(servers[0].tools)
        .map(normalizeInventoryTool)
        .sort();
      if (toolPolicy.gatewayAll ? actualTools.length === 0 : JSON.stringify(actualTools) !== JSON.stringify(requiredTools)) {
        const error = new Error('Codex effective Athena MCP tool inventory does not match the approved tools');
        error.code = 'CODEX_MCP_TOOL_INVENTORY_MISMATCH';
        throw error;
      }
      return true;
    },
  });
}

function createCodexChatRuntime({
  userDataPath,
  cwd,
  gateway,
  allowedTools,
  envOverridesFn = () => mcpEnv.buildEnvOverrides(),
  securityKeyFn,
  identityKeyFn,
  fsImpl = fs,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  terminateTreeFn = terminateTree,
  env = process.env,
  platform = process.platform,
} = {}) {
  const runtimeHome = resolveCodexRuntimeHome(nonEmptyString(userDataPath, 'userDataPath'));
  const resolvedCwd = nonEmptyString(cwd, 'cwd');
  if (typeof envOverridesFn !== 'function') throw new TypeError('envOverridesFn must be a function');
  if (typeof securityKeyFn !== 'function') throw new TypeError('securityKeyFn must be a function');
  if (typeof identityKeyFn !== 'function') throw new TypeError('identityKeyFn must be a function');
  const codexExecutable = resolveCodexExecutable({
    env, platform, existsSync: fsImpl.existsSync.bind(fsImpl), spawnSyncImpl,
  });
  const appServerArgs = Object.freeze(buildCodexAppServerArgs({ gateway, allowedTools }));
  const mcpAudit = createMcpAudit(allowedTools, gateway);

  function generationContextFactory(input = {}) {
    let current = true;
    const identityKey = input.identityKey ?? identityKeyFn();
    const securityKey = input.securityKey ?? securityKeyFn();
    const runtimeGeneration = input.runtimeGeneration ?? 0;
    const processOwnerId = input.processOwnerId ?? `codex-chat-${runtimeGeneration}`;
    function assertCurrent() {
      if (!current || identityKeyFn() !== identityKey || securityKeyFn() !== securityKey) {
        throw Object.assign(new Error('stale Codex chat generation'), { code: 'CODEX_STALE_GENERATION' });
      }
    }
    return Object.freeze({
      runtimeGeneration,
      processOwnerId,
      spawnContext: Object.freeze({
        assertCurrent,
        buildEnv(provider) {
          assertCurrent();
          if (provider !== 'codex') throw new TypeError('Codex generation env requested for another provider');
          const overrides = envOverridesFn();
          if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
            throw new TypeError('envOverridesFn must return an object');
          }
          return { ...env, ...overrides, CODEX_HOME: runtimeHome };
        },
        registerChild(child, metadata = {}) {
          assertCurrent();
          if (!child || typeof child !== 'object') throw new TypeError('child is required');
          return Object.freeze({
            async terminate() {
              current = false;
              return terminateTreeFn(child, {
                expectedCreationTime: metadata.expectedCreationTime
                  ?? child.expectedCreationTime
                  ?? child.creationTime,
                readCreationTime: metadata.readCreationTime,
              });
            },
          });
        },
      }),
    });
  }

  const runtime = Object.freeze({
    spawnGenerationAppServer(generationContext) {
      if (!fsImpl.existsSync(path.join(runtimeHome, 'auth.json'))) {
        throw createPrivateAuthRequiredError(runtimeHome);
      }
      const spawnContext = generationContext?.spawnContext;
      if (!spawnContext || typeof spawnContext.assertCurrent !== 'function'
        || typeof spawnContext.buildEnv !== 'function'
        || typeof spawnContext.registerChild !== 'function') {
        throw new TypeError('generationContext.spawnContext is invalid');
      }
      spawnContext.assertCurrent();
      const child = spawnImpl(codexExecutable, [...appServerArgs], {
        cwd: resolvedCwd,
        env: spawnContext.buildEnv('codex'),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let terminationHandle;
      try {
        terminationHandle = spawnContext.registerChild(child, {
          provider: 'codex',
          runtimeGeneration: generationContext.runtimeGeneration,
          processOwnerId: generationContext.processOwnerId,
        });
      } catch (error) {
        // Registration is the ownership fence. If it rejects, start cleanup
        // immediately so an unowned app-server cannot survive the failed start.
        try { Promise.resolve(terminateTreeFn(child)).catch(() => {}); } catch { /* best effort */ }
        throw error;
      }
      return { child, terminationHandle };
    },
  });

  const sessionOptions = Object.freeze({
    cwd: resolvedCwd,
    runtime,
    generationContextFactory,
    mcpAudit,
    requiredMcpServer: mcpAudit.requiredMcpServer,
  });
  return Object.freeze({
    runtime,
    generationContextFactory,
    mcpAudit,
    sessionOptions,
    runtimeHome,
    codexExecutable,
    appServerArgs,
  });
}

module.exports = {
  DISABLED_FEATURES,
  buildCodexAppServerArgs,
  createCodexChatRuntime,
  createMcpAudit,
  createPrivateAuthRequiredError,
  resolveCodexExecutable,
};

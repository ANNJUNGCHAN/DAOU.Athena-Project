import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const FIXTURE_DIR = path.join(APP_DIR, 'test-fixtures', 'provider-contract');
const DEFAULT_FIXTURE = path.join(FIXTURE_DIR, 'claude-agent-sdk-0.3.251.json');
const DEFAULT_DELAYED_FIXTURE = path.join(FIXTURE_DIR, 'claude-delayed-transcript.json');
const DEFAULT_REPORT = path.join(FIXTURE_DIR, 'reports', 'claude.json');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertTypeContracts(dts) {
  const required = {
    startup: /export declare function startup\([\s\S]*?Promise<WarmQuery>;/,
    warmQuery: /export declare interface WarmQuery extends AsyncDisposable[\s\S]*?query\(prompt: string \| AsyncIterable<SDKUserMessage>\): Query;/,
    queryInterrupt: /export declare interface Query extends AsyncGenerator<SDKMessage, void>[\s\S]*?interrupt\(\): Promise<SDKControlInterruptResponse \| undefined>;/,
    queryClose: /export declare interface Query extends AsyncGenerator<SDKMessage, void>[\s\S]*?close\(\): void;/,
    resume: /resume\?: string;/,
    resumeCursor: /resumeSessionAt\?: string;/,
    spawn: /spawnClaudeCodeProcess\?: \(options: SpawnOptions\) => SpawnedProcess;/,
    effort: /effort\?: EffortLevel;/,
    fork: /upToMessageId\?: string;/,
    assistantUuid: /export declare type SDKAssistantMessage = \{[\s\S]*?uuid: UUID;/,
    preToolUse: /hook_event_name: 'PreToolUse';/,
  };
  const gates = Object.fromEntries(
    Object.entries(required).map(([name, pattern]) => [name, pattern.test(dts)]),
  );
  const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepEqual(failed, [], `Claude SDK type contracts missing: ${failed.join(', ')}`);
  return gates;
}

export function validateDelayedTranscriptFixture(fixture) {
  assert.equal(fixture.assertions.immediateReadFindsAssistant, false);
  assert.equal(fixture.assertions.boundedPollFindsAssistant, true);
  assert.equal(fixture.fork.upToMessageId, fixture.assistantUuid);
  assert.ok(fixture.reads.length >= 2);
  assert.equal(
    fixture.reads[0].messages.some((message) => message.uuid === fixture.assistantUuid),
    false,
  );
  assert.equal(
    fixture.reads.at(-1).messages.some((message) => message.uuid === fixture.assistantUuid),
    true,
  );
  assert.equal(
    fixture.reads.at(-1).messages.some((message) => message.uuid === fixture.failedTurnSentinelUuid),
    false,
  );
}

export async function probeClaudeContract({
  fixturePath = DEFAULT_FIXTURE,
  delayedFixturePath = DEFAULT_DELAYED_FIXTURE,
  packageRoot = path.join(APP_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
} = {}) {
  const fixture = readJson(fixturePath);
  const packageJson = readJson(path.join(packageRoot, 'package.json'));
  assert.equal(packageJson.name, fixture.package);
  assert.equal(packageJson.version, fixture.version);

  const fileGates = {};
  for (const [relative, expected] of Object.entries(fixture.files)) {
    const bytes = fs.readFileSync(path.join(packageRoot, relative));
    fileGates[relative] = bytes.length === expected.bytes && sha256(bytes) === expected.sha256;
  }
  const failedFiles = Object.entries(fileGates).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepEqual(failedFiles, [], `Claude SDK file drift: ${failedFiles.join(', ')}`);

  const sdk = await import(pathToFileURL(path.join(packageRoot, 'sdk.mjs')).href);
  const exportGates = Object.fromEntries(
    fixture.runtimeExports.map((name) => [name, typeof sdk[name] === 'function']),
  );
  const failedExports = Object.entries(exportGates).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepEqual(failedExports, [], `Claude SDK exports missing: ${failedExports.join(', ')}`);

  const typeGates = assertTypeContracts(fs.readFileSync(path.join(packageRoot, 'sdk.d.ts'), 'utf8'));
  validateDelayedTranscriptFixture(readJson(delayedFixturePath));

  return {
    schemaVersion: 1,
    provider: 'claude',
    version: fixture.version,
    sha256: fixture.files['sdk.mjs'].sha256,
    gates: {
      exactVersion: true,
      fileHashes: Object.values(fileGates).every(Boolean),
      runtimeExports: Object.values(exportGates).every(Boolean),
      warmQueryTypes: Object.values(typeGates).every(Boolean),
      delayedTranscriptFixture: true,
      generationScopedPreToolUse: typeGates.preToolUse,
    },
    liveQueryExecuted: false,
  };
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableJson(report), 'utf8');
}

async function main() {
  const reportArg = process.argv.indexOf('--report');
  const reportPath = reportArg >= 0 ? path.resolve(process.argv[reportArg + 1]) : DEFAULT_REPORT;
  const report = await probeClaudeContract();
  writeReport(reportPath, report);
  process.stdout.write(`${stableJson(report)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Claude SDK contract probe failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

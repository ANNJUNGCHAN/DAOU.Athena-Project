import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  probeClaudeContract,
  validateDelayedTranscriptFixture,
} from './check-claude-agent-sdk-contract.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(APP_DIR, 'test-fixtures', 'provider-contract');

test('pinned Claude SDK exposes the persistent-session contract without a live model query', async () => {
  const report = await probeClaudeContract();
  assert.equal(report.version, '0.3.251');
  assert.equal(report.liveQueryExecuted, false);
  assert.ok(Object.values(report.gates).every(Boolean));
});

test('delayed transcript fixture requires a bounded persistence barrier and excludes failed suffix', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'claude-delayed-transcript.json'), 'utf8'));
  validateDelayedTranscriptFixture(fixture);
});

test('delayed transcript fixture fails closed if the immediate read pretends to be durable', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'claude-delayed-transcript.json'), 'utf8'));
  fixture.assertions.immediateReadFindsAssistant = true;
  assert.throws(() => validateDelayedTranscriptFixture(fixture));
});

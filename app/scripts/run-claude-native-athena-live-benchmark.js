'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { summarize } = require('../lib/main/provider-runtime-metrics');
const { extractTextDelta, StreamJsonSession } = require('../lib/main/stream-json-parser');

const REQUIRED_CONFIGURATION = Object.freeze(['account', 'model', 'effort', 'cwd', 'mcpFingerprint', 'promptHash']);

function stableFingerprint(configuration) {
  const canonical = Object.fromEntries(REQUIRED_CONFIGURATION.map((key) => [key, configuration?.[key]]));
  for (const [key, value] of Object.entries(canonical)) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`configuration ${key} is required`);
  }
  if (!/^[0-9a-f]{64}$/i.test(canonical.mcpFingerprint) || !/^[0-9a-f]{64}$/i.test(canonical.promptHash)) {
    throw new Error('MCP and prompt fingerprints must be SHA-256');
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function parseLiveArgs(argv, env = process.env) {
  const parsed = { allowPaid: false, coldSamples: 5, warmSamples: 30, outputDirectory: null, configPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--allow-paid') parsed.allowPaid = true;
    else {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${name}`);
      if (name === '--config') parsed.configPath = path.resolve(value);
      else if (name === '--output-directory') parsed.outputDirectory = path.resolve(value);
      else throw new Error(`unknown option: ${name}`);
    }
  }
  parsed.allowPaid ||= env.ATHENA_ALLOW_PAID_PROVIDER_BENCHMARK === '1';
  if (!parsed.allowPaid) throw new Error('explicit paid opt-in is required');
  return parsed;
}

async function runLiveComparison({ allowPaid, coldSamples = 5, warmSamples = 30, configuration, runLane }) {
  if (!allowPaid) throw new Error('explicit paid opt-in is required');
  if (coldSamples !== 5 || warmSamples !== 30) throw new Error('live comparison requires cold5/warm30');
  if (typeof runLane !== 'function') throw new TypeError('runLane is required');
  const configurationFingerprint = stableFingerprint(configuration);
  const generatedAt = new Date();
  const scriptHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  const result = {
    schemaVersion: 1,
    scenario: 'claude-native-athena-abba',
    provider: 'claude',
    sourceClass: 'claude-live-paired',
    sourceRevision: process.env.ATHENA_SOURCE_REVISION || scriptHash,
    scriptHash,
    generatedAt: generatedAt.toISOString(),
    freshness: { status: 'fresh', expiresAt: new Date(generatedAt.getTime() + 15 * 60 * 1_000).toISOString() },
    configurationFingerprint,
  };
  let sequence = 0;
  for (const [temperature, count] of [['cold', coldSamples], ['warm', warmSamples]]) {
    const samples = { native: [], athena: [] };
    for (let index = 0; index < count; index += 1) {
      const order = index % 2 === 0 ? ['native', 'athena'] : ['athena', 'native'];
      for (const lane of order) {
        sequence += 1;
        const measured = await runLane({ lane, temperature, index, sequence, configurationFingerprint, configuration });
        if (!Number.isFinite(measured?.firstTextMs) || measured.firstTextMs < 0
          || measured.configurationFingerprint !== configurationFingerprint) {
          throw new Error('live lane returned invalid or mismatched evidence');
        }
        samples[lane].push({
          sequence,
          sample: index + 1,
          lane,
          temperature,
          configurationFingerprint,
          firstTextMs: measured.firstTextMs,
        });
      }
    }
    result[temperature] = Object.fromEntries(['native', 'athena'].map((lane) => [lane, {
      rawSamples: samples[lane],
      firstTextMs: summarize(samples[lane].map((sample) => sample.firstTextMs)),
    }]));
  }
  return result;
}

function summariesEqual(actual, expected) {
  return actual?.count === expected.count && actual?.p50 === expected.p50
    && actual?.p95 === expected.p95 && actual?.max === expected.max;
}

function validateLiveReport(report) {
  const errors = [];
  if (report?.schemaVersion !== 1 || report?.scenario !== 'claude-native-athena-abba'
    || report?.provider !== 'claude' || report?.sourceClass !== 'claude-live-paired') errors.push('live report identity is invalid');
  for (const field of ['sourceRevision', 'scriptHash', 'configurationFingerprint']) {
    const minimum = field === 'sourceRevision' ? 7 : 64;
    if (!new RegExp(`^[0-9a-f]{${minimum},64}$`, 'i').test(String(report?.[field] || ''))) errors.push(`${field} is invalid`);
  }
  const currentHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  if (report?.scriptHash !== currentHash) errors.push('scriptHash does not match the live runner source');
  if (report?.freshness?.status !== 'fresh' || Date.parse(report?.freshness?.expiresAt) <= Date.now()
    || !Number.isFinite(Date.parse(report?.generatedAt))) errors.push('live report is stale');
  let expectedSequence = 0;
  for (const [temperature, count] of [['cold', 5], ['warm', 30]]) {
    for (const lane of ['native', 'athena']) {
      const section = report?.[temperature]?.[lane];
      if (!Array.isArray(section?.rawSamples) || section.rawSamples.length !== count
        || !Number.isFinite(section?.firstTextMs?.p50) || !Number.isFinite(section?.firstTextMs?.p95)
        || !Number.isFinite(section?.firstTextMs?.max)) {
        errors.push(`${temperature}.${lane} samples are invalid`);
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        const sample = section.rawSamples[index];
        if (!sample || sample.sample !== index + 1 || sample.lane !== lane || sample.temperature !== temperature
          || !Number.isFinite(sample.firstTextMs) || sample.firstTextMs < 0) {
          errors.push(`${temperature}.${lane} raw sample is invalid`);
        }
        if (sample?.configurationFingerprint !== report.configurationFingerprint) {
          errors.push(`${temperature}.${lane} raw sample configuration fingerprint is invalid`);
        }
      }
      const expectedSummary = summarize(section.rawSamples.map((sample) => sample?.firstTextMs));
      if (!summariesEqual(section.firstTextMs, expectedSummary)) {
        errors.push(`${temperature}.${lane} summary does not match raw samples`);
      }
    }
    for (let index = 0; index < count; index += 1) {
      const order = index % 2 === 0 ? ['native', 'athena'] : ['athena', 'native'];
      for (const lane of order) {
        expectedSequence += 1;
        if (report?.[temperature]?.[lane]?.rawSamples?.[index]?.sequence !== expectedSequence) {
          errors.push(`${temperature} raw sample sequence is invalid`);
        }
      }
    }
  }
  return errors;
}

function createFirstModelTextParser(onFirstText) {
  const session = new StreamJsonSession();
  const callbacks = {
    onEvent(event) {
      const text = extractTextDelta(event);
      if (text && event.parent_tool_use_id == null) onFirstText();
    },
  };
  return {
    feed(chunk) { session.feed(chunk, callbacks); },
    end() { session.end(callbacks); },
  };
}

function createProcessLaneRunner({
  commands,
  promptText,
  spawnProcess = spawn,
  now = () => performance.now(),
  parserFactory = createFirstModelTextParser,
}) {
  return ({ lane, configurationFingerprint, configuration }) => new Promise((resolve, reject) => {
    const command = commands?.[lane];
    if (!command?.file || !Array.isArray(command.args)) return reject(new Error(`${lane} command is missing`));
    const startedAt = now();
    const child = spawnProcess(command.file, command.args, { cwd: configuration.cwd, env: { ...process.env, ...command.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ firstTextMs: now() - startedAt, configurationFingerprint });
      child.kill?.();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const parser = parserFactory(finish);
    child.once('error', fail);
    child.stdout.on('data', (chunk) => parser.feed(chunk));
    child.once('exit', (code) => {
      if (settled) return;
      parser.end();
      if (!settled) fail(new Error(`${lane} exited before first text (${code})`));
    });
    child.stdin.end(promptText);
  });
}

async function main() {
  const options = parseLiveArgs(process.argv.slice(2));
  if (!options.configPath) throw new Error('--config is required');
  const liveConfig = JSON.parse(fs.readFileSync(options.configPath, 'utf8'));
  const promptText = fs.readFileSync(path.resolve(liveConfig.promptFile), 'utf8');
  if (crypto.createHash('sha256').update(promptText).digest('hex') !== liveConfig.configuration.promptHash) {
    throw new Error('promptHash does not match prompt file');
  }
  const report = await runLiveComparison({ ...options, configuration: liveConfig.configuration,
    runLane: createProcessLaneRunner({ commands: liveConfig.commands, promptText }) });
  const errors = validateLiveReport(report);
  if (errors.length) throw new Error(errors.join('; '));
  const outputDirectory = options.outputDirectory || path.resolve(__dirname, '..', '..', 'artifacts', 'provider-session-benchmark');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `claude-live-paired-${Date.now()}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`report: ${outputPath}\n`);
}

if (require.main === module) void main().catch((error) => {
  process.stderr.write(`Claude live comparison failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  createFirstModelTextParser,
  createProcessLaneRunner,
  parseLiveArgs,
  runLiveComparison,
  stableFingerprint,
  validateLiveReport,
};

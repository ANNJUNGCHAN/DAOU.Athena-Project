#!/usr/bin/env node

import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCustomReadChain } from './custom-read-chain.mjs';
import { DEFAULT_BASE_URL, parseLocalBearer, REPO_ROOT, validateBaseUrl } from './observer.mjs';

const OPENAPI_TIMEOUT_MS = 5_000;
const MAX_OPENAPI_BYTES = 8 * 1024 * 1024;
const OUTPUT_DIR = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const SAFE_FAILURE_REASONS = new Set([
  'ARTIFACT_WRITE_FAILED',
  'AUTH_REJECTED',
  'AUTH_UNAVAILABLE',
  'OPENAPI_BODY_UNAVAILABLE',
  'OPENAPI_HTTP_STATUS',
  'OPENAPI_INVALID_JSON',
  'OPENAPI_NON_JSON_RESPONSE',
  'OPENAPI_RESPONSE_TOO_LARGE',
  'OPENAPI_RESPONSE_URL_CHANGED',
  'OPENAPI_TIMEOUT',
  'OPENAPI_TRANSPORT_ERROR',
]);

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function readWithAbort(reader, signal) {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function readBoundedJson(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) throw fixedError('OPENAPI_BODY_UNAVAILABLE');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OPENAPI_BYTES) throw fixedError('OPENAPI_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fixedError('OPENAPI_INVALID_JSON');
  }
}

async function loadBearer(repoRoot, readBearerFn) {
  let token;
  try {
    token = readBearerFn
      ? await readBearerFn()
      : parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8'));
  } catch {
    token = null;
  }
  if (!token) throw fixedError('AUTH_UNAVAILABLE');
  return token;
}

async function loadOpenApi({ baseUrl, bearer, fetchFn, timeoutMs }) {
  const url = new URL('/openapi.json', baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, 'X-Athena-Caller': 'market-session-audit' },
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (response.url && new URL(response.url).href !== url.href) throw fixedError('OPENAPI_RESPONSE_URL_CHANGED');
    if (!response.ok) throw fixedError(response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : 'OPENAPI_HTTP_STATUS');
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
    if (!(contentType === 'application/json' || contentType.endsWith('+json'))) throw fixedError('OPENAPI_NON_JSON_RESPONSE');
    return await readBoundedJson(response, controller.signal);
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') throw fixedError('OPENAPI_TIMEOUT');
    throw fixedError('OPENAPI_TRANSPORT_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

function outputName(date) {
  return `custom-read-chain-live-${date.toISOString().replace(/[-:]/g, '').replace('.', '-')}.json`;
}

async function reserveArtifact(outputDir, timestamp) {
  try {
    await mkdir(outputDir, { recursive: true });
    for (let suffix = 0; ; suffix += 1) {
      const date = suffix === 0 ? timestamp : new Date(timestamp.getTime() + suffix);
      const outputPath = path.join(outputDir, outputName(date));
      try {
        return { handle: await open(outputPath, 'wx'), outputPath };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
  } catch {
    throw fixedError('ARTIFACT_PREPARATION_FAILED');
  }
}

async function writeReserved(handle, value) {
  await handle.truncate(0);
  await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await handle.sync();
}

function failureMarker(reason, metadataRequestCount, businessRequestCount) {
  return {
    kind: 'custom_read_chain_live_failure',
    observed_at: new Date().toISOString(),
    reason: SAFE_FAILURE_REASONS.has(reason) ? reason : 'ENTRYPOINT_FAILED',
    metadata_request_count: metadataRequestCount,
    business_request_count: businessRequestCount,
    raw_response_persisted: false,
    bearer_persisted: false,
  };
}

export async function runCustomReadChainLive(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  if (options.execute !== true) throw fixedError('EXPLICIT_EXECUTE_REQUIRED');
  const timeoutMs = options.openApiTimeoutMs ?? OPENAPI_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > OPENAPI_TIMEOUT_MS) throw fixedError('INVALID_OPENAPI_TIMEOUT');
  const outputDir = path.resolve(options.outputDir || OUTPUT_DIR);
  const timestamp = options.timestamp instanceof Date ? options.timestamp : new Date();
  const { handle, outputPath } = await reserveArtifact(outputDir, timestamp);
  let metadataRequestCount = 0;
  let businessRequestCount = null;
  try {
    const bearer = await loadBearer(repoRoot, options.readBearerFn);
    const fetchFn = options.fetchFn || globalThis.fetch;
    metadataRequestCount = 1;
    const openapi = await loadOpenApi({ baseUrl, bearer, fetchFn, timeoutMs });
    const chain = await (options.runChainFn || runCustomReadChain)({
      execute: true,
      openapi,
      bearer,
      baseUrl,
      repoRoot,
      fetchFn,
      timeoutMs: 5_000,
      maxRequests: 32,
      maxDurationMs: 60_000,
    });
    businessRequestCount = chain.request_count;
    const artifact = {
      ...chain,
      entrypoint: {
        metadata_request_count: metadataRequestCount,
        business_request_count: businessRequestCount,
        openapi_endpoint: '/openapi.json',
        openapi_raw_persisted: false,
        bearer_persisted: false,
      },
    };
    try {
      if (options.writeArtifactFn) await options.writeArtifactFn(handle, artifact);
      else await writeReserved(handle, artifact);
      await handle.close();
    } catch {
      try {
        await writeReserved(handle, failureMarker('ARTIFACT_WRITE_FAILED', metadataRequestCount, businessRequestCount));
        await handle.close();
      } catch {
        await handle.close().catch(() => {});
      }
      const error = fixedError('ARTIFACT_WRITE_FAILED');
      error.outputPath = outputPath;
      throw error;
    }
    return { artifact, outputPath };
  } catch (error) {
    if (error?.code === 'ARTIFACT_WRITE_FAILED') throw error;
    try {
      await writeReserved(handle, failureMarker(error?.code, metadataRequestCount, businessRequestCount));
      await handle.close();
    } catch {
      await handle.close().catch(() => {});
    }
    error.outputPath = outputPath;
    throw error;
  }
}

async function main(argv) {
  if (argv.length !== 1 || argv[0] !== '--execute') throw fixedError('EXPLICIT_EXECUTE_REQUIRED');
  const { artifact, outputPath } = await runCustomReadChainLive({ execute: true });
  console.log(JSON.stringify({ output: outputPath, mode: artifact.mode, summary: artifact.summary, request_count: artifact.request_count, metadata_request_count: 1 }));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error?.code || 'ENTRYPOINT_FAILED' }));
    process.exitCode = 1;
  }
}

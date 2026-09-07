import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeOnce, REPO_ROOT } from './observer.mjs';

export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_DURATION_MS = 10 * 60 * 60 * 1_000;
export const CHECKPOINTS = Object.freeze(['08:30', '08:40', '09:00', '15:30', '15:40', '16:00', '16:30']);
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 15 * 60_000;
const MAX_WATCH_DURATION_MS = 24 * 60 * 60_000;

function finiteBounded(value, fallback, minimum, maximum, name) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isFinite(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return selected;
}

function kstDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function scheduledAt(localDate, time) {
  return new Date(`${localDate}T${time}:00+09:00`);
}

export function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function persist(state, outputPath) {
  await writeFile(outputPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function safeErrorClass(error) {
  const name = error && typeof error.name === 'string' ? error.name : '';
  return ['AbortError', 'Error', 'RangeError', 'SyntaxError', 'TypeError'].includes(name)
    ? name
    : 'UnknownError';
}

export async function runWatch(options = {}) {
  const nowFn = options.nowFn || (() => new Date());
  const observe = options.observe || observeOnce;
  const sleepFn = options.sleepFn || sleep;
  const persistFn = options.persistFn || persist;
  const signal = options.signal;
  const start = nowFn();
  const localDate = options.localDate || kstDate(start);
  const cutoff = options.cutoff || scheduledAt(localDate, '16:30');
  const maxDurationMs = finiteBounded(options.maxDurationMs, DEFAULT_MAX_DURATION_MS, 1_000, MAX_WATCH_DURATION_MS, 'maxDurationMs');
  const maxEnd = new Date(start.getTime() + maxDurationMs);
  const intervalMs = finiteBounded(options.intervalMs, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS, 'intervalMs');
  const checkpointToleranceMs = finiteBounded(
    options.checkpointToleranceMs, intervalMs, 0, MAX_INTERVAL_MS, 'checkpointToleranceMs',
  );
  const outputRoot = path.resolve(options.outputRoot || path.join(REPO_ROOT, 'artifacts', 'market-session-audit', localDate));
  await mkdir(outputRoot, { recursive: true });
  const stamp = start.toISOString().replace(/[-:]/g, '').replace('.', '-');
  const outputPath = path.join(outputRoot, `watch-${stamp}.json`);
  const state = {
    schema_version: 1,
    kind: 'athena_market_session_watch',
    local_date: localDate,
    interval_ms: intervalMs,
    checkpoint_tolerance_ms: checkpointToleranceMs,
    planned_cutoff: cutoff.toISOString(),
    max_end: maxEnd.toISOString(),
    started_at: start.toISOString(),
    finished_at: null,
    finish_reason: null,
    failures: {
      observation_count: 0,
      metadata_write_count: 0,
      last_observation: null,
    },
    observations: [],
    checkpoints: CHECKPOINTS.map((time) => {
      const scheduled = scheduledAt(localDate, time);
      return {
        scheduled_for: scheduled.toISOString(),
        status: scheduled < start ? 'MISSED_BEFORE_START' : 'PENDING',
        observed_at: null,
        catchup_at: null,
        observation_path: null,
        lateness_ms: null,
      };
    }),
  };
  try {
    try {
      await persistFn(state, outputPath);
      options.onStart?.({ outputPath, state });
    } catch {
      state.failures.metadata_write_count += 1;
      state.finish_reason = 'metadata_write_failed';
    }

    while (!state.finish_reason) {
      const tickStarted = nowFn();
      let result;
      try {
        result = await observe({ ...options.observeOptions, now: tickStarted, outputRoot });
      } catch (error) {
        state.failures.observation_count += 1;
        state.failures.last_observation = {
          occurred_at: nowFn().toISOString(),
          error_class: safeErrorClass(error),
        };
        state.finish_reason = 'observation_failed';
        break;
      }
      state.observations.push({ observed_at: result.artifact.observed_at, observation_path: result.outputPath });
      for (const checkpoint of state.checkpoints) {
        const scheduled = new Date(checkpoint.scheduled_for);
        if (checkpoint.status === 'MISSED_BEFORE_START' && !checkpoint.catchup_at) {
          checkpoint.catchup_at = result.artifact.observed_at;
          checkpoint.observation_path = result.outputPath;
          checkpoint.lateness_ms = Math.max(0, tickStarted.getTime() - scheduled.getTime());
        } else if (checkpoint.status === 'PENDING' && tickStarted >= scheduled) {
          checkpoint.observed_at = result.artifact.observed_at;
          checkpoint.observation_path = result.outputPath;
          checkpoint.lateness_ms = Math.max(0, tickStarted.getTime() - scheduled.getTime());
          checkpoint.status = checkpoint.lateness_ms <= checkpointToleranceMs ? 'OBSERVED' : 'LATE';
        }
      }
      try {
        await persistFn(state, outputPath);
      } catch {
        state.failures.metadata_write_count += 1;
        state.finish_reason = 'metadata_write_failed';
        break;
      }
      options.onTick?.({ outputPath, state, result });

      const afterTick = nowFn();
      if (signal?.aborted) {
        state.finish_reason = 'aborted';
        break;
      }
      if (afterTick >= cutoff) {
        state.finish_reason = 'planned_cutoff_reached';
        break;
      }
      if (afterTick >= maxEnd || kstDate(afterTick) !== localDate) {
        state.finish_reason = afterTick >= maxEnd ? 'max_duration_reached' : 'local_date_changed';
        break;
      }
      const nextAt = Math.min(tickStarted.getTime() + intervalMs, cutoff.getTime(), maxEnd.getTime());
      await sleepFn(Math.max(0, nextAt - nowFn().getTime()), signal);
    }
  } finally {
    state.finished_at = nowFn().toISOString();
    try {
      await persistFn(state, outputPath);
    } catch {
      state.failures.metadata_write_count += 1;
      if (!state.finish_reason || state.finish_reason === 'planned_cutoff_reached') {
        state.finish_reason = 'metadata_write_failed';
      }
    }
  }
  options.onFinish?.({ outputPath, state });
  return { outputPath, state };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output-root') result.outputRoot = argv[++i];
    else if (argv[i] === '--interval-ms') result.intervalMs = Number(argv[++i]);
    else if (argv[i] === '--max-duration-ms') result.maxDurationMs = Number(argv[++i]);
    else if (argv[i] === '--checkpoint-tolerance-ms') result.checkpointToleranceMs = Number(argv[++i]);
    else if (argv[i] === '--root-pid') {
      const rootPid = Number(argv[++i]);
      if (!Number.isInteger(rootPid) || rootPid <= 0) throw new Error('--root-pid must be a positive integer');
      result.observeOptions = { ...(result.observeOptions || {}), rootPid };
    }
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return result;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runWatch({
      ...options, signal: controller.signal,
      onStart: ({ outputPath }) => console.log(`${outputPath} — watch started`),
    });
    console.log(`${result.outputPath} — watch finished reason=${result.state.finish_reason} observations=${result.state.observations.length}`);
    if (['observation_failed', 'metadata_write_failed'].includes(result.state.finish_reason)) process.exitCode = 1;
  } catch (error) {
    console.error(`watch failed: ${error && error.message ? error.message : 'unknown_error'}`);
    process.exitCode = 1;
  }
}

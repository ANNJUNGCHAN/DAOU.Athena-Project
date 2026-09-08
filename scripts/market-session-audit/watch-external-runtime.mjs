// Observe the user's running checkout; keep all new evidence in the audit worktree.
import path from 'node:path';
import { REPO_ROOT, marketPhase } from './observer.mjs';
import { runWatch } from './watch.mjs';

const rootPid = Number(process.argv[2]);
if (!Number.isSafeInteger(rootPid) || rootPid <= 0) throw new Error('A positive observed app PID is required');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const outputRoot = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', marketPhase(new Date()).local_date);
const result = await runWatch({
  signal: controller.signal,
  outputRoot,
  observeOptions: { repoRoot: 'C:/Projects/DAOU.Athena', rootPid, outputRoot },
});
console.log(result.outputPath);

/**
 * brainReady E2E 원스텝 러너 (2026-08-28 P3c) — 시드 DB 생성 → 브레인 켠 백엔드
 * 선기동 → npm run verify → 백엔드 종료. verify.js는 ATHENA_NO_AUTOSTART=1이라
 * 떠 있는 백엔드에만 붙는다 — 이 러너가 그 전제를 만들어 준다.
 *
 * 실측 주의 2건(2026-08-28 P1):
 *   - 부팅 직후 첫 brain 분석 호출이 빈 응답을 줄 수 있다 → ready 폴링 + 재시도.
 *   - 종료를 빼먹으면 시드 브레인이 실사용 앱에 노출된다 → 어떤 경로로 끝나도
 *     taskkill 트리 종료(Windows)로 반드시 내린다.
 *
 * 사용: node scripts/verify-brain-ready.mjs   (성공 시 exit 0)
 */

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BACKEND = join(ROOT, "backend");
const PY = join(BACKEND, ".venv", "Scripts", "python.exe");
const SEED_DB = join(ROOT, ".omc", "tmp", "brain-verify.sqlite3");
const BASE = "http://127.0.0.1:8010";

function log(msg) {
  console.log(`[brain-ready] ${msg}`);
}

function bearerToken() {
  const env = readFileSync(join(BACKEND, ".env"), "utf8");
  const m = env.match(/^ATHENA_LOCAL_BEARER_TOKEN=(.+)$/m);
  return m ? m[1].trim() : null;
}

async function httpOk(path, token) {
  try {
    const res = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => ({}));
  } catch {
    return null;
  }
}

// 0) 8010이 이미 점유돼 있으면 진행하지 않는다 — 실사용 백엔드를 시드로 덮을 위험.
if (await httpOk("/api/v1/llm/manifest", null)) {
  console.error("[brain-ready] 127.0.0.1:8010에 이미 백엔드가 떠 있다 — 내리고 다시 실행하라(시드 오염 방지).");
  process.exit(2);
}

// 1) 시드 DB 생성 (결정론 — LLM 불필요)
mkdirSync(join(ROOT, ".omc", "tmp"), { recursive: true });
if (existsSync(SEED_DB)) rmSync(SEED_DB);
log("시드 DB 생성...");
execFileSync(PY, [join(ROOT, "scripts", "verify-brain-ready-seed.py")], {
  cwd: BACKEND,
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", ATHENA_SEED_DB_PATH: SEED_DB },
});

// 2) 브레인 켠 백엔드 기동
log("브레인 백엔드 기동...");
const backend = spawn(
  PY,
  ["-m", "uvicorn", "athena_api.main:app", "--host", "127.0.0.1", "--port", "8010", "--workers", "1"],
  {
    cwd: BACKEND,
    stdio: "ignore",
    env: { ...process.env, ATHENA_BRAIN_ENABLED: "true", ATHENA_BRAIN_DB_PATH: SEED_DB },
  }
);

function killBackend() {
  try {
    execFileSync("taskkill", ["/PID", String(backend.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* 이미 죽었으면 그만 */
  }
}
process.on("exit", killBackend);
process.on("SIGINT", () => process.exit(130));

// 3) ready 폴링 (부팅 레이스 흡수 — 최대 60초)
const token = bearerToken();
let ready = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const status = await httpOk("/api/v1/brain/status", token);
  if (status && status.ready) {
    ready = true;
    break;
  }
}
if (!ready) {
  console.error("[brain-ready] 60초 안에 brain ready에 도달하지 못했다");
  process.exit(1);
}
log("brain ready — verify 실행");

// 4) npm run verify (콘솔 그대로 통과 — 판정은 exit code)
const verify = spawn("npm", ["run", "verify"], {
  cwd: join(ROOT, "app"),
  stdio: "inherit",
  shell: true,
});
const code = await new Promise((resolve) => verify.on("close", resolve));

// 5) 종료 및 판정 전파
killBackend();
log(`verify exit ${code} — 백엔드 종료 완료`);
process.exit(code === 0 ? 0 : 1);

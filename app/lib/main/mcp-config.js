// claude -p가 읽는 .mcp.json을 런타임에 생성한다.
//
// 왜 커밋된 사본을 안 쓰는가: spike/cli-pipe/gateway/.mcp.json은 이 저장소가
// 클론된 절대경로(`C:\Projects\DAOU.Athena\...`)를 그대로 박고 있다
// (RESULT.md §7: "다른 위치에 클론했으면 고쳐야 한다"). 프로덕션 배선이 그
// 스파이크 파일에 의존하면 다른 머신에서 조용히 깨진다. 대신 `mcp-cli.js`가
// 이미 쓰는 것과 같은 BACKEND_DIR 계산으로 이 앱 실행 시점에 맞는 절대경로를
// 매번 다시 써서 userData 아래에 둔다.
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');

// userDataDir 아래 mcp-config/.mcp.json을 (재)생성하고 그 경로를 돌려준다.
// cwd로 쓸 디렉토리(dir)와 그 안의 상대 파일명(configPath) 둘 다 돌려주는 이유:
// claude -p --mcp-config는 실측상 cwd 기준 상대경로로 쓰는 게 검증된 형태다
// (spike/cli-pipe/gateway/RESULT.md §1 실제 커맨드 — cwd를 .mcp.json이 있는
// 디렉토리로 잡고 `--mcp-config .mcp.json`).
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
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return { dir, configFile: '.mcp.json', configPath };
}

module.exports = { ensureMcpConfig, BACKEND_DIR, PYTHON_EXE };

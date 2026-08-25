'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');

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

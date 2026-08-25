'use strict';

const path = require('path');
const { app } = require('electron');

// `electron migrate-mcp-env-once.js`(파일 직접 지정)로 실행하면 app.getName()이
// package.json의 "athena-shell"이 아니라 Electron 기본값("Electron")으로
// 떨어진다(실측 — 처음 이 스크립트를 그렇게 돌렸을 때 실제로 그랬다). 그러면
// secrets.js가 실제 앱(`npm start` = `electron .`)이 쓰는 userData가 아닌
// 엉뚱한 폴더에 암호화 저장해서, 나중에 진짜 앱이 복호화하려 해도 못 찾는다.
// userData를 명시적으로 이 값으로 고정해 어떤 방식으로 이 스크립트를 불러도
// 항상 같은 자리(`%APPDATA%/athena-shell`)를 쓰게 한다.
app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

const mcpEnv = require('./lib/main/mcp-env');

app.whenReady().then(async () => {
  try {
    const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
    console.log('MIGRATED:', JSON.stringify(migrated));
    console.log('SKIPPED:', JSON.stringify(skipped));
  } catch (err) {
    console.error('MIGRATION_FAILED:', String((err && err.message) || err));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});

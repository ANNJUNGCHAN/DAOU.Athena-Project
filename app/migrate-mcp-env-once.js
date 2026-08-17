// 일회성 실행 스크립트 — 실제 사용자 `~/.athena/mcp_servers.json`의 평문 env를
// 실제 Electron safeStorage로 마이그레이션한다(SECURITY.md §6). `npm run`
// 스크립트에 등록하지 않는다 — 반복 실행할 일이 없는 1회성 수술이고(멱등이라
// 다시 돌려도 안전은 하지만), main.js의 부팅 마이그레이션이 이후로는 이 역할을
// 대신한다. 창을 띄우지 않는다 — app.whenReady() 후 마이그레이션만 하고 종료한다.
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

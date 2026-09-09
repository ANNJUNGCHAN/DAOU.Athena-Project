'use strict';

// Isolated renderer probe for the technique code workspace. It does not start Athena's live backend
// or touch a registered project; all project/file/terminal responses below are fixed probe data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(process.argv[2] || path.join('..', '.omc', 'artifacts', 'project-ide.png'));

function inlineScript(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/<\/script/gi, '<\\/script');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  const css = fs.readFileSync(path.join(__dirname, 'styles', 'tokens.css'), 'utf8')
    + fs.readFileSync(path.join(__dirname, 'shell.css'), 'utf8');
  const editor = inlineScript('lib/backtest-code-editor.js');
  const ide = inlineScript('lib/project-ide.js');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${css}</style></head>
  <body style="margin:0;padding:24px;background:#f5f5f6"><main id="root"></main>
  <script>${editor}</script><script>${ide}</script><script>
  const project = { id:'p1', name:'내-돌파-기법', path:'C:/Athena/projects/내-돌파-기법' };
  const techniqueRoot = 'techniques/내-돌파-기법';
  const entries = [
    {name:'.athena',path:techniqueRoot+'/.athena',is_dir:true,children:[{name:'settings.json',path:techniqueRoot+'/.athena/settings.json',is_dir:false,size:84}]},
    {name:'data',path:techniqueRoot+'/data',is_dir:true,children:[{name:'sample.csv',path:techniqueRoot+'/data/sample.csv',is_dir:false,size:1940}]},
    {name:'tests',path:techniqueRoot+'/tests',is_dir:true,children:[{name:'test_strategy.py',path:techniqueRoot+'/tests/test_strategy.py',is_dir:false,size:173}]},
    {name:'README.md',path:techniqueRoot+'/README.md',is_dir:false,size:311},
    {name:'strategy.py',path:techniqueRoot+'/strategy.py',is_dir:false,py:true,size:392},
    {name:'weights.bin',path:techniqueRoot+'/weights.bin',is_dir:false,size:1536},
  ];
  const files = {
    [techniqueRoot+'/strategy.py']:'import athena_bt as bt\\n\\nPARAMS = {"lookback": 20}\\n\\ndef signals(df, p):\\n    high = df.high.rolling(p["lookback"]).max().shift(1)\\n    entry = df.close > high\\n    exit_ = df.close < df.close.rolling(10).mean()\\n    return entry, exit_\\n',
    [techniqueRoot+'/tests/test_strategy.py']:'from strategy import signals\\n\\ndef test_signal_lengths(sample_prices):\\n    entry, exit_ = signals(sample_prices, {"lookback": 20})\\n    assert len(entry) == len(exit_)\\n',
    [techniqueRoot+'/README.md']:'# 내 돌파 기법\\n',
    [techniqueRoot+'/.athena/settings.json']:'{"environment":"automatic"}\\n',
    [techniqueRoot+'/data/sample.csv']:'date,close\\n2026-09-09,100\\n',
  };
  const workspace = AthenaLib.ProjectIde.createProjectIde({container:document.querySelector('#root'),deps:{
    listProjects:async()=>({projects:[project]}),
    tree:async()=>({entries,truncated:false}),
    readFile:async(_id,p)=>p.endsWith('/weights.bin')?{path:p,kind:'binary',binary:true,size:1536,editable:false}:{path:p,kind:'text',text:files[p]||'',size:(files[p]||'').length,editable:true},
    writeFile:async()=>({}),
    runTerminal:async()=>({exit_code:0,stdout:'IDE 터미널 표시 검증\\n',stderr:'',timed_out:false}),
  }});
  workspace.mount();
  setTimeout(async()=>{await workspace.openAt('p1',techniqueRoot+'/strategy.py',{rootPath:techniqueRoot});await workspace.runTerminal(['python','-c','print("IDE 터미널 표시 검증")']);window.__PROBE_READY__=true;},0);
  </script></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await win.webContents.executeJavaScript('new Promise(r=>{const t=setInterval(()=>{if(window.__PROBE_READY__){clearInterval(t);r(true)}},20)})');
  const audit = await win.webContents.executeJavaScript(`({
    files: document.querySelectorAll('.project-ide-file').length,
    tabs: document.querySelectorAll('.project-ide-tab').length,
    terminal: document.querySelector('.project-ide-terminal-log').innerText,
    removed: document.querySelectorAll('.backtest-technique-band,.backtest-venv-panel,.backtest-technique-approve-bar').length,
  })`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  process.stdout.write(`${JSON.stringify({ output, audit })}\n`);
  await win.close();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  app.exit(1);
});

'use strict';
// Diagnostic capture only: run the existing focused probe unchanged except for
// saving its final DOM measurement and screenshot before fixture restoration.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const appDir = path.resolve(__dirname, '../../../app');
const probePath = path.join(appDir, 'probe-paper-screens.js');
const original = fs.readFileSync(probePath, 'utf8');
const marker = '    return measured;';
if (original.split(marker).length !== 2) throw new Error('Capture insertion no longer unique');
const captureDir = JSON.stringify(__dirname);
const source = original.replace(marker, `
    fs.writeFileSync(path.join(${captureDir}, route.board + '.json'), JSON.stringify(measured, null, 2));
    fs.writeFileSync(path.join(${captureDir}, route.board + '.png'), (await win.webContents.capturePage()).toPNG());
    if (route.board === '446V-1') {
      await win.webContents.executeJavaScript("document.querySelector('.agent-check-result').scrollIntoView({block: 'start'})");
      await wait(100);
      fs.writeFileSync(path.join(${captureDir}, route.board + '-result.png'), (await win.webContents.capturePage()).toPNG());
    }
${marker}`);
const probeModule = new Module(probePath, module);
probeModule.filename = probePath;
probeModule.paths = Module._nodeModulePaths(appDir);
probeModule._compile(source, probePath);

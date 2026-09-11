'use strict';

const path = require('node:path');

function requiredEnvironmentPath(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

const version = String(process.env.ATHENA_INSTALLER_VERSION || '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('ATHENA_INSTALLER_VERSION must be a valid release version');
}

const projectDir = requiredEnvironmentPath('ATHENA_INSTALLER_PROJECT_DIR');
const backendDir = requiredEnvironmentPath('ATHENA_INSTALLER_BACKEND_DIR');
const outputDir = requiredEnvironmentPath('ATHENA_INSTALLER_OUTPUT_DIR');
const electronDist = String(process.env.ATHENA_ELECTRON_DIST || '').trim();

module.exports = {
  appId: 'kr.co.daou.athena',
  productName: 'Athena',
  electronVersion: '43.4.0',
  ...(electronDist ? { electronDist: path.resolve(electronDist) } : {}),
  extraMetadata: {
    version,
  },
  directories: {
    app: projectDir,
    output: outputDir,
  },
  asar: false,
  npmRebuild: false,
  nodeGypRebuild: false,
  files: [
    '**/*',
  ],
  extraResources: [
    {
      from: backendDir,
      to: 'backend',
      filter: ['**/*'],
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: `Athena-Setup-${version}-x64.exe`,
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: false,
  },
};

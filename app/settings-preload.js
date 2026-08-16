// 설정 창 preload — 이 창은 처음부터 안전 설정으로 태어난다.
// nodeIntegration:false / contextIsolation:true / sandbox:true 상태에서 아래 좁은 API만 노출한다.
// 렌더러는 백엔드 주소도, 로컬 bearer 토큰도, 키움 자격증명도 볼 수 없다 —
// 그 값들은 전부 main 프로세스 안에 남고, 여기로는 표시용 상태만 건너온다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('athenaSettings', {
  // 표시용 상태만 돌려준다: { backendReachable, configured, ready, expiresAt }
  getStatus: () => ipcRenderer.invoke('athena:settings:status'),
  // action은 'issue' | 'revoke'만 허용된다(검증은 main에서 한 번 더 한다)
  tokenAction: (action) => ipcRenderer.invoke('athena:settings:token', { action }),
  getInfo: () => ipcRenderer.invoke('athena:settings:info'),
  getPrefs: () => ipcRenderer.invoke('athena:settings:prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('athena:settings:prefs:set', patch),
  close: () => ipcRenderer.send('athena:settings:close'),
});

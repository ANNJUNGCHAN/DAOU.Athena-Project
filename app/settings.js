// 설정 창 렌더러. contextIsolation:true — electron을 직접 require하지 않는다.
// 노출된 창구는 preload가 준 window.athenaSettings 하나뿐이다.
const api = window.athenaSettings;

const $close = document.getElementById('settingsClose');
const $stBackend = document.getElementById('stBackend');
const $stCred = document.getElementById('stCred');
const $stToken = document.getElementById('stToken');
const $stExpires = document.getElementById('stExpires');
const $btnIssue = document.getElementById('btnIssue');
const $btnRevoke = document.getElementById('btnRevoke');
const $btnRefresh = document.getElementById('btnRefresh');
const $acctMsg = document.getElementById('acctMsg');
const $revokeConfirm = document.getElementById('revokeConfirm');
const $btnRevokeYes = document.getElementById('btnRevokeYes');
const $btnRevokeNo = document.getElementById('btnRevokeNo');
const $prefAutoExpand = document.getElementById('prefAutoExpand');
const $prefAutoGrow = document.getElementById('prefAutoGrow');
const $infoVersion = document.getElementById('infoVersion');
const $infoBackend = document.getElementById('infoBackend');
const $infoLayout = document.getElementById('infoLayout');

// ---------- 닫기 ----------
$close.addEventListener('click', () => api.close());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 확인 블록이 열려 있으면 그것부터 닫는다 — 실수로 창이 닫히지 않게.
  if (!$revokeConfirm.hidden) {
    hideRevokeConfirm();
    $btnRevoke.focus();
    return;
  }
  api.close();
});

// ---------- 상태 표시 ----------
function setState(el, text, cls) {
  el.textContent = text;
  el.classList.remove('ok', 'warn', 'off');
  if (cls) el.classList.add(cls);
}

function setMsg(text, cls) {
  $acctMsg.textContent = text;
  $acctMsg.classList.remove('ok', 'warn');
  if (cls) $acctMsg.classList.add(cls);
}

function formatExpiry(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const left = Math.round((t - Date.now()) / 60000);
  const stamp = new Date(t).toLocaleString('ko-KR', { hour12: false });
  if (left <= 0) return `${stamp} · 만료됨`;
  if (left < 60) return `${stamp} · ${left}분 남음`;
  return `${stamp} · ${Math.floor(left / 60)}시간 ${left % 60}분 남음`;
}

function renderStatus(s) {
  if (!s || !s.backendReachable) {
    setState($stBackend, '연결 안 됨', 'warn');
    setState($stCred, '알 수 없음', 'off');
    setState($stToken, '알 수 없음', 'off');
    setState($stExpires, '—', null);
    $btnIssue.disabled = true;
    $btnRevoke.disabled = true;
    if (s && s.error) setMsg(s.error, 'warn');
    return;
  }
  setState($stBackend, '연결됨', 'ok');
  setState($stCred, s.configured ? '설정됨' : '미설정', s.configured ? 'ok' : 'warn');
  setState($stToken, s.ready ? '유효' : (s.configured ? '없음' : '발급 불가'), s.ready ? 'ok' : 'off');
  setState($stExpires, formatExpiry(s.expiresAt), null);
  $btnIssue.disabled = !s.configured;
  $btnRevoke.disabled = !s.ready;
  if (!s.configured) {
    setMsg('.env에 앱키·시크릿키를 넣고 백엔드를 다시 시작해야 한다.', 'warn');
  }
}

async function refreshStatus() {
  setMsg('상태 확인 중…', null);
  try {
    const s = await api.getStatus();
    renderStatus(s);
    if (s && s.backendReachable && s.configured) setMsg('', null);
  } catch (err) {
    renderStatus({ backendReachable: false, error: String((err && err.message) || err) });
  }
}

async function loadInfo() {
  try {
    const info = await api.getInfo();
    $infoVersion.textContent = `${info.name} ${info.version} · Electron ${info.electron}`;
    $infoBackend.textContent = info.backendBaseUrl;
    $infoLayout.textContent =
      `캔버스 ${info.layout.canvasW}×${info.layout.canvasH} · 대화 ${info.layout.chatW}×${info.layout.chatBaseH}` +
      (info.layout.scale !== 1 ? ` · 축소 ${info.layout.scale.toFixed(3)}` : '');
  } catch {
    $infoVersion.textContent = '—';
  }
}

// ---------- 토큰 제어 ----------
// 창 열기·닫기·새로고침은 토큰을 발급하거나 폐기하지 않는다. 버튼을 눌러야만 움직인다.
async function runTokenAction(action) {
  $btnIssue.disabled = true;
  $btnRevoke.disabled = true;
  setMsg(action === 'issue' ? '발급 중…' : '폐기 중…', null);
  try {
    const s = await api.tokenAction(action);
    renderStatus(s);
    if (s && s.ok === false) setMsg(s.error || '실패했다.', 'warn');
    else setMsg(action === 'issue' ? '발급했다.' : '폐기했다.', 'ok');
  } catch (err) {
    setMsg(String((err && err.message) || err), 'warn');
    await refreshStatus();
  }
}

function showRevokeConfirm() { $revokeConfirm.hidden = false; $btnRevokeYes.focus(); }
function hideRevokeConfirm() { $revokeConfirm.hidden = true; }

$btnIssue.addEventListener('click', () => runTokenAction('issue'));
$btnRevoke.addEventListener('click', showRevokeConfirm);
$btnRefresh.addEventListener('click', refreshStatus);
$btnRevokeNo.addEventListener('click', () => { hideRevokeConfirm(); $btnRevoke.focus(); });
$btnRevokeYes.addEventListener('click', async () => {
  hideRevokeConfirm();
  await runTokenAction('revoke');
});

// ---------- 화면 설정 ----------
async function loadPrefs() {
  let prefs = { autoExpandCanvas: true, autoGrowChat: true };
  try {
    prefs = await api.getPrefs();
  } catch {
    /* 기본값 유지 */
  }
  $prefAutoExpand.checked = !!prefs.autoExpandCanvas;
  $prefAutoGrow.checked = !!prefs.autoGrowChat;
}

async function savePref(key, value) {
  try {
    await api.setPrefs({ [key]: value });
  } catch {
    /* 저장 실패해도 이번 세션 값은 유지된다 */
  }
}

$prefAutoExpand.addEventListener('change', () => savePref('autoExpandCanvas', $prefAutoExpand.checked));
$prefAutoGrow.addEventListener('change', () => savePref('autoGrowChat', $prefAutoGrow.checked));

// ---------- 기동 ----------
refreshStatus();
loadInfo();
loadPrefs();

// 창 자체에 포커스를 준다. 닫기 버튼에 주면 프로그램적 포커스 링이 헤더에 크게 뜬다(실측).
// ESC는 document 레벨에서 받으므로 키보드 조작은 그대로 된다.
document.getElementById('win').focus();

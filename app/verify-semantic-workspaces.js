'use strict';

/**
 * Fixture-only Electron verification for the 12 Task Canvas view recipes.
 *
 * The script blocks HTTP(S), never creates a Kiwoom client, and never executes
 * an order.  It uses canonical synthetic response models to build server-owned
 * Task Canvas envelopes, sends those envelopes through the production shell's
 * canvas event, and captures one PNG plus a JSON receipt per recipe.
 */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { publicPolicies: publicRealtimePolicies } = require('./lib/main/integrated-card-realtime');
const paperCardRouting = require('./lib/paper-card-routing');
const boardTemplateRegistry = require('./lib/board-template-registry');
const { isFinalChartPrimary } = require('./lib/semantic-chart-readiness');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BACKEND = path.join(ROOT, 'backend');

// 백엔드 의존성(fastapi·pydantic 등)은 backend/.venv에만 있다. PATH의 맨 python으로
// 부르면 ModuleNotFoundError로 죽는다 — mcp-config.js의 PYTHON_EXE와 같은 경로를 쓴다.
const VENV_PYTHON = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const FIXTURE_PYTHON = process.env.ATHENA_FIXTURE_PYTHON
  || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'task-canvas', 'semantic-workspaces');
const TEMP_PROFILE_PREFIX = 'athena-semantic-workspaces-';
const { resolveHarnessProfile } = require('./lib/main/harness-profile');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const legacyArtifactProfile = path.join(ARTIFACT_DIR, '.electron-user-data');
if (fs.existsSync(legacyArtifactProfile)) fs.rmSync(legacyArtifactProfile, { recursive: true, force: true });
for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PROFILE_PREFIX)) continue;
  const staleProfile = path.join(os.tmpdir(), entry.name);
  if (Date.now() - fs.statSync(staleProfile).mtimeMs < 30_000) continue;
  fs.rmSync(staleProfile, { recursive: true, force: true });
}
// ATHENA_USERDATA_DIR을 주면 실제로 등록한 계좌·CLI 계정이 있는 프로필을 그대로
// 쓴다. 그때는 아래 정리가 전부 no-op이다 — lib/main/harness-profile.js가 그
// 규칙을 소유하므로, 실프로필이 이 스크립트의 rmSync에 지워질 길이 없다.
const harnessProfile = resolveHarnessProfile({ prefix: TEMP_PROFILE_PREFIX });
const electronUserDataDir = harnessProfile.dir;
app.setPath('userData', electronUserDataDir);
function cleanupElectronUserData() {
  // Chromium이 프로세스가 완전히 끝날 때까지 핸들을 잡고 있을 수 있다 —
  // 헬퍼가 실패를 삼킨다.
  harnessProfile.cleanup();
}
function scheduleElectronUserDataCleanup() {
  // 공유 프로필(ATHENA_USERDATA_DIR)이면 예약 자체를 하지 않는다. 이 헬퍼는
  // 부모가 죽은 뒤에 detached 프로세스로 rmSync를 돌리므로 harnessProfile의
  // no-op cleanup을 우회한다 — 여기서 안 막으면 실제로 등록한 계좌·자격증명이
  // 검증이 끝나고 나서 조용히 지워진다.
  if (harnessProfile.shared) return;
  const cleanupScript = String.raw`
const fs = require('node:fs');
const [target, parentPidText] = process.argv.slice(1);
const parentPid = Number(parentPidText);
let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  let parentAlive = false;
  try { process.kill(parentPid, 0); parentAlive = true; } catch {}
  if (parentAlive && attempts < 300) return;
  try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
  if (!fs.existsSync(target) || attempts >= 300) {
    clearInterval(timer);
    process.exit(fs.existsSync(target) ? 1 : 0);
  }
}, 100);
`;
  const helper = spawn(process.execPath, ['-e', cleanupScript, electronUserDataDir, String(process.pid)], {
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  helper.unref();
}
scheduleElectronUserDataCleanup();
process.once('exit', cleanupElectronUserData);
app.disableHardwareAcceleration();

const PYTHON_BUNDLE = String.raw`
import copy
import json
import re
import sys

sys.path[:0] = ['.', 'tests']

from athena_api.api.canvas_push import _bind_semantic_values, _integrated_card_contract
from athena_api.canvas_transform import resolve_fixed_card_title
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
from athena_api.view_recipe_registry import get_view_recipe_registry
from support.canvas_fixture_factory import build_operation_fixtures, build_recipe_display_sections


def semantic_example(key, label, unit, row_marker):
    """Produce stable, investor-readable fixture values without placeholders."""
    text = ' '.join(str(item or '') for item in (key, label, unit)).lower()
    row_number = int(re.search(r'\d+', row_marker).group()) if re.search(r'\d+', row_marker) else 0
    if any(token in text for token in ('stk_nm', '종목명', 'name')):
        return '삼성전자'
    if any(token in text for token in ('stk_cd', '종목코드', 'code')):
        return '005930'
    if any(token in text for token in ('date', 'dt', '일자', '날짜')):
        return f'202608{29 - min(row_number, 8):02d}'
    if any(token in text for token in ('time', '_tm', '시간', '시각')):
        return f'{15 - min(row_number, 5):02d}3000'
    if any(token in text for token in ('rank', '순위')):
        return str(row_number + 1)
    if '전일대비' in text:
        return str(800 + row_number * 50)
    if '대상지수명' in text:
        return 'KOSPI 200'
    if '과세유형' in text:
        return '배당소득세'
    if '잔존일수' in text:
        return str(45 - min(row_number, 20))
    if '델타' in text:
        return f'{0.42 + row_number * 0.01:.2f}'
    if 'lp회사명' in text:
        return '미래에셋증권'
    if '신용거래구분명' in text:
        return '융자'
    if '발동방향' in text:
        return '상승'
    if '장전구분' in text:
        return '정규장'
    if 'vi발동구분' in text:
        return '발동'
    if '거래원' in text:
        return '미래에셋증권'
    if any(token in text for token in ('per', 'pbr', '배수')):
        return f'{18.6 + row_number * 0.4:.1f}'
    if any(token in text for token in ('rate', '_rt', 'ratio', 'roe', '수익률', '등락률', '비율', '율', '%')):
        return f'{2.35 + row_number * 0.18:.2f}'
    if any(token in text for token in ('price', 'pric', 'prc', 'bid', '금액', '가격', '현재가', '시가', '고가', '저가', '종가')):
        return str(72000 + row_number * 100)
    if any(token in text for token in ('qty', 'req', 'volume', 'count', 'cnt', '잔량', '수량', '거래량', '건수')):
        return str(12400 + row_number * 730)
    if any(token in text for token in ('변동', '증감')):
        return str(1250 + row_number * 90)
    if any(token in text for token in ('market', 'mrkt', '시장')):
        return 'KOSPI'
    if any(token in text for token in ('side', 'io_tp', '매매구분', '주문구분')):
        return '매수'
    if any(token in text for token in ('status', 'state', '상태')):
        return '정상'
    if any(token in text for token in ('yn', '여부')):
        return '예'
    return '일반'


def safe_value(value, labels, key='', row_marker='0'):
    if isinstance(value, dict):
        return {child_key: safe_value(item, labels, key=child_key, row_marker=row_marker) for child_key, item in value.items()}
    if isinstance(value, list):
        output = []
        for index, item in enumerate(value):
            output.append(safe_value(copy.deepcopy(item), labels, key=key, row_marker=f'{index}-0'))
            output.append(safe_value(copy.deepcopy(item), labels, key=key, row_marker=f'{index}-1'))
        return output
    if isinstance(value, str):
        label, unit = labels.get(key, (key, ''))
        return semantic_example(key, label, unit, row_marker)
    return value


fixtures = build_operation_fixtures()
fixture_by_id = {fixture.mapping_id: fixture for fixture in fixtures}
recipe_display_sections = build_recipe_display_sections()
recipes = get_view_recipe_registry()
semantic = get_semantic_presentation_registry()
preferred = {
    'instrument-chart': 'base:ka10081',
    'live-orderbook': 'detail:ka10004:buy_bid_prices',
    'order-safe-ticket': 'base:kt10000',
}
representatives = []

for recipe in recipes.recipes:
    candidates = [fixture for fixture in fixtures if recipes.for_operation(fixture.mapping_id).recipe_id == recipe.recipe_id]
    selected = fixture_by_id.get(preferred.get(recipe.recipe_id, ''))
    if selected is None:
        selected = max(
            candidates,
            key=lambda fixture: sum(contract.user_visible for contract in semantic.for_operation(fixture.mapping_id)),
        )
    semantic_contracts = semantic.for_operation(selected.mapping_id)
    labels = {
        item.alias: (item.label_ko or item.alias, item.unit_or_format or '')
        for item in semantic_contracts
    }
    source = safe_value(selected.validated_payload, labels)
    contract = _integrated_card_contract(selected.mapping_id, arguments={'stk_cd': '005930'})
    # A guarded order is a pre-execution draft, not a synthetic broker
    # response.  Keep receipt-only semantic fields empty until a real response
    # exists; the allowlisted order_draft projection remains visible below.
    if recipe.recipe_id in recipe_display_sections:
        curated = recipe_display_sections[recipe.recipe_id]
        for section in contract['presentation_contract']['sections']:
            section['fields'] = []
            section['columns'] = []
            section['rows'] = []
            section.update(copy.deepcopy(curated.get(section['section_id'], {})))
    elif recipe.recipe_id != 'order-safe-ticket':
        _bind_semantic_values(contract, selected.mapping_id, source)
    else:
        draft_section = next(
            section for section in contract['presentation_contract']['sections']
            if section['section_id'] == 'confirmation-and-receipt'
        )
        draft_section['title_ko'] = '확인할 주문'
        draft_section['fields'] = [
            {
                'label_ko': '종목', 'value': '삼성전자 · 005930',
                'display_tier': 'answer', 'display_order': 1,
                'visibility_policy': 'always',
            },
            {
                'label_ko': '주문 내용', 'value': '매수 · 10주 · 시장가',
                'display_tier': 'primary', 'display_order': 2,
                'visibility_policy': 'always',
            },
            {
                'label_ko': '주문 상태', 'value': '확인 대기',
                'display_tier': 'support', 'display_order': 3,
                'visibility_policy': 'always',
            },
        ]
    primary_data = copy.deepcopy(selected.primary_data)
    envelope = {
        **contract,
        # canvas_push가 싣는 최상위 필드를 그대로 싣는다(operation_ref·card_title은
        # 생산 봉투의 값이다) — 픽스처가 이걸 빼면 카드 배선 판정이 픽스처에서만
        # 다르게 돌아 회귀를 못 잡는다(2026-09-06 검수 발견).
        'operation_ref': selected.mapping_id,
        'card_title': resolve_fixed_card_title(selected.mapping_id),
        'canvas_type': selected.canvas_type,
        'data': primary_data,
        'renderer_id': selected.renderer_id,
        'caption': recipe.title_ko,
        'operation_args': {'stk_cd': '005930'},
    }
    representatives.append({
        'recipe_id': recipe.recipe_id,
        'operation_ref': selected.mapping_id,
        'expected_sections': list(recipe.section_ids),
        'expected_candle_count': len(primary_data.get('chart', {}).get('candles', [])),
        'expects_two_sided_orderbook': recipe.recipe_id == 'live-orderbook',
        'expects_order_draft': recipe.recipe_id == 'order-safe-ticket',
        'envelope': envelope,
    })

print(json.dumps({
    'fixture_only': True,
    'external_calls_allowed': False,
    'live_connectivity_verified': False,
    'operation_count': len(fixtures),
    'wire_occurrence_count': sum(len(fixture.occurrences) for fixture in fixtures),
    'unique_wire_path_count': len({(fixture.mapping_id, occurrence.json_path) for fixture in fixtures for occurrence in fixture.occurrences}),
    'representatives': representatives,
}, ensure_ascii=False))
`;

function loadFixtureBundle() {
  const result = spawnSync(
    FIXTURE_PYTHON,
    ['-c', PYTHON_BUNDLE],
    {
      cwd: BACKEND,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );
  if (result.status !== 0) throw new Error(`Task Canvas fixture generation failed:\n${result.stderr}`);
  const bundle = JSON.parse(result.stdout);
  // "앱 렌더러가 primary라 보드가 가로채지 않는다"는 판정은 앱과 같은 함수가 든다.
  // 검증기가 recipe 3종을 따로 세면 앱이 새로 보드로 보내기 시작한 봉투를 여기서
  // 채점하지 못한다 — 두 집합이 갈라질 길을 없앤다(2026-09-06 검수 P1).
  for (const representative of bundle.representatives || []) {
    // 보드가 그 앱 렌더러를 자기 자리에 얹을 수 있으면 봉투는 보드로 간다 —
    // 앱(canvas.boardPrimaryRendererOf)이 보는 사실을 여기서도 같이 본다.
    const surface = (representative.envelope && representative.envelope.surface_contract) || {};
    representative.primary_expected = paperCardRouting.preservesAppPrimary(
      representative.envelope,
      boardTemplateRegistry.primaryRendererFor(surface.board_id || ''),
    );
  }
  return bundle;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fileSafe(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-');
}

function expectedProductSections(representative) {
  const contract = representative.envelope.presentation_contract || {};
  const recipe = representative.envelope.view_recipe || {};
  const policies = new Map((recipe.section_policies || []).map((policy) => [policy.section_id, policy]));
  const sections = (contract.sections || []).filter((section) => (
    !(representative.recipe_id === 'live-orderbook' && section.section_id === 'depth-ladder')
  ));
  const hasRenderableData = (section) => {
    if (['loading', 'empty', 'unavailable', 'error'].includes(section.status)) return false;
    const hasFields = (section.fields || []).some((field) => Object.prototype.hasOwnProperty.call(field, 'value'));
    const hasRows = Array.isArray(section.columns) && section.columns.length > 0
      && Array.isArray(section.rows) && section.rows.length > 0;
    return hasFields || hasRows;
  };
  const hasAnyData = sections.some(hasRenderableData);
  if (!hasAnyData) return [];
  return sections.filter((section) => {
    if (representative.recipe_id === 'live-orderbook' && section.section_id === 'depth-ladder') return false;
    const policy = { ...(policies.get(section.section_id) || {}), ...section };
    const hasData = hasRenderableData(section);
    const visibility = policy.visibility_policy || 'when-data';
    if (policy.workflow_only || visibility === 'workflow') return hasData;
    if (hasData) return true;
    if (['empty', 'unavailable'].includes(section.status)) return false;
    if ((policy.required || visibility === 'always') && visibility === 'always') return true;
    return ['loading', 'stale', 'reconnecting'].includes(section.status);
  }).sort((left, right) => {
    const leftPolicy = { ...(policies.get(left.section_id) || {}), ...left };
    const rightPolicy = { ...(policies.get(right.section_id) || {}), ...right };
    return (leftPolicy.section_order ?? Number.MAX_SAFE_INTEGER)
      - (rightPolicy.section_order ?? Number.MAX_SAFE_INTEGER);
  });
}

function installFixtureIpc() {
  const values = new Map([
    ['athena:conversations-list', []],
    ['athena:account-list', []],
    ['athena:routines-list', []],
    ['athena:settings:prefs:get', {}],
    ['athena:brain-status', { ok: true, ready: false }],
    ['athena:model-get', { model: 'fixture-only' }],
    ['athena:cli-list', []],
    ['athena:boot-readiness:get', { phase: 'ready', tasks: [] }],
    ['athena:onboarding-state', { completed: true, step: 4 }],
    ['athena:chart-history-page', { ok: true, candles: [] }],
  ]);
  for (const [channel, value] of values) ipcMain.handle(channel, async () => value);
  ipcMain.handle('athena:integrated-card-realtime-policy', async () => ({
    ok: true,
    fixtureOnly: true,
    operations: publicRealtimePolicies(),
  }));
  const fixtureDisabled = async (_event, payload = {}) => ({
    ok: true,
    status: 'fixture-disabled',
    fixtureOnly: true,
    leaseId: String(payload.leaseId || ''),
    generation: 1,
    connectionGeneration: 1,
    bindings: [],
  });
  ipcMain.handle('athena:integrated-card-realtime-mount', fixtureDisabled);
  ipcMain.handle('athena:integrated-card-realtime-update', fixtureDisabled);
  ipcMain.handle('athena:integrated-card-realtime-unmount', fixtureDisabled);
  // 보드 표면은 값이 빈 자리를 만나면 하이드레이션을 부른다(canvas.js
  // `athena:canvas-board-hydrate`, 카드 표면 트랙이 넣은 채널). 이 검사기는 픽스처라
  // 백엔드가 없으므로 「채울 값이 없다」로 정상 응답한다 — 핸들러가 아예 없으면
  // 렌더러가 「카드 정보를 불러오지 못했습니다」로 던지고, 그 보드에 얹힌 기존 차트
  // 렌더러 보존 검사까지 함께 떨어진다(실측: instrument-chart).
  ipcMain.handle('athena:canvas-board-hydrate', async (_event, payload = {}) => ({
    ok: true,
    status: 'hydrated',
    board_id: String(payload.boardId || ''),
    slot_values: {},
    filled: 0,
    operations: [],
    surface_contract: null,
  }));
}

async function waitFor(fn, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function prepareStage(win) {
  await win.webContents.executeJavaScript(`(() => {
    let stage = document.getElementById('semanticVerificationStage');
    if (!stage) {
      stage = document.createElement('main');
      stage.id = 'semanticVerificationStage';
      stage.setAttribute('aria-label', 'Task Canvas fixture verification');
      const shell = document.getElementById('shell');
      if (shell) {
        shell.hidden = false;
        shell.classList.remove('is-onboarding-hidden');
      }
      for (const id of ['boot', 'onboard']) {
        const overlay = document.getElementById(id);
        if (overlay) overlay.hidden = true;
      }
      if (shell) {
        const shellStyle = getComputedStyle(shell);
        for (const property of shellStyle) {
          if (property.startsWith('--')) stage.style.setProperty(property, shellStyle.getPropertyValue(property));
        }
      }
      document.body.appendChild(stage);
      const style = document.createElement('style');
      style.textContent = \`
        #semanticVerificationStage {
          position: fixed; inset: 0; z-index: 2147483647; overflow: auto;
          box-sizing: border-box; padding: 32px; background: #eef0f4;
        }
        #semanticVerificationStage > .card {
          position: relative !important; inset: auto !important; transform: none !important;
          width: min(1320px, calc(100vw - 64px)) !important; min-height: 0;
          margin: 0 auto !important; opacity: 1 !important; visibility: visible !important;
          animation: none !important; z-index: 1 !important;
        }
      \`;
      document.head.appendChild(style);
    }
    return true;
  })()`);
}

async function clearStage(win) {
  await win.webContents.executeJavaScript(`(() => {
    const stage = document.getElementById('semanticVerificationStage');
    if (stage) stage.replaceChildren();
    const grid = document.getElementById('grid');
    if (grid) grid.replaceChildren();
    return true;
  })()`);
}

async function inspectAndStage(win, recipe) {
  // 차트 카드는 **비동기**로 선다(chart-card.js가 lightweight-charts를 먼저 싣는다).
  // 그래서 대기 조건에 차트 본문을 넣지 않으면 마운트 전 프레임을 읽고 「차트 렌더러가
  // 보존되지 않았다」로 떨어진다 — 실측으로 두 번에 한 번 실패했다.
  const needsChart = recipe && recipe.recipe_id === 'instrument-chart';
  return waitFor(
    () => win.webContents.executeJavaScript(`(() => {
      const NEEDS_CHART = ${needsChart};
      const isFinalChartPrimary = ${isFinalChartPrimary.toString()};
      const grid = document.getElementById('grid');
      const card = grid && [...grid.querySelectorAll('.card')].find(
        (item) => item.dataset.taskCanvas === 'true' || item.dataset.boardSurface === 'true');
      if (!card) return null;
      // 보드 표면 카드에는 의미 작업대가 안 붙는다(canvas.js 세 upsert 호출부의 보드
      // 예외) — 그래서 마운트 판정도 갈린다: 보드는 보드가 섰는지, 나머지는 작업대가
      // 붙었는지를 본다.
      const boardSurface = card.dataset.boardSurface === 'true';
      const boardHost = card.querySelector('.board-surface-host');
      if (boardSurface ? !(boardHost && boardHost.children.length) : !card.querySelector('.semantic-workspace')) return null;
      if (NEEDS_CHART && !isFinalChartPrimary(card)) return null;
      const shell = document.getElementById('shell');
      if (shell) {
        shell.hidden = false;
        shell.classList.remove('is-onboarding-hidden');
      }
      for (const id of ['boot', 'onboard']) {
        const overlay = document.getElementById(id);
        if (overlay) overlay.hidden = true;
      }
      const stage = document.getElementById('semanticVerificationStage');
      stage.hidden = false;
      stage.replaceChildren(card);
      card.hidden = false;
      card.removeAttribute('hidden');
      const workspace = card.querySelector('.semantic-workspace');
      const sections = workspace ? [...workspace.querySelectorAll('.semantic-workspace-section')] : [];
      const values = workspace
        ? [...workspace.querySelectorAll('.semantic-workspace-value, .semantic-workspace-table tbody td')] : [];
      const raw = card.querySelector('.semantic-detail-sheet');
      const forbiddenPattern = /(?:\\b(?:FID|raw|alias|REST|0D|fundamentals|entry|draft|json[ _-]?path|mapping[ _-]?id|operation[ _-]?ref|plan[ _-]?token|trace[ _-]?id)\\b|(?:base|detail):[a-z0-9]|\\bka\\d{5}\\b|canonical snapshot|백엔드 영속|후속 라운드|미구현|\\$\\.)/i;
      const visibleText = card.innerText || '';
      const forbiddenText = visibleText.match(forbiddenPattern);
      const accessibleText = [card, ...card.querySelectorAll('*')]
        .flatMap((node) => ['aria-label', 'aria-description', 'title', 'alt', 'placeholder']
          .map((name) => ({ name, value: node.getAttribute && node.getAttribute(name) }))
          .filter((entry) => entry.value));
      const forbiddenAccessibleText = accessibleText.find((entry) => forbiddenPattern.test(entry.value));
      // Opaque observation hashes are the sole exception to the raw-identity
      // attribute gate. They support row-local patching without exposing an
      // operation, field, concept, alias, FID, JSON path, or realtime key.
      const allowedOpaqueAttribute = (attr) => attr.name === 'data-semantic-observation-id'
        && /^obs_[a-f0-9]{12,64}$/i.test(attr.value);
      const forbiddenAttributeName = /(?:operation|mapping|json[-_]?path|field[-_]?occurrence|fid|alias|concept|realtime|merge[-_]?key|plan[-_]?token|trace[-_]?id|session[-_]?id|tr[-_]?id|live[-_]?source|raw|wire)/i;
      const forbiddenDomAttribute = [card, ...card.querySelectorAll('*')]
        .flatMap((node) => [...node.attributes].map((attr) => ({ node, attr })))
        .find(({ attr }) => !allowedOpaqueAttribute(attr)
          && (forbiddenAttributeName.test(attr.name) || forbiddenPattern.test(attr.value)));
      const primitiveSections = sections.map((section) => ({
        sectionId: section.dataset.semanticSection,
        metricCount: section.querySelectorAll('.semantic-workspace-value').length,
        hasTable: Boolean(section.querySelector('.semantic-workspace-table')),
      }));
      const rect = card.getBoundingClientRect();
      const populatedOrderbookRows = (selector) => [...card.querySelectorAll(selector)]
        .filter((row) => {
          const price = row.querySelector('.card-kit-hoga-live-price');
          const quantity = row.querySelector('.card-kit-hoga-live-quantity');
          return price && quantity && price.textContent !== '—' && quantity.textContent !== '—';
        }).length;
      return {
        recipeId: ${JSON.stringify(recipe.recipe_id)},
        boardSurface,
        boardId: card.dataset.boardId || null,
        semanticWorkspaceMounted: Boolean(workspace),
        sections: sections.map((node) => node.dataset.semanticSection),
        primitiveSections,
        valueCount: values.length,
        values: values.slice(0, 12).map((node) => node.textContent),
        rawMounted: Boolean(raw),
        forbiddenAccessibleText,
        forbiddenDomAttribute: forbiddenDomAttribute && {
          name: forbiddenDomAttribute.attr.name,
          value: forbiddenDomAttribute.attr.value,
          tag: forbiddenDomAttribute.node.tagName,
          className: forbiddenDomAttribute.node.className,
        },
        forbiddenText: forbiddenText && forbiddenText[0],
        // 차트 카드 본문은 .chart-card-body다 (canvas.js가 그 클래스를 붙이고
        // chart-card.js가 그 안에 lightweight-charts를 세운다). 옛 선택자
        // .chart-stage / .chart-host 는 지금 앱에 아예 없어 이 단언이 늘 거짓이었다.
        // (주석에 백틱을 쓰면 이 템플릿 문자열이 끊긴다 — 쓰지 않는다.)
        hasChartPrimary: isFinalChartPrimary(card),
        hasProfessionalChartPanel: isFinalChartPrimary(card),
        hasOrderbookPrimary: Boolean(card.classList.contains('hoga') || card.querySelector('.hoga, .orderbook, .card-kit-hoga-live, [data-orderbook]')),
        populatedAskRows: populatedOrderbookRows('.card-kit-hoga-live-row--ask'),
        populatedBidRows: populatedOrderbookRows('.card-kit-hoga-live-row--bid'),
        hasOrderDraftUi: Boolean(card.querySelector('.card-kind-order-receipt, .card-kind-order-facts')),
        realtimeErrorCount: card.querySelectorAll('.integrated-realtime-error').length,
        genericRawPrimary: Boolean(card.querySelector('.mcp-table, .facts-grid, .compound-card, .stream-card, .reader-card')),
        cardClasses: [...card.classList],
        cardStyle: {
          display: getComputedStyle(card).display,
          visibility: getComputedStyle(card).visibility,
          opacity: getComputedStyle(card).opacity,
          backgroundColor: getComputedStyle(card).backgroundColor,
        },
        primaryClasses: [...card.querySelectorAll('[class]')].slice(0, 30).map((node) => node.className),
        rect: {
          x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)),
          width: Math.max(1, Math.min(window.innerWidth, Math.ceil(rect.width))),
          height: Math.max(1, Math.min(window.innerHeight, Math.ceil(rect.height))),
        },
      };
    })()`),
    `${recipe.recipe_id}: card surface did not mount`,
  );
}

async function verifyFailureState(win, representative) {
  await clearStage(win);
  win.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: {
      ...representative.envelope,
      state: 'error',
      data: { fields: [{ key: 'cur_prc', label: '현재가', value: '72000' }] },
    },
  });
  return waitFor(
    () => win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('#grid .card');
      if (!card) return null;
      return {
        errorStateMounted: card.dataset.renderState === 'error',
        dataTableMounted: Boolean(card.querySelector('.semantic-workspace-table, .mcp-table, table')),
        semanticWorkspaceMounted: Boolean(card.querySelector('.semantic-workspace')),
      };
    })()`),
    'explicit failure-state card did not mount',
  );
}

function visualPixelReceipt(image) {
  const bitmap = image.toBitmap();
  const size = image.getSize();
  const pixelCount = size.width * size.height;
  if (!bitmap.length || !pixelCount) return { sampled_pixels: 0, varied_pixels: 0 };
  const first = [bitmap[0], bitmap[1], bitmap[2], bitmap[3]];
  let sampled = 0;
  let varied = 0;
  const stride = Math.max(1, Math.floor(pixelCount / 20000));
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    sampled += 1;
    if (bitmap[offset] !== first[0] || bitmap[offset + 1] !== first[1]
      || bitmap[offset + 2] !== first[2] || bitmap[offset + 3] !== first[3]) varied += 1;
  }
  return { sampled_pixels: sampled, varied_pixels: varied };
}

async function captureRenderedPage(win) {
  const alreadyAttached = win.webContents.debugger.isAttached();
  if (!alreadyAttached) win.webContents.debugger.attach('1.3');
  try {
    const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    return nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'));
  } finally {
    if (!alreadyAttached && win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
  }
}

async function verifyNarrowWindow(win, representative) {
  win.setContentSize(390, 844);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await clearStage(win);
  win.webContents.send('athena:add-canvas-live', {
    status: 'success', envelope: representative.envelope,
  });
  await inspectAndStage(win, representative);

  let debuggerAttached = false;
  try {
    win.webContents.debugger.attach('1.3');
    debuggerAttached = true;
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  } catch {
    // Static reduced-motion coverage remains enforced by the Node CSS test.
  }

  const dom = await win.webContents.executeJavaScript(`(() => {
    const stage = document.getElementById('semanticVerificationStage');
    // 재는 기준은 실제로 선 표면이다 — 작업대가 붙는 카드는 작업대, Paper 보드로
    // 그려지는 카드는 카드 루트. 보드 대표를 작업대 선택자로 재면 대상이 0개가 되어
    // 탭 타깃·오버플로 단언이 통째로 무조건 참이 된다(2026-09-06 검수 발견).
    const card = stage.querySelector('.card');
    const workspace = card.querySelector('.semantic-workspace');
    const root = workspace || card;
    const boardHost = card.querySelector('.board-surface-host');
    const boardSurface = boardHost && boardHost.firstElementChild;
    const tableWrap = root.querySelector('.semantic-workspace-table-wrap');
    if (tableWrap) tableWrap.focus();
    // 탭 타깃은 표면 안을 잰다. 카드 머리(닫기 22px)는 Paper 카드 크롬의 치수라
    // 이 게이트의 주제가 아니다 — 표면 안에 조작 요소가 생기면 여기서 걸린다.
    const targets = [...root.querySelectorAll('button, a, input, select, textarea, [tabindex]')]
      .filter((node) => !node.hidden)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        // 어느 요소가 작은지 이름 없이 적으면 다음 사람이 같은 진단을 다시 해야 한다.
        return {
          width: rect.width,
          height: rect.height,
          tag: node.tagName,
          cls: String(node.className || '').trim().slice(0, 60),
          node: (node.dataset && (node.dataset.node || node.dataset.slotId)) || '',
          role: node.getAttribute('role') || '',
          tabindex: node.getAttribute('tabindex') || '',
          text: String(node.textContent || '').trim().slice(0, 24),
        };
      });
    const value = root.querySelector('.semantic-workspace-value');
    const motion = value ? getComputedStyle(value) : null;
    const rgb = (color) => (String(color).match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (color) => {
      const channels = rgb(color).map((channel) => channel / 255)
        .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels.length === 3 ? 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] : 1;
    };
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    // 배경은 흰색으로 가정하지 않는다 — 보드 원문은 자기 배경을 칠하고 온다.
    // 반투명 배경(#5FCE3F1F 같은 칩)은 조상 위에 합성해야 실제로 보이는 색이 된다.
    const backgroundOf = (node) => {
      const layers = [];
      for (let cursor = node; cursor; cursor = cursor.parentElement) {
        const parts = (String(getComputedStyle(cursor).backgroundColor).match(/[\\d.]+/g) || []).map(Number);
        if (parts.length < 3) continue;
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (!alpha) continue;
        layers.push({ r: parts[0], g: parts[1], b: parts[2], a: alpha });
        if (alpha >= 1) break;
      }
      let composed = { r: 255, g: 255, b: 255 };
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index];
        composed = {
          r: layer.r * layer.a + composed.r * (1 - layer.a),
          g: layer.g * layer.a + composed.g * (1 - layer.a),
          b: layer.b * layer.a + composed.b * (1 - layer.a),
        };
      }
      return \`rgb(\${Math.round(composed.r)}, \${Math.round(composed.g)}, \${Math.round(composed.b)})\`;
    };
    const appChromeSamples = [...stage.querySelectorAll([
      '.semantic-workspace-title',
      '.semantic-workspace-section-title',
      '.semantic-workspace-value',
      '.integrated-card-tab.is-active',
      '.integrated-realtime-error',
      '.integrated-realtime-error button',
    ].join(', '))];
    // 작업대가 없는 보드 카드는 Paper 원문 텍스트를 잰다. 그 색은 Paper가 정본이라
    // 이 게이트가 3:1을 요구하지 않는다(앱이 칠한 색만 요구한다) — 대신 잰 값을
    // 영수증에 남겨 보드 색 드리프트가 눈에 보이게 한다.
    const boardSamples = appChromeSamples.length ? [] : [...root.querySelectorAll('*')]
      .filter((node) => [...node.childNodes]
        .some((child) => child.nodeType === 3 && child.textContent.trim())
        && node.getBoundingClientRect().width > 0);
    const sampleOf = (node, paperOwned) => ({
      tag: node.tagName, className: String(node.className || ''), paperOwned,
      text: (node.textContent || '').trim().slice(0, 24),
      color: getComputedStyle(node).color, background: backgroundOf(node),
      contrastOnBackground: contrast(getComputedStyle(node).color, backgroundOf(node)),
    });
    const contrastSamples = [
      ...appChromeSamples.slice(0, 20).map((node) => sampleOf(node, false)),
      ...boardSamples.slice(0, 20).map((node) => sampleOf(node, true)),
    ];
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      semanticWorkspaceMounted: Boolean(workspace),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      workspaceOverflow: root.scrollWidth > root.clientWidth,
      surfaceWidth: { scroll: root.scrollWidth, client: root.clientWidth },
      // 보드 카드 본문은 잘라내므로(card-body is-clipped) 카드 루트만 재면 넘침이
      // 안 보인다 — Paper 원문(1360px)이 실제로 좁은 창까지 접혔는지는 보드 자리와
      // 그 안의 원문 노드를 재야 나온다.
      boardWidth: boardHost ? {
        host: boardHost.clientWidth,
        surface: boardSurface ? Math.round(boardSurface.getBoundingClientRect().width) : null,
        scroll: boardSurface ? boardSurface.scrollWidth : boardHost.scrollWidth,
      } : null,
      boardOverflow: boardHost && boardSurface
        ? boardSurface.scrollWidth > boardHost.clientWidth : false,
      tableHorizontalOverflow: tableWrap ? tableWrap.scrollWidth > tableWrap.clientWidth : false,
      tableOwnsOverflow: tableWrap ? tableWrap.scrollWidth >= tableWrap.clientWidth : null,
      tableFocusable: !tableWrap || tableWrap.tabIndex === 0,
      tableFocused: !tableWrap || document.activeElement === tableWrap,
      headingsScoped: [...root.querySelectorAll('th')].every((node) => node.getAttribute('scope') === 'col'),
      workspaceAriaLabel: workspace ? workspace.getAttribute('aria-label') : null,
      targetCount: targets.length,
      undersizedTargets: targets.filter((target) => target.width < 44 || target.height < 44),
      reducedMotionMatched: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDuration: motion && motion.animationDuration,
      transitionDuration: motion && motion.transitionDuration,
      contrastSamples,
    };
  })()`);
  if (debuggerAttached) win.webContents.debugger.detach();

  if (dom.viewport.width !== 390 || dom.viewport.height !== 844) throw new Error(`narrow-window viewport drifted: ${JSON.stringify(dom.viewport)}`);
  // boardOverflow는 판정하지 않는다 — 보드 원문은 1360px 설계라 390px에서 아직
  // 접히지 않고(실측 924px, 카드가 잘라내 창은 가로로 안 밀린다), 접힘을 요구하는
  // 계약이 아직 없다. 잰 값은 영수증에 남겨 다음 단계가 근거로 쓴다.
  if (dom.documentOverflow || dom.workspaceOverflow || dom.tableHorizontalOverflow) throw new Error(`narrow-window surface overflowed: ${JSON.stringify(dom)}`);
  // aria-label은 의미 작업대의 계약이다 — 보드 카드는 Paper 원문이 자기 머리를 갖는다.
  if (!dom.tableFocusable || !dom.headingsScoped
    || (dom.semanticWorkspaceMounted && !dom.workspaceAriaLabel)) throw new Error(`narrow-window keyboard/table semantics failed: ${JSON.stringify(dom)}`);
  if (dom.undersizedTargets.length) throw new Error(`narrow-window interactive target below 44px: ${JSON.stringify(dom.undersizedTargets)}`);
  const lowContrast = dom.contrastSamples
    .filter((sample) => !sample.paperOwned && sample.contrastOnBackground < 3);
  if (lowContrast.length) throw new Error(`narrow-window card text contrast below 3:1: ${JSON.stringify(lowContrast)}`);
  if (debuggerAttached && (!dom.reducedMotionMatched
    || (dom.animationDuration !== null && dom.animationDuration !== '0s')
    || (dom.transitionDuration !== null && dom.transitionDuration !== '0s'))) {
    throw new Error(`reduced motion contract failed: ${JSON.stringify(dom)}`);
  }

  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  win.webContents.invalidate();
  const image = await captureRenderedPage(win);
  const png = image.toPNG();
  const pixels = visualPixelReceipt(image);
  if (pixels.varied_pixels < 100) throw new Error(`blank narrow-window screenshot: ${JSON.stringify(pixels)}`);
  const file = `narrow-window-390x844-${fileSafe(representative.recipe_id)}.png`;
  fs.writeFileSync(path.join(ARTIFACT_DIR, file), png);
  return {
    recipe_id: representative.recipe_id, ...dom, screenshot: file, screenshot_sha256: sha256(png),
    screenshot_dimensions: image.getSize(), screenshot_pixels: pixels,
  };
}

async function main() {
  const bundle = loadFixtureBundle();
  if (bundle.operation_count !== 299 || bundle.wire_occurrence_count !== 3705 || bundle.unique_wire_path_count !== 3703) {
    throw new Error('canonical Task Canvas fixture totals drifted');
  }
  if (!bundle.fixture_only || bundle.external_calls_allowed || bundle.live_connectivity_verified) {
    throw new Error('fixture-only side-effect boundary is open');
  }
  if (!Array.isArray(bundle.representatives) || bundle.representatives.length !== 12) {
    throw new Error('expected exactly 12 recipe representatives');
  }

  await app.whenReady();
  installFixtureIpc();
  let blockedExternalRequests = 0;
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    backgroundColor: '#EEF0F4',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(APP, 'preload.js'),
    },
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) {
      blockedExternalRequests += 1;
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  const results = [];
  let narrowWindowRegression = null;
  let failureStateRegression = null;
  try {
    await win.loadFile(path.join(APP, 'shell.html'));
    win.show();
    await waitFor(
      () => win.webContents.executeJavaScript('Boolean(window.AthenaLib && window.AthenaLib.SemanticWorkspace && document.getElementById("grid"))'),
      'production shell semantic workspace runtime did not become ready',
    );
    await prepareStage(win);

    for (const representative of bundle.representatives) {
      process.stdout.write(`[semantic-workspace] ${representative.recipe_id}\n`);
      await clearStage(win);
      win.webContents.send('athena:add-canvas-live', {
        status: 'success',
        envelope: representative.envelope,
      });
      const dom = await inspectAndStage(win, representative);
      // 보드로 그려지는 카드는 Paper 보드 그 자체다 — 의미 작업대는 그 카드의
      // 표시 계약이 아니므로 섹션·값 검사를 걸지 않고, 대신 시트가 한 겹 더
      // 붙지 않았는지를 본다. 보드 표면 자체의 반응형·실시간 계약은
      // verify:integrated-cards가 든다.
      const expectedVisibleSections = dom.boardSurface ? [] : expectedProductSections(representative);
      const expectedSections = expectedVisibleSections.map((section) => section.section_id);
      if (dom.boardSurface) {
        if (dom.semanticWorkspaceMounted) {
          throw new Error(`${representative.recipe_id}: semantic workspace was layered under the Paper board`);
        }
      } else if (JSON.stringify(dom.sections) !== JSON.stringify(expectedSections)) {
        throw new Error(`${representative.recipe_id}: named section order drifted: ${JSON.stringify({ expectedSections, actualSections: dom.sections })}`);
      }
      const specializedPrimaryMounted = representative.recipe_id === 'instrument-chart'
        ? dom.hasChartPrimary
        : representative.recipe_id === 'live-orderbook'
          ? dom.hasOrderbookPrimary
          : representative.recipe_id === 'order-safe-ticket' ? dom.hasOrderDraftUi : false;
      if (!dom.boardSurface && !dom.valueCount && !(representative.primary_expected && specializedPrimaryMounted)) {
        throw new Error(`${representative.recipe_id}: no semantic value or specialized primary mounted`);
      }
      if (dom.rawMounted || dom.forbiddenAccessibleText || dom.forbiddenDomAttribute || dom.forbiddenText) {
        throw new Error(`${representative.recipe_id}: technical/raw product UI leakage: ${JSON.stringify({
          text: dom.forbiddenText,
          accessibility: dom.forbiddenAccessibleText,
          attribute: dom.forbiddenDomAttribute,
        })}`);
      }
      if (representative.recipe_id === 'instrument-chart' && !dom.hasChartPrimary) {
        throw new Error('instrument-chart: existing Athena chart renderer was not preserved');
      }
      if (representative.recipe_id === 'instrument-chart'
        && (!dom.hasProfessionalChartPanel || representative.expected_candle_count < 2)) {
        throw new Error(`instrument-chart: professional multi-candle fixture missing: ${JSON.stringify({
          professionalPanel: dom.hasProfessionalChartPanel,
          candleCount: representative.expected_candle_count,
        })}`);
      }
      if (representative.recipe_id === 'live-orderbook' && !dom.hasOrderbookPrimary) {
        throw new Error(`live-orderbook: existing Athena orderbook renderer was not preserved: ${JSON.stringify({ cardClasses: dom.cardClasses, primaryClasses: dom.primaryClasses })}`);
      }
      if (representative.expects_two_sided_orderbook
        && (!dom.populatedAskRows || !dom.populatedBidRows)) {
        throw new Error(`live-orderbook: two-sided price and quantity rows missing: ${JSON.stringify({
          askRows: dom.populatedAskRows, bidRows: dom.populatedBidRows,
        })}`);
      }
      if (representative.expects_order_draft && !dom.hasOrderDraftUi) {
        throw new Error('order-safe-ticket: guarded order draft UI was not rendered');
      }
      if (dom.realtimeErrorCount !== 0) {
        throw new Error(`${representative.recipe_id}: fixture success state rendered a realtime error banner`);
      }
      if (dom.genericRawPrimary && !representative.primary_expected) {
        throw new Error(`${representative.recipe_id}: generic raw primary survived Task Canvas boundary`);
      }
      for (const section of expectedVisibleSections) {
        const primitive = dom.primitiveSections.find((item) => item.sectionId === section.section_id);
        if (!primitive) throw new Error(`${representative.recipe_id}: ${section.section_id} primitive missing`);
        const expectsValues = (section.fields || []).some((field) => Object.prototype.hasOwnProperty.call(field, 'value'));
        const expectsTable = Array.isArray(section.rows) && section.rows.length > 0;
        if (expectsValues && primitive.metricCount === 0 && !expectsTable) {
          throw new Error(`${representative.recipe_id}: ${section.section_id} semantic component value missing`);
        }
        if (expectsTable && !primitive.hasTable) {
          throw new Error(`${representative.recipe_id}: ${section.section_id} table component missing`);
        }
      }
      win.hide();
      win.show();
      win.focus();
      await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      win.webContents.invalidate();

      const capture = await captureRenderedPage(win);
      const png = capture.toPNG();
      const pixels = visualPixelReceipt(capture);
      if (pixels.varied_pixels < 100) {
        throw new Error(`${representative.recipe_id}: blank screenshot: ${JSON.stringify({ pixels, rect: dom.rect, style: dom.cardStyle })}`);
      }
      const file = `${fileSafe(representative.recipe_id)}.png`;
      fs.writeFileSync(path.join(ARTIFACT_DIR, file), png);
      results.push({
        recipe_id: representative.recipe_id,
        representative_operation: representative.operation_ref,
        board_surface: dom.boardSurface,
        board_id: dom.boardId,
        semantic_workspace_mounted: dom.semanticWorkspaceMounted,
        expected_sections: expectedSections,
        rendered_sections: dom.sections,
        rendered_components: dom.primitiveSections,
        semantic_value_count: dom.valueCount,
        sample_values: dom.values,
        raw_detail_sheet_mounted: dom.rawMounted,
        technical_text_or_attribute_found: Boolean(dom.forbiddenAccessibleText || dom.forbiddenDomAttribute || dom.forbiddenText),
        primary_renderer_preserved: representative.primary_expected
          ? (representative.recipe_id === 'instrument-chart'
            ? dom.hasChartPrimary
            : representative.recipe_id === 'live-orderbook' ? dom.hasOrderbookPrimary : dom.hasOrderDraftUi)
          : null,
        candle_count: representative.expected_candle_count || null,
        populated_orderbook_sides: representative.expects_two_sided_orderbook
          ? { ask_rows: dom.populatedAskRows, bid_rows: dom.populatedBidRows } : null,
        order_draft_ui_rendered: representative.expects_order_draft ? dom.hasOrderDraftUi : null,
        integrated_realtime_error_count: dom.realtimeErrorCount,
        screenshot: file,
        screenshot_sha256: sha256(png),
        screenshot_dimensions: capture.getSize(),
        screenshot_pixels: pixels,
      });
    }
    const failureRepresentative = bundle.representatives.find((item) => item.recipe_id === 'discovery-value');
    failureStateRegression = await verifyFailureState(win, failureRepresentative);
    if (!failureStateRegression.errorStateMounted || failureStateRegression.dataTableMounted
      || failureStateRegression.semanticWorkspaceMounted) {
      throw new Error(`failure state exposed a data surface: ${JSON.stringify(failureStateRegression)}`);
    }
    // 좁은 창 회귀는 두 경로를 다 잰다 — 의미 작업대가 서는 카드(order-safe-ticket)와
    // Paper 보드로 그려지는 카드(discovery-value). 작업대 대표만 재면 보드 카드의
    // 오버플로·탭 타깃 단언이 대상 0개로 무조건 참이 된다(2026-09-06 검수 발견).
    narrowWindowRegression = [];
    for (const recipeId of ['order-safe-ticket', 'discovery-value']) {
      const narrowWindowRepresentative = bundle.representatives.find((item) => item.recipe_id === recipeId);
      narrowWindowRegression.push(await verifyNarrowWindow(win, narrowWindowRepresentative));
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }

  const receipt = {
    generated_at: new Date().toISOString(),
    fixture_only: true,
    external_calls_allowed: false,
    live_kiwoom_connectivity_verified: false,
    scope: {
      backend_canonical_operations: bundle.operation_count,
      backend_wire_occurrences: bundle.wire_occurrence_count,
      backend_unique_wire_paths: bundle.unique_wire_path_count,
      electron_recipe_representatives: results.length,
    },
    blocked_external_requests: blockedExternalRequests,
    fixture_realtime_policy: {
      mode: 'disabled-success',
      integrated_realtime_error_count: results.reduce((total, item) => total + item.integrated_realtime_error_count, 0),
      live_registration_attempted: false,
    },
    failure_state_regression: failureStateRegression,
    technical_or_routing_token_count: results.filter((item) => item.technical_text_or_attribute_found).length,
    narrow_window_regression: narrowWindowRegression,
    recipes: results,
  };
  const receiptPath = path.join(ARTIFACT_DIR, 'receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ receipt: receiptPath, screenshots: results.length })}\n`);
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });

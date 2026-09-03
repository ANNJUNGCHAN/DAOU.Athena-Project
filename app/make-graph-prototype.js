'use strict';

/**
 * 그래프 상호작용 프로토타입 생성기 — Neo4j Browser 방식(물리를 계속 켜 둔 라이브
 * 시뮬레이션)을 Athena의 **진짜 성향 그래프**에 얹어 본다.
 *
 * 제품 코드는 한 줄도 안 건드린다. 하는 일은 셋뿐이다:
 *   ① `seed_long_term_etf_persona.py`로 임시 브레인 DB를 씨앗한다(호스트 브레인 무관).
 *   ② 백엔드를 잠깐 띄워 `cluster-map`과 `surprising-connections`를 받아온다.
 *   ③ 그 데이터를 **인라인으로 박은** 자체 완결 HTML을 쓴다(file://로 열려야 하므로
 *      fetch를 쓰지 않는다 — file:// 교차출처 차단에 걸린다).
 *
 * **Graphify판에서 무엇을 바꿨나.** 처음엔 `graphify/exporters/html.py`를 그대로
 * 옮겼다 — 안정화 200회 후 `physics: {enabled: false}`. 그 한 줄이 "굳은 그림"과
 * "살아 있는 그림"을 가른다. Neo4j Browser는 물리를 끄지 않는다: 노드를 끌면 이웃이
 * 딸려오고, 놓으면 다시 자리를 찾아 흔들린다. 여기서는 그쪽을 따른다.
 * 화면에서 토글로 두 방식을 직접 비교할 수 있게 뒀다 — 어느 쪽이 옳은지는 만져 보고
 * 정할 문제라서다.
 *
 * 실행: cd app && node make-graph-prototype.js
 */

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const SEED_SCRIPT = path.join(BACKEND_DIR, 'scripts', 'seed_long_term_etf_persona.py');
const OUT_DIR = path.join(REPO_DIR, 'artifacts', 'graph-proto');
const OUT_HTML = path.join(OUT_DIR, 'graph-prototype.html');
const READY_TIMEOUT_MS = 60_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(url, token) {
  const started = Date.now();
  let lastError = 'no attempt';
  while (Date.now() - started < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${url}/api/v1/brain/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const body = await res.json();
        if (body.ready) return body;
        lastError = `not ready: ${JSON.stringify(body)}`;
      } else lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await wait(400);
  }
  throw new Error(`backend never became ready: ${lastError}`);
}

async function getJson(url, token, pathname, params) {
  const target = new URL(`${url}${pathname}`);
  for (const [k, v] of Object.entries(params || {})) target.searchParams.set(k, String(v));
  const res = await fetch(target, {
    // cluster-map은 모델 노출 대상이 아니라는 헤더 검사가 있다 — 셸과 같은 호출자로 신원을 밝힌다.
    headers: { Authorization: `Bearer ${token}`, 'X-Athena-Caller': 'shell' },
  });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  if (!fs.existsSync(PYTHON_EXE)) throw new Error(`backend venv이 없다: ${PYTHON_EXE}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-graph-proto-'));
  const brainDbPath = path.join(tempRoot, 'brain.sqlite3');
  const port = await reserveLoopbackPort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('hex');

  process.stdout.write('[1/4] 성향 그래프 씨앗 중...\n');
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (seeded.status !== 0) throw new Error(`씨앗 실패: ${seeded.stderr || seeded.stdout}`);
  const seedStats = JSON.parse(seeded.stdout);

  process.stdout.write(`[2/4] 백엔드 기동 중 (${backendUrl})...\n`);
  const backend = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app', '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
  ], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONPATH: BACKEND_DIR,
      ATHENA_LOCAL_BEARER_TOKEN: token,
      ATHENA_BRAIN_ENABLED: 'true',
      ATHENA_BRAIN_DB_PATH: brainDbPath,
      ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
      ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
      ATHENA_ROUTINES_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const backendLog = [];
  backend.stdout.on('data', (c) => backendLog.push(String(c)));
  backend.stderr.on('data', (c) => backendLog.push(String(c)));

  try {
    await waitForReady(backendUrl, token);
    process.stdout.write('[3/4] 그래프 받아오는 중...\n');
    const clusterMap = await getJson(backendUrl, token, '/api/v1/brain/analysis/cluster-map');
    const surprising = await getJson(backendUrl, token, '/api/v1/brain/analysis/surprising-connections', { limit: 50 });

    process.stdout.write('[4/4] HTML 쓰는 중...\n');
    const data = {
      seed: seedStats,
      revision: clusterMap.revision,
      nodes: clusterMap.nodes,
      edges: clusterMap.edges,
      edgeDetails: clusterMap.edge_details || [],
      cohesion: clusterMap.cluster_cohesion || {},
      representativeLabels: clusterMap.cluster_representative_labels || {},
      aiLabels: clusterMap.cluster_ai_labels || {},
      surprising: surprising.connections || [],
    };
    fs.writeFileSync(OUT_HTML, renderHtml(data), 'utf8');

    process.stdout.write(`\n완료: ${OUT_HTML}\n`);
    process.stdout.write(`  노드 ${data.nodes.length} · 엣지 ${data.edges.length} · 군집 ${new Set(data.nodes.map((n) => n.cluster)).size} · 숨은 연관 ${data.surprising.length}\n`);
  } catch (error) {
    process.stderr.write(`\n--- backend log tail ---\n${backendLog.join('').slice(-2000)}\n`);
    throw error;
  } finally {
    try { backend.kill(); } catch { /* 이미 죽었다 */ }
  }
}

// ── HTML ────────────────────────────────────────────────────────────────────
// Neo4j Browser의 화면 문법을 따른다: 캡션이 원 **안에** 있고, 엣지에 **관계 이름과
// 화살표**가 붙고, 라벨(여기서는 테마 군집) 칩이 위쪽에 줄지어 있고, 물리가 계속
// 돌아 노드를 끌면 이웃이 딸려온다. 의미론은 Athena 것을 쓴다 — 엣지 색은
// **확정성 3종**(사실/추론/불확실), 군집 경계를 넘는 엣지는 **숨은 연관**이다.
function renderHtml(data) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Athena 성향 그래프 — Neo4j 방식 프로토타입</title>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"
        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"
        crossorigin="anonymous"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #14181f; color: #e6edf3;
               font: 13px/1.5 "Pretendard", "Malgun Gothic", system-ui, sans-serif; }
  #graph { position: absolute; inset: 0; }

  /* 라벨 칩 줄 — Neo4j Browser 상단의 그것. 클릭하면 그 군집이 사라졌다 나타난다. */
  #labels { position: absolute; top: 12px; left: 12px; right: 360px; display: flex;
            flex-wrap: wrap; gap: 6px; z-index: 5; }
  .chip { padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 600;
          color: #14181f; cursor: pointer; user-select: none; white-space: nowrap;
          border: 2px solid transparent; transition: opacity .12s; }
  .chip.off { opacity: .3; }
  .chip small { font-weight: 400; opacity: .75; margin-left: 4px; }

  /* 컨트롤 — 여기가 이 프로토타입의 요점이다. 물리를 켜고 끄며 두 방식을 비교한다. */
  #controls { position: absolute; left: 12px; bottom: 12px; z-index: 5;
              background: rgba(10,13,18,.92); border: 1px solid #2a323d; border-radius: 10px;
              padding: 12px 14px; width: 268px; backdrop-filter: blur(6px); }
  #controls h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: .06em; color: #7d8590;
                 text-transform: uppercase; }
  .ctl { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
  .ctl input { accent-color: #68bdf6; cursor: pointer; }
  .ctl span { font-size: 12px; }
  .btns { display: flex; gap: 6px; margin-top: 10px; }
  button { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #2a323d;
           background: #1b212b; color: #e6edf3; font-size: 12px; cursor: pointer; font-family: inherit; }
  button:hover { background: #253040; }
  .hint { font-size: 11px; color: #6e7681; margin-top: 9px; line-height: 1.45; }

  /* 오른쪽 패널 — Neo4j의 노드 인스펙터. */
  #panel { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 336px; z-index: 5;
           background: rgba(10,13,18,.94); border: 1px solid #2a323d; border-radius: 10px;
           padding: 16px; overflow-y: auto; backdrop-filter: blur(6px); }
  #panel h1 { font-size: 14px; margin: 0 0 2px; }
  #panel .sub { font-size: 11px; color: #6e7681; margin: 0 0 14px; }
  #search { width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid #2a323d;
            background: #14181f; color: #e6edf3; font-size: 13px; font-family: inherit; }
  #search-results div { padding: 5px 8px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  #search-results div:hover { background: #253040; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7d8590;
       margin: 18px 0 7px; }
  .empty { color: #6e7681; font-style: italic; font-size: 12px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
         border-bottom: 1px solid #1e242d; font-size: 12px; }
  .row span:first-child { color: #7d8590; flex: none; }
  .rel { padding: 5px 0; border-bottom: 1px solid #1e242d; font-size: 12px; }
  .pill { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 10px;
          background: #1e242d; }
  .line { width: 22px; height: 0; flex: none; }
  .legend-item { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 12px; }
</style>
</head>
<body>
<div id="graph"></div>
<div id="labels"></div>

<div id="controls">
  <h4>움직임</h4>
  <label class="ctl"><input type="checkbox" id="physics" checked><span>물리 켜기 <b>(Neo4j 방식)</b></span></label>
  <label class="ctl"><input type="checkbox" id="pin" checked><span>드래그한 노드 고정</span></label>
  <label class="ctl"><input type="checkbox" id="relLabels" checked><span>관계 이름 표시</span></label>
  <label class="ctl"><input type="checkbox" id="sizeByDegree" checked><span>크기 = 연결 수</span></label>
  <div class="btns">
    <button id="shake">다시 흔들기</button>
    <button id="reset">전체 복원</button>
  </div>
  <div class="hint">노드를 <b>끌어</b> 보세요 — 물리가 켜져 있으면 이웃이 딸려옵니다.<br>
    <b>더블클릭</b>하면 그 노드와 이웃만 남깁니다.<br>
    끄면 Graphify 방식(안정화 후 동결)이 됩니다.</div>
</div>

<div id="panel">
  <h1>성향 그래프 — Neo4j 방식</h1>
  <p class="sub">vis-network 9.1.6 · barnesHut · 물리 상시 가동</p>
  <input id="search" type="text" placeholder="노드 검색..." autocomplete="off">
  <div id="search-results"></div>
  <h3>노드 정보</h3>
  <div id="info"><span class="empty">노드를 클릭하세요</span></div>
  <h3>엣지</h3>
  <div id="edge-legend"></div>
  <h3>통계</h3>
  <div id="stats"></div>
</div>

<script>
const DATA = ${JSON.stringify(data)};

// Neo4j Browser의 기본 라벨 팔레트. 군집 번호가 결정적이라 색도 결정적이다.
const PALETTE = ['#FFC454','#68BDF6','#6DCE9E','#FF756E','#DE9BF9','#FB95AF','#A5ABB6','#F79767','#57C7E3','#8DCC93'];
const clusterColor = (c) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length];

// 확정성 3종 — 제품 화면의 엣지 인코딩과 같은 축.
const CONFIDENCE = {
  EXTRACTED: { label: '사실', color: '#6DCE9E', dashes: false },
  INFERRED:  { label: '추론', color: '#68BDF6', dashes: [6, 4] },
  AMBIGUOUS: { label: '불확실', color: '#FFC454', dashes: [2, 4] },
};
const HIDDEN_COLOR = '#DE9BF9'; // 군집 경계를 넘는 연결 = 숨은 연관.
const SEP = '\\u0000';

const nodeById = new Map(DATA.nodes.map((n) => [n.entity_id, n]));
const detailByPair = new Map();
for (const d of DATA.edgeDetails) detailByPair.set(d.source + SEP + d.target, d);
const surpriseByPair = new Map();
for (const s of DATA.surprising) surpriseByPair.set([s.source_entity_id, s.target_entity_id].sort().join(SEP), s);
const detailFor = (a, b) => detailByPair.get(a + SEP + b) || detailByPair.get(b + SEP + a) || {};
const clusterLabel = (c) => DATA.aiLabels[c] || DATA.representativeLabels[c] || ('군집 ' + c);
const maxDegree = Math.max(1, ...DATA.nodes.map((n) => n.degree));

// 관계 이름 — Neo4j의 relationship type 자리. edge_details.kinds가 그 값이다.
function relName(detail) {
  return detail.kinds && detail.kinds.length ? detail.kinds.join(' · ') : '';
}

function buildNode(n, opts) {
  const color = clusterColor(n.cluster);
  const base = {
    id: n.entity_id,
    label: n.name,
    color: { background: color, border: color,
             highlight: { background: color, border: '#ffffff' },
             hover: { background: color, border: '#ffffff' } },
    borderWidth: 2, borderWidthSelected: 4,
    title: n.name + '\\n' + clusterLabel(n.cluster) + ' · 연결 ' + n.degree + '개',
  };
  if (opts.sizeByDegree) {
    // 연결 수를 크기로 — 정보는 늘지만 캡션이 원 밖으로 나간다.
    return Object.assign(base, { shape: 'dot', value: n.degree,
      font: { color: '#e6edf3', size: 12, strokeWidth: 3, strokeColor: '#14181f' } });
  }
  // Neo4j 기본형: 캡션이 원 안에, 크기는 균일(캡션 길이에만 반응).
  return Object.assign(base, { shape: 'circle', widthConstraint: { maximum: 84 },
    font: { color: '#14181f', size: 12, face: 'inherit', bold: { color: '#14181f' } } });
}

function buildEdge([a, b], i, opts) {
  const detail = detailFor(a, b);
  const crossing = (nodeById.get(a) || {}).cluster !== (nodeById.get(b) || {}).cluster;
  const conf = CONFIDENCE[detail.confidence] || CONFIDENCE.AMBIGUOUS;
  const surprise = surpriseByPair.get([a, b].sort().join(SEP));
  return {
    id: i, from: a, to: b,
    label: opts.relLabels ? relName(detail) : undefined,
    color: { color: crossing ? HIDDEN_COLOR : conf.color,
             opacity: crossing ? 0.95 : 0.55, highlight: '#ffffff' },
    dashes: conf.dashes,
    width: crossing ? 2.5 : 1.2,
    arrows: { to: { enabled: true, scaleFactor: 0.55, type: 'arrow' } },
    font: { color: '#8b949e', size: 10, strokeWidth: 4, strokeColor: '#14181f', align: 'horizontal' },
    title: (nodeById.get(a) || {}).name + ' → ' + (nodeById.get(b) || {}).name
         + '\\n' + conf.label + (crossing ? ' · 숨은 연관' : '')
         + (surprise ? ' · 놀라움 ' + surprise.surprise_score.toFixed(2) : '')
         + (relName(detail) ? '\\n' + relName(detail) : ''),
  };
}

// 기본값은 사용자가 승인한 조합이다(2026-09-02): 물리 상시 가동 · 드래그 고정 ·
// 관계 이름 · 크기=연결 수. 크기 인코딩을 켜면 캡션이 원 밖으로 나가지만(Neo4j의
// 균일 원과 다르다), 지금 제품이 쓰는 축(원 크기 = 연결 수)을 잃지 않는 쪽을 골랐다.
const opts = { relLabels: true, sizeByDegree: true };
const nodes = new vis.DataSet(DATA.nodes.map((n) => buildNode(n, opts)));
const edges = new vis.DataSet(DATA.edges.map((pair, i) => buildEdge(pair, i, opts)));

// **물리 설정이 이 프로토타입의 요점이다.**
//  - stabilization: false  → 안정화를 미리 다 돌리지 않는다. 열자마자 그래프가
//    가운데에서 풀려나며 자리를 잡는 것이 보인다(Neo4j를 열었을 때의 그 움직임).
//  - 그리고 **끄지 않는다.** 드래그가 이웃을 끌고, 놓으면 다시 흔들린다.
const PHYSICS = {
  enabled: true,
  solver: 'barnesHut',
  // 척력을 세게 두면 엣지가 없는 노드(여기 40개 중 여럿)가 화면 밖까지 밀려나고,
  // 그걸 담으려고 fit이 축소돼 캡션이 안 읽힌다(실측). 중력을 올려 뭉치게 한다.
  barnesHut: { gravitationalConstant: -4000, centralGravity: 0.6, springLength: 100,
               springConstant: 0.06, damping: 0.5, avoidOverlap: 0.6 },
  stabilization: false,
  minVelocity: 0.4,
};

const network = new vis.Network(document.getElementById('graph'), { nodes, edges }, {
  nodes: { scaling: { min: 12, max: 40 } },
  edges: { smooth: { type: 'dynamic' }, selectionWidth: 2 },
  physics: PHYSICS,
  interaction: { hover: true, tooltipDelay: 150, dragNodes: true, multiselect: true, keyboard: false },
});

// 첫 정착에 한 번만 화면에 맞춘다. stabilization:false라 vis가 대신 fit해 주지
// 않는다 — 안 하면 열자마자 그래프가 화면 밖으로 걸어 나간다(실측). 이후의 fit은
// 사용자가 맞춰 둔 줌을 뺏는 것이라 하지 않는다.
let fitted = false;
function fitOnce() {
  if (fitted) return;
  fitted = true;
  network.fit({ animation: { duration: 600 } });
  // fit이 캡션을 못 읽을 만큼 축소했으면 되돌린다 — 노드 몇 개를 잘라 내는 편이
  // 전부 못 읽는 것보다 낫다.
  setTimeout(() => {
    const scale = network.getScale();
    if (scale < 0.75) network.moveTo({ scale: 0.75, animation: { duration: 300 } });
  }, 650);
}
network.on('stabilized', fitOnce);
setTimeout(fitOnce, 3500);

// ── 컨트롤 ───────────────────────────────────────────────────────────────
const physicsBox = document.getElementById('physics');
physicsBox.addEventListener('change', () => {
  if (physicsBox.checked) {
    network.setOptions({ physics: PHYSICS });
  } else {
    // Graphify 방식 — 지금 자리에서 얼린다.
    network.setOptions({ physics: { enabled: false } });
  }
});

const pinBox = document.getElementById('pin');
network.on('dragEnd', (params) => {
  if (!pinBox.checked || !params.nodes.length) return;
  // Neo4j Browser처럼 끌어다 놓은 노드를 그 자리에 둔다.
  //
  // **fixed:true가 아니라 physics:false다.** 처음엔 fixed를 썼는데, 그러면
  // 노드가 시뮬레이션에서만 빠지는 게 아니라 **다시는 끌 수 없게 된다** — vis의
  // 드래그 핸들러가 fixed인 축의 좌표를 갱신하지 않는다. 화면 끝으로 밀어둔 노드를
  // 도로 끌어올 방법이 사라진다(실측). 문서가 physics를 이렇게 정의한다:
  // "the node is not part of the physics simulation. It will not move except for
  // from manual dragging." 우리가 원한 것이 정확히 그것이다.
  nodes.update(params.nodes.map((id) => ({ id, physics: false })));
});
pinBox.addEventListener('change', () => {
  if (pinBox.checked) return;
  // 체크를 끄면 이미 박아둔 것도 함께 푼다 — 체크만 풀리고 노드는 굳은 채로
  // 남으면 되돌릴 길이 화면에 「전체 복원」밖에 없고, 그건 배치를 통째로 버린다.
  nodes.update(DATA.nodes.map((n) => ({ id: n.entity_id, physics: true })));
});

function rebuild() {
  nodes.update(DATA.nodes.filter((n) => !hiddenClusters.has(n.cluster)).map((n) => buildNode(n, opts)));
  edges.update(DATA.edges.map((pair, i) => buildEdge(pair, i, opts)));
}
document.getElementById('relLabels').addEventListener('change', (e) => {
  opts.relLabels = e.target.checked;
  edges.update(DATA.edges.map((pair, i) => buildEdge(pair, i, opts)));
});
document.getElementById('sizeByDegree').addEventListener('change', (e) => {
  opts.sizeByDegree = e.target.checked;
  rebuild();
});

document.getElementById('shake').addEventListener('click', () => {
  // 고정을 풀고 위치를 흩은 뒤 다시 시뮬레이션 — "동적인 움직임"을 다시 본다.
  nodes.update(DATA.nodes.map((n) => ({ id: n.entity_id, physics: true,
    x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 600 })));
  physicsBox.checked = true;
  network.setOptions({ physics: PHYSICS });
  fitted = false;
  network.once('stabilized', fitOnce);
});

document.getElementById('reset').addEventListener('click', () => {
  hiddenClusters.clear();
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('off'));
  nodes.update(DATA.nodes.map((n) => Object.assign(buildNode(n, opts), { hidden: false, physics: true })));
  network.unselectAll();
  document.getElementById('info').innerHTML = '<span class="empty">노드를 클릭하세요</span>';
  network.fit({ animation: { duration: 500 } });
});

// ── 더블클릭 = 이웃만 남기기 (Neo4j의 확장/축소 감각) ────────────────────
network.on('doubleClick', (params) => {
  if (!params.nodes.length) return;
  const id = params.nodes[0];
  const keep = new Set([id]);
  for (const eid of network.getConnectedEdges(id)) {
    const e = edges.get(eid);
    keep.add(e.from === id ? e.to : e.from);
  }
  nodes.update(DATA.nodes.map((n) => ({ id: n.entity_id, hidden: !keep.has(n.entity_id) })));
});

// ── 노드 클릭 → 정보 패널 ────────────────────────────────────────────────
const info = document.getElementById('info');
network.on('click', (params) => {
  if (!params.nodes.length) { info.innerHTML = '<span class="empty">노드를 클릭하세요</span>'; return; }
  showNode(params.nodes[0], false);
});

function showNode(id, focus) {
  const n = nodeById.get(id);
  if (!n) return;
  const rows = network.getConnectedEdges(id).map((eid) => {
    const e = edges.get(eid);
    const otherId = e.from === id ? e.to : e.from;
    const other = nodeById.get(otherId) || { name: otherId, cluster: -1 };
    const detail = detailFor(e.from, e.to);
    const conf = CONFIDENCE[detail.confidence] || CONFIDENCE.AMBIGUOUS;
    const crossing = other.cluster !== n.cluster;
    return '<div class="rel"><b>' + other.name + '</b> '
         + '<span class="pill" style="color:' + conf.color + '">' + conf.label + '</span>'
         + (crossing ? ' <span class="pill" style="color:' + HIDDEN_COLOR + '">숨은 연관</span>' : '')
         + (relName(detail) ? '<br><span style="color:#6e7681">' + relName(detail) + '</span>' : '')
         + '</div>';
  });
  info.innerHTML =
      '<div style="font-size:15px;font-weight:600;margin-bottom:6px">' + n.name + '</div>'
    + '<div class="row"><span>종류</span><span>' + (n.kind || '—') + '</span></div>'
    + '<div class="row"><span>군집</span><span>' + clusterLabel(n.cluster) + '</span></div>'
    + '<div class="row"><span>연결 수</span><span>' + n.degree + '</span></div>'
    + '<h3>관계 ' + rows.length + '개</h3>' + rows.join('');
  network.selectNodes([id]);
  if (focus) network.focus(id, { scale: 1.1, animation: { duration: 450 } });
}

// ── 검색 ────────────────────────────────────────────────────────────────
const search = document.getElementById('search');
const results = document.getElementById('search-results');
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  if (!q) { results.innerHTML = ''; return; }
  const hits = DATA.nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 8);
  results.innerHTML = hits.length
    ? hits.map((n) => '<div data-id="' + n.entity_id + '">' + n.name + '</div>').join('')
    : '<div class="empty">없음</div>';
});
results.addEventListener('click', (e) => {
  const id = e.target.getAttribute('data-id');
  if (id) { showNode(id, true); search.value = ''; results.innerHTML = ''; }
});

// ── 라벨 칩 (Neo4j 상단 줄) ──────────────────────────────────────────────
const clusters = [...new Set(DATA.nodes.map((n) => n.cluster))].sort((a, b) => a - b);
const hiddenClusters = new Set();
const labels = document.getElementById('labels');
labels.innerHTML = clusters.map((c) => {
  const size = DATA.nodes.filter((n) => n.cluster === c).length;
  const coh = DATA.cohesion[c];
  return '<span class="chip" data-cluster="' + c + '" style="background:' + clusterColor(c) + '">'
       + clusterLabel(c) + '<small>' + size + (coh != null ? ' · 응집 ' + Number(coh).toFixed(2) : '') + '</small></span>';
}).join('');
labels.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const c = Number(chip.getAttribute('data-cluster'));
  if (hiddenClusters.has(c)) hiddenClusters.delete(c); else hiddenClusters.add(c);
  chip.classList.toggle('off', hiddenClusters.has(c));
  nodes.update(DATA.nodes.filter((n) => n.cluster === c)
    .map((n) => ({ id: n.entity_id, hidden: hiddenClusters.has(c) })));
});

document.getElementById('edge-legend').innerHTML =
  Object.values(CONFIDENCE).map((c) =>
    '<div class="legend-item"><span class="line" style="border-top:2px ' + (c.dashes ? 'dashed' : 'solid') + ' ' + c.color + '"></span><span>' + c.label + '</span></div>').join('')
  + '<div class="legend-item"><span class="line" style="border-top:3px solid ' + HIDDEN_COLOR + '"></span><span>숨은 연관(군집 경계 넘음)</span></div>';

const crossingCount = DATA.edges.filter(([a, b]) =>
  (nodeById.get(a) || {}).cluster !== (nodeById.get(b) || {}).cluster).length;
document.getElementById('stats').innerHTML =
    '<div class="row"><span>엔티티</span><span>' + DATA.nodes.length + '</span></div>'
  + '<div class="row"><span>관계</span><span>' + DATA.edges.length + '</span></div>'
  + '<div class="row"><span>군집</span><span>' + clusters.length + '</span></div>'
  + '<div class="row"><span>숨은 연관</span><span>' + crossingCount + '</span></div>'
  + '<div class="row"><span>리비전</span><span>' + DATA.revision + '</span></div>';
</script>
</body>
</html>
`;
}

main().catch((error) => {
  process.stderr.write(`${String((error && error.stack) || error)}\n`);
  process.exit(1);
});

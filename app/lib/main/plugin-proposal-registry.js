'use strict';

const crypto = require('node:crypto');

// 플러그인 승인 제안의 게이트·1회용 소비·실행 순서를 소유하는 순수 모듈.
// **electron도 main.js도 require하지 않는다** — 프로덕션에서는 main.js가
// mcpCli를, verify-plugins.js는 같은 mcpCli를 직접 주입한다. 그래서 검증
// 스크립트가 승인 경로를 그대로 재현할 수 있다.
//
// 게이트가 여기 있는 이유: 승인 인자가 봉투 전체라 `source`는 자기 신고다.
// 권위 검증의 자리는 승인 경로이되, 코드의 거처는 이 한 파일이다(백엔드
// plugin_tools.py의 규칙을 그대로 옮겼다 — 두 곳이 같은 규칙을 말한다).
//
// probe는 이 모듈의 apply 안에 없다. 런타임이 켜진 빌드에서 apply()는
// fenceAndStop 직후 구간이라 그 안에서 upstream 서버를 띄우면 펜스가 오염된다.
// 호출자가 apply 반환 뒤에 probe()를 부른다.
//
// 사용자에게 보이는 실패 문구는 전부 이 파일이 정한다. 파이썬 CLI가 낸 원문은
// 반말이고 내부어가 섞여 있어 화면에 그대로 낼 수 없다 — detail로 따로 실어
// 호출자가 로그에만 쓴다.

const ACTIONS = Object.freeze([
  'install', 'allow_tools', 'revoke_tools', 'set_enabled', 'remove', 'stage_snippet',
]);

// 플러그인이 **아닌** 내장 기능의 별칭. 키움 시세·주문·계좌와 투자의 뇌는
// 아테나 자신의 기능이라 설치·삭제·권한 변경의 대상이 아니다.
const BLOCKED_ALIASES = new Set(['kiwoom', 'kiwoom-selector', 'kiwoom-mcp', 'brain', 'athena']);

const BLOCKED_MESSAGE = '아테나 기본 기능이라 여기서 다룰 수 없습니다';
const MAX_ALIAS_LEN = 28;
const NON_PACKAGE_ARGS = new Set(['-y', '--yes', '-q', '--quiet', 'run', 'exec', '--']);

// 소비 기록과 대기 목록의 상한. 앱을 오래 켜둬도 무한히 자라지 않게 오래된
// 것부터 버린다 — 소비 기록은 한 세션 안의 재승인만 막으면 되고, 대기 목록은
// 창 복원용이라 스무 장을 넘겨 보관할 이유가 없다.
const MAX_TRACKED = 20;

function isBlockedAlias(alias) {
  const name = String(alias == null ? '' : alias).trim().toLowerCase();
  if (!name) return false;
  return BLOCKED_ALIASES.has(name) || name.startsWith('kiwoom') || name === 'brain';
}

// 스니펫 파싱 규칙도 백엔드와 같다 — 서버는 한 개만 담는다.
function sanitizeAlias(raw) {
  const original = String(raw == null ? '' : raw);
  let cleaned = original.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  if (!cleaned) cleaned = 'server';
  if (cleaned.length <= MAX_ALIAS_LEN) return cleaned;
  const digest = crypto.createHash('sha1').update(original, 'utf8').digest('hex').slice(0, 6);
  return `${cleaned.slice(0, MAX_ALIAS_LEN - digest.length - 1)}-${digest}`;
}

// onboarding.py derive_alias()와 같은 별칭을 계산한다. 중복을 원문 키로만 보면
// `DART MCP`가 기존 `DART-MCP`를 피해 `DART-MCP-2`로 조용히 등록될 수 있다.
function deriveSnippetAlias(name, config) {
  const fromName = sanitizeAlias(name);
  if (fromName !== 'server') return fromName;
  const args = config && Array.isArray(config.args) ? config.args : [];
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const candidate = typeof args[i] === 'string' ? args[i] : '';
    if (!candidate || candidate.startsWith('-') || NON_PACKAGE_ARGS.has(candidate)) continue;
    const derived = sanitizeAlias(candidate);
    if (derived !== 'server') return derived;
  }
  return sanitizeAlias(config && typeof config.command === 'string' ? config.command : '');
}

function snippetAliases(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { aliases: [], error: '설정 내용이 비어 있습니다' };
  let data;
  try { data = JSON.parse(raw); } catch { return { aliases: [], error: '설정을 읽을 수 없습니다 — 형식을 확인해 주세요' }; }
  const servers = data && typeof data === 'object' ? data.mcpServers : null;
  if (!servers || typeof servers !== 'object') return { aliases: [], error: '설정에 등록할 내용이 없습니다' };
  const aliases = Object.entries(servers).map(([name, config]) => deriveSnippetAlias(name, config));
  if (!aliases.length) return { aliases: [], error: '설정에 등록할 내용이 없습니다' };
  if (aliases.length > 1) return { aliases: [], error: '한 번에 하나만 등록합니다' };
  return { aliases, error: null };
}

function installSnippet(entry) {
  return JSON.stringify({
    mcpServers: { [entry.id]: { command: entry.command, args: [...entry.args] } },
  });
}

// 원문은 사람에게 보이지 않는다 — detail로만 옮긴다(모듈 상단 주석 참고).
function fail(outcome, message) {
  const raw = outcome && typeof outcome.error === 'string' ? outcome.error.trim() : '';
  return { ok: false, error: message, detail: raw || null, alias: null };
}

function trimOldest(collection) {
  while (collection.size > MAX_TRACKED) {
    collection.delete(collection.keys().next().value);
  }
}

function createPluginProposalRegistry({ executor, catalog = [] } = {}) {
  if (!executor) throw new TypeError('plugin proposal registry: executor required');
  const catalogById = new Map((catalog || []).map((entry) => [entry.id, entry]));
  const consumed = new Set();
  const pendingById = new Map();

  function installedAliases() {
    const listed = executor.list();
    return new Set(((listed && listed.servers) || []).map((server) => server.alias));
  }

  // 게이트 4종 — 차단 별칭 · install 카탈로그/중복 검사 · 나머지 넷의 등록
  // 멤버십 · stage_snippet 파싱. 하나라도 걸리면 실행을 시작조차 하지 않는다.
  function gate(envelope) {
    const actions = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
    if (!actions.length) return { ok: false, error: '승인할 내용이 없습니다' };
    let installed = null;
    const installedNow = () => {
      if (installed === null) installed = installedAliases();
      return installed;
    };
    const plannedAdditions = new Set();
    for (const action of actions) {
      const kind = action && action.action;
      if (!ACTIONS.includes(kind)) return { ok: false, error: '다룰 수 없는 요청입니다' };
      if (kind === 'stage_snippet') {
        // 직접 등록은 설정 안의 이름이 별칭을 정한다 — 대상을 따로 받지 않는다.
        if (action.target !== null && action.target !== undefined && action.target !== '') {
          return { ok: false, error: '직접 등록에는 대상을 보내지 않습니다' };
        }
        const parsed = snippetAliases(action.snippet);
        if (parsed.error) return { ok: false, error: parsed.error };
        if (parsed.aliases.some(isBlockedAlias)) return { ok: false, error: BLOCKED_MESSAGE };
        const alias = parsed.aliases[0];
        const aliasKey = alias.toLowerCase();
        const existing = [...installedNow()].find((candidate) => String(candidate).toLowerCase() === aliasKey);
        if (existing) {
          return {
            ok: false,
            error: `'${existing}'은 이미 등록된 플러그인입니다. 기존 연결 설정과 권한을 확인해 주세요. 교체가 필요할 때만 기존 항목을 삭제한 뒤 다시 등록해 주세요`,
          };
        }
        if (plannedAdditions.has(aliasKey)) {
          return { ok: false, error: `'${alias}' 직접 등록이 같은 요청에 중복됩니다. 하나만 남겨 다시 시도해 주세요` };
        }
        plannedAdditions.add(aliasKey);
        continue;
      }
      const target = typeof action.target === 'string' ? action.target.trim() : '';
      if (!target) return { ok: false, error: '어떤 플러그인인지 알 수 없습니다' };
      if (isBlockedAlias(target)) return { ok: false, error: BLOCKED_MESSAGE };
      if (kind === 'install') {
        if (!catalogById.has(target)) return { ok: false, error: '추천 목록에 없어 설치할 수 없습니다' };
        const targetKey = target.toLowerCase();
        const existing = [...installedNow()].find((candidate) => String(candidate).toLowerCase() === targetKey);
        if (existing) return { ok: false, error: '이미 설치돼 있습니다' };
        if (plannedAdditions.has(targetKey)) {
          return { ok: false, error: `'${target}' 설치가 같은 요청에 중복됩니다. 하나만 남겨 다시 시도해 주세요` };
        }
        plannedAdditions.add(targetKey);
      } else if (!installedNow().has(target)) {
        return { ok: false, error: '설치돼 있지 않습니다' };
      }
    }
    return { ok: true, error: null };
  }

  // 원자적 등록·소비 — 자바스크립트 한 틱 안에서 끝나므로 두 번째 승인은
  // 실행이 시작되기 전에 거부된다. 묶음 단위로 한 번 소비한다(부분 소비 없음).
  function consume(envelope) {
    const id = envelope && envelope.proposal_id;
    if (typeof id !== 'string' || !id) return { ok: false, error: '처리할 수 없는 요청입니다' };
    if (consumed.has(id)) return { ok: false, error: '이미 처리한 요청입니다' };
    consumed.add(id);
    trimOldest(consumed);
    pendingById.delete(id);
    return { ok: true, error: null };
  }

  // 실행이 실패했으면 소비를 되돌린다 — 그러지 않으면 결과 턴의 다시 시도 칩이
  // 같은 봉투를 다시 보냈을 때 "이미 처리한 요청"으로 막힌다. 게이트에서 막힌
  // 봉투는 애초에 소비되지 않았으므로 이 함수를 부르지 않는다.
  function release(envelope) {
    const id = envelope && envelope.proposal_id;
    if (typeof id !== 'string' || !id) return false;
    return consumed.delete(id);
  }

  // 대기 목록은 **복원 전용**이다 — 승인 인자가 봉투 전체이므로 여기에 없어도
  // 승인은 정확하다. 등록 시점은 렌더러가 카드를 그린 뒤 보내는 한 지점뿐이다.
  function note(envelope) {
    const id = envelope && envelope.proposal_id;
    if (typeof id !== 'string' || !id) return false;
    if (consumed.has(id) || pendingById.has(id)) return false;
    pendingById.set(id, { envelope, at: Date.now() });
    trimOldest(pendingById);
    return true;
  }

  function pending() {
    const listed = executor.list();
    return {
      proposals: [...pendingById.values()].map((held) => held.envelope),
      revision: listed ? listed.revision : null,
    };
  }

  // 설치는 오늘도 한 동작의 내부 3단계다 — 등록 뒤 승인에서 실패하면 되돌린다.
  // 보상을 빼면 "등록됐지만 승인되지 않은 행"이 목록에 남는다.
  async function runInstall(action) {
    const entry = catalogById.get(action.target);
    const staged = await executor.stageSnippet(installSnippet(entry));
    const server = staged && staged.ok && Array.isArray(staged.staged) ? staged.staged[0] : null;
    if (!server) return fail(staged, '설치를 시작하지 못했습니다');
    const registered = await executor.register(server);
    if (!registered || !registered.ok) {
      await executor.remove(server.alias);
      return fail(registered, '설치하지 못했습니다');
    }
    const approved = await executor.approve(server.alias);
    if (!approved || !approved.ok) {
      await executor.remove(server.alias);
      return fail(approved, '설치하지 못했습니다');
    }
    return { ok: true, error: null, detail: null, alias: server.alias };
  }

  async function runTools(action, allowed) {
    const features = Array.isArray(action.features) ? action.features : [];
    if (!features.length) return { ok: false, error: '바꿀 기능이 없습니다', detail: null, alias: null };
    for (const feature of features) {
      const outcome = await executor.allowTool(action.target, feature, allowed);
      if (!outcome || !outcome.ok) return fail(outcome, '기능을 바꾸지 못했습니다');
    }
    return { ok: true, error: null, detail: null, alias: action.target };
  }

  async function runAction(action) {
    switch (action.action) {
      case 'install':
        return runInstall(action);
      case 'allow_tools':
        return runTools(action, true);
      case 'revoke_tools':
        return runTools(action, false);
      case 'set_enabled': {
        const outcome = action.enabled
          ? await executor.approve(action.target)
          : await executor.revoke(action.target);
        if (!outcome || !outcome.ok) return fail(outcome, '바꾸지 못했습니다');
        return { ok: true, error: null, detail: null, alias: action.enabled ? action.target : null };
      }
      case 'remove': {
        const outcome = await executor.remove(action.target);
        if (!outcome || !outcome.ok) return fail(outcome, '삭제하지 못했습니다');
        return { ok: true, error: null, detail: null, alias: null };
      }
      case 'stage_snippet': {
        const staged = await executor.stageSnippet(action.snippet);
        const server = staged && staged.ok && Array.isArray(staged.staged) ? staged.staged[0] : null;
        if (!server) return fail(staged, '등록하지 못했습니다');
        // 직접 등록은 등록까지만 하고 승인하지 않는다. 승인 전에는 서버가 뜨지
        // 않으므로(backend onboarding.py) 연결 확인 대상에서 뺀다 — 별칭을
        // 남기면 반드시 실패하는 확인을 돌려 화면이 거짓 실패를 그린다.
        return { ok: true, error: null, detail: null, alias: null };
      }
      default:
        return { ok: false, error: '다룰 수 없는 요청입니다', detail: null, alias: null };
    }
  }

  // 개별 동작 실패를 예외나 ok:false로 올리지 않는다 — 런타임이 켜진 빌드에서
  // 그러면 코디네이터가 fenceAndStop 뒤 catch로 빠져 상주 세션이 멈춘 채 남는다.
  // 시퀀스는 첫 실패에서 멈추고, 앞서 성공한 동작은 되돌리지 않는다.
  async function apply(envelope) {
    const actions = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
    const results = [];
    const aliases = [];
    for (const action of actions) {
      const outcome = await runAction(action);
      results.push({
        action: action.action,
        target: outcome.alias || action.target || null,
        ok: outcome.ok,
        error: outcome.ok ? null : outcome.error,
        detail: outcome.detail || null,
      });
      if (!outcome.ok) break;
      if (outcome.alias) aliases.push(outcome.alias);
    }
    return { ok: true, results, probeAliases: [...new Set(aliases)] };
  }

  // 승인 반환 뒤에 부른다. 여기서 센 도구 수가 결과 턴의 기능 개수 줄이 된다.
  async function probe(aliases) {
    const reports = [];
    for (const alias of aliases || []) {
      const report = await executor.probe(alias);
      if (report && report.ok) {
        reports.push({
          alias,
          ok: true,
          toolCount: Array.isArray(report.tools) ? report.tools.length : 0,
          error: null,
          detail: null,
        });
      } else {
        const failed = fail(report, '연결을 확인하지 못했습니다');
        reports.push({ alias, ok: false, toolCount: 0, error: failed.error, detail: failed.detail });
      }
    }
    return reports;
  }

  // 승인 한 번의 순서를 소유하는 유일한 함수 — main.js도 verify-plugins.js도
  // 이것을 부른다(두 곳이 순서를 각자 적으면 검증이 앱과 다른 것을 잰다).
  // ⑴게이트 → ⑵원자 소비 → ⑶판번호 대조 → ⑷실행 → ⑸연결 확인, 실패면 소비 되돌림.
  // `runMutation`은 런타임이 켜진 빌드에서 실행을 조정자로 감싸는 자리다.
  //
  // 만료(stale)는 소비를 되돌리지 않는 유일한 예외다 — 같은 봉투를 다시 보내도
  // 판번호가 여전히 낡아 같은 자리에서 막힌다(다시 시도 칩도 주지 않는다).
  async function decide(envelope, { revisionNow = null, runMutation = null } = {}) {
    const gated = gate(envelope);
    if (!gated.ok) return { kind: 'failed', reason: gated.error, results: [], probes: [], mutationError: null };
    const claimed = consume(envelope);
    if (!claimed.ok) return { kind: 'failed', reason: claimed.error, results: [], probes: [], mutationError: null };
    const revision = envelope ? envelope.revision : null;
    if (revision !== null && revision !== undefined && revision !== revisionNow) {
      return {
        kind: 'stale',
        reason: '목록이 바뀌어 다시 확인이 필요합니다',
        results: [],
        probes: [],
        mutationError: null,
      };
    }
    const run = () => apply(envelope);
    const applied = await (typeof runMutation === 'function' ? runMutation(run) : run());
    const results = Array.isArray(applied.results) ? applied.results : [];
    // probe는 실행 시퀀스 밖이다 — apply 안에서 upstream 서버를 띄우면 펜스가 오염된다.
    const probes = await probe(applied.probeAliases || []);
    const failed = results.find((row) => !row.ok) || null;
    // 조정자가 낸 문장은 영문 내부 메시지라 화면에 내지 않는다 — 호출자가 로그에만 쓴다.
    const mutationError = applied.ok === true ? null : (applied.error || '사유 없음');
    const reason = failed
      ? failed.error
      : (applied.ok === true ? null : '설정을 바꿨지만 대화에 반영하지 못했습니다');
    if (reason) release(envelope);
    return { kind: reason ? 'failed' : 'success', reason, results, probes, mutationError };
  }

  return { gate, consume, release, note, pending, apply, probe, decide };
}

module.exports = { createPluginProposalRegistry };

// 이력 사이드바의 최소 영속화. 대화 본문은 저장하지 않고 프로젝트 소속과
// 표시용 제목/시각만 보관한다. 프로젝트/최근 UI는 이 한 목록을 함께 투영한다.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { writeJsonAtomic, writeJsonAtomicAsync } = require('./json-store');
// 모드 어휘의 진실은 session-snapshot 하나다 — 화면은 대화 모드를 'summary'라
// 부르고 레코드는 'chat'이라 부르는데, 그 다리를 여기서 또 만들면 두 벌이 된다.
const { viewToMode } = require('../session-snapshot');

const TITLE_MAX = 40;
const STATE_VERSION = 2;
const DEFAULT_PROJECT_ID = 'default';
const DEFAULT_PROJECT_LABEL = '기본 프로젝트';

function statePath() {
  return process.env.ATHENA_CONVERSATIONS_PATH
    || path.join(app.getPath('userData'), 'athena-conversations.json');
}

function validString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeProject(raw, fallbackId) {
  const id = validString(raw && raw.id) || fallbackId;
  const label = validString(raw && (raw.label || raw.name)) || id;
  // 프로젝트는 폴더 하나다(37번 보드). 폴더를 고르기 전의 옛 레코드는 path가
  // 없으므로 null로 읽힌다 — 마이그레이션 없이 그대로 산다.
  const project = { id, label, path: validString(raw && raw.path), pinned: Boolean(raw && raw.pinned) };
  const description = validString(raw && raw.description);
  if (description) project.description = description;
  return project;
}

// 폴더 비교는 절대경로로 맞추고 Windows 대소문자는 무시한다.
function projectPathKey(value) {
  const raw = validString(value);
  return raw ? path.resolve(raw).toLowerCase() : null;
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const projectRows = Array.isArray(source.projects) ? source.projects : [];
  const projects = [];
  const seenProjectIds = new Set();
  const seenProjectPaths = new Set();
  for (const row of projectRows) {
    const project = normalizeProject(row, `project-${projects.length + 1}`);
    if (seenProjectIds.has(project.id)) continue;
    // 폴더 하나에 프로젝트 하나 — 같은 폴더가 두 번 오면 뒤의 것을 버린다.
    const pathKey = projectPathKey(project.path);
    if (pathKey && seenProjectPaths.has(pathKey)) continue;
    if (pathKey) seenProjectPaths.add(pathKey);
    seenProjectIds.add(project.id);
    projects.push(project);
  }
  if (!projects.length) {
    projects.push({ id: DEFAULT_PROJECT_ID, label: DEFAULT_PROJECT_LABEL });
    seenProjectIds.add(DEFAULT_PROJECT_ID);
  }

  let currentProjectId = validString(source.currentProjectId);
  if (!seenProjectIds.has(currentProjectId)) currentProjectId = projects[0].id;

  const conversations = [];
  const seenConversationIds = new Set();
  for (const row of Array.isArray(source.conversations) ? source.conversations : []) {
    const id = validString(row && row.id);
    if (!id || seenConversationIds.has(id)) continue;
    seenConversationIds.add(id);
    const rowProjectId = validString(row.projectId);
    const projectId = seenProjectIds.has(rowProjectId) ? rowProjectId : currentProjectId;
    const createdAt = validString(row.createdAt) || validString(row.updatedAt) || new Date(0).toISOString();
    const updatedAt = validString(row.updatedAt) || createdAt;
    conversations.push({
      id,
      title: validString(row.title) || '(제목 없음)',
      createdAt,
      updatedAt,
      projectId,
      // 대화는 만들어진 모드에 묶인다(35·40번 보드). 옛 레코드에는 이 필드가
      // 없으므로 viewToMode가 'chat'으로 떨어뜨린다 — 마이그레이션 없이 읽힌다.
      mode: viewToMode(row.mode),
      // 마지막으로 관측한 Claude session_id(--resume 커서). 이력 행을 다시 눌렀을 때
      // 모델 문맥까지 이어 붙이는 열쇠다 — 이것이 없으면 메시지만 다시 보이고
      // 대화는 백지에서 시작한다(41번 보드 "다시 누르면 그대로").
      resumeSessionId: validString(row.resumeSessionId),
    });
  }

  return {
    version: STATE_VERSION,
    activeId: validString(source.activeId),
    activeMode: viewToMode(source.activeMode),
    currentProjectId,
    projects,
    conversations,
  };
}

// 같은 프로세스 안에서 begin/touch/setActive가 남긴 최신 상태를 재사용해
// 턴마다 반복되는 디스크 재읽기를 없앤다. 경로가 바뀌면(테스트가
// ATHENA_CONVERSATIONS_PATH를 매번 새로 지정) 캐시를 무효화한다.
let cachedState = null;
let cachedPath = null;

function readState() {
  const currentPath = statePath();
  if (cachedState && cachedPath === currentPath) return cachedState;
  cachedPath = currentPath;
  try {
    cachedState = normalizeState(JSON.parse(fs.readFileSync(currentPath, 'utf-8')));
  } catch {
    cachedState = normalizeState(null);
  }
  return cachedState;
}

// 실제 파일 쓰기는 턴을 막지 않도록 백그라운드로 미루되, 캐시는 즉시 갱신해
// 뒤이은 읽기가 예약된 쓰기를 기다리지 않고도 최신 상태를 본다. 연속 호출이
// 서로 앞지르지 않도록 쓰기는 체인으로 직렬화한다.
let pendingWrite = Promise.resolve();
// 예약만 되고 아직 디스크에 닿지 않은 마지막 상태. flushSync()가 종료 직전에
// 이걸 동기로 마저 쓴다 — 안 그러면 턴 직후 종료에서 사이드바 행이 사라진다.
let unflushed = null;

function writeState(state) {
  cachedState = state;
  const targetPath = statePath();
  const payload = normalizeState(state);
  unflushed = { targetPath, payload };
  pendingWrite = pendingWrite
    .then(() => writeJsonAtomicAsync(targetPath, payload))
    .then(() => { if (unflushed && unflushed.payload === payload) unflushed = null; })
    .catch(() => { /* 사이드바 영속화 실패는 대화 성공의 필요조건이 아니다 */ });
}

function truncateTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(제목 없음)';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean;
}

function sortedConversations(state) {
  return [...state.conversations].sort((a, b) => (
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ));
}

// 프로젝트/최근은 별도 복제본을 만들지 않는다. 둘 다 conversations 안의 같은
// 객체를 참조하므로 한 id의 제목·시각·소속이 화면마다 어긋날 수 없다.
function projectConversations(state, projectId) {
  return sortedConversations(state).filter((conversation) => conversation.projectId === projectId);
}

// 최상단 고정이 먼저, 나머지는 원래 순서 그대로(정렬은 안정적이다).
function sortedProjects(state) {
  return [...state.projects].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

function snapshot(state) {
  return {
    activeId: state.activeId,
    activeMode: state.activeMode,
    currentProjectId: state.currentProjectId,
    projects: sortedProjects(state),
    conversations: sortedConversations(state),
  };
}

function list() {
  return snapshot(readState());
}

// 새 id를 현재 대화로 시작하되, 첫 사용자 입력 전에는 목록에 빈 행을 만들지 않는다.
function begin({ id, projectId, mode } = {}) {
  const nextId = validString(id);
  if (!nextId) return list();
  const state = readState();
  const selectedProjectId = state.projects.some((project) => project.id === projectId)
    ? projectId
    : state.currentProjectId;
  state.activeId = nextId;
  // 행은 첫 입력 때 만들어지므로 모드는 여기서 기억해 두고 touch()가 쓴다.
  state.activeMode = viewToMode(mode);
  state.currentProjectId = selectedProjectId;
  writeState(state);
  return snapshot(state);
}

// 첫 사용자 메시지에서 목록에 한 번만 추가한다. begin()을 거치지 않은 기존
// 호출도 현재 프로젝트로 안전하게 귀속된다.
function touch({ id, title, projectId, mode } = {}) {
  const conversationId = validString(id);
  if (!conversationId) return list();
  const state = readState();
  const existing = state.conversations.find((conversation) => conversation.id === conversationId);
  const requestedProjectId = state.projects.some((project) => project.id === projectId)
    ? projectId
    : state.currentProjectId;
  // 모드는 만들 때 한 번 정해지고 바뀌지 않는다 — 모드가 대화의 경계라서,
  // 이미 있는 행의 모드를 나중에 갈아끼우면 그 경계가 무너진다(40번 보드).
  const requestedMode = mode === undefined ? state.activeMode : viewToMode(mode);
  const nowIso = new Date().toISOString();
  if (existing) {
    existing.updatedAt = nowIso;
  } else {
    state.conversations.push({
      id: conversationId,
      title: truncateTitle(title),
      createdAt: nowIso,
      updatedAt: nowIso,
      projectId: requestedProjectId,
      mode: requestedMode,
      resumeSessionId: null,
    });
  }
  state.activeId = conversationId;
  state.activeMode = existing ? existing.mode : requestedMode;
  state.currentProjectId = existing ? existing.projectId : requestedProjectId;
  writeState(state);
  return snapshot(state);
}

function setActive(id) {
  const state = readState();
  const conversation = state.conversations.find((row) => row.id === id);
  if (!conversation) return list();
  state.activeId = conversation.id;
  // 이력 행을 누르면 그 대화의 모드로 화면이 따라간다 — 백테스트 대화를 열면
  // 백테스트 캔버스가 뜬다. 셸이 이 값을 읽어 view를 맞춘다.
  state.activeMode = conversation.mode;
  state.currentProjectId = conversation.projectId;
  writeState(state);
  return snapshot(state);
}

// 턴이 끝날 때마다 main이 관측한 Claude session_id를 그 대화에 적어 둔다.
// 커서는 대화마다 따로 산다 — 한 대화의 커서로 다른 대화를 이으면 문맥이 섞인다.
function setResumeCursor({ id, resumeSessionId } = {}) {
  const conversationId = validString(id);
  if (!conversationId) return false;
  const state = readState();
  const conversation = state.conversations.find((row) => row.id === conversationId);
  if (!conversation) return false;
  const next = validString(resumeSessionId);
  if (conversation.resumeSessionId === next) return true;
  conversation.resumeSessionId = next;
  writeState(state);
  return true;
}

// 폴더는 사용자가 고른다(37번 보드). 이 모듈은 고른 경로를 적기만 하고 폴더의
// 존재·생성·삭제는 main의 몫이다 — 여기서 파일시스템을 만지지 않는다.
// id를 주면 그대로 쓴다(백엔드 프로젝트 레지스트리의 project_id와 같은 것이어야 한다).
function addProject({ id, path: folderPath, label } = {}) {
  const state = readState();
  const target = validString(folderPath);
  if (!target) return { ok: false, reason: 'invalid_path' };
  const pathKey = projectPathKey(target);
  const taken = state.projects.find((project) => projectPathKey(project.path) === pathKey);
  if (taken) return { ok: false, reason: 'folder_taken', project: taken };
  const requestedId = validString(id);
  const idTaken = requestedId && state.projects.find((project) => project.id === requestedId);
  if (idTaken) return { ok: false, reason: 'id_taken', project: idTaken };
  const project = {
    id: requestedId || `proj-${crypto.randomUUID()}`,
    // 이름을 안 주면 폴더 이름이 곧 프로젝트 이름이다.
    label: validString(label) || path.basename(path.resolve(target)),
    path: target,
    pinned: false,
  };
  state.projects.push(project);
  state.currentProjectId = project.id;
  writeState(state);
  return { ok: true, project, state: snapshot(state) };
}

function setProjectPinned(id, pinned) {
  const state = readState();
  const project = state.projects.find((row) => row.id === validString(id));
  if (!project) return list();
  project.pinned = Boolean(pinned);
  writeState(state);
  return snapshot(state);
}

// '프로젝트 수정'(29번 보드) — 이름과 설명만 고친다. 폴더·id·고정은 건드리지 않는다.
// 이름은 비울 수 없다(사이드바 행과 삭제 확인이 이름으로 사람을 붙잡기 때문이다).
// 설명을 비우면 필드를 지워 기본 문장("이 프로젝트에 속한 대화와 작업")으로 돌아간다.
function updateProject({ id, label, description } = {}) {
  const state = readState();
  const project = state.projects.find((row) => row.id === validString(id));
  if (!project) return { ok: false, reason: 'unknown_project' };
  const nextLabel = validString(label);
  if (!nextLabel) return { ok: false, reason: 'invalid_label' };
  project.label = nextLabel;
  const nextDescription = validString(description);
  if (nextDescription) project.description = nextDescription;
  else delete project.description;
  writeState(state);
  return { ok: true, project, state: snapshot(state) };
}

// 레코드와 그 프로젝트의 대화들만 지운다 — 폴더 자체를 지우는 것은 main의 몫이다.
function removeProject(id) {
  const projectId = validString(id);
  const state = readState();
  if (projectId === DEFAULT_PROJECT_ID) return { ok: false, reason: 'default_project' };
  const index = state.projects.findIndex((row) => row.id === projectId);
  if (index < 0) return { ok: false, reason: 'unknown_project' };
  const [project] = state.projects.splice(index, 1);
  const conversationIds = state.conversations
    .filter((row) => row.projectId === projectId)
    .map((row) => row.id);
  state.conversations = state.conversations.filter((row) => row.projectId !== projectId);
  // 프로젝트 없는 상태는 없다 — 마지막 하나를 지웠다면 기본 프로젝트가 돌아온다.
  if (!state.projects.length) state.projects.push({ id: DEFAULT_PROJECT_ID, label: DEFAULT_PROJECT_LABEL });
  if (state.currentProjectId === projectId) state.currentProjectId = state.projects[0].id;
  if (conversationIds.includes(state.activeId)) state.activeId = null;
  writeState(state);
  return { ok: true, removed: { project, conversationIds }, state: snapshot(state) };
}

// main이 '탐색기에서 열기'로 폴더 경로를 읽을 때 쓴다.
function projectById(id) {
  const projectId = validString(id);
  if (!projectId) return null;
  return readState().projects.find((row) => row.id === projectId) || null;
}

// 백그라운드로 미룬 파일 쓰기가 실제로 끝났는지 기다려야 할 때(테스트) 쓴다.
function flush() {
  return pendingWrite;
}

// 앱 종료 경로에서 부른다. before-quit은 await할 수 없으므로, 아직 디스크에
// 닿지 않은 마지막 상태만 동기로 마저 쓴다.
function flushSync() {
  if (!unflushed) return false;
  const { targetPath, payload } = unflushed;
  unflushed = null;
  try {
    writeJsonAtomic(targetPath, payload);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_LABEL,
  normalizeState,
  projectConversations,
  list,
  begin,
  touch,
  setActive,
  setResumeCursor,
  addProject,
  setProjectPinned,
  updateProject,
  removeProject,
  projectById,
  flush,
  flushSync,
};

// 이력 사이드바의 최소 영속화. 대화 본문은 저장하지 않고 프로젝트 소속과
// 표시용 제목/시각만 보관한다. 프로젝트/최근 UI는 이 한 목록을 함께 투영한다.

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic, writeJsonAtomicAsync } = require('./json-store');

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
  const project = { id, label };
  const description = validString(raw && raw.description);
  if (description) project.description = description;
  return project;
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const projectRows = Array.isArray(source.projects) ? source.projects : [];
  const projects = [];
  const seenProjectIds = new Set();
  for (const row of projectRows) {
    const project = normalizeProject(row, `project-${projects.length + 1}`);
    if (seenProjectIds.has(project.id)) continue;
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
    });
  }

  return {
    version: STATE_VERSION,
    activeId: validString(source.activeId),
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

function snapshot(state) {
  return {
    activeId: state.activeId,
    currentProjectId: state.currentProjectId,
    projects: state.projects,
    conversations: sortedConversations(state),
  };
}

function list() {
  return snapshot(readState());
}

// 새 id를 현재 대화로 시작하되, 첫 사용자 입력 전에는 목록에 빈 행을 만들지 않는다.
function begin({ id, projectId } = {}) {
  const nextId = validString(id);
  if (!nextId) return list();
  const state = readState();
  const selectedProjectId = state.projects.some((project) => project.id === projectId)
    ? projectId
    : state.currentProjectId;
  state.activeId = nextId;
  state.currentProjectId = selectedProjectId;
  writeState(state);
  return snapshot(state);
}

// 첫 사용자 메시지에서 목록에 한 번만 추가한다. begin()을 거치지 않은 기존
// 호출도 현재 프로젝트로 안전하게 귀속된다.
function touch({ id, title, projectId } = {}) {
  const conversationId = validString(id);
  if (!conversationId) return list();
  const state = readState();
  const existing = state.conversations.find((conversation) => conversation.id === conversationId);
  const requestedProjectId = state.projects.some((project) => project.id === projectId)
    ? projectId
    : state.currentProjectId;
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
    });
  }
  state.activeId = conversationId;
  state.currentProjectId = existing ? existing.projectId : requestedProjectId;
  writeState(state);
  return snapshot(state);
}

function setActive(id) {
  const state = readState();
  const conversation = state.conversations.find((row) => row.id === id);
  if (!conversation) return list();
  state.activeId = conversation.id;
  state.currentProjectId = conversation.projectId;
  writeState(state);
  return snapshot(state);
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
  flush,
  flushSync,
};

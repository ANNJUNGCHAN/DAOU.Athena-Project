// 이력 사이드바의 최소 영속화. 대화 본문은 저장하지 않고 프로젝트 소속과
// 표시용 제목/시각만 보관한다. 프로젝트/최근 UI는 이 한 목록을 함께 투영한다.

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

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

function readState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath(), 'utf-8')));
  } catch {
    return normalizeState(null);
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), normalizeState(state));
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

function list() {
  const state = readState();
  return {
    activeId: state.activeId,
    currentProjectId: state.currentProjectId,
    projects: state.projects,
    conversations: sortedConversations(state),
  };
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
  return list();
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
  return list();
}

function setActive(id) {
  const state = readState();
  const conversation = state.conversations.find((row) => row.id === id);
  if (!conversation) return list();
  state.activeId = conversation.id;
  state.currentProjectId = conversation.projectId;
  writeState(state);
  return list();
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
};

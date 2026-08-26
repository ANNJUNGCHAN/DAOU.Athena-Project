// 이력 사이드바(리프 1.2.2)의 최소 영속화 — prefs.js/accounts.js와 같은 패턴
// (userData JSON + writeJsonAtomic). "대화는 앱 수명 단위다"(main.js
// historyAppSessionId 주석)라는 기존 결정은 그대로 둔다 — 이 모듈은 그 백엔드
// 대화(브레인 history-sink)를 재구성하지 않는다. 여기 저장하는 것은 딱
// 사이드바 표시용 "이 세션에서 무슨 대화가 있었는지"의 제목·시각 요약뿐이다.
// 옛 세션 항목을 클릭해도 대화 내용이 다시 열리지 않는다(재생 기능 없음) —
// 없는 기능을 있다고 보이면 안 되므로(soul.md §7) 렌더러 쪽 선택 표시도 그
// 경계를 넘지 않는다.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

const TITLE_MAX = 40;

function statePath() {
  return path.join(app.getPath('userData'), 'athena-conversations.json');
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    return {
      activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
      conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
    };
  } catch {
    return { activeId: null, conversations: [] };
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), state);
}

function truncateTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(제목 없음)';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean;
}

// athena:conversations-list -> { activeId, conversations: [{id, title, createdAt, updatedAt}] }
// updatedAt 내림차순 — 사이드바가 날짜 섹션으로 나누기 전 원본 순서.
function list() {
  const state = readState();
  const conversations = [...state.conversations].sort((a, b) => (
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ));
  return { activeId: state.activeId, conversations };
}

// 세션의 첫 사용자 메시지에서 호출된다(main.js). 이미 있는 id면 updatedAt만
// 갱신한다 — 제목은 첫 메시지로 고정, 이후 대화가 늘어도 안 바뀐다(Paper
// 보드 04 목록의 제목이 질문 요지를 가리키는 것과 같은 규칙).
function touch({ id, title }) {
  if (!id) return list();
  const state = readState();
  const existing = state.conversations.find((c) => c.id === id);
  const nowIso = new Date().toISOString();
  if (existing) {
    existing.updatedAt = nowIso;
  } else {
    state.conversations.push({
      id,
      title: truncateTitle(title),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  state.activeId = id;
  writeState(state);
  return list();
}

// athena:conversations-set-active — 사이드바 항목 클릭의 "선택 상태" 반영.
// 옛 세션을 클릭해도 대화가 재생되지는 않는다(위 파일 주석) — 여기서 하는
// 일은 activeId 저장뿐이다.
function setActive(id) {
  const state = readState();
  if (!state.conversations.some((c) => c.id === id)) return list();
  state.activeId = id;
  writeState(state);
  return list();
}

module.exports = { list, touch, setActive };

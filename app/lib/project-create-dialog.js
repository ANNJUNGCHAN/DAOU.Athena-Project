// IIFE 스코프 격리(2026-08-18 렌더러 격리) — sidebar-project-menu.js와 같은 패턴.
(function () {
'use strict';

// '프로젝트 추가' 대화상자(36번 보드)의 "무엇을 보일까"만 정한다 — DOM은 한 줄도
// 만들지 않는다. 그리는 몫은 sidebar.js이고, 여기 있는 것은 전부 순수 함수라
// 렌더러 없이 node:test로 검증된다(sidebar-project-menu.js와 같은 자리).
//
// 36번 보드가 확정한 것 셋:
//   · 폴더를 먼저 고르고, 그 경로·이름·권한 경계를 보여 준 뒤에만 프로젝트가 생긴다.
//   · 이름의 기본값은 폴더 이름이고 사람이 바꿀 수 있다.
//   · 폴더 하나 = 프로젝트 하나 — 이미 점유된 폴더를 고르면 만들기가 잠긴다.
//
// 권한 세 줄·제목·라벨 같은 붙박이 문구는 여기 없다. shell.html의 마크업이 그
// 문장들의 유일한 집이다 — 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.

// 경로 비교의 정규형. 렌더러에는 node:path가 없어 구분자와 대소문자만 접는다 —
// 최종 판정은 main의 athena:project-add가 다시 한다(같은 폴더 두 번 등록은 거기서 막힌다).
function pathKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.replace(/[/\\]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

// 폴더 이름 = 경로의 마지막 조각. 이름 칸의 기본값이다.
function folderNameOf(value) {
  const parts = String(value ?? '').split(/[/\\]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function occupierOf(projects, folderPath) {
  const key = pathKey(folderPath);
  if (!key) return null;
  const rows = Array.isArray(projects) ? projects : [];
  return rows.find((row) => row && pathKey(row.path) === key) || null;
}

// 조사는 이름의 받침으로 고른다. 이름은 사람이 정하는 값이라 Paper가 쓴 '가' 하나로
// 박으면 받침 있는 이름에서 절반이 틀린 문장이 된다.
function subjectParticle(name) {
  const last = String(name ?? '').trim().slice(-1);
  const code = last ? last.charCodeAt(0) : 0;
  if (code < 0xac00 || code > 0xd7a3) return '가';
  return (code - 0xac00) % 28 ? '이' : '가';
}

/**
 * 사람이 고른 폴더 하나로 대화상자 상태를 연다.
 * `empty`가 boolean이 아니면 빈 폴더로 본다 — 못 읽은 것을 "파일이 있다"고 말하지 않는다.
 */
function openState({ path, name, empty, projects } = {}) {
  const folder = typeof path === 'string' ? path.trim() : '';
  const typed = typeof name === 'string' ? name.trim() : '';
  return {
    path: folder,
    name: typed || folderNameOf(folder),
    empty: empty !== false,
    occupiedBy: occupierOf(projects, folder),
  };
}

function withName(state, text) {
  return { ...(state || {}), name: typeof text === 'string' ? text : '' };
}

// 안내는 한 번에 하나다 — 점유가 빈 폴더보다 세다(점유는 만들기를 막는다).
function noticeFor(state) {
  const row = state || {};
  if (row.occupiedBy) {
    const label = String(row.occupiedBy.label || '');
    return {
      kind: 'occupied',
      title: '이미 점유된 폴더',
      copy: `이 폴더는 ‘${label}’${subjectParticle(label)} 쓰고 있습니다. 프로젝트 하나가 폴더 하나를 독점합니다.`,
      path: row.path || '',
      action: '그 프로젝트 열기',
      projectId: row.occupiedBy.id || '',
    };
  }
  if (row.empty === false) {
    return {
      kind: 'not-empty',
      title: '빈 폴더가 아닐 때',
      copy: '기존 파일은 그대로 둡니다. 아테나가 만든 것만 지웁니다.',
    };
  }
  return null;
}

function canCreate(state) {
  const row = state || {};
  return Boolean(row.path) && Boolean(String(row.name || '').trim()) && !row.occupiedBy;
}

const __exports = { folderNameOf, openState, withName, noticeFor, canCreate };

// UMD 각주(2026-08-18 렌더러 격리) — sidebar-project-menu.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ProjectCreateDialog = __exports;
}

})();

// project-create-dialog.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { folderNameOf, openState, withName, noticeFor, canCreate } = require('./project-create-dialog');

const PROJECTS = [
  { id: 'p1', label: '아테나', path: 'C:\\Projects\\DAOU.Athena' },
  { id: 'p2', label: '키움 리서치', path: 'C:\\Projects\\kiwoom-research' },
];

test('이름의 기본값은 폴더 이름이다(36번 보드)', () => {
  const state = openState({ path: 'C:\\Projects\\DAOU.Athena', projects: PROJECTS.slice(1) });
  assert.equal(state.name, 'DAOU.Athena');
  assert.equal(state.path, 'C:\\Projects\\DAOU.Athena');
});

test('사람이 준 이름이 폴더 이름을 이긴다', () => {
  assert.equal(openState({ path: 'C:\\work\\a', name: '전략 연구' }).name, '전략 연구');
});

test('폴더 이름은 뒤쪽 구분자·슬래시에 흔들리지 않는다', () => {
  assert.equal(folderNameOf('C:/Projects/kiwoom-research/'), 'kiwoom-research');
  assert.equal(folderNameOf(''), '');
});

test('이미 점유된 폴더는 어느 프로젝트가 쓰는지와 함께 만들기를 잠근다', () => {
  const state = openState({ path: 'c:/projects/daou.athena/', projects: PROJECTS });
  assert.equal(state.occupiedBy.id, 'p1');
  assert.equal(canCreate(state), false);
  const notice = noticeFor(state);
  assert.equal(notice.kind, 'occupied');
  assert.equal(notice.title, '이미 점유된 폴더');
  assert.equal(notice.copy, '이 폴더는 ‘아테나’가 쓰고 있습니다. 프로젝트 하나가 폴더 하나를 독점합니다.');
  assert.equal(notice.projectId, 'p1');
  assert.equal(notice.path, 'c:/projects/daou.athena/');
});

test('받침 있는 이름은 조사가 바뀐다 — 이름은 사람이 정하는 값이다', () => {
  const state = openState({ path: 'C:\\x', projects: [{ id: 'p9', label: '개인 연구실', path: 'C:\\x' }] });
  assert.match(noticeFor(state).copy, /‘개인 연구실’이 쓰고 있습니다/);
});

test('빈 폴더가 아닐 때는 안내만 하고 만들기를 막지 않는다', () => {
  const state = openState({ path: 'C:\\Projects\\new', empty: false, projects: PROJECTS });
  const notice = noticeFor(state);
  assert.equal(notice.kind, 'not-empty');
  assert.equal(notice.title, '빈 폴더가 아닐 때');
  assert.equal(notice.copy, '기존 파일은 그대로 둡니다. 아테나가 만든 것만 지웁니다.');
  assert.equal(canCreate(state), true);
});

test('빈 폴더를 고르면 안내가 없다', () => {
  assert.equal(noticeFor(openState({ path: 'C:\\Projects\\new', empty: true, projects: PROJECTS })), null);
});

test('폴더를 못 읽었으면 파일이 있다고 말하지 않는다', () => {
  assert.equal(noticeFor(openState({ path: 'C:\\Projects\\new', projects: [] })), null);
});

test('점유가 빈 폴더 안내보다 세다 — 만들기를 막는 쪽이 먼저다', () => {
  const state = openState({ path: 'C:\\Projects\\DAOU.Athena', empty: false, projects: PROJECTS });
  assert.equal(noticeFor(state).kind, 'occupied');
});

test('이름을 비우면 만들기가 잠긴다', () => {
  const state = openState({ path: 'C:\\Projects\\new', projects: [] });
  assert.equal(canCreate(withName(state, '   ')), false);
  assert.equal(canCreate(withName(state, '새 프로젝트')), true);
});

test('폴더가 없으면 만들기가 잠긴다 — 앱이 경로를 지어내지 않는다', () => {
  assert.equal(canCreate(openState({ path: '', name: '이름만' })), false);
  assert.equal(canCreate(null), false);
});

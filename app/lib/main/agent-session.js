// 에이전트 모드 세션 판정(결정 (b) §1.4) — DOM·IPC·electron을 부르지 않는
// 순수 모듈이다. conversations.js가 만든 스냅샷 하나만 읽고 판정한다.
//
// isDerivedAlertRoom(roomId)은 여기 없다 — 렌더러 UMD 모듈
// app/lib/agent-proposal.js가 소유한다(합의 6차). 렌더러는 shell.html의
// <script src="lib/*.js">로만 로드되고 그 목록에 lib/main/*은 0건이므로,
// 판정 사본을 0으로 유지하려면 소유가 그 방향이어야 한다.

'use strict';

// 외부 세션 기반이 이미 착륙해 있는가(D-3의 답). true인 근거:
// - app/lib/main/conversations.js가 대화 레코드의 mode를 정규화한다
//   (`mode: viewToMode(row.mode)`), state.activeMode도 같은 함수를 통과한다.
// - 그 viewToMode는 app/lib/session-snapshot.js가 소유하는 모드 어휘의
//   유일한 진실이다(모르는 값은 'chat'으로 떨어진다).
// 즉 "대화가 어떤 모드에서 만들어졌는가"는 이 모듈이 새로 발명할 것이 아니라
// 스냅샷에서 읽기만 하면 되는 값이다.
const FOUNDATION_PRESENT = true;

// 지금 활성인 대화가 에이전트 모드일 때만 그 id를 돌려준다.
// 활성이 아닌 에이전트 대화는 절대 고르지 않는다 — 콘솔은 "지금 보고 있는
// 방"에 대한 것이고, 다른 방을 집으면 다른 모드의 화면에 개입하게 된다.
function getAgentConsoleSessionId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
  const activeId = typeof snapshot.activeId === 'string' ? snapshot.activeId : null;
  if (!activeId) return null;
  const active = conversations.find((row) => row && row.id === activeId);
  if (!active || active.mode !== 'agent') return null;
  return active.id;
}

module.exports = { FOUNDATION_PRESENT, getAgentConsoleSessionId };

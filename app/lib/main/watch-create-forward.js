'use strict';

// propose_watch_code 성공 호출에서 채팅 영수증·질문 카드를 고르는 순수 판정부.
// main.js의 maybeForwardWatchCreate가 이것만 부른다 — electron을 만지지 않는다.
// 한국어 제목은 호출 입력(labels 또는 source의 NODE_LABELS)에서만 읽는다.
// 결과 JSON에는 path·code_hash만 있으므로 이름을 결과에서 지어내지 않는다.

const TOOL_NAME = 'athena_routine';
const GATEWAY_NAME = `mcp__athena__${TOOL_NAME}`;

function isWatchCodeCall(step) {
  const name = String((step && step.name) || '');
  if (name !== TOOL_NAME && name !== GATEWAY_NAME) return false;
  return !!(step && step.input && step.input.action === 'propose_watch_code');
}

function titlesFromMap(labels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return [];
  return Object.keys(labels)
    .map((key) => String(labels[key] == null ? '' : labels[key]).trim())
    .filter(Boolean);
}

function titlesFromNodeLabelsLiteral(source) {
  const text = String(source || '');
  const match = /NODE_LABELS\s*=\s*\{([^}]*)\}/.exec(text);
  if (!match) return [];
  const titles = [];
  const valueRe = /:\s*['"]([^'"]+)['"]/g;
  let row;
  while ((row = valueRe.exec(match[1]))) {
    const title = String(row[1] || '').trim();
    if (title) titles.push(title);
  }
  return titles;
}

function koreanTitles(watchCode) {
  if (!watchCode || typeof watchCode !== 'object') return [];
  const fromMap = titlesFromMap(watchCode.labels);
  if (fromMap.length) return fromMap;
  return titlesFromNodeLabelsLiteral(watchCode.source);
}

function isWatchCodeSuccess(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const hash = String(payload.code_hash || '').trim();
  const savedPath = String(payload.path || '').trim();
  return !!(hash || savedPath);
}

function extractWatchCreate(step, payload) {
  if (!isWatchCodeCall(step) || !isWatchCodeSuccess(payload)) return null;
  return { titles: koreanTitles(step.input && step.input.watch_code) };
}

module.exports = {
  TOOL_NAME, GATEWAY_NAME,
  isWatchCodeCall, koreanTitles, isWatchCodeSuccess, extractWatchCreate,
};

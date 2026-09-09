'use strict';

const { createHash } = require('node:crypto');

function describeToolFailure(content) {
  const raw = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  let status = null;
  let code = '';
  const messages = [];
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return;
    if (typeof value === 'string') {
      messages.push(value);
      try { visit(JSON.parse(value), depth + 1); } catch { /* plain tool error */ }
      return;
    }
    if (Array.isArray(value)) { value.slice(0, 20).forEach((entry) => visit(entry, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const key of ['status_code', 'statusCode', 'http_status', 'httpStatus', 'status']) {
      const candidate = Number(value[key]);
      if (Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) status = candidate;
    }
    for (const key of ['error_code', 'errorCode', 'code', 'reason']) {
      const candidate = String(value[key] || '');
      if (/^(?:ORDER_TICKET_REQUIRED|INVALID_ARGUMENTS|MISSING_ARGUMENTS|CANVAS_COVERAGE_MISSING|CANVAS_CARD_COVERAGE_MISSING|TRANSFORM_ERROR|GATEWAY_BLOCKED|UPSTREAM_ERROR|TIMEOUT|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|INTERNAL_ERROR|PREFERRED_REF_NOT_SUPPORTED_BY_QUERY)$/i.test(candidate)) code = candidate.toUpperCase();
    }
    for (const key of ['text', 'message', 'error', 'detail', 'content']) visit(value[key], depth + 1);
  };
  visit(content);
  const text = messages.join('\n');
  if (!status) {
    const match = text.match(/\b(?:HTTP(?:Error)?|status(?:_code| code)?)[^\d\n]{0,12}([45]\d{2})\b/i)
      || text.match(/\b(502|503|504)\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout)\b/i);
    if (match) status = Number(match[1]);
  }
  let message = '조회 도구가 오류를 반환했습니다. 오류 기록을 확인해야 합니다.';
  if (code === 'ORDER_TICKET_REQUIRED'
      || (status === 428 && /X-Athena-Confirm:\s*true is required/i.test(text))) message = '주문 확인이 필요합니다. 주문 티켓에서 내용을 확인해 주세요. 이 요청으로 주문은 접수되지 않았습니다.';
  else if (/CANVAS.*COVERAGE|TRANSFORM_ERROR/.test(code)) message = '조회 응답을 화면으로 변환하지 못했습니다.';
  else if (status === 401 || status === 403) message = '조회 인증 또는 권한을 확인해 주세요.';
  else if (status === 400 || status === 422 || /ARGUMENTS|PREFERRED_REF/.test(code)) message = '조회 요청 조건을 처리하지 못했습니다.';
  else if ([502, 503, 504].includes(status)) message = '조회 서비스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  else if (/timeout|timed out|시간.?초과/i.test(text) || code === 'TIMEOUT') message = '조회 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
  else if (/ECONNREFUSED|connection refused|connecterror/i.test(text)) message = '조회 서비스에 연결하지 못했습니다.';
  const suffix = [status && `HTTP ${status}`, code].filter(Boolean).join(' · ');
  return { message: suffix ? `${message} (${suffix})` : message, httpStatus: status, code,
    fingerprint: createHash('sha256').update(raw).digest('hex').slice(0, 16) };
}

module.exports = { describeToolFailure };

'use strict';

function failureFromResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok !== false && result.exited !== false) return null;
  const error = new Error('공급자 세션 종료가 성공하지 않았다');
  error.result = result;
  return error;
}

function collectFailures(value, failures) {
  if (Array.isArray(value)) {
    for (const item of value) collectFailures(item, failures);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.status === 'rejected') {
    failures.push(value.reason instanceof Error ? value.reason : new Error(String(value.reason)));
    return;
  }
  if (value.status === 'fulfilled') {
    collectFailures(value.value, failures);
    return;
  }
  const failure = failureFromResult(value);
  if (failure) failures.push(failure);
}

function assertSessionStopsSucceeded(results) {
  const failures = [];
  collectFailures(results, failures);
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length}개 공급자 세션을 정상 종료하지 못했다`);
  }
  return results;
}

module.exports = { assertSessionStopsSucceeded };

'use strict';

// Read-only quote reproduction through the same selector + inline canvas path.
const path = require('node:path');
const { readLocalBearerToken } = require('../lib/main/backend-launcher');

async function main() {
  const token = readLocalBearerToken(path.resolve(__dirname, '../../backend'));
  const base = process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010';
  const started = Date.now();
  const response = await fetch(`${base}/api/v1/selector/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ question: process.argv[2] || '금현물 시세 알려줘', intent: 'query',
      preferred_ref: 'base:ka50100', arguments: { stk_cd: 'M04020000' }, deadline_ms: 3000 }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  const report = { httpStatus: response.status, elapsedMs: Date.now() - started,
    status: payload.status, code: payload.code, detail: payload.detail,
    operation_ref: payload.operation_ref,
    envelope: payload.envelope ? { canvas_type: payload.envelope.canvas_type,
      operation_ref: payload.envelope.operation_ref, state: payload.envelope.state } : undefined };
  const output = JSON.stringify(report);
  console.log(token ? output.replaceAll(token, '[redacted]') : output);
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.name, message: error.message }));
  process.exitCode = 1;
});

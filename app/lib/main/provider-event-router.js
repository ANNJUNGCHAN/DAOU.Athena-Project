'use strict';

const INTERNAL_EVENT_TYPES = new Set([
  'turn_started',
  'text_delta',
  'thinking_delta',
  'tool_started',
  'tool_progress',
  'tool_completed',
  'canvas_result',
  'subagent_updated',
  'permission_denied',
  'usage_updated',
  'warning',
  'turn_completed',
  'turn_interrupted',
  'turn_failed',
]);

const TERMINAL_EVENT_TYPES = new Set(['turn_completed', 'turn_interrupted', 'turn_failed']);

function sanitizeDescription(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function validateProviderEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (!INTERNAL_EVENT_TYPES.has(event.type)) return false;
  if (!Number.isSafeInteger(event.runtimeGeneration) || event.runtimeGeneration < 1) return false;
  if (typeof event.conversationId !== 'string' || !event.conversationId) return false;
  if (typeof event.turnId !== 'string' || !event.turnId) return false;
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return false;
  return Boolean(event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload));
}

function createProviderEventRouter({
  replayCapture = null,
  onInternalEvent = null,
  onTextDelta = null,
  onThinkingDelta = null,
  onCanvasResult = null,
  onToolStep = null,
  onSubagentStep = null,
  onPermissionDenied = null,
  onUsage = null,
  onWarning = null,
  onTerminal = null,
  toolStepLabel = (name) => String(name || '도구 실행'),
  clock = () => performance.now(),
  origin = 'shell',
  clientSubmitId = null,
} = {}) {
  const startedAtByToolUseId = new Map();
  const toolNameByToolUseId = new Map();
  const completedToolUseIds = new Set();
  let terminalSeen = false;

  function metadata(event) {
    return Object.freeze({
      clientSubmitId,
      runtimeGeneration: event.runtimeGeneration,
      conversationId: event.conversationId,
      turnId: event.turnId,
      sequence: event.sequence,
      origin,
    });
  }

  function route(event) {
    if (!validateProviderEvent(event)) return { accepted: false, reason: 'invalid-event' };
    if (terminalSeen) return { accepted: false, reason: 'after-terminal' };
    const payload = event.payload;
    const meta = metadata(event);

    if (replayCapture && typeof replayCapture.observeProviderEvent === 'function') {
      replayCapture.observeProviderEvent(event);
    }
    if (typeof onInternalEvent === 'function') onInternalEvent(event);

    switch (event.type) {
      case 'text_delta':
        if (typeof payload.text === 'string' && payload.text && typeof onTextDelta === 'function') {
          onTextDelta(payload.text, meta);
        }
        break;
      case 'thinking_delta':
        if (typeof payload.text === 'string' && payload.text && typeof onThinkingDelta === 'function') {
          onThinkingDelta(payload.text, meta);
        }
        break;
      case 'tool_started': {
        const id = String(payload.toolUseId || '');
        if (!id || startedAtByToolUseId.has(id)) break;
        const canonicalName = String(payload.canonicalToolName || payload.providerToolName || '');
        startedAtByToolUseId.set(id, clock());
        toolNameByToolUseId.set(id, canonicalName);
        if (typeof onToolStep === 'function') {
          onToolStep({
            id,
            label: toolStepLabel(canonicalName),
            done: false,
            elapsedMs: null,
            error: false,
            ...meta,
          });
        }
        break;
      }
      case 'tool_progress': {
        const id = String(payload.toolUseId || '');
        if (!id || completedToolUseIds.has(id) || typeof onToolStep !== 'function') break;
        onToolStep({
          id,
          label: toolStepLabel(toolNameByToolUseId.get(id) || ''),
          done: false,
          elapsedMs: null,
          error: false,
          status: sanitizeDescription(payload.safeStatus),
          ...meta,
        });
        break;
      }
      case 'tool_completed': {
        const id = String(payload.toolUseId || '');
        if (!id || completedToolUseIds.has(id)) break;
        completedToolUseIds.add(id);
        const startedAt = startedAtByToolUseId.get(id);
        const canonicalName = String(payload.canonicalToolName || toolNameByToolUseId.get(id) || '');
        if (typeof onToolStep === 'function') {
          onToolStep({
            id,
            label: toolStepLabel(canonicalName),
            done: true,
            elapsedMs: Number.isFinite(startedAt) ? Math.max(0, clock() - startedAt) : null,
            error: payload.isError === true,
            ...meta,
          });
        }
        break;
      }
      case 'canvas_result':
        if (typeof onCanvasResult === 'function') {
          onCanvasResult({
            toolUseId: payload.toolUseId || null,
            status: payload.status,
            envelope: payload.envelope,
            receipt: payload.receipt,
            ...meta,
          });
        }
        break;
      case 'subagent_updated':
        if (typeof onSubagentStep === 'function') {
          onSubagentStep({
            taskId: String(payload.taskId || ''),
            subtype: String(payload.subtype || ''),
            description: sanitizeDescription(payload.description),
            status: String(payload.status || ''),
            lastToolName: toolStepLabel(payload.lastCanonicalToolName || ''),
            elapsedMs: Number.isFinite(payload.elapsedMs) ? Math.max(0, payload.elapsedMs) : null,
            ...meta,
          });
        }
        break;
      case 'permission_denied':
        if (typeof onPermissionDenied === 'function') {
          onPermissionDenied({
            safeToolLabel: sanitizeDescription(payload.safeToolLabel),
            reasonCode: String(payload.reasonCode || 'DENIED'),
            ...meta,
          });
        }
        break;
      case 'usage_updated':
        if (typeof onUsage === 'function') onUsage(payload, meta);
        break;
      case 'warning':
        if (typeof onWarning === 'function') {
          onWarning({ code: String(payload.code || 'PROVIDER_WARNING'), safeMessage: sanitizeDescription(payload.safeMessage), ...meta });
        }
        break;
      default:
        break;
    }

    if (TERMINAL_EVENT_TYPES.has(event.type)) {
      terminalSeen = true;
      if (typeof onTerminal === 'function') onTerminal(event.type, payload, meta);
    }
    return { accepted: true };
  }

  return Object.freeze({
    route,
    snapshot() {
      return Object.freeze({ terminalSeen, activeTools: startedAtByToolUseId.size, completedTools: completedToolUseIds.size });
    },
  });
}

module.exports = {
  INTERNAL_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  createProviderEventRouter,
  sanitizeDescription,
  validateProviderEvent,
};


'use strict';

function hiddenGeometry(current = {}, patch = {}) {
  return {
    visible: false, titlebar: null, controls: null,
    zoomFactor: current.zoomFactor || 1,
    generation: current.generation || null,
    revision: current.revision || 0,
    ...patch,
  };
}

function normalizeRect(rect, zoomFactor, viewport) {
  if (!rect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))) return null;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((value) => Math.abs(value) <= 1_000_000)
    || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > viewport.width + 1 || y + height > viewport.height + 1) return null;
  return { x: x * zoomFactor, y: y * zoomFactor, width: width * zoomFactor, height: height * zoomFactor };
}

function validateGeometryUpdate({ current, payload = {}, zoomFactor, contentBounds }) {
  const generation = typeof payload.generation === 'string' && payload.generation.length > 0
    && payload.generation.length <= 128 ? payload.generation : null;
  const revision = Number(payload.revision);
  if (!generation || !Number.isSafeInteger(revision) || revision <= 0
    || (current.generation && generation !== current.generation)) {
    return { accepted: false, geometry: hiddenGeometry(current) };
  }
  if (revision <= current.revision) return { accepted: false, stale: true, geometry: current };

  const payloadZoomFactor = payload.zoomFactor;
  const zoomFactorsValid = typeof payloadZoomFactor === 'number'
    && Number.isFinite(payloadZoomFactor)
    && payloadZoomFactor >= 0.25 && payloadZoomFactor <= 5
    && typeof zoomFactor === 'number'
    && Number.isFinite(zoomFactor)
    && zoomFactor >= 0.25 && zoomFactor <= 5;
  if (!zoomFactorsValid) {
    return { accepted: false, geometry: hiddenGeometry(current) };
  }

  const viewport = payload.viewport;
  const viewportValid = viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
    && viewport.width > 0 && viewport.height > 0
    && viewport.width <= 1_000_000 && viewport.height <= 1_000_000
    && Math.abs(viewport.width * zoomFactor - contentBounds.width) <= 2
    && Math.abs(viewport.height * zoomFactor - contentBounds.height) <= 2;
  const base = { generation, revision, zoomFactor };
  if (payload.visible !== true) {
    return { accepted: true, geometry: hiddenGeometry(current, base) };
  }
  const titlebar = viewportValid ? normalizeRect(payload.titlebar, zoomFactor, viewport) : null;
  const controls = viewportValid ? normalizeRect(payload.controls, zoomFactor, viewport) : null;
  if (Math.abs(payloadZoomFactor - zoomFactor) > 0.001 || !titlebar || !controls) {
    return { accepted: false, geometry: hiddenGeometry(current, base) };
  }
  return {
    accepted: true,
    geometry: { visible: true, titlebar, controls, ...base },
  };
}

function pointInRect(point, rect) {
  return Boolean(rect)
    && point.x >= rect.x && point.x < rect.x + rect.width
    && point.y >= rect.y && point.y < rect.y + rect.height;
}

module.exports = { hiddenGeometry, pointInRect, validateGeometryUpdate };

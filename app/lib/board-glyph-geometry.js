'use strict';

const DEFAULT_READABILITY_BOARD_IDS = Object.freeze([
  '2SKU-1', '2R3M-1', '13BC-2', '2QFO-2', '13K0-2', '135M-2',
]);

// This function is deliberately self-contained: the Electron verifier serializes
// it into the renderer process with Function#toString, where CommonJS helpers
// are not available.
function collectGlyphFindings(candidates, pairedRecords, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
  const cap = Number.isInteger(options.cap) && options.cap >= 0 ? options.cap : 20;
  const list = Array.isArray(candidates) ? candidates : [];
  const pairs = Array.isArray(pairedRecords) ? pairedRecords : [];
  const textOf = (entry) => String((entry && entry.text) || '');
  const nameOf = (entry) => String((entry && (entry.owner_name || entry.name)) || '');
  const number = (value) => Number.isFinite(value) ? value : 0;
  const rectKey = (rect) => [rect.left, rect.top, rect.right, rect.bottom].join(':');
  const normalizeRect = (rect) => {
    if (!rect || rect.hidden) return null;
    const left = number(rect.left);
    const top = number(rect.top);
    const right = number(rect.right);
    const bottom = number(rect.bottom);
    if (!(right > left) || !(bottom > top)) return null;
    return { left, top, right, bottom };
  };
  const fragmentsFor = (entry) => {
    if (!entry || entry.hidden) return [];
    const seen = new Set();
    return (Array.isArray(entry.fragments) ? entry.fragments : [])
      .map(normalizeRect)
      .filter((rect) => {
        if (!rect || seen.has(rectKey(rect))) return false;
        seen.add(rectKey(rect));
        return true;
      })
      .sort((left, right) => (left.top - right.top) || (left.left - right.left)
        || (left.bottom - right.bottom) || (left.right - right.right));
  };
  const lineCount = (fragments) => {
    const rows = [];
    for (const rect of fragments) {
      let row = null;
      let best = tolerance;
      for (const current of rows) {
        const overlap = Math.min(current.bottom, rect.bottom) - Math.max(current.top, rect.top);
        if (overlap > best) {
          row = current;
          best = overlap;
        }
      }
      if (!row) rows.push({ top: rect.top, bottom: rect.bottom });
      else {
        row.top = Math.min(row.top, rect.top);
        row.bottom = Math.max(row.bottom, rect.bottom);
      }
    }
    return rows.length;
  };
  const overlap = (left, right) => {
    const width = Math.min(left.right, right.right) - Math.max(left.left, right.left);
    const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
    if (width <= tolerance || height <= tolerance) return null;
    return { width, height, area: width * height };
  };
  const ancestors = (entry) => new Set(Array.isArray(entry.ancestors) ? entry.ancestors : []);
  const related = (left, right) => {
    if (!left || !right || left.owner === right.owner) return true;
    const leftAncestors = ancestors(left);
    const rightAncestors = ancestors(right);
    return leftAncestors.has(right.owner) || rightAncestors.has(left.owner)
      || leftAncestors.has(right.node) || rightAncestors.has(left.node);
  };
  const atomic = [];
  for (const entry of list) {
    if (!entry || !entry.atomic || !entry.layout_owner) continue;
    const fragments = fragmentsFor(entry);
    const lines = lineCount(fragments);
    if (lines > 1) {
      atomic.push({
        node: String(entry.node || ''), name: String(entry.name || ''), owner: String(entry.owner || ''),
        owner_name: nameOf(entry), text: textOf(entry),
        layout_owner: String(entry.layout_owner), line_count: lines, fragments,
      });
    }
  }
  atomic.sort((left, right) => (left.node.localeCompare(right.node)) || left.owner.localeCompare(right.owner));

  const uniqueTextCandidates = [];
  const textCandidateByOwner = new Map();
  for (const entry of list) {
    if (!entry || entry.overlap === false) continue;
    const layoutItem = entry.layout_item || entry.layout_owner;
    const key = entry && entry.layout_owner && layoutItem && entry.owner
      ? `${entry.layout_owner}\u0000${layoutItem}\u0000${entry.owner}` : null;
    if (!key) continue;
    const existing = textCandidateByOwner.get(key);
    if (existing) {
      existing.fragments.push(...(Array.isArray(entry.fragments) ? entry.fragments : []));
      const nextText = textOf(entry);
      if (nextText) existing.text = [textOf(existing), nextText].filter(Boolean).join(' ');
      existing.ancestors = [...new Set([
        ...(Array.isArray(existing.ancestors) ? existing.ancestors : []),
        ...(Array.isArray(entry.ancestors) ? entry.ancestors : []),
      ])];
      existing.hidden = Boolean(existing.hidden && entry.hidden);
      continue;
    }
    const aggregate = {
      ...entry,
      fragments: [...(Array.isArray(entry.fragments) ? entry.fragments : [])],
      ancestors: [...(Array.isArray(entry.ancestors) ? entry.ancestors : [])],
    };
    textCandidateByOwner.set(key, aggregate);
    uniqueTextCandidates.push(aggregate);
  }
  const overlaps = [];
  for (let at = 0; at < uniqueTextCandidates.length; at += 1) {
    const left = uniqueTextCandidates[at];
    if (!left || left.hidden || !left.layout_owner) continue;
    const leftFragments = fragmentsFor(left);
    if (!leftFragments.length) continue;
    for (let next = at + 1; next < uniqueTextCandidates.length; next += 1) {
      const right = uniqueTextCandidates[next];
      const leftItem = left.layout_item || left.layout_owner;
      const rightItem = right && (right.layout_item || right.layout_owner);
      if (!right || right.hidden || left.layout_owner !== right.layout_owner
        || leftItem === rightItem || related(left, right)) continue;
      const rightFragments = fragmentsFor(right);
      if (!rightFragments.length) continue;
      let evidence = null;
      for (const leftFragment of leftFragments) {
        for (const rightFragment of rightFragments) {
          const pixels = overlap(leftFragment, rightFragment);
          if (pixels && (!evidence || pixels.area > evidence.pixels.area)) {
            evidence = { left_fragment: leftFragment, right_fragment: rightFragment, pixels };
          }
        }
      }
      if (evidence) {
        const first = String(left.node || '');
        const second = String(right.node || '');
        const ordered = first.localeCompare(second) <= 0
          ? {
            first_node: first, second_node: second,
            first_owner: String(left.owner || ''), second_owner: String(right.owner || ''),
            first_name: nameOf(left), second_name: nameOf(right),
            first_text: textOf(left), second_text: textOf(right),
          }
          : {
            first_node: second, second_node: first,
            first_owner: String(right.owner || ''), second_owner: String(left.owner || ''),
            first_name: nameOf(right), second_name: nameOf(left),
            first_text: textOf(right), second_text: textOf(left),
          };
        overlaps.push({ ...ordered, layout_owner: String(left.layout_owner), ...evidence });
      }
    }
  }
  overlaps.sort((left, right) => (left.first_node.localeCompare(right.first_node))
    || left.second_node.localeCompare(right.second_node));

  const paired = [];
  for (const record of pairs) {
    if (!record || record.hidden) continue;
    const source = String(record.source || '');
    const violations = [];
    if (!record.source_found) violations.push('missing_source');
    if (record.mirror_has_identity) violations.push('mirror_has_mount_identity');
    if (!record.label_found) violations.push('missing_label');
    if (record.source_found && record.mirror_text !== record.source_text) violations.push('stale_mirror');
    for (const violation of violations) paired.push({ source, violation });
  }
  paired.sort((left, right) => (left.source.localeCompare(right.source)) || left.violation.localeCompare(right.violation));
  const report = (items) => ({ total: items.length, items: items.slice(0, cap) });
  return {
    atomic_wrap_nodes: report(atomic),
    text_overlap_nodes: report(overlaps),
    paired_semantics_violations: report(paired),
  };
}

function collectAtomicWrapFindings(candidates, options) {
  return collectGlyphFindings(candidates.map((entry) => ({ ...entry, atomic: true })), [], options)
    .atomic_wrap_nodes;
}

function collectTextOverlapFindings(candidates, options) {
  return collectGlyphFindings(candidates, [], options).text_overlap_nodes;
}

function collectPairedSemanticFindings(records, options) {
  return collectGlyphFindings([], records, options).paired_semantics_violations;
}

function visualLineCount(fragments, tolerance = 1) {
  const result = collectGlyphFindings([{ node: 'line-count', owner: 'line-count', layout_owner: 'test', atomic: true, fragments }], [], {
    tolerance, cap: 1,
  }).atomic_wrap_nodes;
  if (result.total) return result.items[0].line_count;
  return (Array.isArray(fragments) ? fragments : []).some((fragment) => (
    fragment && !fragment.hidden && fragment.right > fragment.left && fragment.bottom > fragment.top
  )) ? 1 : 0;
}

function overlapArea(left, right, tolerance = 1) {
  const result = collectGlyphFindings([
    { node: 'left', owner: 'left', layout_owner: 'test', layout_item: 'left', fragments: [left] },
    { node: 'right', owner: 'right', layout_owner: 'test', layout_item: 'right', fragments: [right] },
  ], [], { tolerance, cap: 1 }).text_overlap_nodes;
  return result.total ? result.items[0].pixels.area : 0;
}

async function waitForStableLayout(options = {}) {
  const readSignature = options.readSignature;
  if (typeof readSignature !== 'function') throw new TypeError('readSignature must be a function');
  const requestFrame = options.requestFrame || ((callback) => globalThis.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || ((handle) => globalThis.cancelAnimationFrame(handle));
  const setTimer = options.setTimer || ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimer = options.clearTimer || ((handle) => globalThis.clearTimeout(handle));
  const now = options.now || (() => (
    globalThis.performance && typeof globalThis.performance.now === 'function'
      ? globalThis.performance.now() : Date.now()
  ));
  const deadlineMs = Number.isFinite(options.deadlineMs) ? options.deadlineMs : 3000;
  const timerMs = Number.isFinite(options.timerMs) ? options.timerMs : 50;
  const maxSamples = Number.isInteger(options.maxSamples) ? options.maxSamples : 180;
  const requiredStableSamples = Number.isInteger(options.requiredStableSamples)
    ? options.requiredStableSamples : 4;
  const fontsReady = options.fontsReady || null;
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;
  const layoutTimeout = (samples = 0) => new Error(
    `layout did not stabilize within ${deadlineMs}ms after ${samples} samples`,
  );
  let fontReadyTimedOut = false;
  if (fontsReady) {
    await new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimer(timeout);
        if (error) reject(error);
        else resolve();
      };
      const remainingMs = deadlineAt - now();
      if (remainingMs <= 0) {
        fontReadyTimedOut = true;
        finish(new Error(`fonts did not settle within ${deadlineMs}ms`));
        return;
      }
      timeout = setTimer(() => {
        fontReadyTimedOut = true;
        finish(new Error(`fonts did not settle within ${deadlineMs}ms`));
      }, remainingMs);
      Promise.resolve(fontsReady).then(() => {
        if (now() >= deadlineAt) {
          fontReadyTimedOut = true;
          finish(new Error(`fonts did not settle within ${deadlineMs}ms`));
          return;
        }
        finish();
      }, finish);
    });
  }
  const fontReadyMs = now() - startedAt;
  if (now() >= deadlineAt) throw layoutTimeout();
  return new Promise((resolve, reject) => {
    let done = false;
    let previous = null;
    let stable = 0;
    let samples = 0;
    let frameHandle = null;
    let timerHandle = null;
    let deadlineHandle = null;
    const finish = (error, result = null) => {
      if (done) return;
      done = true;
      if (frameHandle !== null) cancelFrame(frameHandle);
      if (timerHandle !== null) clearTimer(timerHandle);
      if (deadlineHandle !== null) clearTimer(deadlineHandle);
      if (error) reject(error);
      else resolve(result);
    };
    const sample = (tickSource) => {
      if (done) return;
      if (frameHandle !== null) cancelFrame(frameHandle);
      if (timerHandle !== null) clearTimer(timerHandle);
      frameHandle = null;
      timerHandle = null;
      if (now() >= deadlineAt) {
        finish(layoutTimeout(samples));
        return;
      }
      samples += 1;
      const signature = String(readSignature());
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= requiredStableSamples) {
        const resolvedAt = now();
        if (resolvedAt >= deadlineAt) {
          finish(layoutTimeout(samples));
          return;
        }
        finish(null, {
          signature,
          samples,
          tick_source: tickSource,
          elapsed_ms: resolvedAt - startedAt,
          fonts_ready_ms: fontReadyMs,
          fonts_ready_timed_out: fontReadyTimedOut,
          timed_out: false,
        });
        return;
      }
      if (samples >= maxSamples) {
        finish(new Error(`layout did not stabilize after ${samples} samples`));
        return;
      }
      frameHandle = requestFrame(() => sample('animation_frame'));
      timerHandle = setTimer(() => sample('timer'), timerMs);
    };
    const remainingMs = deadlineAt - now();
    if (remainingMs <= 0) {
      finish(layoutTimeout());
      return;
    }
    deadlineHandle = setTimer(() => finish(layoutTimeout(samples)), remainingMs);
    sample('initial');
  });
}

function assertReadability(boardId, preset, probe, { enforce = false } = {}) {
  const reports = [
    ['atomic_wrap_nodes', 'atomic_wrap_total'],
    ['text_overlap_nodes', 'text_overlap_total'],
    ['paired_semantics_violations', 'paired_semantics_total'],
  ];
  const schemaInvalid = !probe || reports.some(([itemsName, totalName]) => {
    const items = probe[itemsName];
    const total = probe[totalName];
    return !Array.isArray(items) || !Number.isInteger(total) || total < 0
      || total < items.length || (total <= 20 && total !== items.length);
  });
  const failures = [
    ...(schemaInvalid ? ['readability_schema'] : []),
    ...reports.filter(([, totalName]) => probe && probe[totalName] > 0).map(([itemsName]) => itemsName),
  ];
  if (enforce && failures.length) {
    throw new Error(`board ${boardId} ${preset.name}: readability ${failures.join(', ')}`);
  }
  return { enforced: Boolean(enforce), failures };
}

module.exports = {
  DEFAULT_READABILITY_BOARD_IDS,
  collectGlyphFindings,
  collectAtomicWrapFindings,
  collectTextOverlapFindings,
  collectPairedSemanticFindings,
  visualLineCount,
  overlapArea,
  waitForStableLayout,
  assertReadability,
};

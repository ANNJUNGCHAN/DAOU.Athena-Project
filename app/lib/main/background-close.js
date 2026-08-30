'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NOTICE_MARKER_NAME = '.athena-background-close-notice-v1.json';
function markerPath(dir) { return path.join(path.resolve(dir), NOTICE_MARKER_NAME); }
function markerExists(dir, fileSystem = fs) {
  try {
    const value = JSON.parse(fileSystem.readFileSync(markerPath(dir), 'utf8'));
    return value && value.version === 1 && typeof value.shownAt === 'string'
      && Number.isFinite(Date.parse(value.shownAt));
  } catch { return false; }
}
function writeShownMarker(dir, {
  fileSystem = fs, now = () => new Date(), uniqueId = () => crypto.randomUUID(),
} = {}) {
  const target = markerPath(dir);
  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  if (markerExists(dir, fileSystem)) return { durable: true, target, existing: true };
  const temp = `${target}.${process.pid}.${uniqueId()}.tmp`;
  let fd;
  try {
    fd = fileSystem.openSync(temp, 'wx');
    const shownAt = now().toISOString();
    fileSystem.writeFileSync(fd, `${JSON.stringify({ version: 1, shownAt })}\n`, 'utf8');
    fileSystem.fsyncSync(fd); fileSystem.closeSync(fd); fd = undefined;
    // The fully durable temp lives beside the target, so rename is the only
    // publication step. If it fails, the old final marker remains untouched.
    fileSystem.renameSync(temp, target);
    return { durable: true, target, shownAt };
  } catch (error) {
    if (fd !== undefined) { try { fileSystem.closeSync(fd); } catch {} fd = undefined; }
    try { fileSystem.unlinkSync(temp); } catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  }
}
function createNoticeController({ userDataDir, isSupported, showNotification,
  hasMarker = () => markerExists(userDataDir),
  persistMarker = () => writeShownMarker(userDataDir), log = () => {} }) {
  let memoryConsumed = false;
  const stats = { attempts: 0, shown: 0, durableWrites: 0, failures: 0 };
  function showOnce() {
    stats.attempts += 1;
    if (memoryConsumed) return { shown: false, reason: 'memory-consumed' };
    if (hasMarker()) { memoryConsumed = true; return { shown: false, reason: 'durable-marker' }; }
    if (!isSupported()) return { shown: false, reason: 'unsupported' };
    memoryConsumed = true;
    try { showNotification(); stats.shown += 1; }
    catch (error) {
      memoryConsumed = false; stats.failures += 1; log(error, 'notification-show');
      return { shown: false, reason: 'show-failed', error };
    }
    try {
      const persisted = persistMarker(); stats.durableWrites += 1;
      return { shown: true, durable: true, persisted };
    } catch (error) {
      stats.failures += 1; log(error, 'marker-write');
      return { shown: true, durable: false, error };
    }
  }
  return { showOnce, snapshot: () => ({ ...stats, memoryConsumed }) };
}
function createBackgroundEntry({ ensureTray, hideShell, ensureOrbVisible, showNotice, log = () => {} }) {
  return function enterBackground({ notice = false, source = 'unknown' } = {}) {
    let trayReady = false;
    try { ensureTray(); trayReady = true; }
    catch (error) { log(error, `tray:${source}`); }
    finally {
      try { hideShell(); } catch (error) { log(error, `hide:${source}`); }
      try { ensureOrbVisible(); } catch (error) { log(error, `orb:${source}`); }
    }
    return { trayReady, noticeResult: notice ? showNotice() : null };
  };
}
module.exports = { NOTICE_MARKER_NAME, markerPath, markerExists, writeShownMarker,
  createNoticeController, createBackgroundEntry };

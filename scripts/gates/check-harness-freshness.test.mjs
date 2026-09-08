import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = fileURLToPath(new URL("./check-harness-freshness.mjs", import.meta.url));
const supportingFiles = [
  "orb.html",
  "chat.js",
  "canvas.js",
  "shell.js",
  "orb.js",
  "lib/sidebar.js",
  "lib/sidebar-mode-nav.js",
  "lib/agent-canvas.js",
  "lib/settings-cards.js",
  "lib/auth-screen.js",
  "lib/ui-kit.js",
];

function runChecker(verifySource, { preloadSource = "// fixture\n", mainSource = "// fixture\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "athena-harness-freshness-"));
  const app = join(root, "app");
  mkdirSync(app, { recursive: true });
  const files = {
    "shell.html": '<main id="known"></main>',
    "preload.js": preloadSource,
    "main.js": mainSource,
    "verify.js": verifySource,
    "verify-settings.js": "",
    "verify-settings-cards.js": "",
  };
  for (const rel of supportingFiles) files[rel] = "";
  for (const [rel, source] of Object.entries(files)) {
    const path = join(app, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
  }
  try {
    return spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("DOM athena events are not treated as IPC channels", () => {
  const result = runChecker(`
document.addEventListener('athena:chat-submit', handler, true);
window.removeEventListener('athena:chat-submit', handler, true);
document.dispatchEvent(new CustomEvent('athena:chat-submit'));
`);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /harness freshness verification passed/);
});

test("an unknown real IPC channel still fails", () => {
  const result = runChecker("window.athena.invoke('athena:not-registered');");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /미등록 IPC 채널 'athena:not-registered'/);
});

test("a DOM event does not hide unknown IPC on the same line", () => {
  const result = runChecker(
    "document.addEventListener('athena:chat-submit', () => window.athena.invoke('athena:not-registered'));",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /미등록 IPC 채널 'athena:not-registered'/);
  assert.doesNotMatch(result.stderr, /미등록 IPC 채널 'athena:chat-submit'/);
});

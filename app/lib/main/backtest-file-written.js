'use strict';

// A saved-file event follows the completed backend write, never a proposal.
function savedFileMessage(input, result) {
  if (!input || !result || result.kind !== 'file_written' || result.status !== 'written') return null;
  if (typeof input.source !== 'string' || typeof input.path !== 'string') return null;
  if (result.project_id !== input.project_id || result.path !== input.path
      || result.root_path !== input.root_path) return null;
  return { ...result, source: input.source };
}

module.exports = { savedFileMessage };

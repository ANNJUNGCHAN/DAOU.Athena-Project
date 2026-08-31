'use strict';

const protocol = require('./codex-app-server-protocol');

class CodexJsonlRpcClient extends protocol.CodexAppServerProtocol {}

module.exports = {
  ...protocol,
  CodexJsonlRpcClient,
};

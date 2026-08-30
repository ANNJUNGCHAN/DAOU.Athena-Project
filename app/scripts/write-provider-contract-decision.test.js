'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CLAUDE_REQUIRED_GATES,
  CODEX_REQUIRED_GATES,
  decideProviderContract,
  validateDecision,
} = require('./write-provider-contract-decision');

function provider(version, gates) {
  return { version, sha256: 'a'.repeat(64), gates };
}

function allTrue(names) {
  return Object.fromEntries(names.map((name) => [name, true]));
}

test('decision is GO only when every Claude and Codex live gate is true', () => {
  const decision = decideProviderContract(
    provider('0.3.251', allTrue(CLAUDE_REQUIRED_GATES)),
    provider('0.147.0', allTrue(CODEX_REQUIRED_GATES)),
  );
  validateDecision(decision);
  assert.equal(decision.decision, 'GO');
  assert.equal(decision.rolloutAuthorization.productionRolloutAllowed, false);
});

test('production rollout requires every separate legal and authentication-topology gate', () => {
  const rollout = {
    productionRolloutAllowed: true,
    scope: 'approved-production',
    gates: {
      commercialTermsConfirmed: true,
      deploymentTopologyConfirmed: true,
      endUserOwnedCredentials: true,
      noClaudeAiCredentialIntermediation: true,
      bundledAuthUnmodified: true,
      privacyTelemetryDisclosureConfirmed: true,
    },
  };
  const decision = decideProviderContract(
    provider('0.3.251', allTrue(CLAUDE_REQUIRED_GATES)),
    provider('0.147.0', allTrue(CODEX_REQUIRED_GATES)),
    rollout,
  );
  validateDecision(decision);
  assert.equal(decision.rolloutAuthorization.productionRolloutAllowed, true);
  assert.deepEqual(decision.rolloutAuthorization.failedGates, []);

  rollout.gates.commercialTermsConfirmed = false;
  const blocked = decideProviderContract(
    provider('0.3.251', allTrue(CLAUDE_REQUIRED_GATES)),
    provider('0.147.0', allTrue(CODEX_REQUIRED_GATES)),
    rollout,
  );
  assert.equal(blocked.rolloutAuthorization.productionRolloutAllowed, false);
  assert.deepEqual(blocked.rolloutAuthorization.failedGates, ['commercialTermsConfirmed']);
});

test('decision is CLAUDE_ONLY when Claude is proven but private Codex auth/security is not', () => {
  const codexGates = allTrue(CODEX_REQUIRED_GATES);
  codexGates.privateAuthReady = false;
  codexGates.builtinCapabilityNegativeProbe = false;
  const decision = decideProviderContract(
    provider('0.3.251', allTrue(CLAUDE_REQUIRED_GATES)),
    provider('0.147.0', codexGates),
  );
  validateDecision(decision);
  assert.equal(decision.decision, 'CLAUDE_ONLY');
  assert.equal(decision.providers.codex.enabled, false);
  assert.ok(decision.failedGates.includes('codex.privateAuthReady'));
});

test('decision is NO_GO when the persistent Claude contract drifts', () => {
  const claudeGates = allTrue(CLAUDE_REQUIRED_GATES);
  claudeGates.warmQueryTypes = false;
  const decision = decideProviderContract(
    provider('0.3.251', claudeGates),
    provider('0.147.0', allTrue(CODEX_REQUIRED_GATES)),
  );
  validateDecision(decision);
  assert.equal(decision.decision, 'NO_GO');
  assert.equal(decision.providers.claude.enabled, false);
});

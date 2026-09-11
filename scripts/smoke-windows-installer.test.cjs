'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { contentReadyState } = require('./smoke-windows-installer.cjs');

function onboardingState(overrides = {}) {
  return {
    documentVisibility: 'visible',
    bootVisible: false,
    shellVisible: false,
    textSample: '',
    onboardingVisible: true,
    shellBlockedForOnboarding: true,
    onboardingTextLength: 120,
    ...overrides,
  };
}

test('hidden onboarding DOM is not content ready', () => {
  assert.equal(contentReadyState(onboardingState({ documentVisibility: 'hidden' })), false);
});

test('visible document without ready shell or onboarding is not content ready', () => {
  assert.equal(contentReadyState(onboardingState({
    onboardingVisible: false,
    shellBlockedForOnboarding: false,
    onboardingTextLength: 0,
  })), false);
});

test('visible populated onboarding with the shell blocked is content ready', () => {
  assert.equal(contentReadyState(onboardingState()), true);
});

test('overlapping shell and onboarding surfaces are not content ready', () => {
  assert.equal(contentReadyState(onboardingState({
    shellVisible: true,
    shellBlockedForOnboarding: false,
    textSample: 'Athena shell and onboarding overlap',
  })), false);
});

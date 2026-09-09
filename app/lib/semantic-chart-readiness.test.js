'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isFinalChartPrimary } = require('./semantic-chart-readiness');

function chartCard() {
  let chartBody = { querySelector: (selector) => (selector === 'canvas' ? {} : null) };
  const card = {
    dataset: {
      renderState: 'loading',
      chartAuthority: 'AITS',
      chartPanelId: 'aits:fixture:chart',
    },
    querySelector: (selector) => (selector === '.chart-card-body' ? chartBody : null),
    rejectMount() {
      chartBody = null;
      this.dataset.renderState = 'error';
      delete this.dataset.chartAuthority;
      delete this.dataset.chartPanelId;
      delete this.__athenaChartSessionId;
    },
    finishMount() {
      this.dataset.renderState = 'data';
      this.__athenaChartSessionId = 'aits:fixture:chart:session';
    },
  };
  return card;
}

test('차트 본문과 임시 panel id가 있어도 로딩 뒤 마운트 거부면 완료가 아니다', () => {
  const card = chartCard();
  assert.equal(isFinalChartPrimary(card), false);
  card.rejectMount();
  assert.equal(isFinalChartPrimary(card), false);
});

test('data 상태와 확정 세션 및 실제 canvas가 함께 있어야 완료다', () => {
  const card = chartCard();
  card.finishMount();
  assert.equal(isFinalChartPrimary(card), true);
});

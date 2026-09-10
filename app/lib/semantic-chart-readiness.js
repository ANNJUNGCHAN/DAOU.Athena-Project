'use strict';

function isFinalChartPrimary(card) {
  if (!card || !card.dataset || card.dataset.renderState !== 'data') return false;
  if (card.dataset.chartAuthority !== 'AITS') return false;
  if (typeof card.__athenaChartSessionId !== 'string' || !card.__athenaChartSessionId.trim()) {
    return false;
  }
  const body = typeof card.querySelector === 'function'
    ? card.querySelector('.chart-card-body') : null;
  return Boolean(body && typeof body.querySelector === 'function' && body.querySelector('canvas'));
}

module.exports = { isFinalChartPrimary };

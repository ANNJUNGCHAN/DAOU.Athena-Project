'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fetchTicketCapacity, CASH_PATH, HOLDINGS_PATH } = require('./ticket-capacity');

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('매수여력은 ord_alow_amt, 보유는 종목 행의 매매가능수량이다', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    if (String(url).endsWith(CASH_PATH)) {
      return jsonRes(200, { ord_alow_amt: '0000000008810000' });
    }
    return jsonRes(200, {
      acnt_evlt_remn_indv_tot: [
        { stk_cd: 'A005930', trde_able_qty: '000000000000040', rmnd_qty: '000000000000050' },
      ],
    });
  };
  const cap = await fetchTicketCapacity({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl,
    symbol: '005930',
  });
  assert.equal(cap.ok, true);
  assert.equal(cap.buyingPower, 8810000);
  assert.equal(cap.holdings, 40);
  assert.deepEqual(seen.map((row) => row.url.split('8010')[1]), [CASH_PATH, HOLDINGS_PATH]);
  assert.deepEqual(seen[0].body, { qry_tp: '3' });
  assert.deepEqual(seen[1].body, { qry_tp: '2', dmst_stex_tp: 'KRX' });
});

test('조회 실패·픽스처는 잔고를 짓지 않는다', async () => {
  const fixture = await fetchTicketCapacity({ fixture: true, symbol: '005930' });
  assert.equal(fixture.ok, false);
  assert.equal(fixture.buyingPower, null);
  assert.equal(fixture.holdings, null);
  const failed = await fetchTicketCapacity({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl: async () => { throw new Error('down'); },
    symbol: '005930',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.buyingPower, null);
  assert.equal(failed.holdings, null);
});

test('메인·프리로드·셸이 조회 채널을 연다', () => {
  const appDir = path.join(__dirname, '..', '..');
  const main = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
  const chat = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  assert.match(main, /athena:ticket-capacity/);
  assert.match(main, /ATHENA_CANVAS_SOURCE === 'fixture'/);
  assert.match(preload, /'athena:ticket-capacity'/);
  assert.match(chat, /athena:ticket-capacity/);
});

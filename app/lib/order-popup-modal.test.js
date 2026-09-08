const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chatSource = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const prepareRestReceiptSurface = chatSource.match(
  /function prepareRestReceiptSurface\(\) \{[\s\S]*?\n\}/
);

test('주문 모달 중 영수증 복귀는 배경 셸의 inert 잠금을 해제한다', () => {
  assert.ok(prepareRestReceiptSurface, 'prepareRestReceiptSurface source exists');
  const nodes = {
    onboard: { hidden: true },
    boot: { hidden: false },
    settings: { hidden: false },
    order: { hidden: false },
    shell: { inert: true },
    app: { hidden: false },
  };
  const context = { nodes };

  vm.runInNewContext(`
    const $onboard = nodes.onboard;
    const $boot = nodes.boot;
    const $settings = nodes.settings;
    const $order = nodes.order;
    const $shell = nodes.shell;
    const $app = nodes.app;
    let settingsOpen = false;
    let orderOpen = true;
    ${prepareRestReceiptSurface[0]}
    result = prepareRestReceiptSurface();
    finalState = { settingsOpen, orderOpen };
  `, context);

  assert.equal(context.result, true);
  assert.equal(nodes.order.hidden, true);
  assert.equal(nodes.app.hidden, false);
  assert.equal(nodes.shell.inert, false);
  assert.deepEqual(
    { ...context.finalState },
    { settingsOpen: false, orderOpen: false }
  );
});

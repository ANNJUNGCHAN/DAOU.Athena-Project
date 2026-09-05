'use strict';

// Paper `.tree.txt` 정규형 파서 — 원장 추출기와 템플릿 추출기가 낸 두 표기를
// 같은 레코드 배열로 접는다. 기하(`W×H`)는 여기서 버린다(설계서 §8 3번:
// fit-content 붕괴로 0×0을 적은 노드가 많아 게이트가 원장 height로 판정하면 안 된다).
//
// 원래 `scripts/paper-cards-static.mjs` 안에 있었다. 카드미니 게이트가 정적(ESM)과
// 런타임(CJS electron 프로브) 양쪽에서 같은 트리를 읽어야 해서 CJS 한 곳으로 옮겼다 —
// 파서를 복사하면 두 게이트가 서로 다른 트리를 보게 되고, 그때 나오는 어긋남은
// Paper가 만든 것이 아니라 우리 코드가 만든 것이 된다.

/**
 * 트리 한 줄의 머리. 뒤따르는 텍스트 내용은 줄을 넘길 수 있으므로 여기서 닫지 않는다 —
 * 원장 추출기는 텍스트 안 개행을 실제 개행으로 적어 한 노드가 여러 줄을 차지한다.
 */
const RECORD_HEAD = /^( *)(Text|Frame|Rectangle|SVGVisualElement|SVG) "(.*)" \(([^()]+)\) (\d+)×(\d+)(?: (.*))?$/;

/**
 * `.tree.txt` 원문을 레코드 배열로 접는다.
 * @returns {{depth:number, kind:string, name:string, id:string, text:string}[]}
 */
function parseTreeRecords(raw) {
  const records = [];
  for (const line of raw.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')) {
    const match = line.match(RECORD_HEAD);
    if (match) {
      records.push({
        depth: match[1].length / 2,
        kind: match[2],
        name: match[3],
        id: match[4],
        text: match[7] ?? '',
      });
    } else if (records.length) {
      records[records.length - 1].text += '\n' + line;
    }
  }
  for (const record of records) {
    let text = record.text;
    if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
    // 실제 개행을 두 글자 `\n`으로 접어 두 추출기의 개행 표기를 맞춘다.
    record.text = text.replace(/\n/g, '\\n');
  }
  return records;
}

module.exports = { RECORD_HEAD, parseTreeRecords };

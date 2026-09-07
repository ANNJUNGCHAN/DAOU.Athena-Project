'use strict';

// Paper 원장 한 장 만들기 — `<page>/<board>.tree.txt`(get_tree_summary 원문)를 파싱해
// 같은 자리 `<board>.json`을 쓴다. 형상은 인계 §3.4가 지시한 그대로다:
// {board_id, page, page_name, name, width, height, texts[{id,text,path}],
//  frames[{id,name,component,w,h,depth}], text_multiset, exported_at, tree_summary_sha256}
//
//   node docs/handoff/card-buttons/tools/build-ledger.js <page> <page_name> <board...>   (저장소 루트에서)
//
// 트리 요약의 **이름**은 30자에서 잘리지만(`…`) Text 줄 끝의 본문은 잘리지 않는다 —
// 그래서 다중집합·texts는 본문에서 세고 이름은 경로에만 쓴다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER = 'backend/ref/paper-ledger';
const LINE = /^(\s*)([A-Za-z]+) "(.*?)" \((\S+?)\) (\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)(?: "([\s\S]*)")?$/;

function parse(tree) {
  const records = [];
  for (const line of tree.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(LINE);
    if (!match) throw new Error(`트리 줄을 못 읽었다 — ${line.slice(0, 120)}`);
    records.push({
      depth: match[1].length / 2,
      component: match[2],
      name: match[3],
      id: match[4],
      w: Number(match[5]),
      h: Number(match[6]),
      text: match[7] === undefined ? null : match[7],
    });
  }
  return records;
}

function build(page, pageName, board) {
  const treePath = path.join(LEDGER, page, `${board}.tree.txt`);
  const tree = fs.readFileSync(treePath, 'utf8');
  const records = parse(tree);
  const root = records[0];

  const ancestors = [];
  const texts = [];
  const frames = [];
  const multiset = {};
  for (const record of records) {
    ancestors[record.depth] = record.name;
    const trail = ancestors.slice(0, record.depth);
    if (record.component === 'Text') {
      const text = record.text ?? record.name;
      texts.push({ id: record.id, text, path: trail });
      multiset[text] = (multiset[text] ?? 0) + 1;
    } else {
      frames.push({
        id: record.id,
        name: record.name,
        component: record.component,
        w: record.w,
        h: record.h,
        depth: record.depth,
      });
    }
  }

  const payload = {
    board_id: board,
    page,
    page_name: pageName,
    name: root.name,
    width: root.w,
    height: root.h,
    texts,
    frames,
    text_multiset: multiset,
    exported_at: new Date().toISOString().slice(0, 10),
    tree_summary_sha256: crypto.createHash('sha256').update(tree, 'utf8').digest('hex'),
  };
  fs.writeFileSync(path.join(LEDGER, page, `${board}.json`), `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
  console.log(`${board}: texts ${texts.length} · frames ${frames.length} · 다중집합 ${Object.keys(multiset).length}`);
}

const [page, pageName, ...boards] = process.argv.slice(2);
for (const board of boards) build(page, pageName, board);

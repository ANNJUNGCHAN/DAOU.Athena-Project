'use strict';

// 저작 바인딩 이식 — 2X5N-0(당일 거래량)에서 복제한 보드들은 노드 id가 새로 생겨
// 도너의 slots.json 저작물(mapping_id·f·kor·format·kind·static·note)을 물려받지 못한다.
// 추출기는 저작 열쇠를 **node_id로** 이어 붙이므로(merge_authored), 새 보드의 생성된
// slots.json에 같은 자리(node_path·문구)를 찾아 그 값을 적어 두면 다음 추출에서도 살아남는다.
//
//   node docs/handoff/card-buttons/tools/port-slots.js <donor> <target...>   (저장소 루트에서)

const fs = require('fs');
const path = require('path');

const ROOT = 'backend/ref/card-surface-templates';
const AUTHORED = [
  'kind', 'mapping_id', 'f', 'json_path', 'alt_mappings', 'kor', 'format',
  'static', 'static_reason', 'note', 'extra_fields',
];

function readSlots(board) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, board, 'slots.json'), 'utf8'));
}

function pick(slot) {
  const out = {};
  for (const key of AUTHORED) {
    const value = slot[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    out[key] = value;
  }
  return out;
}

function main() {
  const [donorId, ...targets] = process.argv.slice(2);
  const donor = readSlots(donorId);
  const byPath = new Map();
  const byText = new Map();
  for (const slot of donor.slots) {
    byPath.set(slot.node_path, slot);
    if (!byText.has(slot.paper_text)) byText.set(slot.paper_text, []);
    byText.get(slot.paper_text).push(slot);
  }

  for (const target of targets) {
    const payload = readSlots(target);
    const pairs = new Map(); // donor slot_id -> new slot_id
    let ported = 0;
    let missed = 0;
    for (const slot of payload.slots) {
      const samePath = byPath.get(slot.node_path);
      const sameText = byText.get(slot.paper_text) || [];
      let source = null;
      if (samePath && samePath.paper_text === slot.paper_text) source = samePath;
      else if (sameText.length === 1) source = sameText[0];
      else if (samePath && samePath.region === slot.region) source = samePath;
      if (!source) { missed += 1; continue; }
      Object.assign(slot, pick(source));
      pairs.set(source.slot_id, slot.slot_id);
      ported += 1;
    }
    // 병기 짝은 슬롯 id를 가리킨다 — 새 id로 옮겨 적지 않으면 끊긴 참조가 된다.
    let paired = 0;
    for (const slot of payload.slots) {
      const samePath = byPath.get(slot.node_path);
      const donorSlot = samePath && samePath.paper_text === slot.paper_text
        ? samePath
        : (byText.get(slot.paper_text) || []).length === 1
          ? byText.get(slot.paper_text)[0]
          : samePath;
      if (!donorSlot || !donorSlot.paired_with) continue;
      const mapped = pairs.get(donorSlot.paired_with);
      if (!mapped) continue;
      slot.paired_with = mapped;
      paired += 1;
    }
    // 표 열 묶음·열 우선순위·구역 제목은 슬롯 id를 안 가리킨다 — 순서대로 옮긴다.
    const donorTables = donor.column_bindings || [];
    const targetTables = payload.column_bindings || [];
    for (let i = 0; i < targetTables.length && i < donorTables.length; i += 1) {
      for (const column of targetTables[i].columns || []) {
        const source = (donorTables[i].columns || []).find((item) => item.col === column.col);
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
          if (['col', 'data_col', 'header', 'slot_ids'].includes(key)) continue;
          if (value === null || value === undefined) continue;
          column[key] = value;
        }
      }
    }
    if (donor.column_priority) payload.column_priority = donor.column_priority;
    if (donor.section_titles_ko) payload.section_titles_ko = donor.section_titles_ko;

    fs.writeFileSync(
      path.join(ROOT, target, 'slots.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
    const mapped = payload.slots.filter((slot) => slot.mapping_id).length;
    console.log(`${target}: 이식 ${ported} · 못 찾음 ${missed} · 병기 ${paired} · mapping_id ${mapped}`);
  }
}

main();

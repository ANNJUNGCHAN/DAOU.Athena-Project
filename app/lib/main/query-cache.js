// 시맨틱 질의 캐시(L1 완전일치) — 2026-08-19 사용자 보고 "아직 느리다"의 대응.
//
// 규칙 기반 신규 판단이 아니라 **이미 내린 LLM 판정의 재사용**이다(AITS
// canvas_intent_cache의 정당화 논리 — plan/AITS-참고-매커니즘 §2-1). 저장하는
// 것은 판정(어떤 오퍼레이션을 어떤 인자로, 어떤 카드로)뿐이고 **데이터는
// 리플레이 때마다 새로 조회**한다 — 신선도 문제가 없다. 메모리 전용(디스크
// 직렬화 없음), TTL·상한으로 무한 성장 방지.
//
// L2(정규형·동의 표현)는 미구현 — L1은 "같은 질문을 다시 했을 때"만 잡는다.
// 실측으로 가치가 확인되면 AITS의 잔여 토큰 부분집합 방식을 이식한다.
'use strict';

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30분 — 판정(라우팅)은 데이터보다 오래 유효하다
const DEFAULT_MAX_ENTRIES = 200;

// 완전일치 전 정규화 — 대소문자·공백·말미 문장부호만 다듬는다(의미 변형 없음).
function normalizeQuery(query) {
  return String(query || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.…~\s]+$/g, '')
    .toLowerCase();
}

class QueryCache {
  constructor(opts = {}) {
    this._ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this._maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._clock = opts.clock || Date.now;
    this._map = new Map(); // 삽입 순서 = FIFO 축출 순서
  }

  get(query) {
    const key = normalizeQuery(query);
    if (!key) return null;
    const entry = this._map.get(key);
    if (!entry) return null;
    if (this._clock() - entry.storedAt > this._ttlMs) {
      this._map.delete(key);
      return null;
    }
    return entry.judgment;
  }

  set(query, judgment) {
    const key = normalizeQuery(query);
    if (!key || !judgment) return;
    if (this._map.has(key)) this._map.delete(key); // 재삽입 — 최신이 뒤로
    this._map.set(key, { storedAt: this._clock(), judgment });
    while (this._map.size > this._maxEntries) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  invalidate(query) {
    this._map.delete(normalizeQuery(query));
  }

  size() {
    return this._map.size;
  }
}

// UMD 불필요 — 메인 프로세스 전용 CommonJS.
module.exports = { QueryCache, normalizeQuery, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES };

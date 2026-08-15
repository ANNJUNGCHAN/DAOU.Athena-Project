# 과제 C — NAVER 스트림 정규화 어댑터 구현 · RESULT

## 판정: 통과 (프로토타입 동작 확인, 실측 dedupe 카운트 재현됨)

작업 디렉토리: `spike/stream-adapter/`. 새 API 호출 없음 — 기존 캡처 파일만 입력으로 사용.

---

## 구현한 파일

| 파일 | 내용 |
|---|---|
| `spike/stream-adapter/adapter.py` | 정규화 어댑터 본체 — sanitize, 시각 정규화, url 조합, 소스별 정규화 함수, dedupe(3단계), 캡처 로더, 태그 전수조사 유틸 |
| `spike/stream-adapter/test_adapter.py` | pytest 20건 — sanitize 순서 취약점, RFC822 파싱, `ts_precision`, dedupe 카운트, 혼합정밀도 정렬 |
| `spike/stream-adapter/pytest_output.txt` | 마지막 통과 실행 원문 로그 |
| `spike/mcp-client/.venv` | `pip`(없었음, `ensurepip`로 설치) + `pytest 9.1.1` 추가 설치 |

---

## 테스트 실행 결과 원문

```
$ .venv/Scripts/python.exe -m pytest test_adapter.py -v
============================= test session starts =============================
platform win32 -- Python 3.12.10, pytest-9.1.1, pluggy-1.6.0 -- .../python.exe
plugins: anyio-4.14.2
collecting ... collected 20 items

test_adapter.py::test_strip_tags_removes_b_tag PASSED                    [  5%]
test_adapter.py::test_unescape_entities PASSED                           [ 10%]
test_adapter.py::test_sanitize_order_strip_then_unescape PASSED          [ 15%]
test_adapter.py::test_sanitize_order_prevents_escaped_tag_resurrection PASSED [ 20%]
test_adapter.py::test_sanitize_none_passthrough PASSED                   [ 25%]
test_adapter.py::test_tag_audit_only_b_tag_found PASSED                  [ 30%]
test_adapter.py::test_normalize_news_ts_rfc822 PASSED                    [ 35%]
test_adapter.py::test_normalize_filing_ts_is_day_precision_no_invented_time PASSED [ 40%]
test_adapter.py::test_news_url_prefers_originallink PASSED               [ 45%]
test_adapter.py::test_news_url_falls_back_to_link_when_no_originallink PASSED [ 50%]
test_adapter.py::test_filing_url_composed_from_rcept_no PASSED           [ 55%]
test_adapter.py::test_normalize_news_item_shape PASSED                   [ 60%]
test_adapter.py::test_normalize_filing_item_shape_and_source_dart PASSED [ 65%]
test_adapter.py::test_normalize_filing_item_ticker_from_stock_code PASSED [ 70%]
test_adapter.py::test_dedupe_date_sort_matches_measured_zero_dups PASSED [ 75%]
test_adapter.py::test_dedupe_sim_sort_matches_measured_7_groups_15_items PASSED [ 80%]
test_adapter.py::test_dedupe_seen_hash_filters_cross_poll_repeat PASSED  [ 85%]
test_adapter.py::test_dedupe_no_raw_id_collisions_within_single_capture PASSED [ 90%]
test_adapter.py::test_combined_sort_mixed_precision_does_not_crash PASSED [ 95%]
test_adapter.py::test_combined_sort_filing_same_day_ordered_by_rcept_no PASSED [100%]

============================= 20 passed in 0.14s ==============================
```

**20/20 통과, 0 실패.**

---

## 실측 dedupe 카운트 — 이전 측정과 일치 확인

`CAPTURE-S2B-naver.md` §"중복도 측정"이 남긴 이전 실측치를 그대로 재현했다.

| 정렬 | 이전 실측 (CAPTURE 문서) | 이번 구현 (`dedupe()` 실행) | 일치 |
|---|---|---|---|
| `sort=date` (100건) | 정규화-제목 중복 그룹 0개 | `title_dup_groups=0`, `title_dup_covered_items=0`, `title_dup_items_removed=0` | ✅ |
| `sort=sim` (100건) | 7그룹 15건 중복 커버 | `title_dup_groups=7`, `title_dup_covered_items=15`, `title_dup_items_removed=8`(7그룹×1건 보존 후 제거분) | ✅ |

3단계 dedupe 실행 결과 전체 (직접 실행 `python adapter.py`):

```
date dedupe stats: {'seen_hash_filtered': 0, 'title_dup_groups': 0, 'title_dup_covered_items': 0, 'title_dup_items_removed': 0, 'domain_time_flagged': 0}
sim dedupe stats:  {'seen_hash_filtered': 0, 'title_dup_groups': 7, 'title_dup_covered_items': 15, 'title_dup_items_removed': 8, 'domain_time_flagged': 13}
```

### 각 단계가 실제로 무엇을 하는지 (사유 필드 근거)

1. **`seen_hash_filtered`** — raw_id(뉴스: `link`, 공시: `rcept_no`) 해시 기반 "이미 본 것" 제외. 단일 캡처 호출 내부에서는 두 정렬 모두 **0건**(raw_id 100% 유일 — `test_dedupe_no_raw_id_collisions_within_single_capture`로 확인). **이 단계의 실효는 여러 폴링 호출에 걸친 재등장 시에만 나타난다** — `test_dedupe_seen_hash_filters_cross_poll_repeat`로 동일 기사 재폴링 시나리오를 시뮬레이션해 3건 제외를 확인.
2. **`title_dup_groups` / `title_dup_covered_items` / `title_dup_items_removed`** — 태그 제거 + 비영숫자 제거로 정규화한 제목의 완전 매치. `sort=sim`에서 7그룹(예: "삼성전자 상반기 D램 점유율…" 이 `biz.chosun.com`/`www.yna.co.kr`/`news.sbs.co.kr` 3개 매체에 동일 제목으로 재배포)을 잡았고, 그룹당 1건만 남기고 나머지를 제거해 8건이 최종 제거됐다.
3. **`domain_time_flagged`(보조)** — 완전 제목 매치를 통과했지만 **다른 도메인 + 발행시각 ±15분 이내 + 제목 단어(2자 이상 토큰) 자카드 유사도 ≥0.6**인 쌍을 근접 중복 후보로 *플래그만* 한다(자동 제거하지 않음). `sort=date`는 0건, `sort=sim`은 13건(예: `"삼성전자, 딥러닝·데이터 전문가 영입…반도체 AX 가속"` vs `"삼성전자, '반도체 AX' 가속화…딥러닝·데이터 전문가 영입"` — 같은 사건을 다른 문구로 쓴 기사). **CAPTURE-S2B-naver.md**가 "구두점만 다른 경우는 정규화해도 놓치는 케이스가 있을 수 있다"고 명시한 케이스를 실제로 포착함 — 이번 구현이 그 공백을 메운다.

**구현 함정 하나 자체 발견·수정**: 3차 유사도를 처음엔 글자(character) 단위 자카드로 짰더니 한글 조사·흔한 숫자가 겹쳐서 무관한 기사("…455명…" 류 숫자 기사끼리)가 0.6+ 로 오탐됐다(`date` 정렬에서 7건 오탐 발생). **단어(2자 이상) 토큰 단위로 바꿔 재실행하니 `date`는 0건, `sim`은 실제 근접 중복 8쌍/13개 아이디만 남았다** — 이 수정이 최종 코드에 반영돼 있다.

---

## `<b>` 외 다른 태그 전수조사 결과

`test_tag_audit_only_b_tag_found` — `S2B-naver-news-date.json`(100건) + `S2B-naver-news-sim.json`(100건), 총 **200개 아이템**의 `title`·`description` 필드를 정규식(`<(/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>`)으로 전수 스캔.

**결과: `{'b'}` 하나뿐. `<b>` 외 다른 태그는 0건.**

이는 `plan/mcp-실행계획.md` §3의 "`<b>` 태그가 100/100 아이템 전부에" 기술과 일치하며, `CAPTURE-S2B-naver.md`가 명시하지 않았던 "다른 태그 유무"를 이번에 명시적으로 닫았다.

---

## 핵심 설계 확정 사항

### sanitize 순서 — strip_tags → unescape_entities (고정, 테스트로 잠금)

`test_sanitize_order_prevents_escaped_tag_resurrection`이 순서를 실증적으로 고정한다:
- **올바른 순서** (`strip → unescape`): `"안전 &lt;script&gt;alert(1)&lt;/script&gt; 문구"` → `"안전 <script>alert(1)</script> 문구"`. 이스케이프된 텍스트는 스트립 단계에서 아직 실제 태그가 아니므로 통과하고, 언이스케이프 이후에만 리터럴 텍스트로 복원된다 — **스트리퍼가 두 번 돌지 않으므로 사용자가 의도적으로 이스케이프해 넣은 문자열이 조용히 잘려나가지 않는다.**
- **반대 순서** (`unescape → strip`, 취약): 같은 입력이 `"안전 alert(1) 문구"`가 된다 — 언이스케이프가 먼저 일어나 `&lt;script&gt;`가 진짜 태그 모양(`<script>`)으로 부활한 뒤 스트리퍼에 걸려 사라진다. 두 경로가 서로 다른 결과를 내는 것을 테스트가 직접 비교·확인한다(`wrong_order != correct`).
- **검증 시 재확인(회의적 검토)**: `sanitize()`에 `"안전 &lt;script&gt;alert(1)&lt;/script&gt; 문구"`를 직접 넣어 재현 — 결과 문자열에 리터럴 `<script>alert(1)</script>`가 그대로 담긴다(코드 주석이 의도한 그대로, 조작 없음). **이 함수의 이름·역할은 어디까지나 "실제 NAVER 서식 태그(`<b>` 등)를 걷어내는 것"이지 "출력을 HTML로 렌더링해도 안전하게 만드는 것"이 아니다** — 실측 데이터(200/200 아이템)에는 이스케이프된 태그 패턴이 0건이라 지금은 이론적 케이스지만, `sanitize()` 반환값은 여전히 `<script>` 같은 리터럴 태그 문자열을 담을 수 있다. 게이트웨이 승격 시 이 필드(`title`/`summary`)는 **반드시 텍스트 노드로만 렌더링해야 하며, `innerHTML`/`dangerouslySetInnerHTML`/`v-html` 등으로 재해석해서는 안 된다** — 이 계약이 명시적으로 지켜지지 않으면 `sanitize()`라는 이름이 주는 "안전하다"는 인상과 달리 저장형 XSS 벡터가 된다. (현재 `ui/`에는 아직 이런 렌더링 코드가 없어 실제 취약점은 아니지만, 승격 전 계약으로 반드시 문서화해야 한다.)

### 시각 정규화

- 뉴스: `email.utils.parsedate_to_datetime`로 RFC822 → `datetime.isoformat()`. 실측 예: `"Sat, 15 Aug 2026 00:43:00 +0900"` → `"2026-08-15T00:43:00+09:00"`, `ts_precision="second"`.
- 공시: `rcept_dt`("20260814") → `date.fromisoformat` 경유 `"2026-08-14"`만 담는다. `ts_precision="day"`. **시각 문자열에 `"T"`나 `":"`가 절대 섞이지 않음을 테스트로 강제**(`test_normalize_filing_ts_is_day_precision_no_invented_time`) — 00:00을 지어내지 않는다.
- 혼합 정밀도 정렬: `sort_key()`가 day-precision 레코드를 **정렬 전용으로만** 00:00 KST에 앵커링한다. 저장되는 `ts` 필드 자체는 건드리지 않는다 — 정직성과 정렬 가능성을 분리했다. 동일 날짜 공시는 `rcept_no`를 보조 정렬키로 사용(사실상 시퀀스라는 계획서 관찰 반영).

### url 조합

- 뉴스: `originallink` 우선, 빈 문자열/없음이면 `link` 폴백.
- 공시: 서버가 URL을 주지 않으므로 `https://dart.fss.or.kr/dsaf001/main.do?rcept_no={rcept_no}` 조합.

### 소스 정규화

- 뉴스 `source`는 `url`(originallink 우선)에서 도메인을 추출(`urllib.parse.urlparse`, `www.` 접두사 제거). 예: `chosun.com`, `joongang.co.kr`.
- 공시 `source`는 서버가 안 주므로 게이트웨이가 고정값 `"DART"`를 부여(계획서 지시대로).

---

## 실행 방법 (재현 커맨드)

```bash
cd spike/stream-adapter
../mcp-client/.venv/Scripts/python.exe -m pytest test_adapter.py -v   # 테스트
../mcp-client/.venv/Scripts/python.exe adapter.py                     # 정규화+dedupe 데모 실행
```

`pytest`는 이번 작업에서 `spike/mcp-client/.venv`에 새로 설치했다(venv에 `pip` 자체가 없어 `python -m ensurepip --upgrade`로 먼저 pip을 깔고 `pip install pytest`).

---

## 게이트웨이(`backend/athena_mcp/`) 승격 시 옮겨야 할 것과 버려야 할 것

### 그대로 옮길 것 (검증 완료, 로직 재사용 가능)

- `sanitize()` / `strip_tags()` / `unescape_entities()`와 그 순서 — HTML 엔티티·`<b>` 하이라이트가 실제 응답에 계속 나올 것이므로 게이트웨이의 모든 뉴스류 어댑터에 공통 적용해야 한다. **단, 옮길 때 렌더링 계약을 함께 문서화할 것**: 이 함수는 순서상 이스케이프된 태그(`&lt;script&gt;...`)를 리터럴 `<script>...>` 문자열로 복원할 수 있다(§"핵심 설계 확정 사항"의 검증 시 재확인 참고) — `title`/`summary` 필드는 프론트에서 항상 텍스트 노드로만 렌더링해야 하고 `innerHTML` 계열로 재해석하면 안 된다.
- `normalize_news_ts()` / `normalize_filing_ts()` — RFC822/YYYYMMDD 파싱과 `ts_precision` 부여 규칙. 정밀도를 숨기지 않는다는 원칙(day에 시각을 지어내지 않음)은 다른 소스(예: 향후 붙일 리서치 리포트 MCP)에도 그대로 적용돼야 하는 일반 원칙이다.
- `dedupe()`의 **3단계 구조와 사유 필드**(`seen_hash_filtered` / `title_dup_*` / `domain_time_flagged`) — 알람 원장이 "왜 걸렀는지"를 보여줘야 한다는 `plan/감시에이전트-실행계획.md` §5 요구와 직결된다. 단 게이트웨이에서는 `seen_hash` 집합이 **프로세스 재시작을 넘어 영속화**돼야 실효가 있다(이번 프로토타입은 메모리 내 set — 단일 실행 범위에서만 유효).
- `sort_key()`의 "day는 정렬 전용 앵커, 저장 필드는 불변" 패턴.

### 승격 시 반드시 바꿔야 할 것

- **어댑터 등록 방식**: 지금은 뉴스/공시 각각 전용 함수(`normalize_news_item`/`normalize_filing_item`)로 하드코딩돼 있다. 게이트웨이는 서버별 스키마 매칭 규칙(§3 W3 "형상 감지는 AI가 아니라 스키마 매칭으로")을 등록 가능한 형태로 일반화해야 한다 — 지금처럼 소스 2종에 한정된 if/else 확장 방식은 서버가 늘면 안 버틴다.
- **`raw_id`의 `seen` 집합**: 인메모리 대신 영속 저장소(SQLite 등)로 옮기고, TTL/윈도 정책(무한정 쌓이면 안 된다)을 추가해야 한다.
- **`domain_time_flagged`의 임계값(±15분, 자카드 ≥0.6)**: 이번 스파이크에서 손으로 고른 값이다. 실측 데이터 1세트(200건)로만 튜닝됐으므로 게이트웨이 승격 전 더 큰 표본(하루치 폴링 로그 등)으로 재검증 필요 — `plan/감시에이전트-실행계획.md`가 "정량 게이트의 임계값은 원장이 쌓인 뒤 튜닝"이라고 명시한 항목과 동일한 처지다.
- **`source` 필드의 도메인 추출**: `urlparse`만 쓰는 단순 구현이라 서브도메인 정규화(`m.entertain.naver.com` vs `entertain.naver.com`)까지는 처리하지 않는다. 캔버스에서 "출처"를 사람이 읽을 매체명으로 보여주려면 도메인→매체명 매핑 테이블이 추가로 필요.

### 버릴 것

- `load_news_items()` / `load_filing_items()` / `audit_tags()` — 캡처 파일 전용 로더·조사 유틸이다. 게이트웨이에서는 라이브 `CallToolResult`를 직접 받으므로 이 파일 파싱 계층 자체가 필요 없다. 다만 `content[0].text`를 `json.loads()`하는 폴백 경로(§8 "structuredContent는 예외지 규칙이 아니다")는 게이트웨이의 공통 파싱 유틸로 옮겨야 한다 — 지금 로더 안에 묻혀 있는 이 부분만 승격 대상이다.
- `if __name__ == "__main__":` 데모 블록 — 스파이크 검증용. 게이트웨이는 이 자리를 실제 MCP 클라이언트 호출로 대체한다.

---

## 막힌 것 / 범위 밖으로 남긴 것

- **cross-poll dedupe의 raw_id `seen` 영속화는 시뮬레이션만 했다** — 실제 반복 폴링 로그가 없어(캡처가 단일 시점 스냅샷) 진짜 재등장 패턴으로 검증하지 못했다. `test_dedupe_seen_hash_filters_cross_poll_repeat`는 인위적으로 같은 레코드를 두 번 넣어 로직만 검증한 것이다.
- **`domain_time_flagged` 임계값의 일반화 가능성 미검증** — 위에서 언급한 대로 200건 단일 표본 튜닝. 오탐/누락률을 통계적으로 확정하지 못했다.
- **필터 3단계 모두 뉴스 항목에만 적용됨** — 공시 항목 간의 dedupe(예: 같은 공시가 정정 공시로 재접수되는 케이스, `report_nm`의 `[기재정정]` 접두사)는 이번 범위에서 다루지 않았다. `plan/mcp-실행계획.md`가 언급한 `rm` 필드(비고)나 `report_nm` 접두사 파싱은 스트림 정규화 자체와는 별개 과제로 남겨둔다.

# S2B-naver — `isnow890/naver-search-mcp` 크레덴셜 판정 + 뉴스 캡처

## 판정 : 통과

---

## 최우선 과제 — 크레덴셜 체계 판정

**결론: NAVER API HUB (`NCP_APIGW_API_KEY_ID` / `NCP_APIGW_API_KEY`) 확정.** `.env`를 수정해 레거시 변수(`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`, 어차피 같은 값의 중복 보관이었음)를 삭제하고 판정 근거를 주석으로 남겼다.

### 실측 결과 (조건별 `search_news` 호출)

| 조건 | env | 결과 | 캡처 |
|---|---|---|---|
| A | `NCP_APIGW_API_KEY_ID` + `NCP_APIGW_API_KEY` 만 | **성공** — 실뉴스 데이터 반환 | `S2B-naver-credtest-A_hub_only.json` |
| B | `NAVER_CLIENT_ID` + `NAVER_CLIENT_SECRET` 만 (같은 값) | **실패** — HTTP 401 | `S2B-naver-credtest-B_legacy_only.json` |
| C | 둘 다 | **성공**, 서버가 `Using NAVER API HUB` 로그 출력 | `S2B-naver-credtest-C_both.json` |

조건 B의 에러 메시지 원문 (`content[0].text`, `isError: true`):
```
[네이버 개발자센터] HTTP 401 — https://openapi.naver.com/v1/search/news
{"errorMessage":"NID AUTH Result Invalid (1000) : Authentication failed. (인증에 실패했습니다.)","errorCode":"024"}
인증에 실패했습니다. NAVER API HUB 키를 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET에 넣지 않았는지 확인하세요. HUB 키는 NCP_APIGW_API_KEY_ID/NCP_APIGW_API_KEY에 넣어야 합니다.
```
서버가 자체적으로 이 실수를 짐작해 안내 메시지까지 붙여준다 — 즉 서버 제작자도 "같은 값을 잘못된 변수명에 넣는" 이 정확한 실수를 예상하고 있었다.

패키지 소스(`npx` 캐시에서 `npm pack`으로 직접 확인, `dist/src/config/credentials.js`)도 판정을 뒷받침한다:
```js
// HUB 쌍이 legacy 쌍보다 우선한다.
if (hubId && hubSecret) return { provider: "hub", ... };
...
if (legacyId && legacySecret) return { provider: "legacy", ... };
```
엔드포인트도 물리적으로 다르다 (`dist/src/clients/naver-api-endpoints.js`):
- legacy: `https://openapi.naver.com/v1/search`, 헤더 `X-Naver-Client-Id`/`X-Naver-Client-Secret`
- hub: `https://naverapihub.apigw.ntruss.com/search/v1`, 헤더 `X-NCP-APIGW-API-KEY-ID`/`X-NCP-APIGW-API-KEY`

**`.env`의 두 이름이 같은 값(10자/40자)을 담고 있었던 것도 확인됨** — 값 자체는 안 바꿨고 변수만 정리했다. 최초 추정("40자는 HUB 형식일 것")이 실측으로 확정됐다.

---

## 캡처한 것

| 툴 | 캡처 파일 | 응답 형상 요약 |
|---|---|---|
| `search_news` (A/B/C 조건별, query="테스트", display=1) | `S2B-naver-credtest-{A_hub_only,B_legacy_only,C_both}.json`, `S2B-naver-credtest-summary.json` | A/C 성공(뉴스 아이템), B 실패(401 에러 텍스트) |
| `search_news` query="삼성전자" sort="date" display=100 | `S2B-naver-news-date.json` | `content[0].text` = 문자열화 JSON, `structuredContent: null` |
| `search_news` query="삼성전자" sort="sim" display=100 | `S2B-naver-news-sim.json` | 동일 형상, sim 정렬 |
| `list_tools()` 전문 | `S2B-naver-tools.json` | 18개 툴 (search 8종 + datalab 9종 + `find_category`) |

`serverInfo`: `{name: "naver-search", version: "1.0.49"}`. `protocolVersion: 2025-06-18` (Everything 서버가 보고한 `2025-11-25`와 다름 — 서버마다 지원 프로토콜 리비전이 다르다는 기존 관찰 재확인).

---

## 데이터 형상 → 캔버스 착지

**신규① 스트림.** `search_news` 응답 아이템은 스트림 캔버스가 요구하는 필드(`ts`/`source`/`title`/`url`)에 그대로 매핑 가능:
- `pubDate` → `ts`
- `originallink` 도메인 → `source`
- `title` → `title` (단, sanitize 필수 — 아래 참조)
- `link`(네이버 자체 링크, 항상 `n.news.naver.com` 계열) 또는 `originallink`(언론사 원문) → `url` 후보 2개. **`link`는 네이버가 재호스팅한 사본, `originallink`는 진짜 출처** — 캔버스 표시엔 `originallink`가 더 적합해 보이나 `link`가 종종 더 오래 살아있을 가능성 있음(미검증).
- `description` → 선택 `summary`
- `kind`는 이 툴 하나로는 항상 `"news"` 고정 — 공시 등 다른 소스와 합칠 때 클라이언트가 주입해야 함.

뉴스와 공시가 "같은 형상"이라는 계획의 전제는 필드 이름 수준에서는 안 맞는다(공시는 `disclosure_list` 계열 필드가 다름 — S2B-jjlabsio 캡처 참조 필요) — 게이트웨이가 정규화 어댑터를 둬야 한다.

---

## 응답 필드 분석 (스트림 캔버스 설계 직결)

**필드**: 정확히 `title`, `originallink`, `link`, `description`, `pubDate` 5개. API HUB로 이관됐어도 **레거시 `openapi.naver.com`과 필드명이 동일**하다 — 이관에 따른 필드 변경 없음.

**HTML 태그·엔티티 실제로 섞여 옴 — 확인, 매 아이템 100%.**
- `<b>` 태그: `sort=date`/`sort=sim` 양쪽 다 **100/100 아이템**의 `title` 또는 `description`에 등장 (검색어 하이라이트용). 실제 예:
  ```
  "title": "대한민국 성인 5명 중 1명이 <b>삼성전자</b> 주주…'800만 개미' 시대 눈앞"
  "description": "이전까지 <b>삼성전자</b> 같은 대형주 위주로 투자했던 박씨는..."
  ```
- HTML 엔티티: `&quot;`/`&amp;` 가 `sort=date`에서 24/100, `sort=sim`에서 26/100 아이템에 등장. 실제 예:
  ```
  "title": "&quot;성인 5명 중 1명은 주주&quot;…800만 개미들 <b>삼성</b>에 몰렸다"
  "title": "<b>삼성전자</b>, 상반기 R&amp;D·시설투자 55조 '역대 최대'"
  ```
  **→ 스트림 캔버스는 `<b>` 스트립 + HTML 엔티티 언이스케이프(`&quot;`→`"`, `&amp;`→`&`)를 렌더링 전 필수로 적용해야 한다.** 태그를 그대로 두면 XSS는 아니지만(자체 태그만 옴, `<script>` 등은 안 보임 — 이번 캡처 범위에서 다른 태그는 관찰 안 됨) UI에 raw `<b>`가 노출된다.

**`pubDate` 포맷**: RFC 822 맞음. 예: `"Sat, 15 Aug 2026 00:43:00 +0900"` — `email.utils.parsedate_to_datetime` 또는 표준 RFC822 파서로 바로 파싱 가능. 타임존은 항상 `+0900`(KST) 고정으로 보임(100개 샘플 전부 동일 오프셋).

**`structuredContent`**: 두 호출 모두 `null`. `list_tools()`의 `search_news` 정의에 `outputSchema: null` — 이 서버는 output schema를 선언하지 않아 (`@drfirst/korea-stock-mcp`와 달리) structuredContent가 항상 비어 있다. 게이트웨이는 `content[0].text`를 JSON 파싱하는 경로에 의존해야 한다 (RESULT.md가 이미 정리한 우선순위 규칙과 일치).

**중복도 측정 (100건 기준, `originallink` 도메인 + 태그 제거·비영숫자 제거 정규화 제목으로 측정)**:

| 정렬 | 고유 도메인 수 | 정규화-제목 중복 그룹 | 중복 커버 아이템 | `originallink` 완전 중복 |
|---|---|---|---|---|
| `sort=date` | 69/100 | **0개** | 0 | 0 |
| `sort=sim` | 51/100 | **7개** | 15 | 0 |

- **`sort=date`(최신순)에서는 100건 중 재배포 중복이 0건**이었다 — 최신순은 각기 다른 시각에 발행된 서로 다른 기사가 나열되어 같은 사건이라도 문구가 미세하게 달라 정확 매치가 안 걸린 것으로 보인다(단, 이건 "정확히 동일 제목" 기준이라 느슨한 유사도 기준으로 다시 재면 더 나올 수 있음 — 미검증).
- **`sort=sim`(유사도순)에서는 15/100건이 7개 그룹으로 정확히 동일한 제목**으로 재배포됐다. 실제 사례 (도메인 다르지만 제목 완전 동일):
  ```
  삼성전자 상반기 D램 점유율 39.4%…스마트폰도 22%로 상승
    → biz.chosun.com, www.yna.co.kr, news.sbs.co.kr (3개 매체, 동일 제목)
  삼성전자, 딥러닝·데이터 전문가 영입…반도체 AX 가속
    → www.etnews.com, www.bloter.net (2개 매체)
  ```
  `originallink`는 매체마다 달라 URL 기준 dedup은 불가능하고, **제목 정규화(태그 제거 + 비영숫자 제거) 매치가 실제로 작동**함을 확인. 단 `www.newspim.com`/`www.sedaily.com` 쌍처럼 **구두점만 다른("55조 '역대 최대'" vs "55조…역대 최대") 경우는 정규화해도 문장부호 위치 차이로 안 걸릴 수 있어** 이번 정규화 함수(구두점 완전 제거)로는 걸렸지만, 더 느슨한 정규화가 아니면 놓치는 케이스가 있을 수 있다.
  → **결정론 필터 설계 근거**: `sort=date`만 쓰면(뉴스 파수꾼이 최신순으로 폴링할 가능성이 높음) 이번 표본에서는 중복이 거의 안 보였지만, 표본이 크거나(예: 하루 전체) 인기 이슈가 여러 매체에 동시 배포되면 `sort=sim`에서 본 것과 유사한 패턴(같은 사건, 동일 문구, 다른 도메인)이 나타날 수 있다. **제목 정규화 매치를 1차 필터로 쓰되, 도메인+시각 근접도를 보조 신호로 두는 게 안전.**

---

## 한글 인코딩 : 정상

`spike/captures/S2B-naver-news-*.json`, `S2B-naver-credtest-*.json` 전부 `�` 검색 결과 0건. 파일을 직접 열어 확인해도 `"삼성전자"`, `"딥러닝"` 등 한글이 손상 없이 정상 저장됨.

⚠️ **함정 재확인 (RESULT.md가 이미 경고한 것과 동일 패턴)**: 이번 작업 중 `python -c "print(...)"` 결과를 bash 툴로 확인했을 때 `"���� �����巡�� C..."` 식으로 깨져 보였다. 이건 **터미널 콘솔 코드페이지(cp949)가 만든 표시 아티팩트**였고, `Path.write_text(..., encoding="utf-8")`로 저장한 실제 캡처 파일은 (Read 툴로 직접 열어) 전부 정상임을 확인했다. `search_news`(Node/TS SDK, HTTP 클라이언트 axios) 쪽은 `@drfirst/korea-stock-mcp`가 보였던 "서버→클라이언트 방향 비가역 손상"이 **재현되지 않는다** — RESULT.md가 남긴 "이게 이 Windows 환경의 자식 프로세스 stdio 문제인지, 특정 서버 구현 문제인지 미규명" 질문에 대해, **최소한 모든 Node/npx 서버가 다 깨지는 건 아니라는 반증 사례**를 하나 더 추가한다(pykrx-mcp에 이어 naver-search-mcp도 정상 — 손상은 `@drfirst/korea-stock-mcp` 하나에 국한된 것으로 보이는 심증이 강해짐, 근본 원인은 여전히 미규명).

---

## 막힌 것 — 정직하게

1. **`link`(네이버 재호스팅 URL) vs `originallink`(언론사 원문) 중 어느 쪽이 캔버스에 더 적합한지 실제 수명(원문 삭제/이동 시 링크 생존율)을 검증하지 못했다.** 이번 스파이크는 단일 시점 스냅샷이라 시간 경과에 따른 링크 부패(link rot)는 관찰 범위 밖.
2. **`sort=sim`의 중복 그룹 탐지가 "정규화 후 완전 일치" 기준 하나로만 측정됐다.** 느슨한 유사도(Levenshtein, 토큰 자카드 등) 기준으로 다시 재면 위에서 언급한 구두점-only 차이 케이스처럼 더 많은 중복이 잡힐 가능성이 있다 — 결정론 필터의 정확한 임계값 튜닝은 이번 범위 밖.
3. **`display=100`이 API 상한인지 확인하지 않았다.** 네이버 뉴스 검색 API 공식 문서상 100이 상한으로 알려져 있으나, 이 스파이크에서 101 이상을 시도해 거부 응답을 직접 캡처하지는 않았다.
4. **`datalab_search` 등 나머지 17개 툴은 스키마만 `S2B-naver-tools.json`에 캡처됐고 실제 호출은 하지 않았다** — 과제 범위(`search_news`)를 벗어나므로 의도적으로 생략.
5. `link` 필드가 항상 `n.news.naver.com` 계열인지 100% 확정하지 못했다(육안 샘플링 기준 — 전수 검사는 안 함).

---

## 실행 방법 (재현 커맨드)

```bash
cd spike/mcp-client
.venv/Scripts/python.exe step4_naver_credtest.py   # A/B/C 판정
.venv/Scripts/python.exe step5_naver_stream.py      # 스트림 캔버스 근거 캡처 (HUB 조건)
```

`.env`는 이미 판정 결과대로 정리됨 (레거시 변수 삭제, 값은 불변).

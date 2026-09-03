# 백테스트 시각 설계 ↔ 코드 왕복 — 인계 (2026-09-03)

사용자 위계: **"코드는 최후의 보루. 대화로 코드 플로우 지도를 고치고, 그 지도 뒤에 코드가 있다."**
근거 문서: [왕복 구현 평가](../research/backtest-visual-code-roundtrip-implementation-evaluation.md) ·
[오픈소스 벤치마크](../research/backtest-visual-workflow-open-source-benchmark.md) ·
Paper `백테스트` 페이지 보드 11~14(시각 설계·연결 오류·오류 노드→코드 줄·동기화 완료, y=3560 행)와
15~18(흐름 지도 1급 표면·멈춤→대화·출처→지도·강화 명세, y=4760 행).

## 1. 무엇이 어떻게 됐나

| 층 | 파일 | 역할 |
|---|---|---|
| 백엔드 | `backend/athena_api/backtest/visual_registry.py` | 지표 registry에서 노드 종류 38개·typed port를 만든다(손으로 베낀 목록 없음) |
| | `visual_schema.py` | `VisualStrategyGraph v1` 모델, `validate_graph`(BTG-* 진단, 노드·포트 귀속), `compile_graph`→정규화 `StrategySpec`, `spec_to_graph`, 해시 |
| | `visual_repair.py` | 막는 진단 하나에 질문 하나(`questions_for`), allowlist JSON Patch·spec/code diff·`summary_ko`(`build_patch`) |
| | `codegen.py` | 그래프→코드(`# node: <id>` marker) + authoritative 소스맵, invalid 그래프의 결정적 미리보기(`__MISSING__`, `executable=false`) + provisional 맵 |
| | `mapmodel.py` | 칸 ①~④ 사람 말 지도(폼 yaml/코드 소스 → 문장·실제 값·오류 귀속) |
| | `api/backtest_visual.py` | `/api/v1/backtest/visual/registry·validate·compile·question·patch·from-spec` — runner·store를 이름조차 안 부른다 |
| | `api/backtest.py` · `store.py` | origin `visual`·`code_only`(항상 비활성, `active_version_id` 불변), 버전 묶음 6열을 한 INSERT, apply receipt(409 stale·422 해시), `GET versions/{id}` |
| | `athena_mcp/backtest_tools.py` | `map`·`codegen`·`visual_*` 6개 액션, `visual_question`/`visual_patch`는 채팅 카드 봉투 |
| 앱 | `app/lib/backtest-visual-editor.js` | 팔레트·노드/포트/엣지 캔버스·검사기·검증 요약 바·목록 보기·키보드·drawer·undo/redo(UMD, 의존성 없음) |
| | `app/lib/backtest-canvas.js` | 지도 탭 = 요약 지도(칸 ①~④) 위 + 편집기 아래. 디바운스 검증→valid면 컴파일→폼이 spec을 따라옴. `openCodeAt`(authoritative/preview, 해시 stale이면 안내만). 질문/패치/적용/409/코드 전용 분기/이력 되열기. 세션 워크스페이스 register/report |
| | `app/lib/backtest-explain.js` | 요약 지도 렌더(대상 한 줄·칸·실제 값·방금 바뀜·서랍) |
| | `app/lib/backtest-code-editor.js` | `openSpan`·연결 노드 리본·미실행 미리보기 모드·`spanIsValid` |
| | `app/chat.js` | 카드: 지도 반영 · 한 가지만 확인할게요 · 그래프+코드 패치 · 동기화 완료 · 다시 검토; 캔버스 영수증 이벤트 리스너 |
| | `app/lib/main/live-prompt.js` | 접두에 그래프 블록(노드 id·진단 code·검증 상태·해시)과 "질문 하나→패치 미리보기→사람 적용" 규칙 |
| | `app/main.js` · `preload.js` · `canvas.js` | 채널 `athena:backtest-map/-codegen/-visual-*(7)/-version-detail` |

상태 전이(문서 §"Paper 네 상태"): 편집 → 서버 검증 → invalid면 노드 진단 + preview span → 질문 하나 →
비활성 patch 미리보기 → 사람 [적용] → 재검증·컴파일 → `origin=visual, is_active=false` 원자 저장 → 실행 전 검토.
어느 단계도 run·backfill·activate·deploy를 자동으로 부르지 않는다(테스트가 monkeypatch로 증명).

## 2. 검증 방법

```bash
cd backend && rtk proxy uv run pytest -q -p no:randomly tests/unit tests/api tests/mcp -k "backtest or visual or codegen or source_map"
```

```bash
cd app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js
```

실앱 프로브(백엔드 8010에 `ATHENA_BACKTEST_ENABLED=true`, 005930 일봉 캐시 필요):

```bash
cd app && ATHENA_PROBE_SECTIONS=G,N,K,O npx electron probe-backtest-full.js
```

섹션 G·N = 흐름 지도 1급 표면(보드 15·16), K = 채팅 액션, O = 시각 설계 네 상태(보드 11~14).
전수는 `ATHENA_PROBE_SECTIONS` 없이. 결과는 `artifacts/backtest-tour/full-probe.json`.

## 3. 계약에서 알아둘 것

- `graph_hash`는 `ui`를 뺀 정규 JSON의 sha256이고 노드·엣지 순서에 민감하다. `apply_receipt`의 `base_artifact_hash`는 base 그래프가 컴파일될 때만 있다.
- `/visual/compile`은 `spec_yaml`(블록 스타일)과 함께 `spec`(JSON)을 준다 — 렌더러는 JSON을 쓴다.
- 소스맵 span은 줄 1-based·열 0-based(ast `col_offset`). 소스맵 묶음에는 `kind: authoritative|preview`가 있다.
- `normalize_spec`은 조건 1개짜리 묶음의 `OR`를 `AND`로 접는다(의미 동일).
- 코드 전용 버전(`code_only`)에는 그래프를 저장할 수 없다(422) — 지도 탭은 마지막 호환 그래프를 읽기 전용 스냅샷으로만 보인다.
- `app/preload.js`에는 HEAD부터 UTF-8이 아닌 바이트 줄이 하나 있다 — 텍스트 왕복 패치는 그 줄을 깨뜨리니 바이트 패치만 쓴다.

## 4. 남은 것 (P4 · 문서 §"구현 단계와 난이도")

- undo/redo 영속·대형 그래프·자동 배치·IME 검증·정량 성능(50/80 그래프 validate p95 ≤ 300ms 등 제안 budget) — 측정 전.
- 편집기 렌더러 graduate gate(Rete.js + Lit 비교)는 P4 측정 뒤에만 결정한다.
- 보드 17(출처 URL → 5단계 진행 띠)은 설계만 있다 — 현재는 채팅 도구 단계 라벨로만 진행이 보인다.
- 삭제 API가 없어 프로브가 만든 전략·버전은 남는다(섹션 Z가 id를 남긴다).
